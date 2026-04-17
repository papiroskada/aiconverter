import { logger } from '../logger.js'
import {
  extractCConstants, extractCIncludes, extractCServiceCalls,
  extractCDbCalls, extractCErrors, extractCModes,
  extractCCallGraph, findCPreDispatch, extractUDeps,
} from '../parser/cParser.js'
import { C_BUSINESS_ANALYSIS_PROMPT, C_ANALYZE_ENTRY_POINT_PROMPT } from './prompts.js'

const TOKEN_LIMIT = 80000

export function estimateCTokens(text) {
  return Math.ceil(text.length / 4)
}

function formatModes(modes, constants) {
  if (!modes.length) return '  (none)'
  const constMap = new Map(constants.map(c => [c.name, c.value]))
  return modes.map(m =>
    `  switch(${m.switchVar}):\n` +
    m.cases.map(c => {
      const val = constMap.get(c.constant) ?? '?'
      return `    ${c.constant} (${val}) → ${c.callTarget}`
    }).join('\n')
  ).join('\n')
}

function formatDbCalls(dbCalls) {
  if (!dbCalls.length) return '  (none)'
  return dbCalls.map(d => `  ${d.table}: ${d.operation}`).join('\n')
}

function formatErrors(errors) {
  if (!errors.length) return '  (none)'
  return errors.map(e => `  ${e.code} (${e.field})`).join(', ')
}

function buildCStructural(cText, uText, chunks) {
  const constants    = extractCConstants(cText)
  const includes     = extractCIncludes(cText)
  const serviceCalls = extractCServiceCalls(cText)
  const dbCalls      = extractCDbCalls(cText)
  const errors       = extractCErrors(cText)
  const modes        = extractCModes(cText)
  const uDeps        = extractUDeps(uText)
  const preDispatch  = findCPreDispatch(chunks)

  const svcList   = serviceCalls.length ? serviceCalls.map(s => `  ${s}`).join('\n') : '  (none)'
  const constList = constants.length ? constants.map(c => `  ${c.name} = ${c.value}`).join('\n') : '  (none)'
  const includeList = [...new Set([...includes, ...uDeps])].join(', ') || 'none'
  const preList   = preDispatch.length ? preDispatch.join(', ') : '(none)'

  return [
    `MODE DISPATCH:\n${formatModes(modes, constants)}`,
    `PRE-DISPATCH FUNCTIONS (run before every mode): ${preList}`,
    `SERVICE CALLS (svcCallSvc):\n${svcList}`,
    `DATABASE CALLS (svcCallPlnsqlio):\n${formatDbCalls(dbCalls)}`,
    `ERROR CALLS: ${formatErrors(errors)}`,
    `CONSTANTS:\n${constList}`,
    `INCLUDES: ${includeList}`,
  ].join('\n\n')
}

function buildCContext(structural, chunks) {
  const fnList = chunks
    .map(c => `[${c.chunk_name}]\n${c.cobol_text}`)
    .join('\n\n')
  return `${structural}\n\nFUNCTIONS:\n${fnList || '(none)'}`
}

function buildCEntryPointContext(structural, chunks, funcNames, callGraph, preDispatch) {
  const allNames = new Set([...preDispatch, ...funcNames])
  // Resolve transitive calls
  const queue = [...allNames]
  while (queue.length) {
    const curr = queue.shift()
    for (const dep of (callGraph.get(curr) ?? [])) {
      if (!allNames.has(dep)) { allNames.add(dep); queue.push(dep) }
    }
  }
  const relevant = chunks.filter(c => allNames.has(c.chunk_name))
  const fnList = relevant.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n')
  return `${structural}\n\nFUNCTIONS:\n${fnList || '(none)'}`
}

function mapResult(spec, preDispatch = [], twoStep = false) {
  const params = spec.parameters ?? []
  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(params.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(params.filter(p => p.direction === 'out' || p.direction === 'inout')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  [],
    pre_dispatch:      preDispatch,
    analysis_two_step: twoStep,
  }
}

export async function runCAnalysis({ cText, uText, chunks, provider, emit, programName, signal }) {
  const structural = buildCStructural(cText, uText ?? '', chunks)
  const fullContext = buildCContext(structural, chunks)
  const callGraph   = extractCCallGraph(chunks)
  const preDispatch = findCPreDispatch(chunks)

  function logAndEmit(type, data) {
    logger[type](programName, data.message, data.durationMs)
    emit('progress', data)
  }

  logAndEmit('start', { stage: 'analysis', message: 'Analysing C business logic...' })
  emit('progress', { stage: 'step', step: 1, total: 2 })

  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })

  let spec

  if (estimateCTokens(fullContext) <= TOKEN_LIMIT) {
    spec = await provider.extractBusinessAnalysis(fullContext, signal, 'c')
    logAndEmit('done', { stage: 'analysis', message: 'C analysis complete' })
    emit('progress', { stage: 'step', step: 2, total: 2 })
    return mapResult(spec, preDispatch, false)
  }

  // Large file: 5-line snippets for step 1
  const snippetChunks = chunks.map(c => ({
    ...c,
    cobol_text: c.cobol_text.split('\n').slice(0, 5).join('\n'),
  }))
  const snippetContext = buildCContext(structural, snippetChunks)

  logAndEmit('start', { stage: 'analysis', message: 'Large C file — step 1: identifying entry points' })
  spec = await provider.extractBusinessAnalysis(snippetContext, signal, 'c')

  const entryPoints = spec.entryPoints ?? []
  if (entryPoints.length > 0) {
    logAndEmit('start', { stage: 'analysis', message: `Step 2: analysing ${entryPoints.length} entry point(s)` })
    emit('progress', { stage: 'step', step: 2, total: 2 })

    const detailed = await Promise.all(
      entryPoints.map(async (ep) => {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
        const names = ep.paragraphNames ?? []
        if (!names.length) return ep
        try {
          const epContext = buildCEntryPointContext(structural, chunks, names, callGraph, preDispatch)
          const detail = await provider.analyzeEntryPoint(ep.condition, ep.businessName, epContext, signal, 'c')
          return { ...ep, ...detail }
        } catch (err) {
          if (err.name === 'AbortError') throw err
          logger.error(programName, `Entry point detail failed: ${err.message}`)
          return ep
        }
      })
    )
    spec = { ...spec, entryPoints: detailed }
  }

  logAndEmit('done', { stage: 'analysis', message: 'C analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })
  return mapResult(spec, preDispatch, true)
}

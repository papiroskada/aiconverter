import { logger } from '../logger.js'
import { extractLinkageVars, extractWorkingStorage, extractEvaluateDispatch, extractPerformGraph, resolveTransitive, collectMissingParagraphs, extractEnumCandidates, extractRedefinesMap } from '../parser/cobolParser.js'
import { extractCalls, extractExecSql, extractConstructs, extractTuxTables, extractErrorEntries, buildPicTypeMap, extractDataFlow } from '../parser/cobolExtractor.js'

const TOKEN_LIMIT = 80000   // above this → two-step
const MODEL_LIMIT = 100000  // above this → shrink snippets further

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function picToType(pic) {
  if (!pic) return 'object'
  if (/^X/i.test(pic)) return 'string'
  if (/^[S9]/i.test(pic)) return 'number'
  return 'string'
}

function cobolToCamel(name) {
  return name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase())
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

function conditionValue(c) {
  if (c.value !== undefined) return c.value  // old cached records
  return (c.values ?? []).map(v => v.value ?? `${v.from} THRU ${v.to}`).join(', ')
}

function formatWsVars(wsVars) {
  if (!wsVars.length) return '  (none)'
  return wsVars.map(v => {
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}`
    const conditions = (v.conditions ?? []).map(c => `     88 ${c.name} = ${conditionValue(c)}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

function formatLinkageVars(linkageVars) {
  if (!linkageVars.length) return '  (none)'
  return linkageVars.map(v => {
    const dir = v.direction ? ` [${v.direction}]` : ''
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}${dir}`
    const conditions = (v.conditions ?? []).map(c => `     88 ${c.name} = ${conditionValue(c)}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

// CAPI Rule 22a: paragraphs PERFORMed before the EVALUATE dispatch run before
// every mode and must be included in every entry point's context.
function findPreDispatchParagraphs(paragraphChunks) {
  const dispatchChunk = paragraphChunks.find(c => /\bEVALUATE\b/i.test(c.cobol_text))
  if (!dispatchChunk) return []

  const preDispatch = []
  for (const line of dispatchChunk.cobol_text.split('\n')) {
    if (/\bEVALUATE\b/i.test(line)) break
    const m = line.match(/\bPERFORM\s+([A-Z][A-Z0-9-]+)/i)
    if (m) {
      const name = m[1].toUpperCase()
      if (!['UNTIL', 'VARYING', 'TIMES', 'WITH', 'THRU', 'THROUGH', 'TEST'].includes(name)) {
        preDispatch.push(name)
      }
    }
  }
  return [...new Set(preDispatch)]
}

function buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames, missingParagraphs = new Set()) {
  const callList = calls.map(c => `  CALL '${c.program}'${c.using ? ` USING ${c.using}` : ''}`).join('\n') || '  (none)'
  const fileList = selectFiles.join('\n') || '  (none)'
  const sqlList  = execSqlTables.map(t => {
    const keyPart = t.keyFields?.length ? `  key: ${t.keyFields.join(', ')}` : ''
    const fieldPart = t.fields?.length ? `  fields: ${t.fields.join(', ')}` : ''
    return `  ${t.table}: ${t.operation}${keyPart}${fieldPart}`
  }).join('\n') || '  (none)'
  const tuxList  = tuxTables.map(t => {
    const keyPart = t.keyFields?.length ? `  key: ${t.keyFields.join(', ')}` : ''
    return `  ${t.table}: ${t.operation}${keyPart}`
  }).join('\n') || '  (none)'
  const errList  = errorEntries.length
    ? errorEntries.map(e => e.dataElement ? `${e.seqNo} (${e.dataElement})` : `${e.seqNo}`).join(', ')
    : 'none'
  const dispatchList = evaluateDispatch.length
    ? evaluateDispatch.map(d =>
        `  EVALUATE ${d.evaluateSubject}:\n${d.entries.map(e => `    WHEN ${e.whenValue} → PERFORM ${e.performParagraph}`).join('\n')}`
      ).join('\n')
    : '  (none)'
  const preList = preDispatchNames.length ? preDispatchNames.join(', ') : '(none)'

  const missingList = missingParagraphs.size > 0
    ? `WARNING — PERFORM targets not found as paragraph definitions (possible dynamic PERFORM or THRU gaps): ${[...missingParagraphs].join(', ')}`
    : null

  return [
    `LINKAGE SECTION VARIABLES:\n${formatLinkageVars(linkageVars)}`,
    `WORKING-STORAGE VARIABLES:\n${formatWsVars(wsVars)}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `DATABASE OPERATIONS (TUX MIDDLEWARE):\n${tuxList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
    `ENTRY POINT DISPATCH:\n${dispatchList}`,
    `PRE-DISPATCH PARAGRAPHS (shared by all entry points, run before every mode): ${preList}`,
    `ERROR ENTRIES: ${errList}`,
    ...(missingList ? [missingList] : []),
  ].join('\n\n')
}

function hasEvaluate(chunk) {
  return /\bEVALUATE\b/i.test(chunk.cobol_text)
}

function buildContext(structural, paragraphChunks, linesPerParagraph = Infinity) {
  const paragraphList = paragraphChunks.map(c => {
    let text
    if (linesPerParagraph === Infinity) {
      text = c.cobol_text
    } else if (hasEvaluate(c)) {
      // Always show dispatch paragraphs in full so AI sees the mode structure
      text = c.cobol_text
    } else {
      text = c.cobol_text.split('\n').slice(0, linesPerParagraph).join('\n')
    }
    return `[${c.chunk_name}]\n${text}`
  }).join('\n\n')
  return `${structural}\n\nPARAGRAPHS:\n${paragraphList || '(none)'}`
}

function buildEntryPointContext(structural, paragraphChunks, paragraphNames, performGraph, preDispatchNames) {
  // Always include pre-dispatch paragraphs + transitively expand all names (CAPI Rule 22a + 22b)
  const allNames = new Set([...preDispatchNames, ...paragraphNames])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) {
      allNames.add(dep)
    }
  }
  const relevant = paragraphChunks.filter(c => allNames.has(c.chunk_name))
  const paragraphList = relevant.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n')
  return `${structural}\n\nPARAGRAPHS:\n${paragraphList || '(none)'}`
}

export function serializePerformGraph(graph) {
  return Object.fromEntries([...graph.entries()].map(([k, v]) => [k, [...v]]))
}

export function deserializePerformGraph(obj) {
  return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]))
}

export function validateDbTables(dbTables, execSqlTables, tuxTables) {
  const knownTables = new Set([
    ...execSqlTables.map(t => t.table?.toUpperCase()).filter(Boolean),
    ...tuxTables.map(t => t.table?.toUpperCase()).filter(Boolean),
  ])
  if (knownTables.size === 0) return dbTables
  return dbTables.map(t => {
    const name = t.table?.toUpperCase() ?? ''
    return name && !knownTables.has(name) ? { ...t, ai_hallucinated: true } : t
  })
}

// Keep only entry points whose paragraphNames overlap with structural dispatch targets.
// When evaluateDispatch is empty (no EVALUATE found) we have no ground truth — keep everything.
export function filterEntryPoints(entryPoints, evaluateDispatch) {
  if (!evaluateDispatch || evaluateDispatch.length === 0) return entryPoints

  const dispatchTargets = new Set()
  for (const dispatch of evaluateDispatch) {
    for (const entry of dispatch.entries ?? []) {
      if (entry.performParagraph) dispatchTargets.add(entry.performParagraph.toUpperCase())
    }
  }
  if (dispatchTargets.size === 0) return entryPoints

  return entryPoints.filter(ep => {
    if (ep.condition === 'always') return true
    return (ep.paragraphNames ?? []).some(n => dispatchTargets.has(n.toUpperCase()))
  })
}

function mapResult(spec, linkageVars, preDispatch = [], twoStep = false, execSqlTables = [], tuxTables = [], evaluateDispatch = []) {
  const descMap = new Map((spec.parameters ?? []).map(p => [p.cobolName?.toUpperCase(), p.description ?? '']))

  const contracts = linkageVars.map(v => ({
    name: cobolToCamel(v.name),
    cobolName: v.name,
    type: picToType(v.pic),
    direction: v.direction ?? 'inout',
    description: descMap.get(v.name) ?? '',
  }))

  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(contracts.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(contracts.filter(p => p.direction !== 'in')),
    entry_points:          filterEntryPoints(spec.entryPoints ?? [], evaluateDispatch),
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: validateDbTables(spec.dbTables ?? [], execSqlTables, tuxTables),
    file_ops:  (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations })),
    pre_dispatch:      preDispatch,
    analysis_two_step: twoStep,
  }
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal, structuralCacheIn = null }) {
  const paragraphChunks = chunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')

  let linkageVars, wsVars, calls, execSqlTables, constructs, selectFiles, tuxTables, errorEntries, evaluateDispatch, performGraph, preDispatchNames, missingParagraphs
  let enumCandidates, redefines, picTypes, dataFlow

  if (structuralCacheIn) {
    logger.info(programName, 'Using cached structural data — skipping extraction')
    linkageVars      = structuralCacheIn.linkageVars
    wsVars           = structuralCacheIn.wsVars
    calls            = structuralCacheIn.calls
    execSqlTables    = structuralCacheIn.execSqlTables
    constructs       = structuralCacheIn.constructs
    selectFiles      = structuralCacheIn.selectFiles
    tuxTables        = structuralCacheIn.tuxTables
    errorEntries     = structuralCacheIn.errorEntries
    evaluateDispatch = structuralCacheIn.evaluateDispatch
    preDispatchNames = structuralCacheIn.preDispatchNames
    performGraph     = deserializePerformGraph(structuralCacheIn.performGraph)
    missingParagraphs = new Set(structuralCacheIn.missingParagraphs ?? [])
    enumCandidates   = structuralCacheIn.enumCandidates ?? []
    redefines        = structuralCacheIn.redefines ?? []
    picTypes         = structuralCacheIn.picTypes ?? {}
    dataFlow         = structuralCacheIn.dataFlow ?? {}
  } else {
    const tExtract = Date.now()
    logger.start(programName, 'Extracting structural data...')
    emit('progress', { stage: 'analysis', message: 'Extracting structural data...' })
    linkageVars      = extractLinkageVars(cobolText)
    wsVars           = extractWorkingStorage(cobolText)
    calls            = extractCalls(cobolText)
    execSqlTables    = extractExecSql(cobolText)
    constructs       = extractConstructs(cobolText)
    selectFiles      = extractSelectFiles(cobolText)
    tuxTables        = extractTuxTables(cobolText)
    errorEntries     = extractErrorEntries(cobolText)
    evaluateDispatch = extractEvaluateDispatch(cobolText)
    performGraph     = extractPerformGraph(paragraphChunks)
    preDispatchNames = findPreDispatchParagraphs(paragraphChunks)
    missingParagraphs = collectMissingParagraphs(performGraph)
    enumCandidates   = extractEnumCandidates(wsVars, linkageVars)
    redefines        = extractRedefinesMap(wsVars, linkageVars)
    picTypes         = buildPicTypeMap(wsVars, linkageVars)
    dataFlow         = extractDataFlow(paragraphChunks)
    logger.done(programName, `Structural extraction done — ${paragraphChunks.length} paragraphs, ${calls.length} calls, ${execSqlTables.length} SQL tables`, Date.now() - tExtract)
  }

  const structural = buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames, missingParagraphs)
  const fullContext = buildContext(structural, paragraphChunks)
  const tokenEstimate = estimateTokens(fullContext)

  logger.info(programName, `Context built — ~${tokenEstimate.toLocaleString()} tokens, ${paragraphChunks.length} paragraphs`)
  logAndEmit(emit, programName, 'start', { stage: 'analysis', message: 'Analysing business logic...' })
  emit('progress', { stage: 'step', step: 1, total: 2 })

  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })

  let spec

  const _buildCache = () => structuralCacheIn ?? {
    linkageVars, wsVars, calls, execSqlTables, constructs, selectFiles,
    tuxTables, errorEntries, evaluateDispatch, preDispatchNames,
    missingParagraphs: [...missingParagraphs],
    performGraph: serializePerformGraph(performGraph),
    enumCandidates, redefines, picTypes, dataFlow,
  }

  if (tokenEstimate <= TOKEN_LIMIT) {
    // ── Small file: one AI call with full paragraph code ───────────────────
    logger.start(programName, `AI call: extractBusinessAnalysis (~${tokenEstimate.toLocaleString()} tokens)`)
    emit('progress', { stage: 'analysis', message: 'Sending to AI for analysis...' })
    const tAi = Date.now()
    spec = await provider.extractBusinessAnalysis(fullContext, signal)
    logger.done(programName, 'AI call complete', Date.now() - tAi)
    logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
    emit('progress', { stage: 'step', step: 2, total: 2 })
    return { result: mapResult(spec, linkageVars, preDispatchNames, false, execSqlTables, tuxTables, evaluateDispatch), structuralCache: _buildCache() }
  }

  // ── Large file: two-step ───────────────────────────────────────────────
  const snippetLines = estimateTokens(buildContext(structural, paragraphChunks, 5)) > MODEL_LIMIT ? 3 : 5
  const snippetContext = buildContext(structural, paragraphChunks, snippetLines)
  const snippetTokens = estimateTokens(snippetContext)

  logAndEmit(emit, programName, 'start', {
    stage: 'analysis',
    message: `Large file — step 1: identifying entry points (${snippetLines}-line snippets, ~${snippetTokens.toLocaleString()} tokens)`,
  })
  logger.start(programName, `AI call step 1: extractBusinessAnalysis with snippets (~${snippetTokens.toLocaleString()} tokens)`)
  const tStep1 = Date.now()
  spec = await provider.extractBusinessAnalysis(snippetContext, signal)
  logger.done(programName, `Step 1 complete — ${spec.entryPoints?.length ?? 0} entry point(s) found`, Date.now() - tStep1)

  const entryPoints = spec.entryPoints ?? []
  if (entryPoints.length > 0) {
    logAndEmit(emit, programName, 'start', {
      stage: 'analysis',
      message: `Step 2: analysing ${entryPoints.length} entry point(s) in detail`,
    })
    emit('progress', { stage: 'step', step: 2, total: 2 })

    const tStep2 = Date.now()
    const detailed = await Promise.all(
      entryPoints.map(async (ep) => {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
        const names = ep.paragraphNames ?? []
        if (names.length === 0) return ep
        try {
          const epContext = buildEntryPointContext(structural, paragraphChunks, names, performGraph, preDispatchNames)
          logger.info(programName, `AI call step 2: analyzeEntryPoint "${ep.businessName}" (~${estimateTokens(epContext).toLocaleString()} tokens)`)
          const detail = await provider.analyzeEntryPoint(ep.condition, ep.businessName, epContext, signal)
          return { ...ep, ...detail }
        } catch (err) {
          if (err.name === 'AbortError') throw err
          logger.error(programName, `Entry point detail failed for "${ep.businessName}": ${err.message}`)
          return ep
        }
      })
    )
    logger.done(programName, `Step 2 complete — ${entryPoints.length} entry point(s) analysed`, Date.now() - tStep2)
    spec = { ...spec, entryPoints: detailed }
  }

  logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })
  return { result: mapResult(spec, linkageVars, preDispatchNames, true, execSqlTables, tuxTables, evaluateDispatch), structuralCache: _buildCache() }
}

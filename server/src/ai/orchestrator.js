import { logger } from '../logger.js'
import { extractLinkageVars, extractWorkingStorage, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../parser/cobolParser.js'
import { extractCalls, extractExecSql, extractConstructs, extractTuxTables, extractErrorEntries } from '../parser/cobolExtractor.js'

const TOKEN_LIMIT = 80000   // above this → two-step
const MODEL_LIMIT = 100000  // above this → shrink snippets further

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

function formatWsVars(wsVars) {
  if (!wsVars.length) return '  (none)'
  return wsVars.map(v => {
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

function formatLinkageVars(linkageVars) {
  if (!linkageVars.length) return '  (none)'
  return linkageVars.map(v => {
    const dir = v.direction ? ` [${v.direction}]` : ''
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}${dir}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
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

function buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames) {
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

function mapResult(spec, preDispatch = [], twoStep = false) {
  const params = spec.parameters ?? []
  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(params.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(params.filter(p => p.direction !== 'in')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations })),
    pre_dispatch:      preDispatch,
    analysis_two_step: twoStep,
  }
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal }) {
  const paragraphChunks = chunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')

  const linkageVars      = extractLinkageVars(cobolText)
  const wsVars           = extractWorkingStorage(cobolText)
  const calls            = extractCalls(cobolText)
  const execSqlTables    = extractExecSql(cobolText)
  const constructs       = extractConstructs(cobolText)
  const selectFiles      = extractSelectFiles(cobolText)
  const tuxTables        = extractTuxTables(cobolText)
  const errorEntries     = extractErrorEntries(cobolText)
  const evaluateDispatch = extractEvaluateDispatch(cobolText)
  const performGraph     = extractPerformGraph(paragraphChunks)
  const preDispatchNames = findPreDispatchParagraphs(paragraphChunks)

  const structural = buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames)
  const fullContext = buildContext(structural, paragraphChunks)

  logAndEmit(emit, programName, 'start', { stage: 'analysis', message: 'Analysing business logic...' })
  emit('progress', { stage: 'step', step: 1, total: 2 })

  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })

  let spec

  if (estimateTokens(fullContext) <= TOKEN_LIMIT) {
    // ── Small file: one call with full paragraph code ──────────────────────
    spec = await provider.extractBusinessAnalysis(fullContext, signal)
    logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
    emit('progress', { stage: 'step', step: 2, total: 2 })
    return mapResult(spec, preDispatchNames, false)
  }

  // ── Large file: two-step ───────────────────────────────────────────────
  const snippetLines = estimateTokens(buildContext(structural, paragraphChunks, 5)) > MODEL_LIMIT ? 3 : 5
  const snippetContext = buildContext(structural, paragraphChunks, snippetLines)

  logAndEmit(emit, programName, 'start', {
    stage: 'analysis',
    message: `Large file — step 1: identifying entry points (${snippetLines}-line snippets)`,
  })

  spec = await provider.extractBusinessAnalysis(snippetContext, signal)

  const entryPoints = spec.entryPoints ?? []
  if (entryPoints.length > 0) {
    logAndEmit(emit, programName, 'start', {
      stage: 'analysis',
      message: `Step 2: analysing ${entryPoints.length} entry point(s) in detail`,
    })

    emit('progress', { stage: 'step', step: 2, total: 2 })

    // parallel detail analysis per entry point
    const detailed = await Promise.all(
      entryPoints.map(async (ep) => {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
        const names = ep.paragraphNames ?? []
        if (names.length === 0) return ep
        try {
          const epContext = buildEntryPointContext(structural, paragraphChunks, names, performGraph, preDispatchNames)
          const detail = await provider.analyzeEntryPoint(ep.condition, ep.businessName, epContext, signal)
          return { ...ep, ...detail }
        } catch (err) {
          if (err.name === 'AbortError') throw err
          logger.error(programName, `Entry point detail failed for "${ep.businessName}": ${err.message}`)
          return ep
        }
      })
    )
    spec = { ...spec, entryPoints: detailed }
  }

  logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })
  return mapResult(spec, preDispatchNames, true)
}

import { readFileSync } from 'fs'
import { findProgramById } from '../models/programs.js'
import { getAnalysisByProgramId } from '../models/programAnalysis.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { getSettings } from '../models/settings.js'
import { getProvider } from '../ai/providers/base.js'
import { deserializePerformGraph } from '../ai/orchestrator.js'
import { resolveTransitive } from '../parser/cobolParser.js'
import { extractTuxTableSchemas, extractWsConstants } from '../parser/cobolExtractor.js'

function formatParams(contractJson) {
  if (!contractJson) return '  (none)'
  let params
  try { params = JSON.parse(contractJson) } catch { return '  (parse error)' }
  if (!params.length) return '  (none)'
  return params.map(p => `  ${p.name} (${p.type}${p.direction ? `, ${p.direction}` : ''}) — ${p.description || p.cobolName}`).join('\n')
}

function formatTableSchemas(dbTables, tableSchemas) {
  const usedTables = (dbTables ?? []).filter(t => !t.ai_hallucinated)
  if (!usedTables.length) return '  (none)'

  return usedTables.map(t => {
    const keys = t.keyFields?.length ? `; key: ${t.keyFields.join(', ')}` : ''
    const nf = t.notFoundAction ? `; if not found: ${t.notFoundAction}` : ''
    const header = `  ${t.table} (${t.operation}${keys}${nf})`

    const fields = tableSchemas[t.table]
    if (!fields?.length) return header

    const keySet = new Set((t.keyFields ?? []).map(k => k.toUpperCase().replace(/_/g, '-')))
    const fieldLines = fields.map(f => {
      const isKey = keySet.has(f.name) ? ' [KEY]' : ''
      const camel = f.name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase())
      return `    ${f.name} → ${camel} (${f.pic}, ${f.type})${isKey}`
    }).join('\n')
    return `${header}\n${fieldLines}`
  }).join('\n\n')
}

function buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants) {
  const ep = analysis._selectedEntryPoint

  const errorList = (analysis.error_catalog ?? [])
    .map(e => `  ${e.code}${e.businessMeaning ? ` — ${e.businessMeaning}` : ''}${e.systemAction ? `; ${e.systemAction}` : ''}`)
    .join('\n') || '  (none)'

  const depList = (analysis.external_dependencies ?? [])
    .map(d => `  ${d.program}: ${d.purpose}; in: ${d.dataIn ?? '?'}; out: ${d.dataOut ?? '?'}`)
    .join('\n') || '  (none)'

  const preDispatch = (analysis.pre_dispatch ?? []).join(', ') || '(none)'

  const steps = (ep.steps ?? []).map((s, i) => `  ${i + 1}. ${s}`).join('\n') || '  (none)'
  const sideEffects = (ep.sideEffects ?? []).map(s => `  - ${s}`).join('\n') || '  (none)'
  const epErrors = (ep.errors ?? []).map(s => `  - ${s}`).join('\n') || '  (none)'

  const epDbTables = ep.dbOperations?.length ? ep.dbOperations : analysis.db_tables ?? []
  const epDb = formatTableSchemas(epDbTables, tableSchemas)

  // Only include WS constants that are actually referenced in the relevant paragraph source
  const paragraphText = relevantChunks.map(c => c.cobol_text).join('\n').toUpperCase()
  const referencedConstants = (wsConstants ?? []).filter(c => paragraphText.includes(c.name))
  const wsConstantsList = referencedConstants.length
    ? referencedConstants.map(c => `  ${c.name} = "${c.value}" (js: ${c.camelName})`).join('\n')
    : '  (none)'

  const paragraphSource = relevantChunks
    .map(c => `[${c.chunk_name}]\n${c.cobol_text}`)
    .join('\n\n') || '(none)'

  return [
    `PROGRAM: ${program.name}`,
    `PURPOSE: ${analysis.business_purpose ?? '(unknown)'}`,
    `\nINPUT PARAMETERS:\n${formatParams(analysis.input_contract)}`,
    `\nOUTPUT PARAMETERS:\n${formatParams(analysis.output_contract)}`,
    `\nWS CONSTANTS (exact VALUE-initialized fields — use these literal values, no placeholders):\n${wsConstantsList}`,
    `\nERROR CATALOG:\n${errorList}`,
    `\nDB TABLE SCHEMAS (exact COBOL field names — use for db operations and result field access):\n${epDb}`,
    `\nEXTERNAL DEPENDENCIES:\n${depList}`,
    `\nPRE-DISPATCH PARAGRAPHS (run before every operation): ${preDispatch}`,
    `\nENTRY POINT: ${ep.businessName} (when ${ep.condition})`,
    `STEPS:\n${steps}`,
    `SIDE EFFECTS:\n${sideEffects}`,
    `ERRORS:\n${epErrors}`,
    `\nCOBOL SOURCE PARAGRAPHS:\n${paragraphSource}`,
  ].join('\n')
}

function selectRelevantChunks(paragraphChunks, paragraphNames, performGraph, preDispatchNames) {
  const allNames = new Set([...preDispatchNames, ...paragraphNames])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) {
      allNames.add(dep)
    }
  }
  return paragraphChunks.filter(c => allNames.has(c.chunk_name))
}

export async function generateEntryPoint(programId, condition) {
  const [program, analysis, allChunks, settings] = await Promise.all([
    findProgramById(programId),
    getAnalysisByProgramId(programId),
    getChunksByProgramId(programId),
    getSettings(),
  ])

  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (!analysis) throw Object.assign(new Error('Program has no analysis'), { status: 422 })

  const entryPoints = analysis.entry_points ?? []
  const ep = condition
    ? entryPoints.find(e => e.condition === condition)
    : entryPoints[0]
  if (!ep) throw Object.assign(new Error(`Entry point not found: ${condition}`), { status: 404 })

  const paragraphChunks = allChunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')
  const cache = program.structural_cache
  const performGraph = cache?.performGraph ? deserializePerformGraph(cache.performGraph) : new Map()
  const preDispatchNames = cache?.preDispatchNames ?? []

  const relevantChunks = selectRelevantChunks(
    paragraphChunks,
    ep.paragraphNames ?? [],
    performGraph,
    preDispatchNames
  )

  // Extract field schemas and WS constants from COBOL source
  let tableSchemas = {}
  let wsConstants = []
  if (program.file_path) {
    try {
      const cobolText = readFileSync(program.file_path, 'utf8')
      tableSchemas = extractTuxTableSchemas(cobolText)
      wsConstants = extractWsConstants(cobolText)
    } catch {
      // non-fatal: generation continues without schema detail
    }
  }

  analysis._selectedEntryPoint = ep
  const context = buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants)

  const provider = await getProvider(settings)
  const result = await provider.generateCode(context)

  return {
    programName: program.name,
    entryPoint: { condition: ep.condition, businessName: ep.businessName },
    paragraphsIncluded: relevantChunks.map(c => c.chunk_name),
    contextTokenEstimate: Math.ceil(context.length / 4),
    ...result,
  }
}

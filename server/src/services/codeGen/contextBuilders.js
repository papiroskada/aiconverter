import { readFileSync } from 'fs'
import { findProgramById } from '../../models/programs.js'
import { getAnalysisByProgramId } from '../../models/programAnalysis.js'
import { getChunksByProgramId } from '../../models/programChunks.js'
import { deserializePerformGraph } from '../../ai/orchestrator.js'
import { extractTuxTableSchemas, extractWsConstants } from '../../parser/cobolExtractor.js'
import { toPascal, getPatterns } from './utils.js'
import { formatParams, formatNotFoundAction, formatTableSchemas, sourceSection } from './formatters.js'

export async function loadProgramData(programId) {
  const [program, analysis, allChunks] = await Promise.all([
    findProgramById(programId),
    getAnalysisByProgramId(programId),
    getChunksByProgramId(programId),
  ])
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (!analysis) throw Object.assign(new Error('Program has no analysis'), { status: 422 })

  const cache = program.structural_cache
  const performGraph = cache?.performGraph ? deserializePerformGraph(cache.performGraph) : new Map()
  const preDispatchNames = cache?.preDispatchNames ?? []
  const paragraphChunks = allChunks.filter(c =>
    c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph'
  )

  let tableSchemas = {}
  let wsConstants = []
  if (program.file_path) {
    try {
      const cobolText = readFileSync(program.file_path, 'utf8')
      tableSchemas = extractTuxTableSchemas(cobolText)
      wsConstants = extractWsConstants(cobolText)
    } catch { /* non-fatal */ }
  }

  return { program, analysis, paragraphChunks, performGraph, preDispatchNames, tableSchemas, wsConstants }
}

function interfaceSection(programName) {
  const inputType = toPascal(programName) + 'Input'
  const outputType = toPascal(programName) + 'Output'
  return `\nTYPESCRIPT INTERFACES (use for function signature, import from './types.js'):\n  Input:  ${inputType}\n  Output: ${outputType}`
}

export function buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
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

  const paragraphText = relevantChunks.map(c => c.cobol_text).join('\n').toUpperCase()
  const referencedConstants = (wsConstants ?? []).filter(c => paragraphText.includes(c.name))
  const wsConstantsList = referencedConstants.length
    ? referencedConstants.map(c => `  ${c.name} = "${c.value}" (js: ${c.camelName})`).join('\n')
    : '  (none)'

  const patterns = getPatterns(settings)

  return [
    `PROGRAM: ${program.name}`,
    `PURPOSE: ${analysis.business_purpose ?? '(unknown)'}`,
    interfaceSection(program.name),
    `\nINPUT PARAMETERS:\n${formatParams(analysis.input_contract)}`,
    `\nOUTPUT PARAMETERS:\n${formatParams(analysis.output_contract)}`,
    `\nTARGET PATTERNS:`,
    `  DB read:       ${patterns.dbRead}`,
    `  DB write:      ${patterns.dbWrite}`,
    `  Error:         ${patterns.errorConvention}`,
    `  External call: ${patterns.externalCall}`,
    `\nWS CONSTANTS (exact VALUE-initialized fields):\n${wsConstantsList}`,
    `\nERROR CATALOG:\n${errorList}`,
    `\nDB TABLE SCHEMAS:\n${epDb}`,
    `\nEXTERNAL DEPENDENCIES:\n${depList}`,
    `\nPRE-DISPATCH PARAGRAPHS (run before every operation): ${preDispatch}`,
    `\nENTRY POINT: ${ep.businessName} (when ${ep.condition})`,
    `STEPS:\n${steps}`,
    `SIDE EFFECTS:\n${sideEffects}`,
    `ERRORS:\n${epErrors}`,
    sourceSection(relevantChunks, settings),
  ].filter(s => s !== '').join('\n')
}

export function buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
  const errorList = (analysis.error_catalog ?? [])
    .map(e => `  ${e.code}${e.businessMeaning ? ` — ${e.businessMeaning}` : ''}${e.systemAction ? `; ${e.systemAction}` : ''}`)
    .join('\n') || '  (none)'

  const depList = (analysis.external_dependencies ?? [])
    .map(d => `  ${d.program}: ${d.purpose}; in: ${d.dataIn ?? '?'}; out: ${d.dataOut ?? '?'}`)
    .join('\n') || '  (none)'

  const allDbTables = (analysis.db_tables ?? []).filter(t => !t.ai_hallucinated)
  const dbSection = formatTableSchemas(allDbTables, tableSchemas)

  const paragraphText = relevantChunks.map(c => c.cobol_text).join('\n').toUpperCase()
  const referencedConstants = (wsConstants ?? []).filter(c => paragraphText.includes(c.name))
  const wsConstantsList = referencedConstants.length
    ? referencedConstants.map(c => `  ${c.name} = "${c.value}" (js: ${c.camelName})`).join('\n')
    : '  (none)'

  const entryPointsSection = (analysis.entry_points ?? []).map(ep => {
    const steps = (ep.steps ?? []).map((s, i) => `    ${i + 1}. ${s}`).join('\n') || '    (none)'
    const sideEffects = (ep.sideEffects ?? []).map(s => `    - ${s}`).join('\n') || '    (none)'
    const epErrors = (ep.errors ?? []).map(s => `    - ${s}`).join('\n') || '    (none)'
    const epDb = formatTableSchemas(ep.dbOperations?.length ? ep.dbOperations : [], tableSchemas)
    return [
      `  WHEN ${ep.condition} → ${ep.businessName}`,
      `  Steps:\n${steps}`,
      `  Side Effects:\n${sideEffects}`,
      `  Errors:\n${epErrors}`,
      `  DB Operations:\n${epDb}`,
    ].join('\n')
  }).join('\n\n')

  return [
    `PROGRAM: ${program.name}`,
    `PURPOSE: ${analysis.business_purpose ?? '(unknown)'}`,
    interfaceSection(program.name),
    `\nINPUT PARAMETERS:\n${formatParams(analysis.input_contract)}`,
    `\nOUTPUT PARAMETERS:\n${formatParams(analysis.output_contract)}`,
    `\nWS CONSTANTS:\n${wsConstantsList}`,
    `\nERROR CATALOG:\n${errorList}`,
    `\nDB TABLE SCHEMAS:\n${dbSection}`,
    `\nEXTERNAL DEPENDENCIES:\n${depList}`,
    `\nPRE-DISPATCH: ${(analysis.pre_dispatch ?? []).join(', ') || '(none)'}`,
    `\nENTRY POINTS:\n${entryPointsSection}`,
    sourceSection(relevantChunks, settings),
  ].filter(s => s !== '').join('\n')
}

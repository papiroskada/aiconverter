import { readFileSync } from 'fs'
import { findProgramById } from '../models/programs.js'
import { getAnalysisByProgramId } from '../models/programAnalysis.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { getCallsFromProgram } from '../models/programCalls.js'
import { getSettings } from '../models/settings.js'
import { getProvider } from '../ai/providers/base.js'
import { deserializePerformGraph } from '../ai/orchestrator.js'
import { resolveTransitive } from '../parser/cobolParser.js'
import { extractTuxTableSchemas, extractWsConstants } from '../parser/cobolExtractor.js'

// ─── typed contracts helpers ─────────────────────────────────────────────────

function contractToInterface(programName, contractJson, direction) {
  let params
  try { params = typeof contractJson === 'string' ? JSON.parse(contractJson) : contractJson } catch { return null }
  if (!Array.isArray(params) || !params.length) return null
  const typeName = toPascal(programName) + (direction === 'input' ? 'Input' : 'Output')
  const lines = params.map(p => {
    const tsType = p.type === 'number' ? 'number' : p.type === 'object' ? 'Record<string, unknown>' : 'string'
    const optional = direction === 'output' ? '?' : ''
    const comment = p.cobolName ? `  // ${p.cobolName}` : ''
    return `  ${p.name}${optional}: ${tsType}${comment}`
  })
  return `export interface ${typeName} {\n${lines.join('\n')}\n}`
}

function interfaceSection(programName) {
  const inputType = toPascal(programName) + 'Input'
  const outputType = toPascal(programName) + 'Output'
  return `\nTYPESCRIPT INTERFACES (use for function signature, import from './types.js'):\n  Input:  ${inputType}\n  Output: ${outputType}`
}

// Merge multiple vitest test files: keep boilerplate from first, extract describe blocks from the rest
function mergeTestFiles(files) {
  if (!files.length) return ''
  if (files.length === 1) return files[0]
  const parts = [files[0]]
  for (let i = 1; i < files.length; i++) {
    const match = files[i].match(/^describe\(/m)
    if (match) parts.push(files[i].slice(match.index))
  }
  return parts.join('\n\n')
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatParams(contractJson) {
  if (!contractJson) return '  (none)'
  let params
  try { params = JSON.parse(contractJson) } catch { return '  (parse error)' }
  if (!params.length) return '  (none)'
  return params.map(p => `  ${p.name} (${p.type}${p.direction ? `, ${p.direction}` : ''}) — ${p.description || p.cobolName}`).join('\n')
}

function formatNotFoundAction(nfa) {
  if (!nfa || nfa === 'n/a') return null
  if (typeof nfa === 'string') return nfa
  if (nfa.type === 'error') return `error ${nfa.code}`
  if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    return `set defaults${fields ? ` (${fields})` : ''}${nfa.logError ? ', log error' : ''} and continue`
  }
  if (nfa.type === 'continue') return 'continue (absence acceptable)'
  if (nfa.type === 'skip') return 'skip (conditional)'
  return null
}

function formatTableSchemas(dbTables, tableSchemas) {
  const usedTables = (dbTables ?? []).filter(t => !t.ai_hallucinated)
  if (!usedTables.length) return '  (none)'

  return usedTables.map(t => {
    const keys = t.keyFields?.length ? `; key: ${t.keyFields.join(', ')}` : ''
    const nfText = formatNotFoundAction(t.notFoundAction)
    const nf = nfText ? `; if not found: ${nfText}` : ''
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

function getPatterns(settings) {
  return {
    language:        settings.code_language          ?? 'typescript',
    dbRead:          settings.code_db_read           ?? "await db.select('{table}', { {key}: {value} })",
    dbWrite:         settings.code_db_write          ?? "await db.insert('{table}', data) / await db.update('{table}', data, { {key} })",
    errorConvention: settings.code_error_convention  ?? "return { error: {code}, field: '{field}' }",
    externalCall:    settings.code_external_call     ?? "await callProgram('{name}', input)",
  }
}

function selectRelevantChunks(paragraphChunks, paragraphNames, performGraph, preDispatchNames) {
  const allNames = new Set([...preDispatchNames, ...paragraphNames])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) allNames.add(dep)
  }
  return paragraphChunks.filter(c => allNames.has(c.chunk_name))
}

function toPascal(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/(^|_)([a-z\d])/g, (_, __, c) => c.toUpperCase())
}

function assembleCode(result) {
  const { imports = [], sharedTypes, functions = [], dispatcher } = result
  const parts = [
    imports.length ? imports.join('\n') : null,
    sharedTypes?.trim() || null,
    functions.length ? functions.map(f => f.code).join('\n\n') : null,
    dispatcher?.trim() || null,
  ]
  return parts.filter(Boolean).join('\n\n')
}

function sourceSection(relevantChunks, settings) {
  if (settings.code_source_mode === 'logic_only') return ''
  const text = relevantChunks.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n') || '(none)'
  return `\nCOBOL SOURCE PARAGRAPHS:\n${text}`
}

// ─── test generation context ─────────────────────────────────────────────────

function buildTestGenContext(program, analysis, ep, tableSchemas, wsConstants) {
  const errorList = (analysis.error_catalog ?? [])
    .map(e => `  ${e.code}${e.businessMeaning ? ` — ${e.businessMeaning}` : ''}${e.systemAction ? `; ${e.systemAction}` : ''}`)
    .join('\n') || '  (none)'

  const steps = (ep.steps ?? []).map((s, i) => `  ${i + 1}. ${s}`).join('\n') || '  (none)'

  const epDbTables = (ep.dbOperations?.length ? ep.dbOperations : analysis.db_tables ?? []).filter(t => !t.ai_hallucinated)
  const dbOps = epDbTables.map(t => {
    const keys = t.keyFields?.length ? `; key: ${t.keyFields.join(', ')}` : ''
    const nfText = formatNotFoundAction(t.notFoundAction)
    const nf = nfText ? `; if not found: ${nfText}` : ''
    const header = `  ${t.table} (${t.operation}${keys}${nf})`
    const fields = tableSchemas[t.table]
    if (!fields?.length) return header
    const fieldLines = fields.map(f => `    ${f.name} → ${f.camelName} (${f.type})`).join('\n')
    return `${header}\n${fieldLines}`
  }).join('\n\n') || '  (none)'

  const stepsText = (ep.steps ?? []).join(' ').toUpperCase()
  const referencedConstants = (wsConstants ?? []).filter(c => stepsText.includes(c.name))
  const wsConstantsList = referencedConstants.length
    ? referencedConstants.map(c => `  ${c.name} = "${c.value}" (js: ${c.camelName})`).join('\n')
    : '  (none)'

  return [
    `PROGRAM: ${program.name}`,
    `PURPOSE: ${analysis.business_purpose ?? '(unknown)'}`,
    `\nINPUT PARAMETERS:\n${formatParams(analysis.input_contract)}`,
    `\nOUTPUT PARAMETERS:\n${formatParams(analysis.output_contract)}`,
    `\nWS CONSTANTS:\n${wsConstantsList}`,
    `\nERROR CATALOG:\n${errorList}`,
    `\nENTRY POINT: ${ep.businessName} (when ${ep.condition})`,
    `STEPS:\n${steps}`,
    `\nDB TABLE SCHEMAS:\n${dbOps}`,
  ].join('\n')
}

// ─── single entry point context ─────────────────────────────────────────────

function buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
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

// ─── whole program context ───────────────────────────────────────────────────

function buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
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

// ─── load program data helper ────────────────────────────────────────────────

async function loadProgramData(programId) {
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

// ─── public: single entry point ─────────────────────────────────────────────

export async function generateEntryPoint(programId, condition, { includeTests = false } = {}) {
  const settings = await getSettings()
  const { program, analysis, paragraphChunks, performGraph, preDispatchNames, tableSchemas, wsConstants } =
    await loadProgramData(programId)

  const entryPoints = analysis.entry_points ?? []
  const ep = condition ? entryPoints.find(e => e.condition === condition) : entryPoints[0]
  if (!ep) throw Object.assign(new Error(`Entry point not found: ${condition}`), { status: 404 })

  const relevantChunks = selectRelevantChunks(
    paragraphChunks, ep.paragraphNames ?? [], performGraph, preDispatchNames
  )

  analysis._selectedEntryPoint = ep
  const context = buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)
  const provider = await getProvider(settings)
  const result = await provider.generateCode(context)

  const out = {
    programName: program.name,
    entryPoint: { condition: ep.condition, businessName: ep.businessName },
    paragraphsIncluded: relevantChunks.map(c => c.chunk_name),
    contextTokenEstimate: Math.ceil(context.length / 4),
    ...result,
  }

  if (includeTests) {
    const testContext = buildTestGenContext(program, analysis, ep, tableSchemas, wsConstants)
    const testResult = await provider.generateTests(testContext)
    out.tests = testResult.testFile ?? ''
    out.testsCoverage = testResult.coverage ?? []
  }

  return out
}

// ─── public: generate tests for a single entry point ────────────────────────

export async function generateEntryPointTests(programId, condition) {
  const settings = await getSettings()
  const { program, analysis, tableSchemas, wsConstants } = await loadProgramData(programId)

  const entryPoints = analysis.entry_points ?? []
  const ep = condition ? entryPoints.find(e => e.condition === condition) : entryPoints[0]
  if (!ep) throw Object.assign(new Error(`Entry point not found: ${condition}`), { status: 404 })

  const context = buildTestGenContext(program, analysis, ep, tableSchemas, wsConstants)
  const provider = await getProvider(settings)
  const result = await provider.generateTests(context)

  return {
    programName: program.name,
    entryPoint: { condition: ep.condition, businessName: ep.businessName },
    testFile: result.testFile ?? '',
    coverage: result.coverage ?? [],
  }
}

// ─── public: whole program ───────────────────────────────────────────────────

export async function generateProgram(programId, { includeTests = false } = {}) {
  const settings = await getSettings()
  const { program, analysis, paragraphChunks, performGraph, preDispatchNames, tableSchemas, wsConstants } =
    await loadProgramData(programId)

  const entryPoints = analysis.entry_points ?? []
  if (!entryPoints.length) throw Object.assign(new Error('No entry points in analysis'), { status: 422 })

  const allParagraphNames = [...new Set(entryPoints.flatMap(ep => ep.paragraphNames ?? []))]
  const relevantChunks = selectRelevantChunks(
    paragraphChunks, allParagraphNames, performGraph, preDispatchNames
  )

  const context = buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)
  const patterns = getPatterns(settings)
  const provider = await getProvider(settings)
  const result = await provider.generateProgram(context, patterns)

  const out = {
    programName: program.name,
    language: patterns.language,
    code: assembleCode(result),
    entryPoints: entryPoints.map(ep => ({ condition: ep.condition, businessName: ep.businessName })),
    paragraphsIncluded: relevantChunks.map(c => c.chunk_name),
    contextTokenEstimate: Math.ceil(context.length / 4),
    ...result,
  }

  if (includeTests) {
    const testFiles = []
    for (const ep of entryPoints) {
      try {
        const testContext = buildTestGenContext(program, analysis, ep, tableSchemas, wsConstants)
        const testResult = await provider.generateTests(testContext)
        if (testResult.testFile) testFiles.push(testResult.testFile)
      } catch { /* non-fatal — skip failed entry point test */ }
    }
    out.tests = mergeTestFiles(testFiles)
    out.testsCoverage = []
  }

  return out
}

// ─── public: program types (deterministic, no AI) ────────────────────────────

export async function generateProgramTypes(programIds) {
  const [programs, analyses] = await Promise.all([
    Promise.all(programIds.map(findProgramById)),
    Promise.all(programIds.map(getAnalysisByProgramId)),
  ])

  const blocks = []
  const programNames = []

  for (let i = 0; i < programs.length; i++) {
    const program = programs[i]
    const analysis = analyses[i]
    if (!program || !analysis) continue
    const inputBlock  = contractToInterface(program.name, analysis.input_contract,  'input')
    const outputBlock = contractToInterface(program.name, analysis.output_contract, 'output')
    if (!inputBlock && !outputBlock) continue
    if (inputBlock)  blocks.push(inputBlock)
    if (outputBlock) blocks.push(outputBlock)
    programNames.push(program.name)
  }

  if (!blocks.length) return { code: '// No contracts found\n', programs: [] }

  return {
    code: `// Auto-generated program contracts — do not edit manually\n\n${blocks.join('\n\n')}\n`,
    programs: programNames,
  }
}

// ─── public: DB types (deterministic, no AI) ─────────────────────────────────

export async function generateDbTypes(programIds) {
  const programs = await Promise.all(programIds.map(findProgramById))

  const allSchemas = {}
  for (const program of programs.filter(Boolean)) {
    if (!program.file_path) continue
    try {
      const cobolText = readFileSync(program.file_path, 'utf8')
      Object.assign(allSchemas, extractTuxTableSchemas(cobolText))
    } catch { /* non-fatal */ }
  }

  if (!Object.keys(allSchemas).length) return { code: '// No DB schemas found\n', tables: [] }

  const toPascal = s => s.replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/(^|_)([a-z\d])/g, (_, __, c) => c.toUpperCase())

  const interfaces = Object.entries(allSchemas).map(([table, fields]) => {
    const name = toPascal(table) + 'Row'
    const fieldLines = fields.map(f => `  ${f.camelName}: ${f.type === 'number' ? 'number' : 'string'}`)
    return `export interface ${name} {\n${fieldLines.join('\n')}\n}`
  })

  return {
    code: `// Auto-generated DB row types — do not edit manually\n\n${interfaces.join('\n\n')}\n`,
    tables: Object.keys(allSchemas),
  }
}

// ─── public: pre-generation consistency check ────────────────────────────────

export async function checkConsistency(programIds) {
  const [programs, analyses] = await Promise.all([
    Promise.all(programIds.map(findProgramById)),
    Promise.all(programIds.map(getAnalysisByProgramId)),
  ])

  const byName = new Map()
  programs.forEach((p, i) => { if (p && analyses[i]) byName.set(p.name, analyses[i]) })

  const warnings = []
  for (let i = 0; i < programs.length; i++) {
    const program = programs[i]
    const analysis = analyses[i]
    if (!program || !analysis) continue

    for (const dep of (analysis.external_dependencies ?? [])) {
      const targetAnalysis = byName.get(dep.program)
      if (!targetAnalysis) continue

      let inputContract = []
      try { inputContract = JSON.parse(targetAnalysis.input_contract ?? '[]') } catch { continue }
      const inputNames = new Set(inputContract.map(p => p.cobolName?.toUpperCase()).filter(Boolean))

      const mentionedFields = (dep.dataIn ?? '').match(/\b[A-Z][A-Z0-9]{1,}-[A-Z0-9-]+/g) ?? []
      const mismatches = mentionedFields.filter(f => !inputNames.has(f))

      if (mismatches.length) {
        warnings.push({
          caller: program.name,
          callee: dep.program,
          issue: `Fields in dataIn not found in ${dep.program} input_contract: ${mismatches.join(', ')}`,
        })
      }
    }
  }

  return warnings
}

// ─── public: topological application generation ──────────────────────────────

async function buildGenerationOrder(programIds) {
  const idSet = new Set(programIds.map(String))

  const callsMap = new Map()
  await Promise.all(programIds.map(async id => {
    const calls = await getCallsFromProgram(id)
    callsMap.set(String(id), calls
      .filter(c => c.callee_program_id && idSet.has(String(c.callee_program_id)))
      .map(c => String(c.callee_program_id))
    )
  }))

  // Kahn's algorithm — листові програми (нема вихідних залежностей) йдуть першими
  const inDegree = new Map(programIds.map(id => [String(id), 0]))
  for (const [callerId, deps] of callsMap) {
    for (const dep of deps) {
      // dep залежить від callerId — callerId має бути готовий раніше
      // inDegree рахує скільки програм має бути згенеровано до поточної
      inDegree.set(callerId, (inDegree.get(callerId) ?? 0) + 0) // caller не блокується
    }
  }
  // Переосмислення: A викликає B → B генерується першою (leaf first)
  // inDegree[id] = кількість програм що викликають id (id потрібна раніше)
  const degree = new Map(programIds.map(id => [String(id), 0]))
  for (const [, deps] of callsMap) {
    for (const dep of deps) degree.set(dep, (degree.get(dep) ?? 0) + 1)
  }

  const queue = [...degree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const [caller, deps] of callsMap) {
      if (deps.includes(id)) {
        const newDeg = (degree.get(caller) ?? 1) - 1
        degree.set(caller, newDeg)
        if (newDeg === 0) queue.push(caller)
      }
    }
  }

  // Додати решту (цикли або відокремлені програми)
  const remaining = programIds.map(String).filter(id => !order.includes(id))
  return [...order, ...remaining]
}

async function wireInterProgramCalls(results) {
  const generatedNames = new Set(results.filter(r => r.status === 'ok').map(r => r.programName))

  const analysisMap = new Map()
  await Promise.all(
    results.filter(r => r.status === 'ok').map(async r => {
      const a = await getAnalysisByProgramId(r.programId)
      if (a) analysisMap.set(r.programName, a)
    })
  )

  for (const r of results) {
    if (r.status !== 'ok') continue
    const analysis = analysisMap.get(r.programName)
    if (!analysis) continue

    for (const dep of (analysis.external_dependencies ?? [])) {
      if (!generatedNames.has(dep.program)) continue

      const funcName = `execute${toPascal(dep.program)}`
      const pattern = new RegExp(`callProgram\\(['"]${dep.program}['"],\\s*`, 'g')

      r.dispatcher = r.dispatcher?.replace(pattern, `${funcName}(`)
      r.functions = r.functions?.map(f => ({ ...f, code: f.code.replace(pattern, `${funcName}(`) }))

      const importLine = `import { execute as ${funcName} } from './${dep.program}.js'`
      const typeImportLine = `import type { ${toPascal(dep.program)}Input } from './types.js'`
      if (!(r.imports ?? []).includes(importLine)) {
        r.imports = [typeImportLine, importLine, ...(r.imports ?? [])]
      }
    }

    r.code = assembleCode(r)
  }
}

export async function generateApplication(programIds) {
  const order = await buildGenerationOrder(programIds)
  const results = []

  for (const programId of order) {
    try {
      const result = await generateProgram(programId)
      results.push({ programId, status: 'ok', ...result })
    } catch (err) {
      results.push({ programId, status: 'error', error: err.message })
    }
  }

  await wireInterProgramCalls(results)

  return { order, results }
}

// ─── public: full project with db stub + index ───────────────────────────────

function generateDbStub(language) {
  if (language === 'typescript') return `\
// Auto-generated — replace with your actual DB driver
export const db = {
  async select<T>(table: string, key: Record<string, unknown>): Promise<T | null> {
    throw new Error(\`db.select('\${table}') not implemented\`)
  },
  async insert<T>(table: string, data: Record<string, unknown>): Promise<T> {
    throw new Error(\`db.insert('\${table}') not implemented\`)
  },
  async update<T>(table: string, data: Record<string, unknown>, key: Record<string, unknown>): Promise<T | null> {
    throw new Error(\`db.update('\${table}') not implemented\`)
  },
  async delete(table: string, key: Record<string, unknown>): Promise<void> {
    throw new Error(\`db.delete('\${table}') not implemented\`)
  },
}
`
  return `\
// Auto-generated — replace with your actual DB driver
export const db = {
  async select(table, key) { throw new Error(\`db.select('\${table}') not implemented\`) },
  async insert(table, data) { throw new Error(\`db.insert('\${table}') not implemented\`) },
  async update(table, data, key) { throw new Error(\`db.update('\${table}') not implemented\`) },
  async delete(table, key) { throw new Error(\`db.delete('\${table}') not implemented\`) },
}
`
}

function generateIndex(results, language) {
  const ok = results.filter(r => r.status === 'ok')
  const lines = ['// Auto-generated program registry — do not edit manually', '']
  for (const r of ok) {
    lines.push(`export { execute as execute${toPascal(r.programName)} } from './${r.programName}.js'`)
  }
  return lines.join('\n') + '\n'
}

export async function generateProject(programIds, { includeTests = false } = {}) {
  const { order, results } = await generateApplication(programIds)

  const language = results.find(r => r.status === 'ok')?.language ?? 'typescript'
  const ext = language === 'typescript' ? 'ts' : 'js'

  const files = []
  const warnings = []

  for (const r of results) {
    if (r.status === 'ok') {
      files.push({ path: `src/${r.programName}.${ext}`, content: r.code })
    } else {
      warnings.push(`${r.programName}: ${r.error}`)
    }
  }

  const typesResult = await generateProgramTypes(programIds)
  files.push({ path: `src/types.${ext}`, content: typesResult.code })
  files.push({ path: `src/db.${ext}`,    content: generateDbStub(language) })
  files.push({ path: `src/index.${ext}`, content: generateIndex(results, language) })

  if (includeTests) {
    const settings = await getSettings()
    const provider = await getProvider(settings)
    for (const r of results) {
      if (r.status !== 'ok') continue
      try {
        const { analysis, tableSchemas, wsConstants } = await loadProgramData(r.programId)
        const epList = analysis.entry_points ?? []
        const testFiles = []
        for (const ep of epList) {
          const testContext = buildTestGenContext({ name: r.programName }, analysis, ep, tableSchemas, wsConstants)
          const testResult = await provider.generateTests(testContext)
          if (testResult.testFile) testFiles.push(testResult.testFile)
        }
        if (testFiles.length) {
          files.push({ path: `src/__tests__/${r.programName}.test.${ext}`, content: mergeTestFiles(testFiles) })
        }
      } catch {
        warnings.push(`${r.programName}: test generation failed`)
      }
    }
  }

  return { files, warnings, order }
}

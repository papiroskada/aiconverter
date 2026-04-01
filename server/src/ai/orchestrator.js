import { logger } from '../logger.js'
import { extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage } from '../parser/cobolParser.js'

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

export function isComplex(chunk) {
  const text = chunk.cobol_text.toUpperCase()
  const lines = text.split('\n')
  if (lines.length > 30) return true
  if (text.includes('EVALUATE')) return true
  const ifCount = (text.match(/(?<![A-Z0-9-])IF(?![A-Z0-9-])/g) ?? []).length
  if (ifCount >= 2) return true
  return false
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function formatWsVars(wsVars) {
  if (!wsVars.length) return '  (none)'
  return wsVars.map(v => {
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

function buildInterfaceContext(linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, adaptive = true) {
  const paragraphList = paragraphChunks
    .map(c => {
      const text = (adaptive && isComplex(c))
        ? c.cobol_text
        : c.cobol_text.split('\n').slice(0, 5).join('\n')
      return `[${c.chunk_name}]\n${text}`
    })
    .join('\n\n')

  const callList = calls.map(c =>
    `  CALL '${c.program}'${c.using ? ` USING ${c.using}` : ''}`
  ).join('\n') || '  (none)'

  const fileList = selectFiles.join('\n') || '  (none)'

  const sqlList = execSqlTables.map(t =>
    `  ${t.table}: ${t.operation}`
  ).join('\n') || '  (none)'

  return [
    `LINKAGE SECTION:\n${linkage || '(none)'}`,
    `WORKING-STORAGE VARIABLES:\n${formatWsVars(wsVars)}`,
    `PARAGRAPHS (name + code):\n${paragraphList || '(none)'}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
  ].join('\n\n')
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName, tokenLimit = 80000 }) {
  const paragraphChunks = chunks.filter(
    c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph'
  )

  const ti = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'interface', message: 'Analysing interface...' })

  const linkage = extractLinkage(cobolText)
  const wsVars = extractWorkingStorage(cobolText)
  const calls = extractCalls(cobolText)
  const execSqlTables = extractExecSql(cobolText)
  const constructs = extractConstructs(cobolText)
  const selectFiles = extractSelectFiles(cobolText)

  const complexChunks = paragraphChunks.filter(isComplex)
  const complexNames = new Set(complexChunks.map(c => c.chunk_name))

  const adaptiveContext = buildInterfaceContext(
    linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, true
  )

  let spec
  if (estimateTokens(adaptiveContext) <= tokenLimit) {
    // Single-pass: full text for complex paragraphs, snippets for simple
    spec = await provider.extractInterface(adaptiveContext)
  } else {
    // Two-pass: pass 1 with all snippets, pass 2 for complex paragraphs only
    const snippetContext = buildInterfaceContext(
      linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, false
    )
    spec = await provider.extractInterface(snippetContext)

    if (complexChunks.length > 0) {
      try {
        const complexContext = complexChunks
          .map(c => `[${c.chunk_name}]\n${c.cobol_text}`)
          .join('\n\n')
        const pass2Results = await provider.extractRules(complexContext)
        const rulesMap = new Map(pass2Results.map(r => [r.name, r.rules]))
        spec = {
          ...spec,
          sections: (spec.sections ?? []).map(section => ({
            ...section,
            rules: complexNames.has(section.name)
              ? (rulesMap.get(section.name) ?? [])
              : (section.rules ?? []),
          })),
        }
      } catch (err) {
        logger.error(programName, `Rules extraction failed (non-fatal): ${err.message}`)
      }
    }
  }

  logAndEmit(emit, programName, 'done', {
    stage: 'interface', message: 'Interface done', durationMs: Date.now() - ti,
  })

  // Map to storage shape
  const external_calls = (spec.externalCalls ?? []).map(c => ({
    program: c.program,
    using: c.using ?? '',
  }))
  const db_tables = spec.dbTables ?? []
  const file_ops = (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations }))
  const input_contract = JSON.stringify(
    (spec.parameters ?? []).filter(p => p.direction !== 'out')
  )
  const output_contract = JSON.stringify(
    (spec.parameters ?? []).filter(p => p.direction !== 'in')
  )

  // Step 2: Diagram
  const td = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'diagram', message: 'Generating diagram...' })
  let diagram = null
  try {
    diagram = await provider.generateDiagram(spec.flow_narrative ?? spec.description ?? '')
    logAndEmit(emit, programName, 'done', { stage: 'diagram', message: 'Diagram done', durationMs: Date.now() - td })
  } catch (err) {
    logAndEmit(emit, programName, 'error', {
      stage: 'diagram', message: `Diagram failed: ${err.message}`, durationMs: Date.now() - td,
    })
  }

  return {
    description: spec.description ?? '',
    flow_narrative: spec.flow_narrative ?? '',
    input_contract,
    output_contract,
    external_calls,
    db_tables,
    file_ops,
    sections: spec.sections ?? [],
    diagram,
  }
}

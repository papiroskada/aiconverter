import { readFileSync } from 'fs'
import { findProgramById } from '../../models/programs.js'
import { getAnalysisByProgramId } from '../../models/programAnalysis.js'
import { extractTuxTableSchemas } from '../../parser/cobolExtractor.js'
import { toPascal } from './utils.js'

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

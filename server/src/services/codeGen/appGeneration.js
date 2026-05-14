import { getCallsFromProgram } from '../../models/programCalls.js'
import { getAnalysisByProgramId } from '../../models/programAnalysis.js'
import { getSettings } from '../../models/settings.js'
import { getProvider } from '../../ai/providers/base.js'
import { loadProgramData, buildTestGenContext } from './contextBuilders.js'
import { toPascal, assembleCode, mergeTestFiles } from './utils.js'
import { generateProgramTypes } from './typeGeneration.js'
import { generateProgram } from './programGeneration.js'

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
      inDegree.set(callerId, (inDegree.get(callerId) ?? 0) + 0)
    }
  }
  // Переосмислення: A викликає B → B генерується першою (leaf first)
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

function generateIndex(results) {
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
  files.push({ path: `src/index.${ext}`, content: generateIndex(results) })

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

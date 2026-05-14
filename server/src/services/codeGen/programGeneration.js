import { findProgramById } from '../../models/programs.js'
import { getAnalysisByProgramId } from '../../models/programAnalysis.js'
import { getSettings } from '../../models/settings.js'
import { getProvider } from '../../ai/providers/base.js'
import { loadProgramData, buildCodeGenContext, buildProgramContext, buildTestGenContext } from './contextBuilders.js'
import { selectRelevantChunks, assembleCode, mergeTestFiles, getPatterns } from './utils.js'

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

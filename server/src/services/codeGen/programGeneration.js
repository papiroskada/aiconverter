import { findProgramById } from '../../models/programs.js'
import { getAnalysisByProgramId } from '../../models/programAnalysis.js'
import { getSettings } from '../../models/settings.js'
import { getProvider } from '../../ai/providers/base.js'
import { loadProgramData, buildProgramContext } from './contextBuilders.js'
import { selectRelevantChunks, assembleCode, getPatterns } from './utils.js'
import { generateSkeleton, extractHoles, holeToContext, assembleSkeleton } from './mechanicalTransformer.js'
import { buildVerificationReport, generateTestSuite } from './verificationService.js'

export async function generateEntryPointTests(programId, condition) {
  const { program, analysis } = await loadProgramData(programId)

  const entryPoints = analysis.entry_points ?? []
  const ep = condition ? entryPoints.find(e => e.condition === condition) : entryPoints[0]
  if (!ep) throw Object.assign(new Error(`Entry point not found: ${condition}`), { status: 404 })

  return {
    programName: program.name,
    entryPoint: { condition: ep.condition, businessName: ep.businessName },
    testFile: generateTestSuite(program, analysis, program.structural_cache),
    coverage: [],
  }
}

export async function generateProgram(programId, { includeTests = false } = {}) {
  const settings = await getSettings()
  const { program, analysis, paragraphChunks, performGraph, preDispatchNames, tableSchemas, wsConstants } =
    await loadProgramData(programId)

  const entryPoints = analysis.entry_points ?? []
  if (!entryPoints.length) throw Object.assign(new Error('No entry points in analysis'), { status: 422 })

  const patterns  = getPatterns(settings)
  const provider  = await getProvider(settings)
  const cache     = program.structural_cache
  const hasIR     = Array.isArray(cache?.linkageVars) && cache.linkageVars.length > 0

  let code, notes, paragraphsIncluded, contextTokenEstimate, verificationReport

  if (hasIR) {
    // ── Plan B path: mechanical skeleton + AI hole filling ──────────────────
    const skeleton    = generateSkeleton(program, analysis, paragraphChunks, cache, settings, wsConstants)
    const holes       = extractHoles(skeleton)
    const filledHoles = await Promise.all(
      holes.map(async hole => {
        const ctx    = holeToContext(hole, paragraphChunks, skeleton, settings, tableSchemas)
        const result = await provider.fillHole(ctx)
        return { id: hole.id, code: result.code ?? '  // hole fill failed' }
      })
    )
    code                 = assembleSkeleton(skeleton, filledHoles)
    notes                = [`Mechanical skeleton: ${holes.length} hole(s) filled by AI`]
    paragraphsIncluded   = paragraphChunks.map(c => c.chunk_name)
    contextTokenEstimate = holes.reduce((sum, h) => sum + Math.ceil(holeToContext(h, paragraphChunks, skeleton, settings, tableSchemas).cobolText.length / 4), 0)
    verificationReport   = buildVerificationReport(program, analysis, cache, skeleton, holes)
  } else {
    // ── Fallback: full-context path ─────────────────────────────────────────
    const allParagraphNames = [...new Set(entryPoints.flatMap(ep => ep.paragraphNames ?? []))]
    const relevantChunks    = selectRelevantChunks(paragraphChunks, allParagraphNames, performGraph, preDispatchNames)
    const context           = buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)
    const result            = await provider.generateProgram(context, patterns)
    code                    = assembleCode(result)
    notes                   = result.notes ?? []
    paragraphsIncluded      = relevantChunks.map(c => c.chunk_name)
    contextTokenEstimate    = Math.ceil(context.length / 4)
  }

  const out = {
    programName: program.name,
    language: patterns.language,
    code,
    notes,
    entryPoints: entryPoints.map(ep => ({ condition: ep.condition, businessName: ep.businessName })),
    paragraphsIncluded,
    contextTokenEstimate,
    ...(verificationReport ? { verificationReport } : {}),
  }

  if (includeTests) {
    out.tests = verificationReport?.testSuite ?? generateTestSuite(program, analysis, cache)
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

import { toPascal } from './utils.js'

function cobolToCamel(name) {
  if (!name) return 'unknown'
  if (!name.includes('-') && /[A-Z]/.test(name)) return name
  return name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase())
}

function parseConditionField(condition) {
  if (!condition) return null
  const m = condition.match(/^([a-zA-Z][a-zA-Z0-9-]+)\s*[=!]/)
  if (!m) return null
  const raw = m[1]
  return raw.includes('-') ? cobolToCamel(raw) : raw
}

function parseConditionValue(condition) {
  const m = (condition ?? '').match(/['"](.*?)['"]/)
  return m ? m[1] : 'VALUE'
}

// ── Confidence Score ────────────────────────────────────────────────────────

export function computeConfidence(skeleton, holes, analysis, structuralCache) {
  const cache            = structuralCache ?? {}
  const missingParagraphs = new Set(cache.missingParagraphs ?? [])
  const linkageVars      = cache.linkageVars ?? []
  const tuxTables        = cache.tuxTables   ?? []
  const redefines        = cache.redefines   ?? []

  // 1. Mechanical coverage — % lines NOT inside [AI_HOLE] blocks
  let mechanicalPct = null
  if (skeleton) {
    const totalLines = skeleton.split('\n').length
    let holeLines = 0
    const holeRe = /\/\/ \[AI_HOLE id="[^"]+"\]\n[\s\S]*?\/\/ \[\/AI_HOLE\]/g
    let m
    while ((m = holeRe.exec(skeleton)) !== null) holeLines += m[0].split('\n').length
    mechanicalPct = totalLines > 0 ? Math.round((totalLines - holeLines) / totalLines * 100) : 0
  }

  // 2. Type completeness — % linkage fields with known PIC type
  const directedVars   = linkageVars.filter(v => v.direction)
  const typedVars      = directedVars.filter(v => v.pic)
  const typeCompleteness = directedVars.length > 0
    ? Math.round(typedVars.length / directedVars.length * 100)
    : 100

  // 3. Hole source coverage — holes where we have COBOL paragraphs (not all missing)
  const holesWithSource = (holes ?? []).filter(h =>
    h.paragraphs.length > 0 && !h.paragraphs.every(p => missingParagraphs.has(p))
  ).length
  const holeCount = (holes ?? []).length
  const holeCoveragePct = holeCount > 0 ? Math.round(holesWithSource / holeCount * 100) : 100

  // 4. Flagged items
  const flagged = []

  for (const hole of (holes ?? [])) {
    const isLoop = hole.pattern?.includes('cursor loop')
    flagged.push({
      section:  hole.id,
      reason:   isLoop ? 'cursor loop logic (AI-filled, SCCLOOP)' : 'AI-filled section',
      severity: isLoop ? 'critical' : 'warning',
    })
  }

  for (const t of tuxTables) {
    const op = t.operation ?? ''
    if (/INSERT|UPDATE|DELETE|WRITE/i.test(op)) {
      flagged.push({ section: t.table, reason: `${op} operation — verify data integrity`, severity: 'critical' })
    }
  }

  if (redefines.length > 0) {
    flagged.push({
      section:  'REDEFINES',
      reason:   `${redefines.length} REDEFINES field(s) — check type interpretation`,
      severity: 'warning',
    })
  }

  // Overall score (weighted)
  const mech   = mechanicalPct ?? 50
  const score  = Math.round(mech * 0.5 + typeCompleteness * 0.2 + holeCoveragePct * 0.3)

  return { score, mechanicalPct, typeCompleteness, holeCoveragePct, holeCount, flaggedForReview: flagged }
}

// ── Test Suite Generator ────────────────────────────────────────────────────

export function generateTestSuite(program, analysis, structuralCache) {
  const cache        = structuralCache ?? {}
  const tuxTables    = cache.tuxTables ?? []
  const programName  = program.name
  const dispatcherFn = cobolToCamel(programName) + 'Dispatcher'
  const entryPoints  = analysis.entry_points ?? []
  const readTables   = tuxTables.filter(t => /READ/i.test(t.operation ?? ''))

  const lines = [
    `import { vi, describe, test, expect, beforeEach } from 'vitest'`,
    `vi.mock('../db.js', () => ({ db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() } }))`,
    `vi.mock('../callProgram.js', () => ({ callProgram: vi.fn() }))`,
    `import { db } from '../db.js'`,
    `import { ${dispatcherFn} } from '../${programName}.js'`,
    ``,
    `describe('${programName}', () => {`,
    `  beforeEach(() => vi.clearAllMocks())`,
    ``,
  ]

  for (const ep of entryPoints) {
    const condLabel  = ep.condition ?? ep.businessName ?? 'unknown'
    const bizName    = ep.businessName ?? ep.condition ?? 'ep'
    const field      = parseConditionField(ep.condition)
    const val        = parseConditionValue(ep.condition)
    const happyInput = field ? `{ ${field}: '${val}' }` : '{}'
    const badInput   = field ? `{ ${field}: '__INVALID__' }` : '{}'

    lines.push(`  describe('${bizName} (${condLabel})', () => {`)

    // Error path — one test per known error code
    const epErrors = ep.errors ?? []
    for (const errText of epErrors.slice(0, 2)) {
      const codeMatch = errText.match(/\b(\d{3,5})\b/)
      if (!codeMatch) continue
      lines.push(`    test('returns error on invalid input', async () => {`)
      lines.push(`      const result = await ${dispatcherFn}(${badInput})`)
      lines.push(`      expect(result.cluroRtnSts ?? result.rtnSts ?? result.error).toBeTruthy()`)
      lines.push(`    })`)
      lines.push(``)
    }

    // Not-found test per READ table (up to 2)
    for (const t of readTables.slice(0, 2)) {
      lines.push(`    test('${t.table} not found — no crash', async () => {`)
      lines.push(`      vi.mocked(db.select).mockResolvedValueOnce(null)`)
      lines.push(`      const result = await ${dispatcherFn}(${happyInput})`)
      lines.push(`      expect(result).toBeDefined()`)
      lines.push(`    })`)
      lines.push(``)
    }

    // Happy path
    lines.push(`    test('happy path — returns a result object', async () => {`)
    lines.push(`      vi.mocked(db.select).mockResolvedValue({})`)
    lines.push(`      const result = await ${dispatcherFn}(${happyInput})`)
    lines.push(`      expect(result).toBeDefined()`)
    lines.push(`      expect(typeof result).toBe('object')`)
    lines.push(`    })`)
    lines.push(``)
    lines.push(`  })`)
    lines.push(``)
  }

  lines.push(`})`)

  return lines.join('\n')
}

// ── Verification Report (combines both) ────────────────────────────────────

export function buildVerificationReport(program, analysis, structuralCache, skeleton, holes) {
  const confidence = computeConfidence(skeleton, holes, analysis, structuralCache)
  const testSuite  = generateTestSuite(program, analysis, structuralCache)
  return { confidence, testSuite }
}

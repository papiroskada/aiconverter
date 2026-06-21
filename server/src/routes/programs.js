import { Router } from 'express'
import multer from 'multer'
import { getAllPrograms, findProgramById } from '../models/programs.js'
import { getEdgesForUser, getEdgesForProgram } from '../models/programEdges.js'
import { getAnalysisByProgramId, updateFlag, patchEntryPoints, saveGeneratedCode, getGeneratedCode } from '../models/programAnalysis.js'
import { upsertFlag, deleteFlag, getFlagsForProgram } from '../models/programFlags.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { uploadAndStartAnalysis, reanalyze, deleteProgram, cancelProgram } from '../services/analysisService.js'
import { generateEntryPointTests, generateProgram, previewProgram, generateProgramTypes, checkConsistency, generateApplication, generateProject } from '../services/codeGen/index.js'
import { getCallersOf, getCallsFromProgram } from '../models/programCalls.js'
import { toMarkdown, toOpenApi } from '../services/exportService.js'
import { buildVerificationReport } from '../services/codeGen/verificationService.js'
import { requireRole } from '../middleware/auth.js'
import { logAudit } from '../models/auditLog.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(cbl|cob|cpy|c|u|s|txt)$/i.test(file.originalname)) cb(null, true)
    else cb(Object.assign(new Error('Unsupported file type'), { status: 400 }))
  },
})

import pool from '../db/client.js'
import { programSseEmitters as sseEmitters } from '../emitters.js'

// POST /api/programs/program-types
router.post('/program-types', async (req, res, next) => {
  try {
    const { programIds } = req.body
    if (!Array.isArray(programIds)) return res.status(400).json({ error: 'programIds must be array' })
    const result = await generateProgramTypes(programIds)
    res.json(result)
  } catch (err) { next(err) }
})

// POST /api/programs/consistency-check
router.post('/consistency-check', async (req, res, next) => {
  try {
    const { programIds } = req.body
    if (!Array.isArray(programIds)) return res.status(400).json({ error: 'programIds must be array' })
    const warnings = await checkConsistency(programIds)
    res.json({ warnings })
  } catch (err) { next(err) }
})

// POST /api/programs/application/:appId/generate-project
router.post('/application/:appId/generate-project', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id AS program_id FROM programs WHERE application_id = $1',
      [req.params.appId]
    )
    const programIds = rows.map(r => r.program_id)
    if (!programIds.length) return res.status(422).json({ error: 'No programs in application' })
    const result = await generateProject(programIds, { includeTests: req.body.includeTests ?? false })
    res.json(result)
  } catch (err) { next(err) }
})

// POST /api/programs/application/:appId/generate
router.post('/application/:appId/generate', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id AS program_id FROM programs WHERE application_id = $1',
      [req.params.appId]
    )
    const programIds = rows.map(r => r.program_id)
    if (!programIds.length) return res.status(422).json({ error: 'No programs in application' })
    const result = await generateApplication(programIds)
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/programs
router.get('/', async (req, res, next) => {
  try {
    const [programs, edges] = await Promise.all([getAllPrograms(req.user.sub), getEdgesForUser(req.user.sub)])
    res.json({ programs, edges })
  } catch (err) {
    next(err)
  }
})

// GET /api/programs/callers/:name — returns all programs that CALL the given program name
router.get('/callers/:name', async (req, res, next) => {
  try {
    const callers = await getCallersOf(req.params.name)
    res.json({ callers })
  } catch (err) {
    next(err)
  }
})

// GET /api/programs/:id/calls — returns all programs this program calls (structural)
router.get('/:id/calls', async (req, res, next) => {
  try {
    const calls = await getCallsFromProgram(req.params.id)
    res.json({ calls })
  } catch (err) {
    next(err)
  }
})

// GET /api/programs/:id/export?format=markdown|openapi
router.get('/:id/export', async (req, res, next) => {
  try {
    const [program, analysis] = await Promise.all([
      findProgramById(req.params.id),
      getAnalysisByProgramId(req.params.id),
    ])
    if (!program || !analysis) return res.status(404).json({ error: 'Not found' })

    const format = req.query.format ?? 'markdown'
    if (format === 'markdown') {
      const content = toMarkdown(program, analysis)
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${program.name}.md"`)
      return res.send(content)
    }
    if (format === 'openapi') {
      const spec = toOpenApi(program, analysis)
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="${program.name}-openapi.json"`)
      return res.json(spec)
    }
    res.status(400).json({ error: 'Unknown format. Use markdown or openapi.' })
  } catch (err) { next(err) }
})

// GET /api/programs/:id
router.get('/:id', async (req, res, next) => {
  try {
    const program = await findProgramById(req.params.id)
    if (!program) return res.status(404).json({ error: 'Not found' })

    const [analysis, chunks, edges, userFlags] = await Promise.all([
      getAnalysisByProgramId(req.params.id),
      getChunksByProgramId(req.params.id),
      getEdgesForProgram(req.params.id),
      getFlagsForProgram(req.params.id),
    ])
    res.json({ ...program, analysis, chunks, edges, userFlags })
  } catch (err) {
    next(err)
  }
})

// GET /api/programs/:id/stream  (SSE)
router.get('/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { id } = req.params
  if (!sseEmitters.has(id)) sseEmitters.set(id, new Set())
  sseEmitters.get(id).add(res)

  req.on('close', () => {
    const set = sseEmitters.get(id)
    if (set) {
      set.delete(res)
      if (set.size === 0) sseEmitters.delete(id)
    }
  })
})

// GET /api/programs/:id/chunks
router.get('/:id/chunks', async (req, res, next) => {
  try {
    const program = await findProgramById(req.params.id)
    if (!program) return res.status(404).json({ error: 'Not found' })
    const chunks = await getChunksByProgramId(req.params.id)
    res.json(chunks)
  } catch (err) {
    next(err)
  }
})

// POST /api/programs/upload
router.post('/upload', requireRole('developer', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const applicationId = req.body.application_id || null
    const file = req.file
    if (!file) return res.status(400).json({ error: 'No file provided' })
    const program = await uploadAndStartAnalysis(file, sseEmitters, applicationId, req.user?.sub)
    await logAudit(req.user.sub, 'upload', 'program', program.id, req.ip)
    res.status(202).json({ id: program.id, status: program.status })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/analyze  (re-analyze)
router.post('/:id/analyze', requireRole('developer', 'admin'), async (req, res) => {
  try {
    await reanalyze(req.params.id, sseEmitters, req.user?.sub)
    res.json({ status: 'analyzing' })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// GET /api/programs/:id/generate-preview
router.get('/:id/generate-preview', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const result = await previewProgram(req.params.id)
    res.json(result)
  } catch (err) { next(err) }
})

// POST /api/programs/:id/generate — delegates to generate-program (kept for backwards compat)
router.post('/:id/generate', requireRole('developer', 'admin'), async (req, res) => {
  try {
    const { includeTests = false } = req.body ?? {}
    const result = await generateProgram(req.params.id, { includeTests }, req.user?.sub)
    await logAudit(req.user.sub, 'generate', 'program', req.params.id, req.ip)
    res.json(result)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/generate-tests
router.post('/:id/generate-tests', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const result = await generateEntryPointTests(req.params.id, req.body.condition ?? null)
    res.json(result)
  } catch (err) { next(err) }
})

// GET /api/programs/:id/generated-code
router.get('/:id/generated-code', async (req, res, next) => {
  try {
    const cached = await getGeneratedCode(req.params.id)
    res.json(cached)
  } catch (err) { next(err) }
})

// GET /api/programs/:id/verification-report
router.get('/:id/verification-report', async (req, res, next) => {
  try {
    const [program, analysis] = await Promise.all([
      findProgramById(req.params.id),
      getAnalysisByProgramId(req.params.id),
    ])
    if (!program || !analysis) return res.status(404).json({ error: 'Not found' })
    const cache = program.structural_cache
    if (!cache) return res.status(404).json({ error: 'No structural cache — re-analyse first' })
    const report = buildVerificationReport(program, analysis, cache, null, [])
    res.json(report)
  } catch (err) { next(err) }
})

// POST /api/programs/:id/generate-program
router.post('/:id/generate-program', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const result = await generateProgram(req.params.id, { includeTests: req.body?.includeTests ?? false }, req.user?.sub)
    saveGeneratedCode(req.params.id, {
      code: result.code,
      tests: result.tests ?? null,
      language: result.language ?? 'typescript',
      notes: Array.isArray(result.notes) ? result.notes.join(' · ') : (result.notes ?? null),
    }).catch(() => {})
    await logAudit(req.user.sub, 'generate', 'program', req.params.id, req.ip)
    res.json(result)
  } catch (err) { next(err) }
})

// DELETE /api/programs/:id
router.delete('/:id', requireRole('developer', 'admin'), async (req, res) => {
  try {
    await deleteProgram(req.params.id, sseEmitters)
    await logAudit(req.user.sub, 'delete', 'program', req.params.id, req.ip)
    res.status(204).send()
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/cancel
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const cancelled = cancelProgram(req.params.id)
    res.json({ cancelled })
  } catch (err) {
    next(err)
  }
})

// PATCH /api/programs/:id/flags — sets or clears the current user's flag for one entry point
router.patch('/:id/flags', async (req, res) => {
  try {
    const { condition, flag } = req.body
    if (!condition) return res.status(400).json({ error: 'condition is required' })
    if (flag !== null && flag !== undefined && !['approved', 'warning', 'deprecated'].includes(flag)) {
      return res.status(400).json({ error: 'flag must be approved, warning, deprecated, or null' })
    }
    if (flag === null || flag === undefined) {
      await deleteFlag(req.params.id, req.user.sub, condition)
    } else {
      await upsertFlag(req.params.id, req.user.sub, condition, flag)
    }
    const userFlags = await getFlagsForProgram(req.params.id)
    res.json(userFlags)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// PATCH /api/programs/:id/entry-points
router.patch('/:id/entry-points', async (req, res) => {
  try {
    const { entry_points } = req.body
    if (!Array.isArray(entry_points)) return res.status(400).json({ error: 'entry_points must be array' })
    const updated = await patchEntryPoints(req.params.id, entry_points)
    res.json({ entry_points: updated })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

export default router

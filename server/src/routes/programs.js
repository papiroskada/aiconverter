import { Router } from 'express'
import multer from 'multer'
import { getAllPrograms, findProgramById } from '../models/programs.js'
import { getAllEdges, getEdgesForProgram } from '../models/programEdges.js'
import { getAnalysisByProgramId, updateFlag, patchEntryPoints } from '../models/programAnalysis.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { uploadAndStartAnalysis, reanalyze, deleteProgram, cancelProgram } from '../services/analysisService.js'
import { generateEntryPoint, generateProgram, generateDbTypes, checkConsistency, generateApplication } from '../services/codeGenerationService.js'
import { getCallersOf, getCallsFromProgram } from '../models/programCalls.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

import pool from '../db/client.js'

// SSE emitter registry: programId → Set of response objects
const sseEmitters = new Map()

// POST /api/programs/db-types
router.post('/db-types', async (req, res, next) => {
  try {
    const { programIds } = req.body
    if (!Array.isArray(programIds)) return res.status(400).json({ error: 'programIds must be array' })
    const result = await generateDbTypes(programIds)
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

// POST /api/programs/application/:appId/generate
router.post('/application/:appId/generate', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT program_id FROM application_programs WHERE application_id = $1',
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
    const [programs, edges] = await Promise.all([getAllPrograms(), getAllEdges()])
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

// GET /api/programs/:id
router.get('/:id', async (req, res, next) => {
  try {
    const program = await findProgramById(req.params.id)
    if (!program) return res.status(404).json({ error: 'Not found' })

    const [analysis, chunks, edges] = await Promise.all([
      getAnalysisByProgramId(req.params.id),
      getChunksByProgramId(req.params.id),
      getEdgesForProgram(req.params.id),
    ])
    res.json({ ...program, analysis, chunks, edges })
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
router.post('/upload', upload.fields([{ name: 'file', maxCount: 1 }, { name: 'companion', maxCount: 1 }]), async (req, res) => {
  try {
    const applicationId = req.body.application_id || null
    const file = req.files?.file?.[0]
    const companion = req.files?.companion?.[0] ?? null
    if (!file) return res.status(400).json({ error: 'No file provided' })
    const program = await uploadAndStartAnalysis(file, sseEmitters, applicationId, companion)
    res.status(202).json({ id: program.id, status: program.status })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/analyze  (re-analyze)
router.post('/:id/analyze', async (req, res) => {
  try {
    await reanalyze(req.params.id, sseEmitters)
    res.json({ status: 'analyzing' })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/generate
router.post('/:id/generate', async (req, res) => {
  try {
    const result = await generateEntryPoint(req.params.id, req.body.condition ?? null)
    res.json(result)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/generate-program
router.post('/:id/generate-program', async (req, res, next) => {
  try {
    const result = await generateProgram(req.params.id)
    res.json(result)
  } catch (err) { next(err) }
})

// DELETE /api/programs/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteProgram(req.params.id, sseEmitters)
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

// PATCH /api/programs/:id/flags
router.patch('/:id/flags', async (req, res) => {
  try {
    const { condition, flag } = req.body
    if (!condition) return res.status(400).json({ error: 'condition is required' })
    if (flag !== null && flag !== undefined && !['warning', 'deprecated'].includes(flag)) {
      return res.status(400).json({ error: 'flag must be warning, deprecated, or null' })
    }
    const flags = await updateFlag(req.params.id, condition, flag ?? null)
    res.json(flags)
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

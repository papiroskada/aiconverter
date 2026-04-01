import { Router } from 'express'
import multer from 'multer'
import { getAllPrograms, findProgramById } from '../models/programs.js'
import { getAllEdges, getEdgesForProgram } from '../models/programEdges.js'
import { getAnalysisByProgramId } from '../models/programAnalysis.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { uploadAndStartAnalysis, reanalyze, deleteProgram } from '../services/analysisService.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// SSE emitter registry: programId → Set of response objects
const sseEmitters = new Map()

// GET /api/programs
router.get('/', async (req, res, next) => {
  try {
    const [programs, edges] = await Promise.all([getAllPrograms(), getAllEdges()])
    res.json({ programs, edges })
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
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const program = await uploadAndStartAnalysis(req.file, sseEmitters)
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

// DELETE /api/programs/:id
router.delete('/:id', async (req, res) => {
  try {
    await deleteProgram(req.params.id, sseEmitters)
    res.status(204).send()
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

export default router

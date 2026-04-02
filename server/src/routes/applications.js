import { Router } from 'express'
import {
  createApplication,
  getAllApplications,
  findApplicationById,
  getApplicationPrograms,
} from '../models/applications.js'
import { startBatchAnalysis, cancelBatch } from '../services/batchService.js'

const router = Router()

// SSE emitter registry: applicationId → Set of response objects
export const appSseEmitters = new Map()

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const app = await createApplication({ name: name.trim().toUpperCase() })
    res.status(201).json(app)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const apps = await getAllApplications()
    res.json(apps.map(({ program_count, ...a }) => ({ ...a, programCount: parseInt(program_count, 10) })))
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const programs = await getApplicationPrograms(req.params.id)
    res.json({ ...application, programs })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { id } = req.params
  if (!appSseEmitters.has(id)) appSseEmitters.set(id, new Set())
  appSseEmitters.get(id).add(res)

  req.on('close', () => {
    const set = appSseEmitters.get(id)
    if (set) {
      set.delete(res)
      if (set.size === 0) appSseEmitters.delete(id)
    }
  })
})

router.post('/:id/analyze', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const mode = req.body.mode === 'parallel' ? 'parallel' : 'sequential'
    startBatchAnalysis(req.params.id, mode, appSseEmitters)
    res.status(202).json({ status: 'analyzing', mode })
  } catch (err) {
    next(err)
  }
})

// POST /api/applications/:id/cancel
router.post('/:id/cancel', async (req, res, next) => {
  try {
    cancelBatch(req.params.id)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router

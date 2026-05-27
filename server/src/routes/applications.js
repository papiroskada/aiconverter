import { Router } from 'express'
import { rmSync } from 'fs'
import {
  createApplication,
  getAllApplications,
  findApplicationById,
  getApplicationPrograms,
  deleteApplicationById,
} from '../models/applications.js'
import { getProgramsByApplicationId, deleteProgramsByApplicationId, getProgramsByAppForGraph } from '../models/programs.js'
import { getEdgesForApplication } from '../models/programEdges.js'
import { startBatchAnalysis, cancelBatch } from '../services/batchService.js'
import { cancelProgram } from '../services/analysisService.js'
import { requireRole } from '../middleware/auth.js'
import { logAudit } from '../models/auditLog.js'

const router = Router()

// SSE emitter registry: applicationId → Set of response objects
export const appSseEmitters = new Map()

router.post('/', requireRole('developer', 'admin'), async (req, res, next) => {
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

router.get('/:id/graph', async (req, res, next) => {
  try {
    const [programs, edges] = await Promise.all([
      getProgramsByAppForGraph(req.params.id),
      getEdgesForApplication(req.params.id),
    ])
    res.json({ programs, edges })
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

router.post('/:id/analyze', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const mode = req.body.mode === 'parallel' ? 'parallel' : 'sequential'
    startBatchAnalysis(req.params.id, mode, appSseEmitters, req.user?.sub)
    res.status(202).json({ status: 'analyzing', mode })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/applications/:id — cancels any running batch, deletes all programs + files + the application
router.delete('/:id', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    cancelBatch(req.params.id)
    const programs = await getProgramsByApplicationId(req.params.id)
    for (const p of programs) cancelProgram(p.id)
    await deleteProgramsByApplicationId(req.params.id)
    await deleteApplicationById(req.params.id)
    await logAudit(req.user.sub, 'delete', 'application', req.params.id, req.ip)
    res.status(204).send()
    // File cleanup after response — don't block the client
    for (const p of programs) {
      if (p.file_path) try { rmSync(p.file_path, { force: true }) } catch {}
    }
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

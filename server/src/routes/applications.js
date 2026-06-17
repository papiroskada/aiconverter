import { Router } from 'express'
import { rmSync } from 'fs'
import {
  createApplication,
  getAllApplications,
  findApplicationById,
  getApplicationPrograms,
  deleteApplicationById,
  getApplicationMembers,
  addApplicationMember,
  removeApplicationMember,
} from '../models/applications.js'
import { getProgramsByApplicationId, deleteProgramsByApplicationId, getProgramsByAppForGraph } from '../models/programs.js'
import { getEdgesForApplication } from '../models/programEdges.js'
import { startBatchAnalysis, cancelBatch } from '../services/batchService.js'
import { cancelProgram } from '../services/analysisService.js'
import { requireRole } from '../middleware/auth.js'
import { logAudit } from '../models/auditLog.js'

const router = Router()

import { programSseEmitters, appSseEmitters } from '../emitters.js'

router.post('/', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const app = await createApplication({ name: name.trim().toUpperCase(), created_by: req.user.sub })
    res.status(201).json(app)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const apps = await getAllApplications(req.user.sub)
    res.json(apps.map(({ program_count, ...a }) => ({
      ...a,
      programCount: parseInt(program_count, 10),
      isOwner: a.is_owner === true || a.is_owner === 't',
      ownerName: a.owner_name ?? null,
    })))
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const programs = await getApplicationPrograms(req.params.id)
    res.json({ ...application, programs })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/graph', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const [programs, edges] = await Promise.all([
      getProgramsByAppForGraph(req.params.id),
      getEdgesForApplication(req.params.id),
    ])
    res.json({ programs, edges })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/stream', async (req, res) => {
  const application = await findApplicationById(req.params.id, req.user.sub)
  if (!application) { res.status(404).end(); return }

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
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const mode = req.body.mode === 'parallel' ? 'parallel' : 'sequential'
    startBatchAnalysis(req.params.id, mode, appSseEmitters, programSseEmitters, req.user?.sub)
    res.status(202).json({ status: 'analyzing', mode })
  } catch (err) {
    next(err)
  }
})

// DELETE /api/applications/:id — cancels any running batch, deletes all programs + files + the application
router.delete('/:id', requireRole('developer', 'admin'), async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    if (application.is_owner !== true && application.is_owner !== 't') {
      return res.status(403).json({ error: 'Only the project owner can delete it' })
    }
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

// GET /api/applications/:id/members
router.get('/:id/members', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const members = await getApplicationMembers(req.params.id)
    res.json(members)
  } catch (err) { next(err) }
})

// POST /api/applications/:id/members — add member by email (owner only)
router.post('/:id/members', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const isOwner = application.is_owner === true || application.is_owner === 't'
    if (!isOwner) return res.status(403).json({ error: 'Only the project owner can invite members' })
    const { email } = req.body
    if (!email?.trim()) return res.status(400).json({ error: 'email is required' })
    const result = await addApplicationMember(req.params.id, email.trim(), req.user.sub)
    if (result.error) return res.status(400).json({ error: result.error })
    const members = await getApplicationMembers(req.params.id)
    res.json(members)
  } catch (err) { next(err) }
})

// DELETE /api/applications/:id/members/:memberId — remove member (owner only)
router.delete('/:id/members/:memberId', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id, req.user.sub)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const isOwner = application.is_owner === true || application.is_owner === 't'
    if (!isOwner) return res.status(403).json({ error: 'Only the project owner can remove members' })
    await removeApplicationMember(req.params.id, req.params.memberId)
    const members = await getApplicationMembers(req.params.id)
    res.json(members)
  } catch (err) { next(err) }
})

export default router

import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { getAllUsers, createUser, updateUser } from '../models/users.js'
import { requireRole } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const createSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1),
  role:     z.enum(['admin', 'developer', 'viewer']),
  password: z.string().min(8),
})

const updateSchema = z.object({
  role:      z.enum(['admin', 'developer', 'viewer']).optional(),
  is_active: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'No fields to update' })

// All users routes — admin only
router.use(requireRole('admin'))

// GET /api/users
router.get('/', async (req, res, next) => {
  try { res.json(await getAllUsers()) }
  catch (err) { next(err) }
})

// POST /api/users
router.post('/', validate(createSchema), async (req, res, next) => {
  try {
    const { email, name, role, password } = req.body
    const password_hash = await bcrypt.hash(password, 12)
    const user = await createUser({ email, name, password_hash, role })
    res.status(201).json(user)
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already in use' })
    next(err)
  }
})

// PATCH /api/users/:id
router.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    const user = await updateUser(req.params.id, req.body)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user)
  } catch (err) { next(err) }
})

export default router

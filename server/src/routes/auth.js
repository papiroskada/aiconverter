import { Router } from 'express'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { findUserByEmail, findUserById } from '../models/users.js'
import { saveRefreshToken, findRefreshToken, revokeRefreshToken, generateRefreshToken } from '../models/refreshTokens.js'
import { logAudit } from '../models/auditLog.js'
import { signAccessToken, requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { authLimiter } from '../middleware/rateLimiter.js'

const router = Router()

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/api/auth',
}

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

// POST /api/auth/login
router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body
    const user = await findUserByEmail(email)

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is deactivated' })
    }

    const accessToken    = signAccessToken({ sub: user.id, email: user.email, role: user.role })
    const refreshToken   = generateRefreshToken()
    await saveRefreshToken(user.id, refreshToken)
    await logAudit(user.id, 'login', null, null, req.ip)

    res.cookie('refreshToken', refreshToken, COOKIE_OPTS)
    res.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) { next(err) }
})

// POST /api/auth/refresh
router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken
    if (!token) return res.status(401).json({ error: 'No refresh token' })

    const stored = await findRefreshToken(token)
    if (!stored) return res.status(401).json({ error: 'Invalid or expired refresh token' })

    const user = await findUserById(stored.user_id)
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' })
    }

    const accessToken = signAccessToken({ sub: user.id, email: user.email, role: user.role })
    res.json({
      accessToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    })
  } catch (err) { next(err) }
})

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const token = req.cookies?.refreshToken
  if (token) await revokeRefreshToken(token).catch(() => {})
  res.clearCookie('refreshToken', { ...COOKIE_OPTS, maxAge: 0 })
  res.status(204).send()
})

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await findUserById(req.user.sub)
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role })
  } catch (err) { next(err) }
})

export default router

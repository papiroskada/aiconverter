import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { apiLimiter } from './middleware/rateLimiter.js'
import { requireAuth } from './middleware/auth.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import programsRouter from './routes/programs.js'
import settingsRouter from './routes/settings.js'
import applicationsRouter from './routes/applications.js'

const app = express()

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet())

// ── CORS — only allow the configured frontend origin ─────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}))

// ── Body & cookie parsing ─────────────────────────────────────────────────────
app.use(express.json())
app.use(cookieParser())

// ── Public auth routes (no token required) ────────────────────────────────────
app.use('/api/auth', authRouter)

// ── Global rate limit + auth for all other /api routes ───────────────────────
app.use('/api', apiLimiter, requireAuth)

// ── Protected routes ─────────────────────────────────────────────────────────
app.use('/api/users',        usersRouter)
app.use('/api/programs',     programsRouter)
app.use('/api/settings',     settingsRouter)
app.use('/api/applications', applicationsRouter)

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app

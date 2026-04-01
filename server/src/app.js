import express from 'express'
import cors from 'cors'
import programsRouter from './routes/programs.js'
import settingsRouter from './routes/settings.js'
import applicationsRouter from './routes/applications.js'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/programs', programsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/applications', applicationsRouter)

// Global error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app

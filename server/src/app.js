import express from 'express'
import cors from 'cors'
import programsRouter from './routes/programs.js'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/programs', programsRouter)

// Global error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app

import { getApplicationPrograms, updateApplicationStatus } from '../models/applications.js'
import { getSettings } from '../models/settings.js'
import { runProgramFromFile } from './analysisService.js'

const CONCURRENCY_LIMIT = 3

async function runWithConcurrencyLimit(tasks, limit) {
  const results = []
  const executing = new Set()

  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r })
    executing.add(p)
    results.push(p)
    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  return Promise.allSettled(results)
}

export async function startBatchAnalysis(applicationId, mode, appSseEmitters) {
  const [programs, settings] = await Promise.all([
    getApplicationPrograms(applicationId),
    getSettings(),
  ])

  const pending = programs.filter(p => p.status !== 'analyzed')
  if (pending.length === 0) {
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: done\ndata: ${JSON.stringify({ applicationId })}\n\n`)
    }
    return
  }

  await updateApplicationStatus(applicationId, 'analyzing')

  const sseEmitters = new Map() // program-level SSE not used in batch; app-level handles progress

  const run = async () => {
    if (mode === 'parallel') {
      const tasks = pending.map(p => () => runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters))
      await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT)
    } else {
      for (const p of pending) {
        await runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters)
      }
    }

    const updated = await getApplicationPrograms(applicationId)
    const allDone = updated.every(p => p.status === 'analyzed' || p.status === 'failed')
    const anyFailed = updated.some(p => p.status === 'failed')
    await updateApplicationStatus(applicationId, anyFailed ? 'failed' : allDone ? 'analyzed' : 'analyzing')

    // Emit done on app SSE
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: done\ndata: ${JSON.stringify({ applicationId })}\n\n`)
    }
  }

  const runPromise = run()
  runPromise.catch(async (err) => {
    await updateApplicationStatus(applicationId, 'failed')
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: failed\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    }
  })
  return runPromise // tests can await this; production routes ignore the return value
}

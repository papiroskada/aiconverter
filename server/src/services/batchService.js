import { getApplicationPrograms, updateApplicationStatus } from '../models/applications.js'
import { getSettings } from '../models/settings.js'
import { runProgramFromFile, cancelProgram } from './analysisService.js'

const CONCURRENCY_LIMIT = 3

const cancelledBatches = new Set()          // applicationIds that have been cancelled
const batchProgramIds = new Map()           // applicationId → programId[]

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

// Cancel a running batch: abort in-progress programs and prevent future ones from starting.
export function cancelBatch(applicationId) {
  cancelledBatches.add(applicationId)
  const ids = batchProgramIds.get(applicationId) || []
  for (const id of ids) cancelProgram(id)
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
  batchProgramIds.set(applicationId, pending.map(p => p.id))

  const sseEmitters = new Map() // program-level SSE not used in batch; app-level handles progress

  const run = async () => {
    if (mode === 'parallel') {
      const tasks = pending.map(p => () => {
        if (cancelledBatches.has(applicationId)) return Promise.resolve()
        return runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters)
      })
      await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT)
    } else {
      for (const p of pending) {
        if (cancelledBatches.has(applicationId)) break
        await runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters)
      }
    }

    batchProgramIds.delete(applicationId)

    if (cancelledBatches.has(applicationId)) {
      cancelledBatches.delete(applicationId)
      await updateApplicationStatus(applicationId, 'pending')
      const emitters = appSseEmitters.get(applicationId) || []
      for (const res of emitters) {
        res.write(`event: cancelled\ndata: ${JSON.stringify({ applicationId })}\n\n`)
      }
      return
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
    batchProgramIds.delete(applicationId)
    cancelledBatches.delete(applicationId)
    await updateApplicationStatus(applicationId, 'failed')
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: failed\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    }
  })
  return runPromise // tests can await this; production routes ignore the return value
}

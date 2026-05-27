import { getApplicationPrograms, updateApplicationStatus } from '../models/applications.js'
import { getSettings } from '../models/settings.js'
import { runProgramFromFile, cancelProgram } from './analysisService.js'
import { logger } from '../logger.js'

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

export async function startBatchAnalysis(applicationId, mode, appSseEmitters, userId = null) {
  const [programs, settings] = await Promise.all([
    getApplicationPrograms(applicationId),
    getSettings(),
  ])

  const pending = programs.filter(p => p.status !== 'analyzed')
  if (pending.length === 0) {
    logger.info('BATCH', `No pending programs in application ${applicationId} — skipping`)
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: done\ndata: ${JSON.stringify({ applicationId })}\n\n`)
    }
    return
  }

  logger.start('BATCH', `Starting ${mode} analysis of ${pending.length} program(s): ${pending.map(p => p.name).join(', ')}`)
  await updateApplicationStatus(applicationId, 'analyzing')
  batchProgramIds.set(applicationId, pending.map(p => p.id))

  const sseEmitters = new Map() // program-level SSE not used in batch; app-level handles progress
  const tBatch = Date.now()

  const run = async () => {
    if (mode === 'parallel') {
      const tasks = pending.map(p => () => {
        if (cancelledBatches.has(applicationId)) return Promise.resolve()
        logger.start(p.name, `Batch [${mode}]: starting program`)
        return runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters, userId)
      })
      await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT)
    } else {
      for (const p of pending) {
        if (cancelledBatches.has(applicationId)) break
        logger.start(p.name, `Batch [${mode}]: starting program`)
        await runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters, userId)
      }
    }

    batchProgramIds.delete(applicationId)

    if (cancelledBatches.has(applicationId)) {
      cancelledBatches.delete(applicationId)
      logger.info('BATCH', `Batch cancelled for application ${applicationId}`)
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
    const finalStatus = anyFailed ? 'failed' : allDone ? 'analyzed' : 'analyzing'
    await updateApplicationStatus(applicationId, finalStatus)

    const failed = updated.filter(p => p.status === 'failed').map(p => p.name)
    logger.done('BATCH', `Batch complete — ${updated.filter(p => p.status === 'analyzed').length} analyzed, ${failed.length} failed${failed.length ? `: ${failed.join(', ')}` : ''}`, Date.now() - tBatch)

    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: done\ndata: ${JSON.stringify({ applicationId })}\n\n`)
    }
  }

  const runPromise = run()
  runPromise.catch(async (err) => {
    batchProgramIds.delete(applicationId)
    cancelledBatches.delete(applicationId)
    logger.error('BATCH', `Batch failed unexpectedly: ${err.message}`)
    await updateApplicationStatus(applicationId, 'failed')
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: failed\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    }
  })
  return runPromise // tests can await this; production routes ignore the return value
}

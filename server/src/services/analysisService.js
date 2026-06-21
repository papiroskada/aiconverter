import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol, preprocessCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { logger } from '../logger.js'
import { getSettings } from '../models/settings.js'
import { createProgram, updateProgramStatus, findProgramByName, findProgramByNameInApp, findProgramForUpload, findProgramById, updateFilePath, updateProgramApplicationId, deleteProgramById, deleteOrphanedPhantoms, saveStructuralCache } from '../models/programs.js'
import { upsertBusinessAnalysis } from '../models/programAnalysis.js'
import { insertChunks, getChunksByProgramId } from '../models/programChunks.js'
import { backfillEdgesForNewProgram, updateGraphAfterAnalysis } from './graphService.js'
import { upsertCall } from '../models/programCalls.js'
import { recordUsage } from '../models/tokenUsage.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

// Active AbortControllers: programId → AbortController
const activeControllers = new Map()

function makeEmit(programId, sseEmitters) {
  return (event, data) => {
    const emitters = sseEmitters.get(programId) || []
    for (const res of emitters) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }
}

// Core analysis logic — awaitable, accepts a pre-built emit function and settings config
async function runAnalysisCore(programId, programName, cobolText, savedChunks, emit, settings, userId = null) {
  const controller = new AbortController()
  activeControllers.set(programId, controller)
  const provider = await getProvider(settings)

  if (userId) {
    provider.setUsageCallback(({ action, model, tokensIn, tokensOut }) => {
      recordUsage(userId, programId, action, model, tokensIn, tokensOut).catch(() => {})
    })
  }

  const aiProvider = settings.ai_provider ?? 'openai'
  const aiModel = aiProvider === 'openai'
    ? (settings.openai_model_interface ?? 'gpt-4o')
    : (settings.claude_model_interface ?? 'claude-sonnet-4-6')
  logger.info(programName, `Starting analysis — provider: ${aiProvider}, model: ${aiModel}`)
  emit('progress', { stage: 'analysis', message: `Starting analysis (${aiProvider} / ${aiModel})...` })

  const t0 = Date.now()
  try {
    const program = await findProgramById(programId)

    const structuralCacheIn = program.structural_cache ?? null
    const analysis = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName, signal: controller.signal, structuralCacheIn })
    const result = analysis.result
    const structuralCache = analysis.structuralCache
    if (!structuralCacheIn) {
      await saveStructuralCache(programId, analysis.structuralCache)
    }

    const analysisModel = settings.ai_provider === 'openai'
      ? (settings.openai_model_interface ?? 'gpt-4o')
      : (settings.claude_model_interface ?? 'claude-sonnet-4-6')
    await upsertBusinessAnalysis(programId, { ...result, analysis_model: analysisModel })
    await updateGraphAfterAnalysis(programId, (result.external_dependencies ?? []).map(d => ({ program: d.program, using: '' })))
    for (const call of (structuralCache?.calls ?? [])) {
      const calleeName = call.program?.toUpperCase()
      if (!calleeName) continue
      const target = program.application_id
        ? await findProgramByNameInApp(calleeName, program.application_id)
        : await findProgramByName(calleeName)
      await upsertCall({
        caller_program_id: programId,
        callee_name: calleeName,
        callee_program_id: target?.id ?? null,
        call_context: call.using ?? '',
      })
    }
    await updateProgramStatus(programId, 'analyzed', { analyzed_at: true })
    logger.done(programName, 'Analysis complete', Date.now() - t0)
    emit('done', { programId })
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.done(programName, 'Analysis cancelled', Date.now() - t0)
      await updateProgramStatus(programId, 'pending')
      emit('cancelled', { programId })
      return
    }
    logger.error(programName, `Analysis failed: ${err.message}`, Date.now() - t0)
    emit('progress', { stage: 'failed', message: `Analysis failed: ${err.message}` })
    await updateProgramStatus(programId, 'failed')
    emit('failed', { error: err.message })
  } finally {
    activeControllers.delete(programId)
  }
}

// Cancel an in-progress analysis. Returns true if a controller was found and aborted.
export function cancelProgram(programId) {
  const controller = activeControllers.get(programId)
  if (!controller) return false
  controller.abort()
  return true
}

// Single-file upload: saves file, parses, and fire-and-forgets analysis (no applicationId)
// Batch upload: saves file and parses only — batchService handles analysis (with applicationId)
export async function uploadAndStartAnalysis(file, sseEmitters, applicationId = null, userId = null) {
  mkdirSync(UPLOADS_DIR, { recursive: true })

  const sourceText = file.buffer.toString('utf8')
  const cobolText = preprocessCobol(sourceText)
  const programName = file.originalname.replace(/\.(cbl|cob)$/i, '').toUpperCase()

  let program = await findProgramForUpload(programName, applicationId)
  if (!program) {
    program = await createProgram({
      name: programName,
      status: 'analyzing',
      application_id: applicationId,
    })
  } else {
    // Single-file uploads: reject if already analyzing (SSE subscriber is watching it)
    // Batch uploads (applicationId set): force-reset even if stuck from a previous run
    if (program.status === 'analyzing' && !applicationId) {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
    if (applicationId && !program.application_id) {
      await updateProgramApplicationId(program.id, applicationId)
    }
  }

  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  writeFileSync(filePath, cobolText)
  await updateFilePath(program.id, filePath)

  await backfillEdgesForNewProgram(program)

  const emit = makeEmit(program.id, sseEmitters)

  const t0 = Date.now()
  logger.start(programName, 'Parsing COBOL file...')
  emit('progress', { stage: 'parsing', message: 'Parsing COBOL file...' })
  const parsedChunks = parseCobol(cobolText)
  const savedChunks = await insertChunks(program.id, parsedChunks)
  const parseDuration = Date.now() - t0
  logger.done(programName, `Parsed ${savedChunks.length} chunks`, parseDuration)
  emit('progress', { stage: 'parsing', message: `Parsed ${savedChunks.length} chunks`, durationMs: parseDuration })

  // Always start analysis immediately after upload (fire-and-forget)
  const settings = await getSettings()
  runAnalysisCore(program.id, programName, cobolText, savedChunks, emit, settings, userId)

  return program
}

// Called by batchService: reads saved file, runs analysis, emits on both program and app SSE
export async function runProgramFromFile(programId, programSseEmitters, settings, appSseEmitters = null, userId = null) {
  const program = await findProgramById(programId)
  if (!program || !program.file_path) return

  await updateProgramStatus(programId, 'analyzing')
  const cobolText = preprocessCobol(readFileSync(program.file_path, 'utf8'))
  const savedChunks = await getChunksByProgramId(programId)

  const programEmit = makeEmit(programId, programSseEmitters)
  const emit = (event, data) => {
    programEmit(event, data)
    if (appSseEmitters && program.application_id) {
      const appEmitters = appSseEmitters.get(program.application_id) || new Set()
      for (const res of appEmitters) {
        res.write(`event: ${event}\ndata: ${JSON.stringify({ programId, programName: program.name, ...data })}\n\n`)
      }
    }
  }

  await runAnalysisCore(programId, program.name, cobolText, savedChunks, emit, settings, userId)
}

export async function reanalyze(programId, sseEmitters, userId = null) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') throw Object.assign(new Error('Already analyzing'), { status: 409 })

  if (!program.file_path) throw Object.assign(new Error('No source file found'), { status: 404 })
  await updateProgramStatus(programId, 'analyzing')
  await saveStructuralCache(programId, null)
  const cobolText = preprocessCobol(readFileSync(program.file_path, 'utf8'))
  const existingChunks = await getChunksByProgramId(programId)
  const settings = await getSettings()
  const emit = makeEmit(programId, sseEmitters)

  runAnalysisCore(programId, program.name, cobolText, existingChunks, emit, settings, userId)
}

export async function deleteProgram(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })

  // If analysis is actively running (controller exists in memory) — cancel it first.
  // A stale 'analyzing' status from a previous server run is not a blocker.
  const controller = activeControllers.get(programId)
  if (controller) {
    controller.abort()
    activeControllers.delete(programId)
  }

  await deleteProgramById(programId)
  await deleteOrphanedPhantoms()

  if (program.file_path) {
    try {
      rmSync(program.file_path, { force: true })
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(program.name, `Failed to remove file: ${err.message}`)
      }
    }
  }

  const emitters = sseEmitters.get(programId)
  if (emitters) {
    for (const res of emitters) res.end()
    sseEmitters.delete(programId)
  }
}

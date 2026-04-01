import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { logger } from '../logger.js'
import { getSettings } from '../models/settings.js'
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath, deleteProgramById, deleteOrphanedPhantoms } from '../models/programs.js'
import { upsertAnalysis, updateDiagram, updateAnalysisFields } from '../models/programAnalysis.js'
import { insertChunks, getChunksByProgramId, updateChunkPurpose } from '../models/programChunks.js'
import { backfillEdgesForNewProgram, updateGraphAfterAnalysis } from './graphService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

function makeEmit(programId, sseEmitters) {
  return (event, data) => {
    const emitters = sseEmitters.get(programId) || []
    for (const res of emitters) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }
}

// Core analysis logic — awaitable, accepts a pre-built emit function and settings config
async function runAnalysisCore(programId, programName, cobolText, savedChunks, emit, settings) {
  const provider = await getProvider(settings)
  try {
    const {
      description, flow_narrative, input_contract, output_contract,
      external_calls, db_tables, file_ops, sections, diagram,
    } = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName })

    await upsertAnalysis({ program_id: programId, description, call_parameters: [], external_calls: [], db_tables: [] })
    await updateAnalysisFields(programId, { external_calls, db_tables, file_ops, input_contract, output_contract, flow_narrative })
    if (diagram != null) await updateDiagram(programId, diagram)

    const chunkNameMap = new Map(savedChunks.map(c => [c.chunk_name, c.id]))
    for (const section of sections) {
      const chunkId = chunkNameMap.get(section.name)
      if (chunkId) await updateChunkPurpose(chunkId, section.purpose, section.rules ?? [])
    }

    await updateGraphAfterAnalysis(programId, external_calls)
    await updateProgramStatus(programId, 'analyzed', { analyzed_at: true })
    emit('done', { programId })
  } catch (err) {
    logger.error(programName, `Analysis failed: ${err.message}`)
    emit('progress', { stage: 'failed', message: `Analysis failed: ${err.message}` })
    await updateProgramStatus(programId, 'failed')
    emit('failed', { error: err.message })
  }
}

// Single-file upload: saves file, parses, and fire-and-forgets analysis (no applicationId)
// Batch upload: saves file and parses only — batchService handles analysis (with applicationId)
export async function uploadAndStartAnalysis(file, sseEmitters, applicationId = null) {
  mkdirSync(UPLOADS_DIR, { recursive: true })

  const cobolText = file.buffer.toString('utf8')
  const programName = file.originalname.replace(/\.cbl$/i, '').toUpperCase()

  let program = await findProgramByName(programName)
  if (!program) {
    program = await createProgram({ name: programName, status: 'analyzing', application_id: applicationId })
  } else {
    if (program.status === 'analyzing') {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
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

  // Single-file: start analysis immediately (fire-and-forget)
  if (!applicationId) {
    const settings = await getSettings()
    runAnalysisCore(program.id, programName, cobolText, savedChunks, emit, settings)
  }

  return program
}

// Called by batchService: reads saved file, runs analysis, emits on both program and app SSE
export async function runProgramFromFile(programId, programSseEmitters, settings, appSseEmitters = null) {
  const program = await findProgramById(programId)
  if (!program || !program.file_path) return

  await updateProgramStatus(programId, 'analyzing')
  const cobolText = readFileSync(program.file_path, 'utf8')
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

  await runAnalysisCore(programId, program.name, cobolText, savedChunks, emit, settings)
}

export async function reanalyze(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') throw Object.assign(new Error('Already analyzing'), { status: 409 })

  await updateProgramStatus(programId, 'analyzing')
  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  const cobolText = readFileSync(filePath, 'utf8')
  const existingChunks = await getChunksByProgramId(programId)
  const settings = await getSettings()
  const emit = makeEmit(programId, sseEmitters)

  runAnalysisCore(programId, program.name, cobolText, existingChunks, emit, settings)
}

export async function deleteProgram(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') {
    throw Object.assign(new Error('Cannot delete program while analyzing'), { status: 409 })
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

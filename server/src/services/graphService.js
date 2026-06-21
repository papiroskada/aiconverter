import { findProgramByNameInApp, findProgramById, createProgram, updateProgramStatus } from '../models/programs.js'
import { upsertEdge, backfillPhantomEdges } from '../models/programEdges.js'
import { backfillCallTargets } from '../models/programCalls.js'

export async function updateGraphAfterAnalysis(fromProgramId, externalCalls) {
  const fromProgram = await findProgramById(fromProgramId)
  const applicationId = fromProgram?.application_id ?? null

  for (const call of externalCalls) {
    const name = call.program?.toUpperCase()
    if (!name) continue

    let target = applicationId
      ? await findProgramByNameInApp(name, applicationId)
      : null
    let targetId = target ? target.id : null

    if (!target) {
      const created = await createProgram({ name, status: 'pending', application_id: applicationId })
      targetId = created.id
    }

    await upsertEdge({
      from_program_id: fromProgramId,
      to_program_name: name,
      to_program_id: targetId,
      context: call.using ?? '',
    })
  }

  await updateProgramStatus(fromProgramId, 'analyzed', { analyzed_at: true })
}

export async function backfillEdgesForNewProgram(program) {
  const appId = program.application_id ?? null
  await backfillPhantomEdges(program.name, program.id, appId)
  await backfillCallTargets(program.name, program.id, appId)
}

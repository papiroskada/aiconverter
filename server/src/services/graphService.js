import { findProgramByName, createProgram, updateProgramStatus } from '../models/programs.js'
import { upsertEdge, backfillPhantomEdges } from '../models/programEdges.js'
import { backfillCallTargets } from '../models/programCalls.js'

export async function updateGraphAfterAnalysis(fromProgramId, externalCalls) {
  for (const call of externalCalls) {
    const name = call.program?.toUpperCase()
    if (!name) continue

    let target = await findProgramByName(name)
    let targetId = target ? target.id : null

    if (!target) {
      const created = await createProgram({ name, status: 'pending' })
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
  await backfillPhantomEdges(program.name, program.id)
  await backfillCallTargets(program.name, program.id)
}

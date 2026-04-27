import pool from '../db/client.js'

export async function upsertCall({ caller_program_id, callee_name, callee_program_id = null, call_context = '' }) {
  await pool.query(
    `INSERT INTO program_calls (caller_program_id, callee_name, callee_program_id, call_context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (caller_program_id, callee_name) DO UPDATE
       SET callee_program_id = EXCLUDED.callee_program_id`,
    [caller_program_id, callee_name, callee_program_id, call_context]
  )
}

export async function getCallsFromProgram(programId) {
  const { rows } = await pool.query(
    `SELECT callee_name, callee_program_id, call_context
     FROM program_calls WHERE caller_program_id = $1
     ORDER BY callee_name`,
    [programId]
  )
  return rows
}

export async function getCallersOf(calleeName) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, pc.call_context
     FROM program_calls pc
     JOIN programs p ON p.id = pc.caller_program_id
     WHERE pc.callee_name = $1
     ORDER BY p.name`,
    [calleeName.toUpperCase()]
  )
  return rows
}

export async function backfillCallTargets(callee_name, callee_id) {
  await pool.query(
    `UPDATE program_calls SET callee_program_id = $1
     WHERE callee_name = $2 AND callee_program_id IS NULL`,
    [callee_id, callee_name]
  )
}

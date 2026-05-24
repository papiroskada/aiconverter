import pool from '../db/client.js'

export async function upsertFlag(programId, userId, condition, flag) {
  await pool.query(
    `INSERT INTO program_flags (program_id, user_id, condition, flag)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (program_id, user_id, condition)
     DO UPDATE SET flag = $4, updated_at = NOW()`,
    [programId, userId, condition, flag]
  )
}

export async function deleteFlag(programId, userId, condition) {
  await pool.query(
    `DELETE FROM program_flags WHERE program_id = $1 AND user_id = $2 AND condition = $3`,
    [programId, userId, condition]
  )
}

// Returns { [condition]: [{ userId, name, flag }] }
export async function getFlagsForProgram(programId) {
  const { rows } = await pool.query(
    `SELECT pf.condition, pf.flag, pf.user_id, u.name AS user_name
     FROM program_flags pf
     JOIN users u ON u.id = pf.user_id
     WHERE pf.program_id = $1
     ORDER BY pf.condition, u.name`,
    [programId]
  )
  return rows.reduce((acc, row) => {
    if (!acc[row.condition]) acc[row.condition] = []
    acc[row.condition].push({ userId: row.user_id, name: row.user_name, flag: row.flag })
    return acc
  }, {})
}

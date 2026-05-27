import pool from '../db/client.js'

export async function upsertEdge({ from_program_id, to_program_name, to_program_id = null, context = null }) {
  await pool.query(
    `INSERT INTO program_edges (from_program_id, to_program_name, to_program_id, context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_program_id, to_program_name) DO NOTHING`,
    [from_program_id, to_program_name, to_program_id, context]
  )
}

export async function backfillPhantomEdges(program_name, program_id) {
  await pool.query(
    `UPDATE program_edges
     SET to_program_id = $1
     WHERE to_program_name = $2 AND to_program_id IS NULL`,
    [program_id, program_name]
  )
}

export async function getAllEdges() {
  const { rows } = await pool.query(
    `SELECT from_program_id AS "from", to_program_id AS "to", to_program_name AS to_name
     FROM program_edges`
  )
  return rows
}

export async function getEdgesForApplication(applicationId) {
  const { rows } = await pool.query(
    `SELECT pe.from_program_id AS "from", pe.to_program_id AS "to", pe.to_program_name AS to_name
     FROM program_edges pe
     JOIN programs fp ON fp.id = pe.from_program_id
     WHERE fp.application_id = $1`,
    [applicationId]
  )
  return rows
}

export async function getEdgesForProgram(program_id) {
  const { rows } = await pool.query(
    `SELECT pe.*,
            fp.name AS from_program_name,
            tp.name AS to_program_name_resolved,
            tp.status AS to_program_status
     FROM program_edges pe
     JOIN programs fp ON fp.id = pe.from_program_id
     LEFT JOIN programs tp ON tp.id = pe.to_program_id
     WHERE pe.from_program_id = $1 OR pe.to_program_id = $1`,
    [program_id]
  )
  return rows
}

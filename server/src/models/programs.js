import pool from '../db/client.js'

export async function createProgram({ name, file_path = null, status = 'pending' }) {
  const { rows } = await pool.query(
    `INSERT INTO programs (name, file_path, status)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, file_path, status]
  )
  return rows[0]
}

export async function findProgramByName(name) {
  const { rows } = await pool.query(
    'SELECT * FROM programs WHERE name = $1 LIMIT 1',
    [name]
  )
  return rows[0] || null
}

export async function findProgramById(id) {
  const { rows } = await pool.query('SELECT * FROM programs WHERE id = $1', [id])
  return rows[0] || null
}

export async function updateProgramStatus(id, status, extra = {}) {
  const { rows } = await pool.query(
    `UPDATE programs SET status = $1, updated_at = NOW()
     ${extra.analyzed_at ? ', analyzed_at = NOW()' : ''}
     WHERE id = $2 RETURNING *`,
    [status, id]
  )
  return rows[0]
}

export async function updateFilePath(id, file_path) {
  await pool.query(
    'UPDATE programs SET file_path = $1, updated_at = NOW() WHERE id = $2',
    [file_path, id]
  )
}

export async function getAllPrograms() {
  const { rows } = await pool.query('SELECT id, name, status FROM programs ORDER BY created_at ASC')
  return rows
}

export async function deleteProgramById(id) {
  const { rows } = await pool.query(
    'DELETE FROM programs WHERE id = $1 RETURNING *',
    [id]
  )
  return rows[0] || null
}

export async function deleteOrphanedPhantoms() {
  await pool.query(`
    DELETE FROM programs
    WHERE status = 'pending'
    AND id NOT IN (
      SELECT DISTINCT to_program_id FROM program_edges WHERE to_program_id IS NOT NULL
    )
  `)
}

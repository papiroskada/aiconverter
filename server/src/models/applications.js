import pool from '../db/client.js'

export async function createApplication({ name }) {
  const { rows } = await pool.query(
    `INSERT INTO applications (name) VALUES ($1) RETURNING *`,
    [name]
  )
  return rows[0]
}

export async function getAllApplications() {
  const { rows } = await pool.query(`
    SELECT a.id, a.name, a.status, a.created_at, a.updated_at,
           COUNT(p.id) AS program_count
    FROM applications a
    LEFT JOIN programs p ON p.application_id = a.id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `)
  return rows
}

export async function findApplicationById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE id = $1',
    [id]
  )
  return rows[0] || null
}

export async function getApplicationPrograms(applicationId) {
  const { rows } = await pool.query(
    'SELECT id, name, status FROM programs WHERE application_id = $1 ORDER BY created_at ASC',
    [applicationId]
  )
  return rows
}

export async function updateApplicationStatus(id, status) {
  await pool.query(
    'UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  )
}

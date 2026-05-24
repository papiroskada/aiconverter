import pool from '../db/client.js'

export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  return rows[0] ?? null
}

export async function findUserById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at'
  )
  return rows
}

export async function createUser({ email, name, password_hash, role }) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, is_active, created_at',
    [email, name, password_hash, role]
  )
  return rows[0]
}

export async function updateUser(id, fields) {
  const allowed = ['role', 'is_active', 'name', 'password_hash']
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k))
  if (!updates.length) return null

  const setClauses = updates.map(([k], i) => `${k} = $${i + 2}`).join(', ')
  const values     = [id, ...updates.map(([, v]) => v)]

  const { rows } = await pool.query(
    `UPDATE users SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING id, email, name, role, is_active`,
    values
  )
  return rows[0] ?? null
}

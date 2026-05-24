import pool from '../db/client.js'
import crypto from 'crypto'

export function generateRefreshToken() {
  return crypto.randomBytes(48).toString('hex')
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function saveRefreshToken(userId, token) {
  const hash      = hashToken(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt]
  )
}

export async function findRefreshToken(token) {
  const hash = hashToken(token)
  const { rows } = await pool.query(
    'SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()',
    [hash]
  )
  return rows[0] ?? null
}

export async function revokeRefreshToken(token) {
  const hash = hashToken(token)
  await pool.query('UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1', [hash])
}

export async function revokeAllUserTokens(userId) {
  await pool.query('UPDATE refresh_tokens SET revoked = true WHERE user_id = $1', [userId])
}

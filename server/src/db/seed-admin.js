import 'dotenv/config'
import bcrypt from 'bcrypt'
import pool from './client.js'

const email    = process.env.ADMIN_EMAIL    ?? 'admin@example.com'
const password = process.env.ADMIN_PASSWORD ?? 'changeme123'
const name     = process.env.ADMIN_NAME     ?? 'Admin'

const { rows } = await pool.query('SELECT COUNT(*) FROM users')
if (parseInt(rows[0].count, 10) > 0) {
  console.log('Users table already has entries — skipping seed.')
  await pool.end()
  process.exit(0)
}

const hash = await bcrypt.hash(password, 12)
await pool.query(
  'INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4)',
  [email, name, hash, 'admin']
)

console.log(`Admin created: ${email}`)
await pool.end()

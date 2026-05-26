import pool from '../db/client.js'
import { encrypt, decrypt } from '../utils/crypto.js'

const DEFAULTS = {
  ai_provider: 'claude',
  claude_api_key: null,
  openai_api_key: null,
  claude_model_interface: 'claude-sonnet-4-6',
  claude_model_rules: 'claude-haiku-4-5-20251001',
  openai_model_interface: 'gpt-4o',
  openai_model_rules: 'gpt-4o-mini',
  code_db_read:          "await db.select('{table}', { {key}: {value} })",
  code_db_write:         "await db.insert('{table}', data) / await db.update('{table}', data, { {key} })",
  code_error_convention: "return { error: {code}, field: '{field}' }",
  code_external_call:    "await callProgram('{name}', input)",
  code_language:         'typescript',
  code_source_mode:      'with_source',
}

// Fields that are stored encrypted in the DB (_enc columns)
const ENCRYPTED_FIELDS = ['claude_api_key', 'openai_api_key']

export async function getSettings() {
  // Env vars take precedence over DB values
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')
  const row = rows[0] ?? {}

  const result = { ...DEFAULTS, ...row }

  // DB value takes priority; env var is fallback if DB has nothing
  result.claude_api_key = (row.claude_api_key_enc ? decrypt(row.claude_api_key_enc) : row.claude_api_key ?? null)
    ?? process.env.CLAUDE_API_KEY ?? null
  result.openai_api_key = (row.openai_api_key_enc ? decrypt(row.openai_api_key_enc) : row.openai_api_key ?? null)
    ?? process.env.OPENAI_API_KEY ?? null

  return result
}

export async function upsertSettings(fields) {
  const allowed = Object.keys(DEFAULTS)
  const updates = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k))
  )
  if (Object.keys(updates).length === 0) return false

  // Encrypt sensitive fields before writing
  const dbUpdates = {}
  for (const [k, v] of Object.entries(updates)) {
    if (ENCRYPTED_FIELDS.includes(k)) {
      dbUpdates[`${k}_enc`] = v ? encrypt(v) : null
    } else {
      dbUpdates[k] = v
    }
  }

  const cols = Object.keys(dbUpdates)
  const vals = Object.values(dbUpdates)
  const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')

  await pool.query(
    `INSERT INTO settings (id, ${cols.join(', ')})
     VALUES (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    vals
  )
  return true
}

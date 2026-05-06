import pool from '../db/client.js'

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

export async function getSettings() {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')
  return rows[0] ?? DEFAULTS
}

export async function upsertSettings(fields) {
  const allowed = Object.keys(DEFAULTS)
  const updates = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k))
  )
  if (Object.keys(updates).length === 0) return false

  const cols = Object.keys(updates)
  const vals = Object.values(updates)
  const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')

  await pool.query(
    `INSERT INTO settings (id, ${cols.join(', ')})
     VALUES (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    vals
  )
  return true
}

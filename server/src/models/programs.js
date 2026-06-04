import pool from '../db/client.js'

export async function createProgram({ name, file_path = null, status = 'pending', application_id = null, file_type = 'cobol', companion_content = null }) {
  const { rows } = await pool.query(
    `INSERT INTO programs (name, file_path, status, application_id, file_type, companion_content)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, file_path, status, application_id, file_type, companion_content]
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

export async function updateProgramApplicationId(id, applicationId) {
  await pool.query(
    'UPDATE programs SET application_id = $1, updated_at = NOW() WHERE id = $2',
    [applicationId, id]
  )
}

export async function getProgramsByApplicationId(applicationId) {
  const { rows } = await pool.query(
    'SELECT id, file_path FROM programs WHERE application_id = $1',
    [applicationId]
  )
  return rows
}

export async function deleteProgramsByApplicationId(applicationId) {
  await pool.query('DELETE FROM programs WHERE application_id = $1', [applicationId])
}

const GRAPH_SELECT = `
  SELECT
    p.id, p.name, p.status, p.application_id, p.file_type,
    a.name AS application_name,
    COALESCE(jsonb_array_length(pa.entry_points), 0)::int AS entry_point_count,
    COALESCE(pa.flags, '{}') AS flags,
    (
      SELECT COALESCE(jsonb_agg(t->>'table'), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(pa.db_tables, '[]')) t
      WHERE NOT COALESCE((t->>'ai_hallucinated')::boolean, false)
    ) AS table_names,
    (
      SELECT COALESCE(jsonb_agg(d->>'program'), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(pa.external_dependencies, '[]')) d
    ) AS dependency_names,
    (
      SELECT COALESCE(jsonb_agg(e->>'code'), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(pa.error_catalog, '[]')) e
    ) AS error_codes
  FROM programs p
  LEFT JOIN program_analysis pa ON pa.program_id = p.id
  LEFT JOIN applications a ON a.id = p.application_id
`

export async function getAllPrograms(userId) {
  const { rows } = await pool.query(
    GRAPH_SELECT + `
    WHERE (
      p.application_id IS NULL
      OR a.created_by  IS NULL
      OR a.created_by   = $1
      OR EXISTS (
        SELECT 1 FROM application_members am
        WHERE am.application_id = p.application_id AND am.user_id = $1
      )
    )
    ORDER BY p.created_at ASC`,
    [userId]
  )
  return rows
}

export async function getProgramsByAppForGraph(applicationId) {
  const { rows } = await pool.query(
    GRAPH_SELECT + 'WHERE p.application_id = $1 ORDER BY p.created_at ASC',
    [applicationId]
  )
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

export async function saveStructuralCache(id, cache) {
  await pool.query(
    'UPDATE programs SET structural_cache = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(cache), id]
  )
}

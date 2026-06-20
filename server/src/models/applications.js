import pool from '../db/client.js'

export async function createApplication({ name, created_by = null }) {
  const { rows } = await pool.query(
    `INSERT INTO applications (name, created_by) VALUES ($1, $2) RETURNING *`,
    [name, created_by]
  )
  return rows[0]
}

export async function getAllApplications(userId) {
  const { rows } = await pool.query(`
    SELECT a.id, a.name, a.status, a.created_at, a.updated_at,
           a.created_by,
           (a.created_by = $1)   AS is_owner,
           u.name                AS owner_name,
           COUNT(p.id)           AS program_count
    FROM applications a
    LEFT JOIN programs p ON p.application_id = a.id
    LEFT JOIN users u    ON u.id = a.created_by
    WHERE a.created_by IS NULL
       OR a.created_by = $1
       OR EXISTS (
         SELECT 1 FROM application_members am
         WHERE am.application_id = a.id AND am.user_id = $1
       )
    GROUP BY a.id, u.name
    ORDER BY a.created_at DESC
  `, [userId])
  return rows
}

export async function findApplicationById(id, userId = null) {
  const { rows } = await pool.query(`
    SELECT a.*, (a.created_by = $2) AS is_owner, u.name AS owner_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.id = $1
      AND (
        $2::uuid IS NULL
        OR a.created_by IS NULL
        OR a.created_by = $2
        OR EXISTS (
          SELECT 1 FROM application_members am
          WHERE am.application_id = $1 AND am.user_id = $2
        )
      )
  `, [id, userId])
  return rows[0] || null
}

export async function getApplicationPrograms(applicationId) {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.name, p.status,
      COALESCE(jsonb_array_length(pa.entry_points), 0)::int AS entry_point_count,
      (pa.generated_code IS NOT NULL) AS code_generated,
      (
        SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
        FROM (
          SELECT DISTINCT u.name AS "userName", pf.flag
          FROM program_flags pf
          JOIN users u ON u.id = pf.user_id
          WHERE pf.program_id = p.id
        ) x
      ) AS flags
    FROM programs p
    LEFT JOIN program_analysis pa ON pa.program_id = p.id
    WHERE p.application_id = $1
    ORDER BY p.created_at ASC
  `, [applicationId])
  return rows
}

export async function updateApplicationStatus(id, status) {
  await pool.query(
    'UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  )
}

export async function deleteApplicationById(id) {
  await pool.query('DELETE FROM applications WHERE id = $1', [id])
}

export async function getApplicationMembers(applicationId) {
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, am.created_at AS invited_at
    FROM application_members am
    JOIN users u ON u.id = am.user_id
    WHERE am.application_id = $1
    ORDER BY am.created_at ASC
  `, [applicationId])
  return rows
}

export async function addApplicationMember(applicationId, email, invitedBy) {
  const { rows: userRows } = await pool.query(
    `SELECT id FROM users WHERE email = $1 AND is_active = true`,
    [email]
  )
  if (!userRows[0]) return { error: 'User not found' }
  const userId = userRows[0].id
  try {
    await pool.query(
      `INSERT INTO application_members (application_id, user_id, invited_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [applicationId, userId, invitedBy]
    )
    return { userId }
  } catch (err) {
    return { error: err.message }
  }
}

export async function removeApplicationMember(applicationId, userId) {
  await pool.query(
    `DELETE FROM application_members WHERE application_id = $1 AND user_id = $2`,
    [applicationId, userId]
  )
}

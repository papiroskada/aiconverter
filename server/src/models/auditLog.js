import pool from '../db/client.js'

export async function logAudit(userId, action, resourceType = null, resourceId = null, ip = null) {
  await pool.query(
    'INSERT INTO audit_log (user_id, action, resource_type, resource_id, ip) VALUES ($1, $2, $3, $4, $5)',
    [userId ?? null, action, resourceType, resourceId ?? null, ip]
  ).catch(() => {}) // non-blocking — never fail the request because of audit
}

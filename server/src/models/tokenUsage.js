import pool from '../db/client.js'

export async function recordUsage(userId, programId, action, model, tokensIn, tokensOut) {
  await pool.query(
    `INSERT INTO token_usage (user_id, program_id, action, model, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId || null, programId || null, action, model, tokensIn, tokensOut]
  )
}

export async function getUsageStats() {
  const { rows: users } = await pool.query(`
    SELECT u.id, u.name, u.email,
           COALESCE(SUM(tu.tokens_in), 0)::int  AS tokens_in,
           COALESCE(SUM(tu.tokens_out), 0)::int AS tokens_out,
           COALESCE(SUM(tu.tokens_in + tu.tokens_out), 0)::int AS total
    FROM users u
    LEFT JOIN token_usage tu ON tu.user_id = u.id
    GROUP BY u.id, u.name, u.email
    ORDER BY total DESC
  `)
  const { rows: daily } = await pool.query(`
    SELECT DATE(created_at) AS date,
           user_id,
           SUM(tokens_in)::int  AS tokens_in,
           SUM(tokens_out)::int AS tokens_out
    FROM token_usage
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at), user_id
    ORDER BY date DESC, tokens_in + tokens_out DESC
  `)
  const { rows: totals } = await pool.query(`
    SELECT COALESCE(SUM(tokens_in), 0)::int  AS total_in,
           COALESCE(SUM(tokens_out), 0)::int AS total_out
    FROM token_usage
  `)
  return { users, daily, totalIn: totals[0].total_in, totalOut: totals[0].total_out }
}

import pool from '../db/client.js'

const PRICING = {
  'claude-sonnet-4-6':      { in: 3.00,  out: 15.00 },
  'claude-haiku-4-5-20251001': { in: 1.00,  out: 5.00  },
  'claude-haiku-4-5':       { in: 1.00,  out: 5.00  },
  'gpt-4o':                 { in: 2.50,  out: 10.00 },
}

function calcCost(model, tokensIn, tokensOut) {
  const p = PRICING[model]
  if (!p) return 0
  return (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out
}

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
    ORDER BY date DESC, SUM(tokens_in + tokens_out) DESC
  `)
  const { rows: totals } = await pool.query(`
    SELECT COALESCE(SUM(tokens_in), 0)::int  AS total_in,
           COALESCE(SUM(tokens_out), 0)::int AS total_out
    FROM token_usage
  `)
  const { rows: byModel } = await pool.query(`
    SELECT user_id, model,
           SUM(tokens_in)::int  AS tokens_in,
           SUM(tokens_out)::int AS tokens_out
    FROM token_usage
    GROUP BY user_id, model
  `)
  const costByUser = {}
  let totalCost = 0
  for (const row of byModel) {
    const c = calcCost(row.model, row.tokens_in, row.tokens_out)
    costByUser[row.user_id] = (costByUser[row.user_id] ?? 0) + c
    totalCost += c
  }
  const usersWithCost = users.map(u => ({ ...u, cost: costByUser[u.id] ?? 0 }))
  return { users: usersWithCost, daily, totalIn: totals[0].total_in, totalOut: totals[0].total_out, totalCost }
}

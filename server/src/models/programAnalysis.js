import pool from '../db/client.js'

export async function upsertAnalysis({ program_id, description, call_parameters, external_calls, db_tables }) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis (program_id, description, call_parameters, external_calls, db_tables)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (program_id) DO UPDATE
       SET description = EXCLUDED.description,
           call_parameters = EXCLUDED.call_parameters,
           external_calls = EXCLUDED.external_calls,
           db_tables = EXCLUDED.db_tables,
           updated_at = NOW()
     RETURNING *`,
    [program_id, description, JSON.stringify(call_parameters), JSON.stringify(external_calls), JSON.stringify(db_tables)]
  )
  return rows[0]
}

export async function getAnalysisByProgramId(program_id) {
  const { rows } = await pool.query(
    'SELECT * FROM program_analysis WHERE program_id = $1',
    [program_id]
  )
  return rows[0] || null
}

export async function updateDescription(program_id, description) {
  const { rows } = await pool.query(
    `UPDATE program_analysis SET description = $1, updated_at = NOW()
     WHERE program_id = $2 RETURNING *`,
    [description, program_id]
  )
  return rows[0]
}

export async function updateDiagram(program_id, diagram) {
  await pool.query(
    'UPDATE program_analysis SET diagram = $1, updated_at = NOW() WHERE program_id = $2',
    [diagram, program_id]
  )
}

export async function updateAnalysisFields(program_id, { external_calls, db_tables, file_ops, input_contract, output_contract, flow_narrative }) {
  await pool.query(
    `UPDATE program_analysis
     SET external_calls = $1, db_tables = $2, file_ops = $3,
         input_contract = $4, output_contract = $5, flow_narrative = $6,
         updated_at = NOW()
     WHERE program_id = $7`,
    [
      JSON.stringify(external_calls ?? []),
      JSON.stringify(db_tables ?? []),
      JSON.stringify(file_ops ?? []),
      input_contract ?? null,
      output_contract ?? null,
      flow_narrative ?? null,
      program_id,
    ]
  )
}

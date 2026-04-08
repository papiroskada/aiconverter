import pool from '../db/client.js'

export async function upsertBusinessAnalysis(program_id, {
  business_purpose, input_contract, output_contract,
  entry_points, error_catalog, external_dependencies,
  db_tables, file_ops,
}) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis
       (program_id, business_purpose, input_contract, output_contract,
        entry_points, error_catalog, external_dependencies, db_tables, file_ops)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (program_id) DO UPDATE SET
       business_purpose      = EXCLUDED.business_purpose,
       input_contract        = EXCLUDED.input_contract,
       output_contract       = EXCLUDED.output_contract,
       entry_points          = EXCLUDED.entry_points,
       error_catalog         = EXCLUDED.error_catalog,
       external_dependencies = EXCLUDED.external_dependencies,
       db_tables             = EXCLUDED.db_tables,
       file_ops              = EXCLUDED.file_ops,
       updated_at            = NOW()
     RETURNING *`,
    [
      program_id,
      business_purpose ?? null,
      input_contract ?? null,
      output_contract ?? null,
      JSON.stringify(entry_points ?? []),
      JSON.stringify(error_catalog ?? []),
      JSON.stringify(external_dependencies ?? []),
      JSON.stringify(db_tables ?? []),
      JSON.stringify(file_ops ?? []),
    ]
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

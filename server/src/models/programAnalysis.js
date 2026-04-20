import pool from '../db/client.js'

export async function upsertBusinessAnalysis(program_id, {
  business_purpose, input_contract, output_contract,
  entry_points, error_catalog, external_dependencies,
  db_tables, file_ops,
  pre_dispatch = [], analysis_model = null, analysis_two_step = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis
       (program_id, business_purpose, input_contract, output_contract,
        entry_points, error_catalog, external_dependencies, db_tables, file_ops,
        pre_dispatch, analysis_model, analysis_two_step)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (program_id) DO UPDATE SET
       business_purpose      = EXCLUDED.business_purpose,
       input_contract        = EXCLUDED.input_contract,
       output_contract       = EXCLUDED.output_contract,
       entry_points          = EXCLUDED.entry_points,
       error_catalog         = EXCLUDED.error_catalog,
       external_dependencies = EXCLUDED.external_dependencies,
       db_tables             = EXCLUDED.db_tables,
       file_ops              = EXCLUDED.file_ops,
       pre_dispatch          = EXCLUDED.pre_dispatch,
       analysis_model        = EXCLUDED.analysis_model,
       analysis_two_step     = EXCLUDED.analysis_two_step,
       updated_at            = NOW()
     RETURNING *`,
    [
      program_id,
      business_purpose ?? null,
      input_contract   ?? null,
      output_contract  ?? null,
      JSON.stringify(entry_points          ?? []),
      JSON.stringify(error_catalog         ?? []),
      JSON.stringify(external_dependencies ?? []),
      JSON.stringify(db_tables             ?? []),
      JSON.stringify(file_ops              ?? []),
      JSON.stringify(pre_dispatch          ?? []),
      analysis_model     ?? null,
      analysis_two_step  ?? null,
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

export async function updateFlag(program_id, condition, flag) {
  if (flag === null) {
    const { rows } = await pool.query(
      `UPDATE program_analysis
       SET flags = flags - $2, updated_at = NOW()
       WHERE program_id = $1
       RETURNING flags`,
      [program_id, condition]
    )
    return rows[0]?.flags ?? {}
  }
  const { rows } = await pool.query(
    `UPDATE program_analysis
     SET flags = flags || jsonb_build_object($2::text, $3::text), updated_at = NOW()
     WHERE program_id = $1
     RETURNING flags`,
    [program_id, condition, flag]
  )
  return rows[0]?.flags ?? {}
}

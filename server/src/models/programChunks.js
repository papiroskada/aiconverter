import pool from '../db/client.js'

export async function insertChunks(program_id, chunks) {
  if (chunks.length === 0) return []
  const values = chunks.map((c, i) => {
    const base = i * 8
    return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, $${base+8})`
  }).join(', ')

  const params = chunks.flatMap(c => [
    program_id, c.chunk_type, c.chunk_name, c.start_line, c.end_line,
    c.cobol_text, c.token_estimate, c.order_index
  ])

  const { rows } = await pool.query(
    `INSERT INTO program_chunks
       (program_id, chunk_type, chunk_name, start_line, end_line, cobol_text, token_estimate, order_index)
     VALUES ${values}
     RETURNING *`,
    params
  )
  return rows
}

export async function getChunksByProgramId(program_id) {
  const { rows } = await pool.query(
    'SELECT * FROM program_chunks WHERE program_id = $1 ORDER BY order_index ASC',
    [program_id]
  )
  return rows
}

export async function updateChunkPurpose(id, purpose, rules = []) {
  await pool.query(
    `UPDATE program_chunks SET analysis = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ purpose, rules }), id]
  )
}

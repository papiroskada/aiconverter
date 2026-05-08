function parseJson(val) {
  if (!val) return null
  if (typeof val !== 'string') return val
  try { return JSON.parse(val) } catch { return null }
}

function nfaText(nfa) {
  if (!nfa || nfa === 'n/a') return '—'
  if (typeof nfa === 'string') return nfa
  if (nfa.type === 'error') return `Error ${nfa.code}`
  if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    return `Defaults${fields ? ` (${fields})` : ''}${nfa.logError ? ', log' : ''}`
  }
  if (nfa.type === 'continue') return 'Continue'
  if (nfa.type === 'skip') return 'Skip'
  return '—'
}

function mdTable(headers, rows) {
  if (!rows.length) return '_(none)_'
  const escape = s => String(s ?? '—').replace(/\|/g, '\\|')
  const h = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map(r => `| ${r.map(escape).join(' | ')} |`).join('\n')
  return [h, sep, body].join('\n')
}

export function toMarkdown(program, analysis) {
  const input  = parseJson(analysis.input_contract)  ?? []
  const output = parseJson(analysis.output_contract) ?? []
  const eps    = analysis.entry_points               ?? []
  const errors = analysis.error_catalog              ?? []
  const deps   = analysis.external_dependencies      ?? []
  const tables = analysis.db_tables                  ?? []
  const files  = analysis.file_ops                   ?? []

  const lines = []

  lines.push(`# ${program.name}\n`)
  lines.push(`**Business Purpose:** ${analysis.business_purpose ?? '—'}\n`)

  lines.push(`## Input Contract\n`)
  lines.push(mdTable(
    ['Parameter', 'COBOL Name', 'Type', 'Description'],
    input.map(p => [p.name, p.cobolName, p.type, p.description])
  ))
  lines.push('')

  lines.push(`## Output Contract\n`)
  lines.push(mdTable(
    ['Parameter', 'COBOL Name', 'Type', 'Description'],
    output.map(p => [p.name, p.cobolName, p.type, p.description])
  ))
  lines.push('')

  lines.push(`## Entry Points\n`)
  for (const ep of eps) {
    lines.push(`### \`${ep.condition ?? 'always'}\` — ${ep.businessName ?? ''}\n`)

    if (ep.steps?.length) {
      lines.push('**Steps:**')
      ep.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
      lines.push('')
    }
    if (ep.sideEffects) {
      lines.push(`**Side Effects:** ${ep.sideEffects}\n`)
    }
    if (ep.returns) {
      lines.push(`**Returns:** ${ep.returns}\n`)
    }
    if (ep.errors?.length) {
      lines.push('**Errors:**')
      ep.errors.forEach(e => lines.push(`- ${e}`))
      lines.push('')
    }
    if (ep.dbOperations?.length) {
      lines.push('**DB Operations:**\n')
      lines.push(mdTable(
        ['Table', 'Operation', 'Key Fields', 'Not Found'],
        ep.dbOperations.map(op => [
          op.table,
          op.operation,
          (op.keyFields ?? []).join(', ') || '—',
          nfaText(op.notFoundAction),
        ])
      ))
      lines.push('')
    }
    lines.push('---\n')
  }

  lines.push(`## Error Catalog\n`)
  lines.push(mdTable(
    ['Code', 'Business Meaning', 'System Action'],
    errors.map(e => [e.code, e.businessMeaning, e.systemAction])
  ))
  lines.push('')

  lines.push(`## External Dependencies\n`)
  lines.push(mdTable(
    ['Program', 'Purpose', 'Data In', 'Data Out'],
    deps.map(d => [d.program, d.purpose, d.dataIn, d.dataOut])
  ))
  lines.push('')

  lines.push(`## Database Tables\n`)
  lines.push(mdTable(
    ['Table', 'Operation', 'Key Fields', 'Not Found Action'],
    tables.filter(t => !t.ai_hallucinated).map(t => [
      t.table,
      t.operation,
      (t.keyFields ?? []).join(', ') || '—',
      nfaText(t.notFoundAction),
    ])
  ))
  lines.push('')

  if (files.length) {
    lines.push(`## File I/O\n`)
    lines.push(mdTable(
      ['File', 'Operations'],
      files.map(f => [f.file, (f.operations ?? []).join(', ')])
    ))
    lines.push('')
  }

  return lines.join('\n')
}

export function toOpenApi(program, analysis) {
  const input  = parseJson(analysis.input_contract)  ?? []
  const output = parseJson(analysis.output_contract) ?? []
  const eps    = analysis.entry_points               ?? []

  function contractToSchema(params) {
    if (!params.length) return { type: 'object', properties: {} }
    const properties = {}
    const required = []
    for (const p of params) {
      if (!p.name) continue
      properties[p.name] = { type: p.type === 'number' ? 'integer' : 'string' }
      if (p.description) properties[p.name].description = p.description
      if (p.direction === 'in' || p.direction === 'inout') required.push(p.name)
    }
    const schema = { type: 'object', properties }
    if (required.length) schema.required = required
    return schema
  }

  const paths = {}
  for (const ep of eps) {
    const condition = ep.condition ?? 'default'
    const slug = condition.replace(/[^a-zA-Z0-9]/g, '_')
    paths[`/${program.name}/${slug}`] = {
      post: {
        summary: ep.businessName ?? condition,
        operationId: `${program.name}_${slug}`,
        tags: [program.name],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: contractToSchema(input) } },
        },
        responses: {
          '200': {
            description: ep.returns ?? 'Success',
            content: { 'application/json': { schema: contractToSchema(output) } },
          },
          '422': {
            description: 'Business error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'integer', description: 'Error code' },
                    field: { type: 'string', description: 'Field that caused the error' },
                  },
                },
              },
            },
          },
        },
      },
    }
  }

  return {
    openapi: '3.0.0',
    info: {
      title: program.name,
      description: analysis.business_purpose ?? '',
      version: '1.0.0',
    },
    paths,
  }
}

export function formatParams(contractJson) {
  if (!contractJson) return '  (none)'
  let params
  try { params = JSON.parse(contractJson) } catch { return '  (parse error)' }
  if (!params.length) return '  (none)'
  return params.map(p => `  ${p.name} (${p.type}${p.direction ? `, ${p.direction}` : ''}) — ${p.description || p.cobolName}`).join('\n')
}

export function formatNotFoundAction(nfa) {
  if (!nfa || nfa === 'n/a') return null
  if (typeof nfa === 'string') return nfa
  if (nfa.type === 'error') return `error ${nfa.code}`
  if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    return `set defaults${fields ? ` (${fields})` : ''}${nfa.logError ? ', log error' : ''} and continue`
  }
  if (nfa.type === 'continue') return 'continue (absence acceptable)'
  if (nfa.type === 'skip') return 'skip (conditional)'
  return null
}

export function formatTableSchemas(dbTables, tableSchemas) {
  const usedTables = (dbTables ?? []).filter(t => !t.ai_hallucinated)
  if (!usedTables.length) return '  (none)'

  return usedTables.map(t => {
    const keys = t.keyFields?.length ? `; key: ${t.keyFields.join(', ')}` : ''
    const nfText = formatNotFoundAction(t.notFoundAction)
    const nf = nfText ? `; if not found: ${nfText}` : ''
    const header = `  ${t.table} (${t.operation}${keys}${nf})`

    const fields = tableSchemas[t.table]
    if (!fields?.length) return header

    const keySet = new Set((t.keyFields ?? []).map(k => k.toUpperCase().replace(/_/g, '-')))
    const fieldLines = fields.map(f => {
      const isKey = keySet.has(f.name) ? ' [KEY]' : ''
      const camel = f.name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase())
      return `    ${f.name} → ${camel} (${f.pic}, ${f.type})${isKey}`
    }).join('\n')
    return `${header}\n${fieldLines}`
  }).join('\n\n')
}

export function sourceSection(relevantChunks, settings) {
  if (settings.code_source_mode === 'logic_only') return ''
  const text = relevantChunks.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n') || '(none)'
  return `\nCOBOL SOURCE PARAGRAPHS:\n${text}`
}

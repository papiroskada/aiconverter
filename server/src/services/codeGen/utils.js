import { resolveTransitive } from '../../parser/cobolParser.js'

export function toPascal(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/(^|_)([a-z\d])/g, (_, __, c) => c.toUpperCase())
}

export function assembleCode(result) {
  const { imports = [], sharedTypes, functions = [], dispatcher } = result
  const parts = [
    imports.length ? imports.join('\n') : null,
    sharedTypes?.trim() || null,
    functions.length ? functions.map(f => f.code).join('\n\n') : null,
    dispatcher?.trim() || null,
  ]
  return parts.filter(Boolean).join('\n\n')
}

export function getPatterns(settings) {
  return {
    language:        settings.code_language          ?? 'typescript',
    dbRead:          settings.code_db_read           ?? "const { rows: [{resultVar}] } = await pool.query('SELECT {cols} FROM {table} WHERE {key} = $1', [{value}])  // if (!{resultVar}) { /* not found */ }",
    dbWrite:         settings.code_db_write          ?? "await pool.query('INSERT INTO {table} ({cols}) VALUES ({$params})', [{values}])  // or UPDATE: await pool.query('UPDATE {table} SET {col} = $1 WHERE {key} = $2', [val, key])",
    errorConvention: settings.code_error_convention  ?? "output.{rtnStsField} = {code}; return output",
    externalCall:    settings.code_external_call     ?? "await callProgram('{name}', input)",
  }
}

export function selectRelevantChunks(paragraphChunks, paragraphNames, performGraph, preDispatchNames) {
  const allNames = new Set([...preDispatchNames, ...paragraphNames])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) allNames.add(dep)
  }
  return paragraphChunks.filter(c => allNames.has(c.chunk_name))
}

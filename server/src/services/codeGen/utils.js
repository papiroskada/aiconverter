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

export function mergeTestFiles(files) {
  if (!files.length) return ''
  if (files.length === 1) return files[0]
  const parts = [files[0]]
  for (let i = 1; i < files.length; i++) {
    const match = files[i].match(/^describe\(/m)
    if (match) parts.push(files[i].slice(match.index))
  }
  return parts.join('\n\n')
}

export function getPatterns(settings) {
  return {
    language:        settings.code_language          ?? 'typescript',
    dbRead:          settings.code_db_read           ?? "await db.select('{table}', { {key}: {value} })",
    dbWrite:         settings.code_db_write          ?? "await db.insert('{table}', data) / await db.update('{table}', data, { {key} })",
    errorConvention: settings.code_error_convention  ?? "return { error: {code}, field: '{field}' }",
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

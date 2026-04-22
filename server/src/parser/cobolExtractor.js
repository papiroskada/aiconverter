import { detectFixedFormat, stripSequenceNumber } from './cobolParser.js'

export function extractCalls(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const seen = new Set()
  const calls = []

  for (const line of lines) {
    const parsed = fixedFormat ? stripSequenceNumber(line) : line
    const match = parsed.match(/CALL\s+['"]([^'"]+)['"]\s*(?:USING\s+(\S+?))?(?:\s|,|;|\.|$)/i)
    if (!match) continue
    const program = match[1].toUpperCase()
    if (seen.has(program)) continue
    seen.add(program)
    const raw = match[2] ?? null
    const using = raw ? raw.replace(/[,;.]$/, '') : null
    calls.push({ program, using })
  }
  return calls
}

export function extractExecSql(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const normalised = lines.map(l => fixedFormat ? stripSequenceNumber(l) : l).join('\n')

  const tables = new Map()
  const blockRe = /EXEC\s+SQL([\s\S]*?)END-EXEC/gi
  let m
  while ((m = blockRe.exec(normalised)) !== null) {
    const block = m[1]
    const blockUpper = block.toUpperCase()
    let op = null
    let table = null

    const sel = blockUpper.match(/SELECT[\s\S]*?FROM\s+(\S+)/)
    const ins = blockUpper.match(/INSERT\s+INTO\s+(\S+)/)
    const upd = blockUpper.match(/UPDATE\s+(\S+)/)
    const del = blockUpper.match(/DELETE\s+FROM\s+(\S+)/)

    if (sel)      { op = 'SELECT'; table = sel[1] }
    else if (ins) { op = 'INSERT'; table = ins[1] }
    else if (upd) { op = 'UPDATE'; table = upd[1] }
    else if (del) { op = 'DELETE'; table = del[1] }

    if (!op || !table) continue
    table = table.replace(/[,;()]/g, '')

    // Extract SELECT column list (before INTO or FROM)
    let fields = []
    if (op === 'SELECT') {
      const colMatch = blockUpper.match(/SELECT\s+([\s\S]*?)(?:\s+INTO\b|\s+FROM\b)/)
      if (colMatch) {
        const colText = colMatch[1].trim()
        if (colText !== '*' && colText !== '1') {
          fields = colText.split(',').map(f => f.trim()).filter(Boolean)
        }
      }
    }

    // Extract keyFields from WHERE clause
    const keyFields = []
    const whereMatch = blockUpper.match(/\bWHERE\b([\s\S]*)$/)
    if (whereMatch) {
      const whereClause = whereMatch[1]
      const condRe = /\b([A-Z][A-Z0-9-]+)\s*=\s*[:?]/g
      let wm
      while ((wm = condRe.exec(whereClause)) !== null) {
        keyFields.push(wm[1])
      }
    }

    if (!tables.has(table)) tables.set(table, { table, ops: new Set(), fields: [], keyFields: [] })
    const entry = tables.get(table)
    entry.ops.add(op)
    if (fields.length && !entry.fields.length) entry.fields = fields
    for (const kf of keyFields) {
      if (!entry.keyFields.includes(kf)) entry.keyFields.push(kf)
    }
  }

  return [...tables.values()].map(e => ({
    table: e.table,
    operation: [...e.ops].join('/'),
    fields: e.fields,
    keyFields: e.keyFields,
  }))
}

export function extractErrorEntries(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const normalised = lines.map(l => fixedFormat ? stripSequenceNumber(l) : l)

  const seqRe  = /MOVE\s+(\d{4,5})\s+TO\s+\S*SEQ[-_]NO/i
  const dataRe = /MOVE\s+"([^"]+)"\s+TO\s+\S*DATA[-_]EL/i

  const entries = []
  const seen = new Set()

  for (let i = 0; i < normalised.length; i++) {
    const seqMatch = normalised[i].match(seqRe)
    if (!seqMatch) continue
    const seqNo = parseInt(seqMatch[1], 10)
    if (seen.has(seqNo)) continue
    seen.add(seqNo)

    let dataElement = null
    const distances = [0, 1, -1, 2, -2, 3, -3]
    for (const d of distances) {
      const j = i + d
      if (j < 0 || j >= normalised.length) continue
      const elMatch = normalised[j].match(dataRe)
      if (elMatch) { dataElement = elMatch[1]; break }
    }

    entries.push({ seqNo, dataElement })
  }

  return entries.sort((a, b) => a.seqNo - b.seqNo)
}

export function extractErrorSeqNos(cobolText) {
  return extractErrorEntries(cobolText).map(e => e.seqNo)
}

const KNOWN_CONSTRUCTS = [
  'PERFORM', 'COMPUTE', 'IF', 'GO TO', 'MOVE', 'EVALUATE', 'ALTER',
  'STOP RUN', 'CALL', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE',
  'READ', 'WRITE', 'OPEN', 'CLOSE', 'ACCEPT', 'DISPLAY', 'REWRITE',
  'DELETE', 'START',
]

export function extractConstructs(cobolText) {
  const upper = cobolText.toUpperCase()
  return KNOWN_CONSTRUCTS.filter(c => {
    const escaped = c.replace(/\s+/g, '\\s+')
    return new RegExp(`(?<![A-Z0-9-])${escaped}(?![A-Z0-9-])`).test(upper)
  })
}

const OP_ORDER = ['READ', 'INSERT', 'UPDATE', 'DELETE', 'WRITE']

const TUX_OP_MAP = {
  RD: 'READ', CTN: 'READ', NXT: 'READ', FWD: 'READ', SRT: 'READ',
  INS: 'INSERT',
  UPD: 'UPDATE',
  DEL: 'DELETE',
  WRT: 'WRITE', LCK: 'WRITE',
}

export function extractTuxTables(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const normalised = lines.map(l => fixedFormat ? stripSequenceNumber(l) : l).join('\n')

  // Build prefix → tableName map from TABNAM declarations
  const prefixMap = new Map()
  const tabnamRe = /(\w+)-TABNAM\b[^\n]*?"([a-zA-Z][a-zA-Z0-9]{0,7})"/gi
  let m
  while ((m = tabnamRe.exec(normalised)) !== null) {
    prefixMap.set(m[1].toUpperCase(), m[2].toLowerCase())
  }

  const tabnamSplitRe = /(\w+)-TABNAM\b[^\n]*\n[^\n]*?"([a-zA-Z][a-zA-Z0-9]{0,7})"/gi
  while ((m = tabnamSplitRe.exec(normalised)) !== null) {
    const prefix = m[1].toUpperCase()
    if (!prefixMap.has(prefix)) prefixMap.set(prefix, m[2].toLowerCase())
  }

  if (prefixMap.size === 0) return []

  const tables = new Map()

  // Strategy 1: MOVE "OP" TO prefix-FUNC (keep as fallback for programs that have it)
  const moveRe = /MOVE\s+"(RD|INS|UPD|DEL|CTN|NXT|FWD|SRT|WRT|LCK)"\s+TO\s+(\w+)-FUNC/gi
  while ((m = moveRe.exec(normalised)) !== null) {
    const opCode = m[1].toUpperCase()
    const prefix = m[2].toUpperCase()
    const tableName = prefixMap.get(prefix)
    if (!tableName) continue
    const op = TUX_OP_MAP[opCode]
    if (!tables.has(tableName)) tables.set(tableName, { ops: new Set(), keyFields: new Set() })
    tables.get(tableName).ops.add(op)
  }

  // Strategy 2: paragraph naming convention — {VERB}-{PREFIX}[-extra-tokens]
  const normLines = normalised.split('\n')
  const paraRe = /^\s*([A-Z][A-Z0-9-]+)\./i

  const paraToTable = new Map()
  for (const line of normLines) {
    const pm = line.match(paraRe)
    if (!pm) continue
    const paraName = pm[1].toUpperCase()
    const parts = paraName.split('-')

    for (let i = parts.length - 1; i >= 1; i--) {
      const candidatePrefix = parts[i]
      if (!prefixMap.has(candidatePrefix)) continue
      const verbPart = parts.slice(0, i).join('-')
      const op = paraVerbToOp(verbPart)
      if (op) {
        paraToTable.set(paraName, { tableName: prefixMap.get(candidatePrefix), prefix: candidatePrefix, op })
      }
      break
    }
  }

  // Register operations from all named paragraphs directly
  for (const [, { tableName, op }] of paraToTable) {
    if (!tables.has(tableName)) tables.set(tableName, { ops: new Set(), keyFields: new Set() })
    tables.get(tableName).ops.add(op)
  }

  // Scan PERFORM call sites to collect key fields
  const INFRA_SUFFIXES = new Set(['FUNC', 'TABNAM', 'CURSOR', 'KEYNUM', 'LOCK', 'STATUS', 'DATA'])
  const performRe = /\bPERFORM\s+([A-Z][A-Z0-9-]+)/i

  for (let i = 0; i < normLines.length; i++) {
    const perfMatch = normLines[i].match(performRe)
    if (!perfMatch) continue
    const paraName = perfMatch[1].toUpperCase()
    const entry = paraToTable.get(paraName)
    if (!entry) continue

    const { tableName, prefix } = entry
    if (!tables.has(tableName)) tables.set(tableName, { ops: new Set(), keyFields: new Set() })

    const moveToRe = new RegExp(`\\bMOVE\\s+\\S+\\s+TO\\s+(${prefix}-[A-Z0-9-]+)`, 'i')
    for (let j = Math.max(0, i - 15); j < i; j++) {
      const mv = normLines[j].match(moveToRe)
      if (!mv) continue
      const fieldName = mv[1].toUpperCase()
      const lastToken = fieldName.split('-').pop()
      if (!INFRA_SUFFIXES.has(lastToken)) {
        tables.get(tableName).keyFields.add(fieldName.replace(/-/g, '_').toLowerCase())
      }
    }
  }

  return [...tables.entries()].map(([table, entry]) => ({
    table,
    operation: OP_ORDER.filter(o => entry.ops.has(o)).join('/'),
    keyFields: [...entry.keyFields],
  }))
}

function paraVerbToOp(verbPart) {
  const firstToken = verbPart.split('-')[0]
  return {
    READ: 'READ', VLD: 'READ', VALIDATE: 'READ', GET: 'READ',
    START: 'READ', FETCH: 'READ', FIND: 'READ',
    INS: 'INSERT', INSERT: 'INSERT', ADD: 'INSERT',
    UPD: 'UPDATE', UPDATE: 'UPDATE', MOD: 'UPDATE', MODIFY: 'UPDATE',
    DEL: 'DELETE', DELETE: 'DELETE', RMV: 'DELETE', REMOVE: 'DELETE',
  }[firstToken]
}

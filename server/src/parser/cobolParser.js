const CHUNK_MAX_LINES = 300
const CHUNK_OVERLAP = 20

const DIVISION_RE = /^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i
const DATA_SECTION_RE = /^\s*(WORKING-STORAGE|FILE|LINKAGE)\s+SECTION/i
const PROCEDURE_PARA_RE = /^([A-Z][A-Z0-9-]+)\./i

function tokenEstimate(text) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function splitIntoWindows(lines, startLine, baseName, chunkType) {
  const chunks = []
  let windowStart = 0
  let windowIndex = 1

  while (windowStart < lines.length) {
    const windowEnd = Math.min(windowStart + CHUNK_MAX_LINES, lines.length)
    const sliceLines = lines.slice(windowStart, windowEnd)
    const text = sliceLines.join('\n')
    const name = windowIndex === 1 ? baseName : `${baseName} [${windowIndex}]`

    chunks.push({
      chunk_type: chunkType,
      chunk_name: name,
      start_line: startLine + windowStart + 1,
      end_line: startLine + windowEnd,
      cobol_text: text,
      token_estimate: tokenEstimate(text),
      status: 'pending',
    })

    if (windowEnd >= lines.length) break
    windowStart = windowEnd - CHUNK_OVERLAP
    windowIndex++
  }
  return chunks
}

/**
 * Detect if the file uses COBOL fixed-format with sequence numbers in cols 1-6.
 * Returns true if the first non-blank, non-comment line has a numeric prefix of 6 chars.
 */
function detectFixedFormat(lines) {
  for (const line of lines) {
    if (line.trim().length === 0) continue
    if (line.length > 6 && (line[6] === '*' || line[6] === '/')) continue
    const prefix = line.substring(0, 6)
    if (/^\s*\d+\s*$/.test(prefix)) return true
    break
  }
  return false
}

/**
 * Strip the 6-character sequence number prefix used in fixed-format COBOL,
 * returning the content starting at column 7 (index 6).
 */
function stripSequenceNumber(line) {
  return line.length > 6 ? line.substring(6) : ''
}

/**
 * Clean COBOL source before sending to AI:
 *   - strip 6-char sequence numbers (cols 1-6)
 *   - remove comment / debug lines (col 7 = '*', '/', 'D')
 *   - strip identification area (cols 73+) and trailing whitespace
 *   - collapse consecutive blank lines
 */
export function preprocessCobol(text) {
  const lines = text.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const processed = []

  for (const line of lines) {
    if (fixedFormat) {
      const indicator = line.length > 6 ? line[6] : ' '
      if (indicator === '*' || indicator === '/' || indicator === 'D' || indicator === 'd') continue
      // strip sequence (cols 0-5) and identification area (cols 72+)
      processed.push(line.substring(6, 72).trimEnd())
    } else {
      processed.push(line.trimEnd())
    }
  }

  // collapse consecutive blank lines
  const out = []
  let prevBlank = false
  for (const line of processed) {
    const blank = line.trim() === ''
    if (blank && prevBlank) continue
    out.push(line)
    prevBlank = blank
  }
  // trim leading/trailing blank lines
  while (out.length && out[0].trim() === '') out.shift()
  while (out.length && out[out.length - 1].trim() === '') out.pop()

  return out.join('\n')
}

export function parseCobol(cobolText) {
  const lines = cobolText.split('\n')
  const rawChunks = []

  const fixedFormat = detectFixedFormat(lines)

  // parseLine returns the matchable content of a line (sequence-stripped if needed)
  function parseLine(line) {
    return fixedFormat ? stripSequenceNumber(line) : line
  }

  let inData = false
  let inProcedure = false
  let currentSection = null
  let currentSectionStart = -1
  let currentPara = null
  let currentParaStart = -1

  function flushSection(endIdx) {
    if (!currentSection || currentSectionStart === -1) return
    const sectionLines = lines.slice(currentSectionStart, endIdx)
    const windows = splitIntoWindows(sectionLines, currentSectionStart, currentSection, 'data_summary')
    rawChunks.push(...windows)
    currentSection = null
    currentSectionStart = -1
  }

  function flushPara(endIdx) {
    if (!currentPara || currentParaStart === -1) return
    const paraLines = lines.slice(currentParaStart, endIdx)
    if (paraLines.length <= CHUNK_MAX_LINES) {
      const text = paraLines.join('\n')
      rawChunks.push({
        chunk_type: 'paragraph',
        chunk_name: currentPara,
        start_line: currentParaStart + 1,
        end_line: endIdx,
        cobol_text: text,
        token_estimate: tokenEstimate(text),
        status: 'pending',
      })
    } else {
      const windows = splitIntoWindows(paraLines, currentParaStart, currentPara, 'sub_paragraph')
      rawChunks.push(...windows)
    }
    currentPara = null
    currentParaStart = -1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const parsed = parseLine(line)

    if (DIVISION_RE.test(parsed)) {
      flushSection(i)
      flushPara(i)
      inData = /DATA\s+DIVISION/i.test(parsed)
      inProcedure = /PROCEDURE\s+DIVISION/i.test(parsed)
      continue
    }

    if (inData && DATA_SECTION_RE.test(parsed)) {
      flushSection(i)
      const match = parsed.match(DATA_SECTION_RE)
      currentSection = match[1].toUpperCase()
      currentSectionStart = i
      continue
    }

    if (inProcedure) {
      const trimmed = parsed.trimStart()
      const match = trimmed.match(PROCEDURE_PARA_RE)
      if (match && !/^(END-PERFORM|END-IF|END-READ|END-WRITE|END-EVALUATE|END-SEARCH|END-STRING|END-UNSTRING|END-CALL|END-COMPUTE|END-ADD|END-SUBTRACT|END-MULTIPLY|END-DIVIDE|EXIT|GOBACK|STOP)/.test(trimmed)) {
        flushPara(i)
        currentPara = match[1].toUpperCase()
        currentParaStart = i
      }
    }
  }

  flushSection(lines.length)
  flushPara(lines.length)

  return rawChunks.map((chunk, i) => ({ ...chunk, order_index: i }))
}

export function extractLinkage(cobolText) {
  const upper = cobolText.toUpperCase()
  const start = upper.indexOf('LINKAGE SECTION')
  if (start === -1) return ''
  const stopPatterns = ['PROCEDURE DIVISION', 'FILE SECTION', 'WORKING-STORAGE SECTION', 'SCREEN SECTION']
  let stop = upper.length
  for (const p of stopPatterns) {
    const idx = upper.indexOf(p, start + 15)
    if (idx !== -1 && idx < stop) stop = idx
  }
  return cobolText.slice(start, stop).trim()
}

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
    const block = m[1].toUpperCase()
    let op = null
    let table = null

    const sel = block.match(/SELECT[\s\S]*?FROM\s+(\S+)/)
    const ins = block.match(/INSERT\s+INTO\s+(\S+)/)
    const upd = block.match(/UPDATE\s+(\S+)/)
    const del = block.match(/DELETE\s+FROM\s+(\S+)/)

    if (sel)      { op = 'SELECT'; table = sel[1] }
    else if (ins) { op = 'INSERT'; table = ins[1] }
    else if (upd) { op = 'UPDATE'; table = upd[1] }
    else if (del) { op = 'DELETE'; table = del[1] }

    if (op && table) {
      table = table.replace(/[,;()]/g, '')
      if (!tables.has(table)) tables.set(table, { table, ops: new Set() })
      tables.get(table).ops.add(op)
    }
  }

  return [...tables.values()].map(e => ({
    table: e.table,
    operation: [...e.ops].join('/'),
    fields: [],
  }))
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
  const tabnamRe = /(\w+)-TABNAM\b[^\n]*?"([a-z][a-z0-9]{0,7})"/g
  let m
  while ((m = tabnamRe.exec(normalised)) !== null) {
    prefixMap.set(m[1].toUpperCase(), m[2])
  }

  // Also handle TABNAM declaration that spans onto the next line
  const tabnamSplitRe = /(\w+)-TABNAM\b[^\n]*\n[^\n]*?"([a-z][a-z0-9]{0,7})"/g
  while ((m = tabnamSplitRe.exec(normalised)) !== null) {
    const prefix = m[1].toUpperCase()
    if (!prefixMap.has(prefix)) prefixMap.set(prefix, m[2])
  }

  if (prefixMap.size === 0) return []

  // Find all MOVE "OP" TO prefix-FUNC assignments
  const tables = new Map()
  const moveRe = /MOVE\s+"(RD|INS|UPD|DEL|CTN|NXT|FWD|SRT|WRT|LCK)"\s+TO\s+(\w+)-FUNC/gi
  while ((m = moveRe.exec(normalised)) !== null) {
    const opCode = m[1].toUpperCase()
    const prefix = m[2].toUpperCase()
    const tableName = prefixMap.get(prefix)
    if (!tableName) continue
    const op = TUX_OP_MAP[opCode]
    if (!tables.has(tableName)) tables.set(tableName, new Set())
    tables.get(tableName).add(op)
  }

  return [...tables.entries()].map(([table, ops]) => ({
    table,
    operation: OP_ORDER.filter(o => ops.has(o)).join('/'),
  }))
}

export function extractErrorSeqNos(cobolText) {
  const seqRe = /MOVE\s+(\d{4,5})\s+TO\s+\S*SEQ[-_]NO/gi
  const seen = new Set()
  let m
  while ((m = seqRe.exec(cobolText)) !== null) {
    seen.add(parseInt(m[1], 10))
  }
  return [...seen].sort((a, b) => a - b)
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

export function extractWorkingStorage(cobolText) {
  try {
    const lines = cobolText.split('\n')
    const fixedFormat = detectFixedFormat(lines)
    const stopPatterns = ['PROCEDURE DIVISION', 'FILE SECTION', 'LINKAGE SECTION', 'SCREEN SECTION']

    let inWS = false
    const result = []
    let currentVar = null

    for (const line of lines) {
      const parsed = fixedFormat ? stripSequenceNumber(line) : line
      const upper = parsed.toUpperCase()

      if (!inWS) {
        if (upper.includes('WORKING-STORAGE SECTION')) inWS = true
        continue
      }

      if (stopPatterns.some(p => upper.includes(p))) break

      // 88-level condition
      const cond88 = parsed.match(/^\s*88\s+([A-Z0-9-]+)\s+VALUES?\s+(.+?)\.?\s*$/i)
      if (cond88 && currentVar) {
        currentVar.conditions.push({
          name: cond88[1].toUpperCase(),
          value: cond88[2].trim().replace(/\.$/, ''),
        })
        continue
      }

      // Variable definition (any level except 88)
      const varMatch = parsed.match(/^\s*(\d{1,2})\s+([A-Z0-9-]+)(?:\s+PIC\s+(\S+?)\.?)?/i)
      if (varMatch && parseInt(varMatch[1], 10) !== 88) {
        currentVar = {
          level: varMatch[1].padStart(2, '0'),
          name: varMatch[2].toUpperCase(),
          pic: varMatch[3] ? varMatch[3].replace(/\.$/, '') : null,
          conditions: [],
        }
        result.push(currentVar)
      }
    }

    return result
  } catch {
    return []
  }
}

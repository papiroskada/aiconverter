# COBOL Extractor Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `cobolParser.js`, fix `extractTuxTables` for COMMON-FUNC programs, add key field extraction to both TUX and EXEC SQL extractors, surface key fields in AI context, and add a prompt guardrail against invented table names.

**Architecture:** Create `server/src/parser/cobolExtractor.js` holding all data-extraction functions (moved from `cobolParser.js`). The extractor imports two internal utilities from `cobolParser.js`. New paragraph-naming strategy in `extractTuxTables` scans paragraph headings for `{VERB}-{PREFIX}` patterns as a fallback-free primary detector; key fields are gathered by scanning MOVE statements before each PERFORM call site.

**Tech Stack:** Node.js ES modules, Vitest, existing cobolParser helper utilities (`detectFixedFormat`, `stripSequenceNumber`).

---

## File Map

| File | Change |
|---|---|
| `server/src/parser/cobolParser.js` | Remove 6 extractor exports; export `detectFixedFormat` + `stripSequenceNumber` |
| `server/src/parser/cobolExtractor.js` | New — all extractor functions with TUX + EXEC SQL improvements |
| `server/src/ai/orchestrator.js` | Import from both parser files; update `buildStructural` to show key fields |
| `server/src/ai/prompts.js` | Add table-name guardrail to both COBOL prompts |
| `server/tests/parser/cobolExtractor.test.js` | New — extractor tests (moved + new) |
| `server/tests/parser/cobolParser.test.js` | Remove extractor tests; update import list |

---

### Task 1: File split — create cobolExtractor.js and migrate tests

**Files:**
- Create: `server/src/parser/cobolExtractor.js`
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/src/ai/orchestrator.js`
- Create: `server/tests/parser/cobolExtractor.test.js`
- Modify: `server/tests/parser/cobolParser.test.js`

- [ ] **Step 1: Export the two shared utilities from cobolParser.js**

In `server/src/parser/cobolParser.js`, add `export` keyword to `detectFixedFormat` and `stripSequenceNumber` (they are currently internal). Change:

```js
function detectFixedFormat(lines) {
```
to:
```js
export function detectFixedFormat(lines) {
```

And:
```js
function stripSequenceNumber(line) {
```
to:
```js
export function stripSequenceNumber(line) {
```

- [ ] **Step 2: Create cobolExtractor.js with the moved functions**

Create `server/src/parser/cobolExtractor.js`:

```js
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

  // Strategy 1 (fallback): MOVE "OP" TO prefix-FUNC
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

  return [...tables.entries()].map(([table, entry]) => ({
    table,
    operation: OP_ORDER.filter(o => entry.ops.has(o)).join('/'),
    keyFields: [...entry.keyFields],
  }))
}
```

- [ ] **Step 3: Remove the moved functions from cobolParser.js**

In `server/src/parser/cobolParser.js`, delete:
- The private `TUX_OP_MAP` and `OP_ORDER` constants (lines ~262-270)
- The `export function extractCalls` block
- The `export function extractExecSql` block
- The `export function extractErrorEntries` block
- The `export function extractErrorSeqNos` block
- The `const KNOWN_CONSTRUCTS` array
- The `export function extractConstructs` block
- The `export function extractTuxTables` block

The file should retain: `preprocessCobol`, `parseCobol`, `extractLinkageVars`, `extractWorkingStorage`, `extractEvaluateDispatch`, `extractPerformGraph`, `resolveTransitive`, and the now-exported `detectFixedFormat`, `stripSequenceNumber`, plus private helpers `tokenEstimate`, `splitIntoWindows`, `DIVISION_RE`, `DATA_SECTION_RE`, `PROCEDURE_PARA_RE`, `inferDirection`, `extractSectionVars`.

- [ ] **Step 4: Update the orchestrator.js import**

In `server/src/ai/orchestrator.js`, change line 2 from:

```js
import { extractLinkageVars, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorEntries, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../parser/cobolParser.js'
```

to:

```js
import { extractLinkageVars, extractWorkingStorage, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../parser/cobolParser.js'
import { extractCalls, extractExecSql, extractConstructs, extractTuxTables, extractErrorEntries } from '../parser/cobolExtractor.js'
```

- [ ] **Step 5: Create cobolExtractor.test.js with the moved tests**

Create `server/tests/parser/cobolExtractor.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { extractCalls, extractExecSql, extractConstructs, extractTuxTables, extractErrorEntries, extractErrorSeqNos } from '../../src/parser/cobolExtractor.js'

describe('extractCalls', () => {
  it('returns empty array for no CALL statements', () => {
    expect(extractCalls('MOVE X TO Y.')).toEqual([])
  })

  it('extracts CALL with single quotes', () => {
    const cobol = "  CALL 'ARCUSACS' USING WS-AREA."
    const result = extractCalls(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].program).toBe('ARCUSACS')
    expect(result[0].using).toBe('WS-AREA')
  })

  it('extracts CALL with double quotes', () => {
    const cobol = '  CALL "PROGRAM1".'
    const result = extractCalls(cobol)
    expect(result[0].program).toBe('PROGRAM1')
    expect(result[0].using).toBeNull()
  })

  it('deduplicates repeated CALLs to same program', () => {
    const cobol = "  CALL 'PROG' USING A.\n  CALL 'PROG' USING B."
    expect(extractCalls(cobol)).toHaveLength(1)
  })
})

describe('extractExecSql', () => {
  it('returns empty array when no EXEC SQL blocks', () => {
    expect(extractExecSql('MOVE X TO Y.')).toEqual([])
  })

  it('extracts SELECT operation and table', () => {
    const cobol = `
      EXEC SQL
        SELECT EUR-ENBL-FLG
        INTO :EUR-ENBL-FLG
        FROM EXREUR
        WHERE EUR-EXEC-LGN-ID = :EUR-EXEC-LGN-ID
      END-EXEC
    `
    const result = extractExecSql(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('EXREUR')
    expect(result[0].operation).toBe('SELECT')
  })

  it('extracts INSERT operation', () => {
    const cobol = `
      EXEC SQL
        INSERT INTO EXRLOG (COL1) VALUES (:VAL1)
      END-EXEC
    `
    const result = extractExecSql(cobol)
    expect(result[0].operation).toBe('INSERT')
    expect(result[0].table).toBe('EXRLOG')
  })
})

describe('extractConstructs', () => {
  it('returns empty array for empty text', () => {
    expect(extractConstructs('')).toEqual([])
  })

  it('detects PERFORM and IF', () => {
    const result = extractConstructs('PERFORM SOMETHING.\nIF X > 0 MOVE Y TO Z.')
    expect(result).toContain('PERFORM')
    expect(result).toContain('IF')
  })
})

describe('extractTuxTables', () => {
  it('returns empty array when no TUX tables', () => {
    expect(extractTuxTables('PROCEDURE DIVISION.\n  MOVE 1 TO X.')).toEqual([])
  })

  it('extracts table with single operation (MOVE-FUNC strategy)', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      10  EXREUR-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('exreur')
    expect(result[0].operation).toBe('READ')
  })

  it('merges multiple operations on same table', () => {
    const cobol = `
      10  EXTCNS-TABNAM  PIC X(6)  VALUE "extcns".
      10  EXTCNS-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXTCNS-FUNC.
      MOVE "DEL" TO EXTCNS-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0].operation).toBe('READ/DELETE')
  })

  it('maps CTN/NXT/FWD to READ', () => {
    const cobol = `
      10  EXRPDA-TABNAM  PIC X(6)  VALUE "exrpda".
      10  EXRPDA-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "CTN" TO EXRPDA-FUNC.
      MOVE "NXT" TO EXRPDA-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0].operation).toBe('READ')
  })

  it('handles multiple tables', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      10  EXREUR-FUNC    PIC X(3)  VALUE "OPN".
      10  EXRSEI-TABNAM  PIC X(6)  VALUE "exrsei".
      10  EXRSEI-FUNC    PIC X(3)  VALUE "OPN".
      MOVE "RD"  TO EXREUR-FUNC.
      MOVE "RD"  TO EXRSEI-FUNC.
      MOVE "INS" TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result).toHaveLength(2)
    const eur = result.find(t => t.table === 'exreur')
    expect(eur.operation).toBe('READ/INSERT')
  })

  it('includes empty keyFields array on every result entry', () => {
    const cobol = `
      10  EXREUR-TABNAM  PIC X(6)  VALUE "exreur".
      MOVE "RD"  TO EXREUR-FUNC.
    `
    const result = extractTuxTables(cobol)
    expect(result[0]).toHaveProperty('keyFields')
    expect(Array.isArray(result[0].keyFields)).toBe(true)
  })
})

describe('extractErrorEntries', () => {
  it('returns empty for no error entries', () => {
    expect(extractErrorEntries('MOVE X TO Y.')).toEqual([])
  })

  it('extracts seq number and data element', () => {
    const cobol = `
      MOVE 1500 TO WS-SEQ-NO.
      MOVE "EUR-EXEC-LGN-ID" TO WS-DATA-EL.
    `
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].seqNo).toBe(1500)
    expect(result[0].dataElement).toBe('EUR-EXEC-LGN-ID')
  })
})

describe('extractErrorSeqNos', () => {
  it('returns only seq numbers', () => {
    const cobol = `
      MOVE 1500 TO WS-SEQ-NO.
      MOVE 1600 TO WS-SEQ-NO.
    `
    expect(extractErrorSeqNos(cobol)).toEqual([1500, 1600])
  })
})
```

- [ ] **Step 6: Update cobolParser.test.js — remove moved tests and update import**

In `server/tests/parser/cobolParser.test.js`, replace the import line:

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorSeqNos, extractLinkageVars, extractErrorEntries, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../../src/parser/cobolParser.js'
```

with:

```js
import { parseCobol, extractWorkingStorage, extractLinkageVars, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../../src/parser/cobolParser.js'
```

Then delete the `describe('extractTuxTables', ...)` block (lines ~319-373) and the `describe('extractErrorSeqNos', ...)` block and any other `describe` blocks for functions that moved. Also delete `describe('extractCalls', ...)`, `describe('extractExecSql', ...)`, `describe('extractConstructs', ...)`, `describe('extractErrorEntries', ...)` if they exist in this file.

- [ ] **Step 7: Run all tests to confirm nothing is broken**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: all tests pass. The total count may drop in cobolParser.test.js and increase in cobolExtractor.test.js, but the total should be the same or higher.

- [ ] **Step 8: Commit**

```bash
git add server/src/parser/cobolExtractor.js server/src/parser/cobolParser.js server/src/ai/orchestrator.js server/tests/parser/cobolExtractor.test.js server/tests/parser/cobolParser.test.js
git commit -m "refactor(parser): split cobolParser.js — move extractor functions to cobolExtractor.js"
```

---

### Task 2: Fix extractTuxTables — paragraph-naming operation detection + key field extraction

**Files:**
- Modify: `server/src/parser/cobolExtractor.js`
- Modify: `server/tests/parser/cobolExtractor.test.js`

- [ ] **Step 1: Write failing tests for the COMMON-FUNC paragraph-naming pattern**

In `server/tests/parser/cobolExtractor.test.js`, add these tests inside the `describe('extractTuxTables', ...)` block:

```js
it('detects READ from VLD-EUR paragraph name (COMMON-FUNC pattern)', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
      10  EUR-FUNC    PIC X(3) VALUE "OPN".
    PROCEDURE DIVISION.
    BUSINESS-LOGIC.
      PERFORM VLD-EUR THRU VLD-EUR-EXIT.
    VLD-EUR.
      MOVE "RD" TO COMMON-FUNC.
      PERFORM COMMON-REC.
    VLD-EUR-EXIT. EXIT.
  `
  const result = extractTuxTables(cobol)
  expect(result).toHaveLength(1)
  expect(result[0].table).toBe('exreur')
  expect(result[0].operation).toBe('READ')
})

it('detects INSERT from INS-EUR paragraph name', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    INS-EUR.
      MOVE "INS" TO COMMON-FUNC.
  `
  const result = extractTuxTables(cobol)
  expect(result).toHaveLength(1)
  expect(result[0].operation).toBe('INSERT')
})

it('merges operations detected by both strategies on same table', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
      10  EUR-FUNC  PIC X(3) VALUE "OPN".
    PROCEDURE DIVISION.
    MAIN.
      MOVE "RD" TO EUR-FUNC.
      PERFORM UPD-EUR.
    UPD-EUR.
      MOVE "UPD" TO COMMON-FUNC.
  `
  const result = extractTuxTables(cobol)
  expect(result).toHaveLength(1)
  expect(result[0].operation).toBe('READ/UPDATE')
})

it('skips OPEN-EUR and CLOSE-EUR paragraphs', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    OPEN-EUR.
      PERFORM COMMON-OPEN.
    CLOSE-EUR.
      PERFORM COMMON-CLOSE.
  `
  const result = extractTuxTables(cobol)
  expect(result).toHaveLength(0)
})

it('handles READ-EUR-REC suffix (paragraph name with extra tokens after prefix)', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    READ-EUR-REC.
      MOVE "RD" TO COMMON-FUNC.
  `
  const result = extractTuxTables(cobol)
  expect(result).toHaveLength(1)
  expect(result[0].operation).toBe('READ')
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test -- --reporter=verbose tests/parser/cobolExtractor.test.js
```

Expected: the 5 new tests fail with `expect(received).toHaveLength(1)` or `toHaveLength(0)` errors (current extractTuxTables doesn't detect these cases).

- [ ] **Step 3: Implement paragraph-naming operation detection in extractTuxTables**

In `server/src/parser/cobolExtractor.js`, inside `extractTuxTables`, replace the current return statement with the full implementation:

```js
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
  const paraRe = /^([A-Z][A-Z0-9-]+)\./i

  // Build mapping: paragraph name → { tableName, prefix, op }
  const paraToTable = new Map()
  for (const line of normLines) {
    const pm = line.match(paraRe)
    if (!pm) continue
    const paraName = pm[1].toUpperCase()
    const parts = paraName.split('-')

    // Try each token from the end backwards as a candidate prefix
    for (let i = parts.length - 1; i >= 1; i--) {
      const candidatePrefix = parts[i]
      if (!prefixMap.has(candidatePrefix)) continue
      const verbPart = parts.slice(0, i).join('-')
      const op = paraVerbToOp(verbPart)
      if (op) {
        paraToTable.set(paraName, { tableName: prefixMap.get(candidatePrefix), prefix: candidatePrefix, op })
      }
      break // stop at first prefix match from the end
    }
  }

  // Scan PERFORM call sites to record operations and collect key fields
  const INFRA_SUFFIXES = new Set(['FUNC', 'TABNAM', 'CURSOR', 'KEYNUM', 'LOCK', 'STATUS', 'DATA'])
  const performRe = /\bPERFORM\s+([A-Z][A-Z0-9-]+)/i

  for (let i = 0; i < normLines.length; i++) {
    const perfMatch = normLines[i].match(performRe)
    if (!perfMatch) continue
    const paraName = perfMatch[1].toUpperCase()
    const entry = paraToTable.get(paraName)
    if (!entry) continue

    const { tableName, prefix, op } = entry
    if (!tables.has(tableName)) tables.set(tableName, { ops: new Set(), keyFields: new Set() })
    tables.get(tableName).ops.add(op)

    // Scan up to 15 preceding lines for MOVE ... TO PREFIX-FIELD
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
```

Place `paraVerbToOp` as a module-level function after the `TUX_OP_MAP` constant.

- [ ] **Step 4: Write failing tests for key field extraction**

Add to `describe('extractTuxTables', ...)` in `cobolExtractor.test.js`:

```js
it('extracts key field from MOVE before PERFORM VLD-EUR', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    BUSINESS-LOGIC.
      MOVE VLLRI-EXEC-LGN-ID  TO  EUR-EXEC-LGN-ID.
      PERFORM VLD-EUR THRU VLD-EUR-EXIT.
    VLD-EUR.
      PERFORM COMMON-REC.
    VLD-EUR-EXIT. EXIT.
  `
  const result = extractTuxTables(cobol)
  expect(result[0].keyFields).toContain('eur_exec_lgn_id')
})

it('excludes infrastructure fields (FUNC, TABNAM, CURSOR, KEYNUM, LOCK, STATUS, DATA)', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    MAIN.
      MOVE "RD"   TO EUR-FUNC.
      MOVE 0      TO EUR-KEYNUM.
      MOVE 1      TO EUR-CURSOR.
      MOVE X      TO EUR-EXEC-LGN-ID.
      PERFORM VLD-EUR.
    VLD-EUR.
      PERFORM COMMON-REC.
  `
  const result = extractTuxTables(cobol)
  expect(result[0].keyFields).toEqual(['eur_exec_lgn_id'])
})

it('collects key fields from multiple PERFORM call sites for same table', () => {
  const cobol = `
    WORKING-STORAGE SECTION.
      10  EUR-TABNAM
          PIC X(8) VALUE "exreur".
    PROCEDURE DIVISION.
    STEP-1.
      MOVE VLLRI-EXEC-LGN-ID TO EUR-EXEC-LGN-ID.
      PERFORM VLD-EUR.
    STEP-2.
      MOVE VLLRI-PRD-ID TO EUR-PRD-ID.
      PERFORM VLD-EUR.
    VLD-EUR.
      PERFORM COMMON-REC.
  `
  const result = extractTuxTables(cobol)
  expect(result[0].keyFields).toContain('eur_exec_lgn_id')
  expect(result[0].keyFields).toContain('eur_prd_id')
})
```

- [ ] **Step 5: Run to confirm the key field tests fail first**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test -- --reporter=verbose tests/parser/cobolExtractor.test.js
```

Expected: paragraph-naming tests now pass (from Step 3), key field tests fail (`keyFields` is empty `[]`).

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: only the 3 new key field tests fail; everything else passes.

- [ ] **Step 7: Commit the working paragraph-naming detection**

```bash
git add server/src/parser/cobolExtractor.js server/tests/parser/cobolExtractor.test.js
git commit -m "feat(extractor): extractTuxTables detects ops via paragraph naming (COMMON-FUNC pattern) + key field extraction"
```

The key field tests will be red but committed as-is — they document expected behavior while we implement.

Wait — per TDD, we should make the tests pass before committing. The key field extraction is already implemented in Step 3's code above (the scan loop is included). Let's verify:

- [ ] **Step 7 (corrected): Run all extractor tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test -- --reporter=verbose tests/parser/cobolExtractor.test.js
```

Expected: ALL tests pass including key field tests. The implementation in Step 3 already includes the MOVE-scan loop.

- [ ] **Step 8: Run full test suite**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add server/src/parser/cobolExtractor.js server/tests/parser/cobolExtractor.test.js
git commit -m "feat(extractor): extractTuxTables — paragraph-naming detection + key field extraction from MOVE-before-PERFORM"
```

---

### Task 3: Fix extractExecSql — keyFields from WHERE + fields from SELECT

**Files:**
- Modify: `server/src/parser/cobolExtractor.js`
- Modify: `server/tests/parser/cobolExtractor.test.js`

- [ ] **Step 1: Write failing tests**

Add to `describe('extractExecSql', ...)` in `cobolExtractor.test.js`:

```js
it('extracts keyFields from WHERE clause', () => {
  const cobol = `
    EXEC SQL
      SELECT EUR-ENBL-FLG
      INTO :EUR-ENBL-FLG
      FROM EXREUR
      WHERE EUR-EXEC-LGN-ID = :EUR-EXEC-LGN-ID
    END-EXEC
  `
  const result = extractExecSql(cobol)
  expect(result[0].keyFields).toEqual(['EUR-EXEC-LGN-ID'])
})

it('extracts multiple keyFields from compound WHERE', () => {
  const cobol = `
    EXEC SQL
      SELECT CNS-ENV-NM
      INTO :CNS-ENV-NM
      FROM EXTCNS
      WHERE CNS-EXEC-LGN-ID = :CNS-EXEC-LGN-ID
        AND CNS-ENV-NM = :CNS-ENV-NM
    END-EXEC
  `
  const result = extractExecSql(cobol)
  expect(result[0].keyFields).toEqual(['CNS-EXEC-LGN-ID', 'CNS-ENV-NM'])
})

it('extracts fields from SELECT column list (not SELECT *)', () => {
  const cobol = `
    EXEC SQL
      SELECT EUR-ENBL-FLG, EUR-STATUS
      INTO :EUR-ENBL-FLG, :EUR-STATUS
      FROM EXREUR
      WHERE EUR-EXEC-LGN-ID = :EUR-EXEC-LGN-ID
    END-EXEC
  `
  const result = extractExecSql(cobol)
  expect(result[0].fields).toEqual(['EUR-ENBL-FLG', 'EUR-STATUS'])
})

it('returns empty fields for SELECT *', () => {
  const cobol = `
    EXEC SQL
      SELECT * FROM EXREUR
      WHERE EUR-ID = :EUR-ID
    END-EXEC
  `
  const result = extractExecSql(cobol)
  expect(result[0].fields).toEqual([])
})

it('returns empty keyFields when no WHERE clause', () => {
  const cobol = `
    EXEC SQL
      INSERT INTO EXRLOG (COL1) VALUES (:VAL1)
    END-EXEC
  `
  const result = extractExecSql(cobol)
  expect(result[0].keyFields).toEqual([])
  expect(result[0].fields).toEqual([])
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test -- --reporter=verbose tests/parser/cobolExtractor.test.js
```

Expected: the 5 new SQL tests fail — `keyFields` is undefined and `fields` is `[]` (currently `fields` is returned but empty, and `keyFields` doesn't exist yet).

- [ ] **Step 3: Implement extractExecSql improvements**

In `server/src/parser/cobolExtractor.js`, replace the `extractExecSql` function:

```js
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
```

- [ ] **Step 4: Run tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test -- --reporter=verbose tests/parser/cobolExtractor.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/parser/cobolExtractor.js server/tests/parser/cobolExtractor.test.js
git commit -m "feat(extractor): extractExecSql adds keyFields from WHERE clause and fields from SELECT column list"
```

---

### Task 4: Update orchestrator.js — surface key fields in AI context

**Files:**
- Modify: `server/src/ai/orchestrator.js`

No new test needed: the format change only adds information when `keyFields` is present; existing orchestrator tests have no `keyFields` so the output is identical to before.

- [ ] **Step 1: Update buildStructural to show key fields**

In `server/src/ai/orchestrator.js`, replace lines 62-63:

```js
  const sqlList  = execSqlTables.map(t => `  ${t.table}: ${t.operation}`).join('\n') || '  (none)'
  const tuxList  = tuxTables.map(t => `  ${t.table}: ${t.operation}`).join('\n') || '  (none)'
```

with:

```js
  const sqlList  = execSqlTables.map(t => {
    const keyPart = t.keyFields?.length ? `  key: ${t.keyFields.join(', ')}` : ''
    const fieldPart = t.fields?.length ? `  fields: ${t.fields.join(', ')}` : ''
    return `  ${t.table}: ${t.operation}${keyPart}${fieldPart}`
  }).join('\n') || '  (none)'
  const tuxList  = tuxTables.map(t => {
    const keyPart = t.keyFields?.length ? `  key: ${t.keyFields.join(', ')}` : ''
    return `  ${t.table}: ${t.operation}${keyPart}`
  }).join('\n') || '  (none)'
```

- [ ] **Step 2: Run full test suite**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: all tests pass (the format change adds nothing when keyFields is absent, matching existing test assertions).

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/orchestrator.js
git commit -m "feat(orchestrator): buildStructural shows key fields and SELECT columns in AI context"
```

---

### Task 5: Update prompts.js — add table-name guardrail

**Files:**
- Modify: `server/src/ai/prompts.js`

No new test: prompt text changes are verified by running the analysis and checking AI output quality, not by unit tests.

- [ ] **Step 1: Add guardrail to BUSINESS_ANALYSIS_PROMPT**

In `server/src/ai/prompts.js`, find the `dbTables` rule line (currently ends with `return [] if none`). Add the guardrail after the existing `dbTables` rule text:

Find:
```
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); if you see PREFIX2 operating on the same table as PREFIX in the paragraph text, that is a second buffer for the same table (not a different table) — the parser already deduplicates these; for each table also capture: keyFields = fields used in the WHERE clause or key lookup (e.g. primary key field); notFoundAction = what happens if the row does not exist (error code, fallback read with a different key, or "return empty"); if no key info is available use []; if write-only (INSERT/UPDATE/DELETE) set notFoundAction to "n/a"; return [] if none
```

Replace with:
```
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); if you see PREFIX2 operating on the same table as PREFIX in the paragraph text, that is a second buffer for the same table (not a different table) — the parser already deduplicates these; for each table also capture: keyFields = fields used in the WHERE clause or key lookup (e.g. primary key field); notFoundAction = what happens if the row does not exist (error code, fallback read with a different key, or "return empty"); if no key info is available use []; if write-only (INSERT/UPDATE/DELETE) set notFoundAction to "n/a"; return [] if none; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
```

- [ ] **Step 2: Add the same guardrail to ANALYZE_ENTRY_POINT_PROMPT**

In `server/src/ai/prompts.js`, find the `dbOperations` rule in `ANALYZE_ENTRY_POINT_PROMPT`. Currently ends around:
```
- dbOperations: list ONLY the db tables actually touched by this entry point's paragraphs...
```

Add at the end of that rule:
```
; table name: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing
```

- [ ] **Step 3: Run full test suite to confirm no breakage**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: all tests pass (prompt strings are not tested by unit tests).

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/prompts.js
git commit -m "feat(prompts): add table-name guardrail to COBOL analysis prompts — never invent table names"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Split cobolParser.js into cobolParser.js + cobolExtractor.js | Task 1 |
| Move extractTuxTables, extractExecSql, extractCalls, extractErrorEntries, extractConstructs | Task 1 |
| Paragraph-naming operation detection (READ-EUR, VLD-EUR, INS-EUR...) | Task 2 |
| Keep MOVE "OP" TO PREFIX-FUNC as fallback | Task 2 (both strategies in same function) |
| Key field extraction from MOVE before PERFORM | Task 2 |
| Exclude FUNC/TABNAM/CURSOR/KEYNUM/LOCK/STATUS/DATA infra fields | Task 2 |
| extractExecSql keyFields from WHERE clause | Task 3 |
| extractExecSql fields from SELECT column list | Task 3 |
| orchestrator.js buildStructural shows key fields | Task 4 |
| prompts.js guardrail on both COBOL prompts | Task 5 |
| New test file cobolExtractor.test.js | Task 1 |
| Remove extractor tests from cobolParser.test.js | Task 1 |
| All existing tests continue to pass | Verified in each task |

**Placeholder scan:** None found.

**Type consistency:**
- `extractTuxTables` returns `{ table, operation, keyFields: string[] }` — used in Task 4 as `t.keyFields?.length`
- `extractExecSql` returns `{ table, operation, fields: string[], keyFields: string[] }` — used in Task 4 as `t.keyFields?.length` and `t.fields?.length`
- `paraVerbToOp` is defined at module level in cobolExtractor.js and called from inside extractTuxTables ✓

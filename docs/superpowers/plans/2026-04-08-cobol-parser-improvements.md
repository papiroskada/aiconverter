# COBOL Static Parser Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AI inference with static parsing for structural COBOL properties: linkage parameters (with direction auto-detection from naming convention), error catalog entries (with data element names), EVALUATE dispatch blocks, PERFORM call graphs, and pre-dispatch paragraph detection. Also update prompts with rules from CAPI_RULES.md that prevent common AI analysis mistakes.

**Architecture:** Six new or improved parser functions in `cobolParser.js`; orchestrator updated to pass richer structured data to AI (including pre-dispatch paragraph context for all entry points); prompts updated with four key analysis rules from CAPI_RULES.md (paragraph-name trust, pre-dispatch inclusion, post-read conditionals, second-buffer pattern). The PERFORM graph enables precise paragraph selection for large-file entry-point analysis; pre-dispatch detection ensures shared logic (VALIDATE-LINKAGE etc.) is always included regardless of mode.

**Tech Stack:** Node.js ESM, Vitest (tests run with `npm test` inside `server/`). No new dependencies.

---

## Codebase context

Working directory: `/home/darias/Projects/aiconverter/aiconverter-main`

**Key files:**
- `server/src/parser/cobolParser.js` — all static parser functions (exported)
- `server/tests/parser/cobolParser.test.js` — parser unit tests (Vitest)
- `server/src/ai/orchestrator.js` — builds context string and calls AI provider
- `server/src/ai/prompts.js` — prompt templates
- `server/tests/ai/orchestrator.test.js` — orchestrator unit tests

**Run tests:** `cd server && npm test`

**Existing exported parser functions (do not remove/rename):**
- `preprocessCobol`, `parseCobol`, `extractLinkage`, `extractCalls`, `extractExecSql`
- `extractConstructs`, `extractWorkingStorage`, `extractTuxTables`, `extractErrorSeqNos`

**Existing orchestrator internals (can be changed):**
- `buildStructural(linkage, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorSeqNos)` — builds structural context string
- `buildEntryPointContext(structural, paragraphChunks, paragraphNames)` — builds per-entry-point context for large-file step 2
- `formatWsVars(wsVars)` — formats WS variables for display

---

## File Structure

| File | Change |
|------|--------|
| `server/src/parser/cobolParser.js` | Add 5 new exports; refactor `extractWorkingStorage` to use shared helper; `extractLinkageVars` returns `direction` field |
| `server/tests/parser/cobolParser.test.js` | Add tests for 5 new functions (do NOT modify existing tests) |
| `server/src/ai/orchestrator.js` | Update imports, `buildStructural`, `buildEntryPointContext`, `runAnalysis`; add `findPreDispatchParagraphs` internal helper |
| `server/tests/ai/orchestrator.test.js` | Add 4 tests verifying new context sections; existing tests must still pass |
| `server/src/ai/prompts.js` | Update both prompt templates to reference new context sections and add CAPI Rules 22h, 22a, 22d, 22f |

---

## Task 1: `extractSectionVars` helper + `extractLinkageVars` with direction detection

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

The existing `extractWorkingStorage` has 48 lines of section-parsing logic that we need for LINKAGE SECTION too. Factor it into a private `extractSectionVars` helper. The new `extractLinkageVars` also auto-detects parameter direction from the COBOL naming convention (CAPI Rule 22g-ii):

- `{3-char}RI-FIELD` or `{3-char}UI-FIELD` → `direction: 'in'` (input)
- `{3-char}RO-FIELD` or `{3-char}UO-FIELD` → `direction: 'out'` (output)
- anything else → `direction: null` (AI infers)

Examples: `CPSRI-PART-CUS-ID` → in, `CPSRO-RTN-STS` → out, `VLLRI-PRS-MD` → in, `LP-INPUT` → null.

This means the AI receives pre-labeled parameter directions instead of guessing from context.

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

- [ ] **Step 1: Add failing tests for `extractLinkageVars`**

Append to `server/tests/parser/cobolParser.test.js`:

```js
describe('extractLinkageVars', () => {
  it('returns empty array when no LINKAGE SECTION', () => {
    expect(extractLinkageVars('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toEqual([])
  })

  it('extracts 01-level parameter with PIC and direction in', () => {
    const src = `DATA DIVISION.\nLINKAGE SECTION.\n 01 CPSRI-PART-ID PIC X(8).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ level: '01', name: 'CPSRI-PART-ID', pic: 'X(8)', conditions: [], direction: 'in' })
  })

  it('detects direction out from RO pattern', () => {
    const src = `LINKAGE SECTION.\n 01 CPSRO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('out')
  })

  it('detects direction in from UI pattern (z-programs)', () => {
    const src = `LINKAGE SECTION.\n 01 CHGUI-REF-PFX PIC X(2).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('in')
  })

  it('detects direction out from UO pattern (z-programs)', () => {
    const src = `LINKAGE SECTION.\n 01 CHGUO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBe('out')
  })

  it('returns direction null for fields not matching naming convention', () => {
    const src = `LINKAGE SECTION.\n 01 LP-INPUT PIC X(8).\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result[0].direction).toBeNull()
  })

  it('extracts group with nested 05-level fields', () => {
    const src = `LINKAGE SECTION.\n 01 LP-GROUP.\n    05 VLLRI-CODE PIC X(2).\n    05 VLLRO-STATUS PIC 9.\nPROCEDURE DIVISION.`
    const result = extractLinkageVars(src)
    expect(result.find(v => v.name === 'VLLRI-CODE').direction).toBe('in')
    expect(result.find(v => v.name === 'VLLRO-STATUS').direction).toBe('out')
  })

  it('extracts 88-level conditions on linkage field', () => {
    const src = `LINKAGE SECTION.\n 01 VLLRI-FUNC PIC X(2).\n    88 FUNC-READ   VALUE "RD".\n    88 FUNC-INSERT VALUE "INS".`
    const result = extractLinkageVars(src)
    expect(result[0].conditions).toHaveLength(2)
    expect(result[0].conditions[0]).toEqual({ name: 'FUNC-READ', value: '"RD"' })
  })

  it('stops at WORKING-STORAGE SECTION', () => {
    const src = `LINKAGE SECTION.\n 01 LP-A PIC X.\nWORKING-STORAGE SECTION.\n 01 WS-B PIC X.`
    const result = extractLinkageVars(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('LP-A')
  })
})
```

- [ ] **Step 2: Add `extractLinkageVars` to import in test file**

Change the first line of `server/tests/parser/cobolParser.test.js`:

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorSeqNos, extractLinkageVars } from '../../src/parser/cobolParser.js'
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep "extractLinkageVars"
```

Expected: `ReferenceError` or `is not a function` — confirms function doesn't exist yet.

- [ ] **Step 4: Implement `inferDirection`, `extractSectionVars`, `extractLinkageVars`**

In `server/src/parser/cobolParser.js`, replace the existing `extractWorkingStorage` function (lines 334–382) with:

```js
// CAPI Rule 22g-ii: COBOL linkage fields follow {3-char}{R|U}{I|O}-FIELD naming.
// RI/UI = input, RO/UO = output. Returns 'in', 'out', or null.
function inferDirection(fieldName) {
  const m = fieldName.match(/^[A-Z]{3}[RU](I|O)-/i)
  if (!m) return null
  return m[1].toUpperCase() === 'I' ? 'in' : 'out'
}

function extractSectionVars(cobolText, sectionHeader, stopPatterns, withDirection = false) {
  try {
    const lines = cobolText.split('\n')
    const fixedFormat = detectFixedFormat(lines)
    let inSection = false
    const result = []
    let currentVar = null

    for (const line of lines) {
      const parsed = fixedFormat ? stripSequenceNumber(line) : line
      const upper = parsed.toUpperCase()

      if (!inSection) {
        if (upper.includes(sectionHeader)) inSection = true
        continue
      }
      if (stopPatterns.some(p => upper.includes(p))) break

      const cond88 = parsed.match(/^\s*88\s+([A-Z0-9-]+)\s+VALUES?\s+(.+?)\.?\s*$/i)
      if (cond88 && currentVar) {
        currentVar.conditions.push({
          name: cond88[1].toUpperCase(),
          value: cond88[2].trim().replace(/\.$/, ''),
        })
        continue
      }

      const varMatch = parsed.match(/^\s*(\d{1,2})\s+([A-Z0-9-]+)(?:\s+PIC\s+(\S+?)\.?)?/i)
      if (varMatch && parseInt(varMatch[1], 10) !== 88) {
        const name = varMatch[2].toUpperCase()
        currentVar = {
          level: varMatch[1].padStart(2, '0'),
          name,
          pic: varMatch[3] ? varMatch[3].replace(/\.$/, '') : null,
          conditions: [],
          ...(withDirection ? { direction: inferDirection(name) } : {}),
        }
        result.push(currentVar)
      }
    }

    return result
  } catch {
    return []
  }
}

export function extractWorkingStorage(cobolText) {
  return extractSectionVars(cobolText, 'WORKING-STORAGE SECTION', [
    'PROCEDURE DIVISION', 'FILE SECTION', 'LINKAGE SECTION', 'SCREEN SECTION',
  ])
}

export function extractLinkageVars(cobolText) {
  return extractSectionVars(cobolText, 'LINKAGE SECTION', [
    'PROCEDURE DIVISION', 'WORKING-STORAGE SECTION', 'FILE SECTION', 'SCREEN SECTION',
  ], true)
}
```

- [ ] **Step 5: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  92 passed (92)` (83 existing + 9 new)

- [ ] **Step 6: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): add extractLinkageVars with direction auto-detection, refactor WS to shared helper"
```

---

## Task 2: `extractErrorEntries`

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

Currently `extractErrorSeqNos` returns `[2169, 1500]`. We want `extractErrorEntries` returning `[{ seqNo: 2169, dataElement: "SCCGTERR-DATA-EL value" }]` — pairs captured because the MOVE statements appear within ~3 lines of each other (CAPI Rule 22e: verify string constants against exact MOVE statements).

`extractErrorSeqNos` stays exported and will delegate to `extractErrorEntries` internally. All existing `extractErrorSeqNos` tests must still pass.

- [ ] **Step 1: Add failing tests for `extractErrorEntries`**

Append to `server/tests/parser/cobolParser.test.js`:

```js
describe('extractErrorEntries', () => {
  it('returns empty array when no error assignments', () => {
    expect(extractErrorEntries('MOVE X TO Y.')).toEqual([])
  })

  it('extracts seqNo with dataElement on following line', () => {
    const cobol = `
      MOVE 1500 TO SCCGTERR-SEQ-NO.
      MOVE "PRS-MD" TO SCCGTERR-DATA-EL.
    `
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ seqNo: 1500, dataElement: 'PRS-MD' })
  })

  it('extracts seqNo with dataElement on preceding line', () => {
    const cobol = `
      MOVE "REF-PFX" TO WS-DATA-EL.
      MOVE 1502 TO WS-SEQ-NO.
    `
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ seqNo: 1502, dataElement: 'REF-PFX' })
  })

  it('returns null dataElement when no data element nearby', () => {
    const cobol = `MOVE 9999 TO SCCGTERR-SEQ-NO.`
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ seqNo: 9999, dataElement: null })
  })

  it('deduplicates by seqNo (keeps first occurrence dataElement)', () => {
    const cobol = `
      MOVE "FIELD-A" TO SCCGTERR-DATA-EL.
      MOVE 1500 TO SCCGTERR-SEQ-NO.
      MOVE "FIELD-B" TO SCCGTERR-DATA-EL.
      MOVE 1500 TO SCCGTERR-SEQ-NO.
    `
    const result = extractErrorEntries(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].seqNo).toBe(1500)
  })

  it('sorts by seqNo ascending', () => {
    const cobol = `
      MOVE 2000 TO WS-SEQ-NO.
      MOVE 1000 TO WS-SEQ-NO.
      MOVE 1500 TO WS-SEQ-NO.
    `
    const result = extractErrorEntries(cobol)
    expect(result.map(e => e.seqNo)).toEqual([1000, 1500, 2000])
  })

  it('ignores 3-digit numbers', () => {
    expect(extractErrorEntries('MOVE 999 TO WS-SEQ-NO.')).toEqual([])
  })
})
```

- [ ] **Step 2: Add `extractErrorEntries` to import in test file**

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorSeqNos, extractLinkageVars, extractErrorEntries } from '../../src/parser/cobolParser.js'
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep "extractErrorEntries"
```

Expected: failing tests.

- [ ] **Step 4: Implement `extractErrorEntries` and update `extractErrorSeqNos`**

In `server/src/parser/cobolParser.js`, replace the existing `extractErrorSeqNos` function with:

```js
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

    // Look ±3 lines for a DATA-EL assignment
    let dataElement = null
    for (let j = Math.max(0, i - 3); j <= Math.min(normalised.length - 1, i + 3); j++) {
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
```

- [ ] **Step 5: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  99 passed (99)` (92 from Task 1 + 7 new)

- [ ] **Step 6: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): add extractErrorEntries with data element pairing, keep extractErrorSeqNos as alias"
```

---

## Task 3: `extractEvaluateDispatch`

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

Parse EVALUATE blocks to extract the mode dispatch structure. Returns an array of `{ evaluateSubject, entries: [{ whenValue, performParagraph }] }`. Only includes entries where a `PERFORM PARAGRAPH-NAME` is found within 5 lines after the WHEN clause.

Example COBOL:
```
EVALUATE VLLRI-PRS-MD
  WHEN "1"
    PERFORM PROCESS-CREATE
  WHEN "2"
    PERFORM PROCESS-READ
END-EVALUATE
```

Expected: `[{ evaluateSubject: 'VLLRI-PRS-MD', entries: [{ whenValue: '"1"', performParagraph: 'PROCESS-CREATE' }, ...] }]`

- [ ] **Step 1: Add failing tests for `extractEvaluateDispatch`**

Append to `server/tests/parser/cobolParser.test.js`:

```js
describe('extractEvaluateDispatch', () => {
  it('returns empty array when no EVALUATE', () => {
    expect(extractEvaluateDispatch('PROCEDURE DIVISION.\n PARA.\n   MOVE 1 TO X.')).toEqual([])
  })

  it('returns empty array when EVALUATE has no PERFORM entries', () => {
    const cobol = `
      EVALUATE WS-FLAG
        WHEN "Y"
          MOVE 1 TO WS-X
        WHEN OTHER
          MOVE 0 TO WS-X
      END-EVALUATE
    `
    expect(extractEvaluateDispatch(cobol)).toEqual([])
  })

  it('extracts single EVALUATE with two WHEN-PERFORM entries', () => {
    const cobol = `
      EVALUATE VLLRI-PRS-MD
        WHEN "1"
          PERFORM PROCESS-CREATE
        WHEN "2"
          PERFORM PROCESS-READ
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].evaluateSubject).toBe('VLLRI-PRS-MD')
    expect(result[0].entries).toHaveLength(2)
    expect(result[0].entries[0]).toEqual({ whenValue: '"1"', performParagraph: 'PROCESS-CREATE' })
    expect(result[0].entries[1]).toEqual({ whenValue: '"2"', performParagraph: 'PROCESS-READ' })
  })

  it('includes WHEN OTHER entries', () => {
    const cobol = `
      EVALUATE WS-MODE
        WHEN "A"
          PERFORM DO-A
        WHEN OTHER
          PERFORM DO-DEFAULT
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result[0].entries.find(e => e.whenValue === 'OTHER')).toBeDefined()
    expect(result[0].entries.find(e => e.whenValue === 'OTHER').performParagraph).toBe('DO-DEFAULT')
  })

  it('extracts multiple separate EVALUATE blocks', () => {
    const cobol = `
      EVALUATE WS-FUNC
        WHEN "RD"
          PERFORM READ-RECORD
      END-EVALUATE
      EVALUATE WS-STATUS
        WHEN "OK"
          PERFORM FINISH-OK
      END-EVALUATE
    `
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(2)
    expect(result[0].evaluateSubject).toBe('WS-FUNC')
    expect(result[1].evaluateSubject).toBe('WS-STATUS')
  })

  it('handles fixed-format COBOL with sequence numbers', () => {
    const cobol = [
      '000010 EVALUATE WS-MODE',
      '000020   WHEN "1"',
      '000030     PERFORM MODE-ONE',
      '000040 END-EVALUATE',
    ].join('\n')
    const result = extractEvaluateDispatch(cobol)
    expect(result).toHaveLength(1)
    expect(result[0].entries[0].performParagraph).toBe('MODE-ONE')
  })
})
```

- [ ] **Step 2: Add `extractEvaluateDispatch` to import in test file**

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorSeqNos, extractLinkageVars, extractErrorEntries, extractEvaluateDispatch } from '../../src/parser/cobolParser.js'
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep "extractEvaluateDispatch"
```

Expected: failing tests.

- [ ] **Step 4: Implement `extractEvaluateDispatch`**

Add to `server/src/parser/cobolParser.js` (after `extractErrorSeqNos`):

```js
export function extractEvaluateDispatch(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const normalised = lines.map(l => fixedFormat ? stripSequenceNumber(l) : l)

  const result = []

  for (let i = 0; i < normalised.length; i++) {
    const evalMatch = normalised[i].match(/\bEVALUATE\s+(\S+)/i)
    if (!evalMatch) continue

    const evaluateSubject = evalMatch[1].toUpperCase()
    const entries = []
    let j = i + 1

    while (j < normalised.length) {
      const trimmed = normalised[j].trim()
      if (/^END-EVALUATE/i.test(trimmed)) break

      const whenMatch = trimmed.match(/^WHEN\s+(.+)/i)
      if (whenMatch) {
        const whenValue = whenMatch[1].trim().toUpperCase()
        // Look ahead up to 5 lines for a PERFORM PARAGRAPH-NAME
        let performParagraph = null
        for (let k = j + 1; k < Math.min(j + 6, normalised.length); k++) {
          const kt = normalised[k].trim()
          if (/^WHEN\b/i.test(kt) || /^END-EVALUATE/i.test(kt)) break
          const perf = kt.match(/^PERFORM\s+([A-Z][A-Z0-9-]+)/i)
          if (perf) { performParagraph = perf[1].toUpperCase(); break }
        }
        if (performParagraph) entries.push({ whenValue, performParagraph })
      }
      j++
    }

    if (entries.length > 0) result.push({ evaluateSubject, entries })
  }

  return result
}
```

- [ ] **Step 5: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  105 passed (105)` (99 from Task 2 + 6 new)

- [ ] **Step 6: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): add extractEvaluateDispatch — extracts EVALUATE dispatch blocks"
```

---

## Task 4: `extractPerformGraph` + `resolveTransitive`

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

Build a call graph from paragraph chunks (CAPI Rule 22b: trace ALL PERFORMs transitively). `extractPerformGraph(paragraphChunks)` returns `Map<string, Set<string>>`. `resolveTransitive(startParagraph, graph)` does BFS returning `Set<string>` of all reachable paragraphs including start.

Used in `buildEntryPointContext` to expand AI-provided paragraph names and in pre-dispatch detection (Task 5).

- [ ] **Step 1: Add failing tests**

Append to `server/tests/parser/cobolParser.test.js`:

```js
describe('extractPerformGraph', () => {
  it('returns empty Map for empty chunks array', () => {
    const graph = extractPerformGraph([])
    expect(graph.size).toBe(0)
  })

  it('maps paragraph to directly PERFORMed paragraphs', () => {
    const chunks = [
      { chunk_name: 'MAIN-PARA', chunk_type: 'paragraph', cobol_text: 'MAIN-PARA.\n  PERFORM VALIDATE.\n  PERFORM PROCESS.' },
      { chunk_name: 'VALIDATE', chunk_type: 'paragraph', cobol_text: 'VALIDATE.\n  IF X > 0 MOVE 1 TO Y.' },
      { chunk_name: 'PROCESS', chunk_type: 'paragraph', cobol_text: 'PROCESS.\n  PERFORM SAVE-DATA.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.get('MAIN-PARA')).toEqual(new Set(['VALIDATE', 'PROCESS']))
    expect(graph.get('VALIDATE')).toEqual(new Set())
    expect(graph.get('PROCESS')).toEqual(new Set(['SAVE-DATA']))
  })

  it('ignores PERFORM UNTIL / VARYING / TIMES keywords', () => {
    const chunks = [
      { chunk_name: 'LOOP-PARA', chunk_type: 'paragraph', cobol_text: 'LOOP-PARA.\n  PERFORM UNTIL WS-DONE = "Y"\n    MOVE 1 TO X\n  END-PERFORM.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.get('LOOP-PARA').has('UNTIL')).toBe(false)
  })

  it('ignores data_summary chunks', () => {
    const chunks = [
      { chunk_name: 'WORKING-STORAGE', chunk_type: 'data_summary', cobol_text: '01 WS-PERFORM PIC X.' },
      { chunk_name: 'REAL-PARA', chunk_type: 'paragraph', cobol_text: 'REAL-PARA.\n  PERFORM OTHER-PARA.' },
    ]
    const graph = extractPerformGraph(chunks)
    expect(graph.has('WORKING-STORAGE')).toBe(false)
    expect(graph.has('REAL-PARA')).toBe(true)
  })
})

describe('resolveTransitive', () => {
  it('returns Set containing only start when start has no outgoing edges', () => {
    const graph = new Map([['LEAF', new Set()]])
    expect(resolveTransitive('LEAF', graph)).toEqual(new Set(['LEAF']))
  })

  it('resolves direct dependencies', () => {
    const graph = new Map([
      ['A', new Set(['B', 'C'])],
      ['B', new Set()],
      ['C', new Set()],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B', 'C']))
  })

  it('resolves transitive chain A→B→C→D', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['D'])],
      ['D', new Set()],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B', 'C', 'D']))
  })

  it('handles cycles without infinite loop', () => {
    const graph = new Map([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ])
    expect(resolveTransitive('A', graph)).toEqual(new Set(['A', 'B']))
  })

  it('returns Set with only start when start not in graph', () => {
    const graph = new Map([['OTHER', new Set()]])
    expect(resolveTransitive('UNKNOWN', graph)).toEqual(new Set(['UNKNOWN']))
  })
})
```

- [ ] **Step 2: Add new functions to import in test file**

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorSeqNos, extractLinkageVars, extractErrorEntries, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../../src/parser/cobolParser.js'
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep -E "extractPerformGraph|resolveTransitive"
```

Expected: failing tests.

- [ ] **Step 4: Implement `extractPerformGraph` and `resolveTransitive`**

Add to `server/src/parser/cobolParser.js` (after `extractEvaluateDispatch`):

```js
const PERFORM_KEYWORDS = new Set([
  'UNTIL', 'VARYING', 'TIMES', 'WITH', 'THRU', 'THROUGH', 'TEST', 'AFTER', 'BEFORE',
])

export function extractPerformGraph(paragraphChunks) {
  const graph = new Map()
  const paraRe = /\bPERFORM\s+([A-Z][A-Z0-9-]+)/gi

  for (const chunk of paragraphChunks) {
    if (chunk.chunk_type === 'data_summary') continue
    const name = chunk.chunk_name
    const performed = new Set()
    const re = new RegExp(paraRe.source, paraRe.flags)
    let m
    while ((m = re.exec(chunk.cobol_text)) !== null) {
      const target = m[1].toUpperCase()
      if (!PERFORM_KEYWORDS.has(target)) performed.add(target)
    }
    graph.set(name, performed)
  }

  return graph
}

export function resolveTransitive(startParagraph, graph) {
  const visited = new Set()
  const queue = [startParagraph]

  while (queue.length > 0) {
    const curr = queue.shift()
    if (visited.has(curr)) continue
    visited.add(curr)
    for (const child of (graph.get(curr) ?? [])) {
      if (!visited.has(child)) queue.push(child)
    }
  }

  return visited
}
```

- [ ] **Step 5: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  114 passed (114)` (105 from Task 3 + 9 new)

- [ ] **Step 6: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): add extractPerformGraph and resolveTransitive for paragraph dependency resolution"
```

---

## Task 5: Orchestrator integration

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

Update the orchestrator to:
1. Call the four new parser functions
2. Pass `linkageVars` (structured, with direction) instead of raw linkage text — AI gets labeled `[in]`/`[out]` on each field
3. Pass `errorEntries` (with data elements) instead of just seq numbers
4. Add `ENTRY POINT DISPATCH` section from `extractEvaluateDispatch`
5. Add `PRE-DISPATCH PARAGRAPHS` section — paragraphs PERFORMed before the EVALUATE in the dispatch paragraph (CAPI Rule 22a: these run before every mode and must appear in every entry point's steps)
6. In `buildEntryPointContext`: expand paragraphNames transitively with `resolveTransitive` AND always prepend pre-dispatch paragraphs + their transitive deps

**Why pre-dispatch matters (Rule 22a):** COBOL programs always execute `VALIDATE-LINKAGE`, `INITIAL-SETUP`, `VALIDATE-ACCESS` before the mode dispatch. These paragraphs validate inputs, load config, check access rights. Without them, each entry point spec is missing its preconditions.

- [ ] **Step 1: Add failing orchestrator tests**

Append to `server/tests/ai/orchestrator.test.js`:

```js
describe('runAnalysis — context content', () => {
  it('includes LINKAGE SECTION VARIABLES with direction in context', async () => {
    const provider = makeProvider()
    const cobolText = 'DATA DIVISION.\nLINKAGE SECTION.\n 01 CPSRI-PART-ID PIC X(8).\n 01 CPSRO-RTN-STS PIC 9(4).\nPROCEDURE DIVISION.'
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('LINKAGE SECTION VARIABLES')
    expect(ctx).toContain('CPSRI-PART-ID')
    expect(ctx).toContain('[in]')
    expect(ctx).toContain('[out]')
  })

  it('includes ENTRY POINT DISPATCH in context when EVALUATE present', async () => {
    const cobolText = `PROCEDURE DIVISION.\nDISPATCH.\n  EVALUATE WS-MODE\n    WHEN "1"\n      PERFORM DO-ONE\n  END-EVALUATE.`
    const chunks = [
      { chunk_name: 'DISPATCH', chunk_type: 'paragraph', cobol_text: 'EVALUATE WS-MODE\n  WHEN "1"\n    PERFORM DO-ONE\nEND-EVALUATE' },
    ]
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks, provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('ENTRY POINT DISPATCH')
    expect(ctx).toContain('WS-MODE')
  })

  it('includes ERROR ENTRIES with data elements in context', async () => {
    const cobolText = `PROCEDURE DIVISION.\nMAIN.\n  MOVE "PRS-MD" TO SCCGTERR-DATA-EL.\n  MOVE 1500 TO SCCGTERR-SEQ-NO.`
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('ERROR ENTRIES')
    expect(ctx).toContain('1500')
    expect(ctx).toContain('PRS-MD')
  })

  it('includes PRE-DISPATCH PARAGRAPHS in context when present', async () => {
    const cobolText = 'PROCEDURE DIVISION.'
    const chunks = [
      {
        chunk_name: 'BUSINESS-LOGIC',
        chunk_type: 'paragraph',
        cobol_text: 'BUSINESS-LOGIC.\n  PERFORM VALIDATE-LINKAGE.\n  PERFORM INITIAL-SETUP.\n  EVALUATE WS-MODE\n    WHEN "1"\n      PERFORM DO-ONE\n  END-EVALUATE.',
      },
      { chunk_name: 'VALIDATE-LINKAGE', chunk_type: 'paragraph', cobol_text: 'VALIDATE-LINKAGE.\n  IF WS-MODE = SPACES MOVE 1500 TO WS-SEQ-NO.' },
      { chunk_name: 'INITIAL-SETUP', chunk_type: 'paragraph', cobol_text: 'INITIAL-SETUP.\n  MOVE SPACES TO WS-OUT.' },
    ]
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks, provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('PRE-DISPATCH PARAGRAPHS')
    expect(ctx).toContain('VALIDATE-LINKAGE')
    expect(ctx).toContain('INITIAL-SETUP')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep -E "LINKAGE SECTION VARIABLES|ENTRY POINT DISPATCH|ERROR ENTRIES|PRE-DISPATCH"
```

Expected: 4 failing tests.

- [ ] **Step 3: Update `orchestrator.js` imports**

Change the import line at the top of `server/src/ai/orchestrator.js`:

```js
import { extractLinkageVars, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage, extractTuxTables, extractErrorEntries, extractEvaluateDispatch, extractPerformGraph, resolveTransitive } from '../parser/cobolParser.js'
```

(Removed: `extractLinkage`, `extractErrorSeqNos`. Added: `extractLinkageVars`, `extractErrorEntries`, `extractEvaluateDispatch`, `extractPerformGraph`, `resolveTransitive`.)

- [ ] **Step 4: Add `formatLinkageVars` helper and `findPreDispatchParagraphs` internal helper**

Add these two functions to `server/src/ai/orchestrator.js` (before `buildStructural`):

```js
function formatLinkageVars(linkageVars) {
  if (!linkageVars.length) return '  (none)'
  return linkageVars.map(v => {
    const dir = v.direction ? ` [${v.direction}]` : ''
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}${dir}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

// CAPI Rule 22a: paragraphs PERFORMed before the EVALUATE dispatch run before
// every mode and must be included in every entry point's context.
function findPreDispatchParagraphs(paragraphChunks) {
  const dispatchChunk = paragraphChunks.find(c => /\bEVALUATE\b/i.test(c.cobol_text))
  if (!dispatchChunk) return []

  const preDispatch = []
  for (const line of dispatchChunk.cobol_text.split('\n')) {
    if (/\bEVALUATE\b/i.test(line)) break
    const m = line.match(/\bPERFORM\s+([A-Z][A-Z0-9-]+)/i)
    if (m) {
      const name = m[1].toUpperCase()
      if (!['UNTIL', 'VARYING', 'TIMES', 'WITH', 'THRU', 'THROUGH', 'TEST'].includes(name)) {
        preDispatch.push(name)
      }
    }
  }
  return [...new Set(preDispatch)]
}
```

- [ ] **Step 5: Replace `buildStructural` with updated version**

Replace the existing `buildStructural` function in `server/src/ai/orchestrator.js`:

```js
function buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames) {
  const callList = calls.map(c => `  CALL '${c.program}'${c.using ? ` USING ${c.using}` : ''}`).join('\n') || '  (none)'
  const fileList = selectFiles.join('\n') || '  (none)'
  const sqlList  = execSqlTables.map(t => `  ${t.table}: ${t.operation}`).join('\n') || '  (none)'
  const tuxList  = tuxTables.map(t => `  ${t.table}: ${t.operation}`).join('\n') || '  (none)'
  const errList  = errorEntries.length
    ? errorEntries.map(e => e.dataElement ? `${e.seqNo} (${e.dataElement})` : `${e.seqNo}`).join(', ')
    : 'none'
  const dispatchList = evaluateDispatch.length
    ? evaluateDispatch.map(d =>
        `  EVALUATE ${d.evaluateSubject}:\n${d.entries.map(e => `    WHEN ${e.whenValue} → PERFORM ${e.performParagraph}`).join('\n')}`
      ).join('\n')
    : '  (none)'
  const preList = preDispatchNames.length ? preDispatchNames.join(', ') : '(none)'

  return [
    `LINKAGE SECTION VARIABLES:\n${formatLinkageVars(linkageVars)}`,
    `WORKING-STORAGE VARIABLES:\n${formatWsVars(wsVars)}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `DATABASE OPERATIONS (TUX MIDDLEWARE):\n${tuxList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
    `ENTRY POINT DISPATCH:\n${dispatchList}`,
    `PRE-DISPATCH PARAGRAPHS (shared by all entry points, run before every mode): ${preList}`,
    `ERROR ENTRIES: ${errList}`,
  ].join('\n\n')
}
```

- [ ] **Step 6: Replace `buildEntryPointContext` with updated version using `resolveTransitive` and pre-dispatch**

Replace the existing `buildEntryPointContext` function:

```js
function buildEntryPointContext(structural, paragraphChunks, paragraphNames, performGraph, preDispatchNames) {
  // Always include pre-dispatch paragraphs + transitively expand all names (CAPI Rule 22a + 22b)
  const allNames = new Set([...preDispatchNames, ...paragraphNames])
  for (const name of [...allNames]) {
    for (const dep of resolveTransitive(name, performGraph)) {
      allNames.add(dep)
    }
  }
  const relevant = paragraphChunks.filter(c => allNames.has(c.chunk_name))
  const paragraphList = relevant.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n')
  return `${structural}\n\nPARAGRAPHS:\n${paragraphList || '(none)'}`
}
```

- [ ] **Step 7: Update `runAnalysis` to call new parsers**

Replace the block of extractor calls and structural build in `runAnalysis`:

```js
export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal }) {
  const paragraphChunks = chunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')

  const linkageVars      = extractLinkageVars(cobolText)
  const wsVars           = extractWorkingStorage(cobolText)
  const calls            = extractCalls(cobolText)
  const execSqlTables    = extractExecSql(cobolText)
  const constructs       = extractConstructs(cobolText)
  const selectFiles      = extractSelectFiles(cobolText)
  const tuxTables        = extractTuxTables(cobolText)
  const errorEntries     = extractErrorEntries(cobolText)
  const evaluateDispatch = extractEvaluateDispatch(cobolText)
  const performGraph     = extractPerformGraph(paragraphChunks)
  const preDispatchNames = findPreDispatchParagraphs(paragraphChunks)

  const structural = buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames)
  const fullContext = buildContext(structural, paragraphChunks)
  // ... rest of function unchanged
```

Also update the `buildEntryPointContext` call in the large-file step-2 section:

```js
const epContext = buildEntryPointContext(structural, paragraphChunks, names, performGraph, preDispatchNames)
```

- [ ] **Step 8: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  118 passed (118)` (114 from Task 4 + 4 new)

- [ ] **Step 9: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js
git commit -m "feat(orchestrator): integrate structured linkage+direction, error entries, dispatch, pre-dispatch, perform graph"
```

---

## Task 6: Prompt updates

**Files:**
- Modify: `server/src/ai/prompts.js`

Update both prompt templates to:
1. Reference new context sections added in Task 5 (LINKAGE SECTION VARIABLES with direction, ENTRY POINT DISPATCH, PRE-DISPATCH PARAGRAPHS, ERROR ENTRIES)
2. Add four analysis rules from CAPI_RULES.md that prevent the most common AI mistakes

**Rules being added:**
- **Rule 22h** — Paragraph names are labels, not contracts. `VALIDATE-ACCESS` in one program checks branches, in another reads different tables. Always base analysis on actual code content.
- **Rule 22a** — Pre-dispatch logic (validation, access, setup) runs before every mode and must appear in every entry point's steps — not just mode-specific paragraphs.
- **Rule 22d** — For each table read, trace what the calling paragraph does after: conditional errors, fallback reads with different keys, field derivation from result.
- **Rule 22f** — In TUX middleware, PREFIX2-TABNAM with same table name as PREFIX-TABNAM is a second buffer for the same table (not a different table). Parser already deduplicates these; this tells AI how to interpret the pattern in paragraph text.

- [ ] **Step 1: Replace `BUSINESS_ANALYSIS_PROMPT` rules section**

In `server/src/ai/prompts.js`, replace the `Rules:` section of `BUSINESS_ANALYSIS_PROMPT` (everything after the closing `}` of the JSON schema):

```js
Rules:
- businessPurpose: one sentence, business domain language, not code language
- parameters: use LINKAGE SECTION VARIABLES — field names, PIC types, and direction labels [in]/[out] are pre-analyzed; infer JS type: PIC X = string, PIC 9 = number, group level (no PIC) = object; direction null means infer from context
- entryPoints: use ENTRY POINT DISPATCH as the starting point — each WHEN entry is one entry point; if ENTRY POINT DISPATCH is (none), look for EVALUATE or IF blocks dispatching on a linkage parameter; if no dispatch create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL paragraph names relevant to this entry point including PRE-DISPATCH PARAGRAPHS (for large-file second-pass use)
- entryPoints[].steps: include PRE-DISPATCH PARAGRAPHS logic first (validation, access checks, initial setup) — these run before every mode; then mode-specific steps; describe WHAT HAPPENS FOR THE BUSINESS, not code mechanics
- entryPoints[].sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- errorCatalog: use ERROR ENTRIES as the canonical list — each entry has seqNo and dataElement pre-extracted; populate code=seqNo, add businessMeaning and systemAction from context; include every entry listed
- externalDependencies: only CALLS representing meaningful business operations; EXCLUDE calls starting with C_ (C_WRITELNKAREA, C_GETPLENV, C_GETDATETM, C_HIGHLOW, C_ISOLATION, C_COMPRESS) — middleware boilerplate
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); if you see PREFIX2 operating on the same table as PREFIX in the paragraph text, that is a second buffer for the same table (not a different table) — the parser already deduplicates these; return [] if none
- fileIO: file I/O from FILE I/O (SELECT statements) and OPEN/READ/WRITE/CLOSE in paragraphs; return [] if none

Analysis discipline (from CAPI_RULES.md):
- Paragraph names are labels, not contracts — do NOT infer behavior from the name alone (VALIDATE-ACCESS in one program checks branches, in another it reads entirely different tables); always base analysis on the actual code content of each paragraph provided
- For each table read found in paragraphs, consider what happens after: are there conditional errors (not found = error?), fallback reads with different keys, or field derivation from the result?
- The pre-dispatch paragraphs listed in PRE-DISPATCH PARAGRAPHS run before every mode — their validation and setup logic applies to ALL entry points
`
```

- [ ] **Step 2: Replace `ANALYZE_ENTRY_POINT_PROMPT` rules section**

Replace the `Rules:` section of `ANALYZE_ENTRY_POINT_PROMPT`:

```js
Rules:
- steps: start with PRE-DISPATCH PARAGRAPHS logic (validation, access, setup listed in context) — these run before this operation too; then describe the operation-specific WHAT HAPPENS FOR THE BUSINESS, not code mechanics
- sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- returns: what output parameters or status values are set on success
- errors: reference ERROR ENTRIES from context — format as "seqNo (dataElement): business meaning"; use actual seq numbers from the list, not generic descriptions
- Paragraph names are labels: do NOT infer behavior from name alone — base analysis on actual paragraph code provided
- For table reads: describe what happens after (conditional errors, fallback reads, field derivation)
`
```

- [ ] **Step 3: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test
```

Expected: `Tests  118 passed (118)` — no tests for prompt text, confirming nothing broke.

- [ ] **Step 4: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/ai/prompts.js
git commit -m "feat(prompts): add CAPI Rules 22h/22a/22d/22f, reference structured context sections"
```

---

## Self-Review

**Spec coverage:**
- ✅ `extractLinkageVars` with direction auto-detection (Rule 22g-ii) — Task 1
- ✅ `extractErrorSeqNos` kept as alias — Task 2
- ✅ `extractErrorEntries` with data element pairing (Rule 22e) — Task 2
- ✅ `extractEvaluateDispatch` — Task 3
- ✅ `extractPerformGraph` + `resolveTransitive` (Rule 22b) — Task 4
- ✅ Orchestrator: structured linkage, error entries, dispatch, pre-dispatch — Task 5
- ✅ `buildEntryPointContext` expands transitively + always includes pre-dispatch (Rule 22a) — Task 5
- ✅ Prompts: Rule 22h (paragraph names), 22a (pre-dispatch), 22d (post-read), 22f (second-buffer) — Task 6

**Placeholder scan:** No TBDs. All code complete.

**Type consistency:**
- `extractLinkageVars` returns `{ level, name, pic, conditions, direction }[]` — `direction` shown as `[in]`/`[out]` in `formatLinkageVars` ✅
- `extractErrorEntries` returns `{ seqNo: number, dataElement: string | null }[]` — formatted as `1500 (PRS-MD)` in `errList` ✅
- `extractEvaluateDispatch` returns `{ evaluateSubject, entries: { whenValue, performParagraph }[] }[]` — formatted in `dispatchList` ✅
- `extractPerformGraph` returns `Map<string, Set<string>>` — passed as `performGraph` to `buildEntryPointContext` and `resolveTransitive` ✅
- `resolveTransitive(start, graph)` returns `Set<string>` — iterated in `buildEntryPointContext` ✅
- `findPreDispatchParagraphs(paragraphChunks)` returns `string[]` — passed as `preDispatchNames` to both `buildStructural` and `buildEntryPointContext` ✅
- `buildStructural` new signature: `(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames)` — called with exactly these in `runAnalysis` ✅
- `buildEntryPointContext` new signature: `(structural, paragraphChunks, paragraphNames, performGraph, preDispatchNames)` — called in large-file step-2 ✅

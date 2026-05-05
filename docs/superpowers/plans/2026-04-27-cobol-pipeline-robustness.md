# COBOL Pipeline Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five independent robustness issues in the COBOL analysis pipeline: PERFORM THRU support, sub-paragraph overlap, AI response validation, structural analysis caching, and a proper inter-program call dependency table.

**Architecture:** Five independent improvements — each can be implemented and committed separately without touching the others. All live in the `server/` package. No DB migrations are shared between tasks (each task adds its own).

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL (pg), `server/src/parser/cobolParser.js`, `server/src/ai/orchestrator.js`, `server/src/db/schema.sql`, `server/src/models/`, `server/src/services/graphService.js`

---

## File Map

| Task | Files modified | Files created |
|------|---------------|---------------|
| 1 — PERFORM THRU | `server/src/parser/cobolParser.js` | — |
| 1 — PERFORM THRU | `server/src/ai/orchestrator.js` | — |
| 1 — PERFORM THRU | `server/tests/parser/cobolParser.test.js` | — |
| 2 — Overlap | `server/src/parser/cobolParser.js` (1 line) | — |
| 3 — DB validation | `server/src/ai/orchestrator.js` | — |
| 3 — DB validation | `server/tests/ai/orchestrator.test.js` | — |
| 4 — Structural cache | `server/src/db/schema.sql` | — |
| 4 — Structural cache | `server/src/models/programs.js` | — |
| 4 — Structural cache | `server/src/ai/orchestrator.js` | — |
| 4 — Structural cache | `server/src/services/analysisService.js` | — |
| 5 — program_calls | `server/src/db/schema.sql` | `server/src/models/programCalls.js` |
| 5 — program_calls | `server/src/services/graphService.js` | — |
| 5 — program_calls | `server/src/services/analysisService.js` | — |
| 5 — program_calls | `server/src/routes/programs.js` | — |
| 5 — program_calls | `server/tests/services/graphService.test.js` | — |

---

## Task 1: PERFORM THRU support + missing-paragraph logging

**Context:** `extractPerformGraph()` at `server/src/parser/cobolParser.js:331` only captures the first word after `PERFORM`. A `PERFORM INIT-PARA THRU INIT-PARA-EXIT` currently includes `INIT-PARA` but silently drops `INIT-PARA-EXIT` and everything between. `collectMissingParagraphs()` (new export) lets the orchestrator surface which PERFORM targets were referenced but never defined — these are either dynamic PERFORMs or THRU endpoints that weren't resolved.

**Files:**
- Modify: `server/src/parser/cobolParser.js:331-350` (extractPerformGraph)
- Modify: `server/src/ai/orchestrator.js:71-105` (buildStructural — add missing-para section)
- Modify: `server/src/ai/orchestrator.js:165-196` (runAnalysis — call collectMissingParagraphs)
- Modify: `server/tests/parser/cobolParser.test.js`

---

- [ ] **Step 1.1: Write failing tests for THRU and missing-paragraph behavior**

Append to `server/tests/parser/cobolParser.test.js`:

```javascript
import { extractPerformGraph, resolveTransitive, collectMissingParagraphs } from '../../src/parser/cobolParser.js'

describe('extractPerformGraph — THRU support', () => {
  test('PERFORM A THRU C includes all paragraphs in range', () => {
    const chunks = [
      { chunk_type: 'paragraph', chunk_name: 'INIT-A', cobol_text: 'INIT-A.\n    PERFORM INIT-B THRU INIT-D.' },
      { chunk_type: 'paragraph', chunk_name: 'INIT-B', cobol_text: 'INIT-B.\n    MOVE 1 TO X.' },
      { chunk_type: 'paragraph', chunk_name: 'INIT-C', cobol_text: 'INIT-C.\n    MOVE 2 TO X.' },
      { chunk_type: 'paragraph', chunk_name: 'INIT-D', cobol_text: 'INIT-D.\n    CONTINUE.' },
    ]
    const graph = extractPerformGraph(chunks)
    const performed = graph.get('INIT-A')
    expect(performed.has('INIT-B')).toBe(true)
    expect(performed.has('INIT-C')).toBe(true)
    expect(performed.has('INIT-D')).toBe(true)
  })

  test('PERFORM A THROUGH C (long form) includes range', () => {
    const chunks = [
      { chunk_type: 'paragraph', chunk_name: 'MAIN', cobol_text: 'MAIN.\n    PERFORM STEP-1 THROUGH STEP-3.' },
      { chunk_type: 'paragraph', chunk_name: 'STEP-1', cobol_text: 'STEP-1.\n    CONTINUE.' },
      { chunk_type: 'paragraph', chunk_name: 'STEP-2', cobol_text: 'STEP-2.\n    CONTINUE.' },
      { chunk_type: 'paragraph', chunk_name: 'STEP-3', cobol_text: 'STEP-3.\n    CONTINUE.' },
    ]
    const graph = extractPerformGraph(chunks)
    const performed = graph.get('MAIN')
    expect(performed.has('STEP-1')).toBe(true)
    expect(performed.has('STEP-2')).toBe(true)
    expect(performed.has('STEP-3')).toBe(true)
  })
})

describe('collectMissingParagraphs', () => {
  test('returns paragraph names that are PERFORM targets but not graph keys', () => {
    const graph = new Map([
      ['MAIN', new Set(['SUB-A', 'GHOST-PARA'])],
      ['SUB-A', new Set()],
    ])
    const missing = collectMissingParagraphs(graph)
    expect(missing.has('GHOST-PARA')).toBe(true)
    expect(missing.has('SUB-A')).toBe(false)
    expect(missing.has('MAIN')).toBe(false)
  })

  test('returns empty set when all targets are defined', () => {
    const graph = new Map([
      ['MAIN', new Set(['INIT'])],
      ['INIT', new Set()],
    ])
    expect(collectMissingParagraphs(graph).size).toBe(0)
  })
})
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/parser/cobolParser.test.js 2>&1 | tail -20
```

Expected: FAIL — `collectMissingParagraphs is not a function`, THRU tests fail.

- [ ] **Step 1.3: Implement THRU support and collectMissingParagraphs in cobolParser.js**

In `server/src/parser/cobolParser.js`, replace the entire `extractPerformGraph` function (lines 331–350) and add `collectMissingParagraphs` after it:

```javascript
export function extractPerformGraph(paragraphChunks) {
  const graph = new Map()
  const paraRe = /\bPERFORM\s+([A-Z][A-Z0-9-]+)/gi
  const thruRe = /\bPERFORM\s+([A-Z][A-Z0-9-]+)\s+(?:THRU|THROUGH)\s+([A-Z][A-Z0-9-]+)/gi

  // Build ordered paragraph list for THRU range resolution
  const paraOrder = []
  for (const chunk of paragraphChunks) {
    if (chunk.chunk_type === 'data_summary') continue
    const name = chunk.chunk_name.replace(/\s+\[\d+\]$/, '')
    if (!paraOrder.includes(name)) paraOrder.push(name)
  }

  for (const chunk of paragraphChunks) {
    if (chunk.chunk_type === 'data_summary') continue
    const name = chunk.chunk_name.replace(/\s+\[\d+\]$/, '')
    if (graph.has(name)) continue
    const performed = new Set()

    // THRU ranges first
    const thruReg = new RegExp(thruRe.source, thruRe.flags)
    let tm
    while ((tm = thruReg.exec(chunk.cobol_text)) !== null) {
      const start = tm[1].toUpperCase()
      const end = tm[2].toUpperCase()
      const si = paraOrder.indexOf(start)
      const ei = paraOrder.indexOf(end)
      if (si !== -1 && ei !== -1 && ei >= si) {
        for (let i = si; i <= ei; i++) performed.add(paraOrder[i])
      } else {
        performed.add(start)
        if (!PERFORM_KEYWORDS.has(end)) performed.add(end)
      }
    }

    // Regular PERFORM targets
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

export function collectMissingParagraphs(graph) {
  const defined = new Set(graph.keys())
  const missing = new Set()
  for (const targets of graph.values()) {
    for (const t of targets) {
      if (!defined.has(t)) missing.add(t)
    }
  }
  return missing
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/parser/cobolParser.test.js 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 1.5: Surface missing paragraphs in buildStructural**

In `server/src/ai/orchestrator.js`:

1. Add `collectMissingParagraphs` to the import from cobolParser (find the existing import line that includes `extractPerformGraph` and add it):

```javascript
import { ..., extractPerformGraph, collectMissingParagraphs } from '../parser/cobolParser.js'
```

2. Add `missingParagraphs` parameter to `buildStructural` (add after `preDispatchNames` parameter) and a new section in the returned array:

Current signature: `function buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames)`

New signature and body — add at the end of the returned array in `buildStructural`:

```javascript
function buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames, missingParagraphs = new Set()) {
  // ... all existing lines unchanged ...
  // add this entry at the end of the returned array, before the closing bracket:
  const missingList = missingParagraphs.size > 0
    ? `WARNING — PERFORM targets not found as paragraph definitions (possible dynamic PERFORM or THRU gaps): ${[...missingParagraphs].join(', ')}`
    : null

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
    ...(missingList ? [missingList] : []),
  ].join('\n\n')
}
```

3. In `runAnalysis()` (around line 177–180), after `const performGraph = extractPerformGraph(...)`, add:

```javascript
const missingParagraphs = collectMissingParagraphs(performGraph)
```

And update the `buildStructural` call (line 180) to pass `missingParagraphs` as the last argument:

```javascript
const structural = buildStructural(linkageVars, calls, execSqlTables, tuxTables, selectFiles, constructs, wsVars, errorEntries, evaluateDispatch, preDispatchNames, missingParagraphs)
```

- [ ] **Step 1.6: Run all server tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 1.7: Commit**

```bash
git add server/src/parser/cobolParser.js server/src/ai/orchestrator.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): PERFORM THRU range support and missing-paragraph logging"
```

---

## Task 2: Increase sub_paragraph overlap to 45 lines

**Context:** `CHUNK_OVERLAP = 20` at `server/src/parser/cobolParser.js:2` means context windows for large paragraphs overlap by only 20 lines (~6% of the 300-line window). For COBOL where an IF block can span 50+ lines, the second window may start mid-`IF` with no context. Change to 45 lines (~15% overlap — enough to capture open control structures).

**Files:**
- Modify: `server/src/parser/cobolParser.js:2`
- Modify: `server/tests/parser/cobolParser.test.js`

---

- [ ] **Step 2.1: Write a failing test for 45-line overlap**

In `server/tests/parser/cobolParser.test.js`, find the existing test for sub-chunks (around `splits large sections into sub-chunks`) and add:

```javascript
describe('splitIntoWindows overlap', () => {
  test('second window starts 45 lines before end of first window', () => {
    // Build a paragraph with 320 lines to force 2 windows
    const lines = Array.from({ length: 320 }, (_, i) => `    MOVE ${i} TO WS-X.`)
    const cobol = ` PROCEDURE DIVISION.\n LARGE-PARA.\n${lines.join('\n')}`
    const chunks = parseCobol(cobol)
    const subs = chunks.filter(c => c.chunk_type === 'sub_paragraph' || (c.chunk_type === 'paragraph' && c.chunk_name.includes('[')))
    // There should be exactly 2 chunks for LARGE-PARA
    const window1 = chunks.find(c => c.chunk_name === 'LARGE-PARA')
    const window2 = chunks.find(c => c.chunk_name === 'LARGE-PARA [2]')
    expect(window1).toBeDefined()
    expect(window2).toBeDefined()
    // window2 start_line should be window1 end_line - 45 + 1
    expect(window2.start_line).toBe(window1.end_line - 45 + 1)
  })
})
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/parser/cobolParser.test.js --reporter=verbose 2>&1 | grep -A5 "overlap"
```

Expected: FAIL — second window starts 20 lines before, not 45.

- [ ] **Step 2.3: Change CHUNK_OVERLAP from 20 to 45**

In `server/src/parser/cobolParser.js`, line 2:

Old:
```javascript
const CHUNK_OVERLAP = 20
```

New:
```javascript
const CHUNK_OVERLAP = 45
```

- [ ] **Step 2.4: Run test to confirm it passes**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/parser/cobolParser.test.js 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js
git commit -m "feat(parser): increase sub_paragraph overlap from 20 to 45 lines"
```

---

## Task 3: Cross-validate AI dbTables against structurally extracted tables

**Context:** `mapResult()` at `server/src/ai/orchestrator.js:140` blindly trusts `spec.dbTables` from the AI response. If the AI invents a table name not found in any `EXEC SQL` or TUX statement, it silently enters the database. Add `validateDbTables()` that flags unknown tables with `ai_hallucinated: true`. If no structural tables were found (empty known set), skip validation — we can't confidently call the AI wrong.

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

---

- [ ] **Step 3.1: Write failing tests for validateDbTables**

In `server/tests/ai/orchestrator.test.js`, add after the existing imports and before the first `describe`:

```javascript
import { validateDbTables } from '../../src/ai/orchestrator.js'

describe('validateDbTables', () => {
  test('flags table not in known set with ai_hallucinated: true', () => {
    const known = [{ table: 'CUSTOMER' }]
    const tux = []
    const result = validateDbTables(
      [{ table: 'CUSTOMER', operation: 'SELECT' }, { table: 'GHOST_TABLE', operation: 'INSERT' }],
      known, tux
    )
    expect(result[0].ai_hallucinated).toBeUndefined()
    expect(result[1].ai_hallucinated).toBe(true)
  })

  test('case-insensitive comparison', () => {
    const known = [{ table: 'customer_tbl' }]
    const result = validateDbTables([{ table: 'CUSTOMER_TBL', operation: 'SELECT' }], known, [])
    expect(result[0].ai_hallucinated).toBeUndefined()
  })

  test('skips validation when no structural tables found', () => {
    const result = validateDbTables([{ table: 'ANYTHING', operation: 'SELECT' }], [], [])
    expect(result[0].ai_hallucinated).toBeUndefined()
  })

  test('returns empty array when dbTables is empty', () => {
    expect(validateDbTables([], [{ table: 'X' }], [])).toEqual([])
  })
})
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/ai/orchestrator.test.js 2>&1 | tail -15
```

Expected: FAIL — `validateDbTables is not a function`.

- [ ] **Step 3.3: Add validateDbTables to orchestrator.js and wire into mapResult**

In `server/src/ai/orchestrator.js`:

1. Add the new function before `mapResult` (insert at line 139):

```javascript
export function validateDbTables(dbTables, execSqlTables, tuxTables) {
  const knownTables = new Set([
    ...execSqlTables.map(t => t.table?.toUpperCase()).filter(Boolean),
    ...tuxTables.map(t => t.table?.toUpperCase()).filter(Boolean),
  ])
  if (knownTables.size === 0) return dbTables
  return dbTables.map(t => {
    const name = t.table?.toUpperCase() ?? ''
    return name && !knownTables.has(name) ? { ...t, ai_hallucinated: true } : t
  })
}
```

2. Change `mapResult` signature to accept `execSqlTables` and `tuxTables`:

Old:
```javascript
function mapResult(spec, linkageVars, preDispatch = [], twoStep = false) {
```

New:
```javascript
function mapResult(spec, linkageVars, preDispatch = [], twoStep = false, execSqlTables = [], tuxTables = []) {
```

3. In `mapResult` body, change the `db_tables` line (currently `db_tables: spec.dbTables ?? []`):

Old:
```javascript
    db_tables: spec.dbTables ?? [],
```

New:
```javascript
    db_tables: validateDbTables(spec.dbTables ?? [], execSqlTables, tuxTables),
```

4. In `runAnalysis()`, update the two `mapResult` call sites to pass `execSqlTables` and `tuxTables`.

First call site (small file, around line 195):

Old:
```javascript
    return mapResult(spec, linkageVars, preDispatchNames, false)
```

New:
```javascript
    return mapResult(spec, linkageVars, preDispatchNames, false, execSqlTables, tuxTables)
```

Second call site (large file, at the end of `runAnalysis`, around line 237–241 where `mapResult` is called after two-step merge):

Old:
```javascript
  return mapResult(spec, linkageVars, preDispatchNames, true)
```

New:
```javascript
  return mapResult(spec, linkageVars, preDispatchNames, true, execSqlTables, tuxTables)
```

- [ ] **Step 3.4: Run tests to confirm they pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/ai/orchestrator.test.js 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 3.5: Run all server tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 3.6: Commit**

```bash
git add server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js
git commit -m "feat(orchestrator): cross-validate AI dbTables against structural extraction, flag hallucinated table names"
```

---

## Task 4: Cache structural analysis in programs table

**Context:** Every call to `runAnalysis()` in `server/src/ai/orchestrator.js:165` re-runs all regex-based structural extraction (`extractCalls`, `extractExecSql`, `extractTuxTables`, `extractPerformGraph`, etc.) from the raw COBOL text. For large files this is redundant on re-analysis. Cache the extracted structural data as JSONB in `programs.structural_cache` after the first analysis. On re-analysis, restore from cache and skip extraction. `performGraph` (a `Map<string, Set<string>>`) requires custom serialization.

**Files:**
- Modify: `server/src/db/schema.sql`
- Modify: `server/src/models/programs.js`
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/src/services/analysisService.js`

---

- [ ] **Step 4.1: Write tests for serialization helpers**

In `server/tests/ai/orchestrator.test.js`, add:

```javascript
import { serializePerformGraph, deserializePerformGraph } from '../../src/ai/orchestrator.js'

describe('serializePerformGraph / deserializePerformGraph', () => {
  test('round-trips a Map<string, Set<string>>', () => {
    const original = new Map([
      ['MAIN', new Set(['INIT', 'CLEANUP'])],
      ['INIT', new Set(['SUB-A'])],
      ['CLEANUP', new Set()],
    ])
    const serialized = serializePerformGraph(original)
    expect(typeof serialized).toBe('object')
    expect(Array.isArray(serialized['MAIN'])).toBe(true)
    expect(serialized['MAIN']).toContain('INIT')

    const restored = deserializePerformGraph(serialized)
    expect(restored).toBeInstanceOf(Map)
    expect(restored.get('MAIN')).toBeInstanceOf(Set)
    expect(restored.get('MAIN').has('INIT')).toBe(true)
    expect(restored.get('CLEANUP').size).toBe(0)
  })
})
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/ai/orchestrator.test.js 2>&1 | grep -A3 "serializePerformGraph"
```

Expected: FAIL — `serializePerformGraph is not a function`.

- [ ] **Step 4.3: Add serialization helpers to orchestrator.js**

In `server/src/ai/orchestrator.js`, add these two functions near the top (after the `const TOKEN_LIMIT` constants, before `buildStructural`):

```javascript
export function serializePerformGraph(graph) {
  return Object.fromEntries([...graph.entries()].map(([k, v]) => [k, [...v]]))
}

export function deserializePerformGraph(obj) {
  return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]))
}
```

- [ ] **Step 4.4: Run test to confirm it passes**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/ai/orchestrator.test.js 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4.5: Add migration for structural_cache column**

In `server/src/db/schema.sql`, append at the end of the file:

```sql
-- Structural analysis cache: avoids re-running regex extraction on re-analysis
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS structural_cache JSONB;
```

Run the migration:

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
node src/db/migrate.js
```

Expected output: migration runs without error.

- [ ] **Step 4.6: Add saveStructuralCache to programs model**

In `server/src/models/programs.js`, append at the end of the file:

```javascript
export async function saveStructuralCache(id, cache) {
  await pool.query(
    'UPDATE programs SET structural_cache = $1, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(cache), id]
  )
}
```

- [ ] **Step 4.7: Refactor runAnalysis to accept and return structural cache**

In `server/src/ai/orchestrator.js`, modify `runAnalysis`:

1. Add `structuralCacheIn = null` to the destructured parameter:

Old:
```javascript
export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal }) {
```

New:
```javascript
export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal, structuralCacheIn = null }) {
```

2. Replace the structural extraction block (lines 166–179, all the `const linkageVars = ...` through `const preDispatchNames = ...`) with a conditional:

```javascript
  const paragraphChunks = chunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')

  let linkageVars, wsVars, calls, execSqlTables, constructs, selectFiles, tuxTables, errorEntries, evaluateDispatch, performGraph, preDispatchNames, missingParagraphs

  if (structuralCacheIn) {
    linkageVars      = structuralCacheIn.linkageVars
    wsVars           = structuralCacheIn.wsVars
    calls            = structuralCacheIn.calls
    execSqlTables    = structuralCacheIn.execSqlTables
    constructs       = structuralCacheIn.constructs
    selectFiles      = structuralCacheIn.selectFiles
    tuxTables        = structuralCacheIn.tuxTables
    errorEntries     = structuralCacheIn.errorEntries
    evaluateDispatch = structuralCacheIn.evaluateDispatch
    preDispatchNames = structuralCacheIn.preDispatchNames
    performGraph     = deserializePerformGraph(structuralCacheIn.performGraph)
    missingParagraphs = new Set(structuralCacheIn.missingParagraphs ?? [])
  } else {
    linkageVars      = extractLinkageVars(cobolText)
    wsVars           = extractWorkingStorage(cobolText)
    calls            = extractCalls(cobolText)
    execSqlTables    = extractExecSql(cobolText)
    constructs       = extractConstructs(cobolText)
    selectFiles      = extractSelectFiles(cobolText)
    tuxTables        = extractTuxTables(cobolText)
    errorEntries     = extractErrorEntries(cobolText)
    evaluateDispatch = extractEvaluateDispatch(cobolText)
    performGraph     = extractPerformGraph(paragraphChunks)
    preDispatchNames = findPreDispatchParagraphs(paragraphChunks)
    missingParagraphs = collectMissingParagraphs(performGraph)
  }
```

3. At the end of `runAnalysis`, before the final `return mapResult(...)` calls, compute `newStructuralCache` and include it in both return paths. Change both `return mapResult(...)` statements to return an object:

For the small-file path (was `return mapResult(spec, linkageVars, preDispatchNames, false, execSqlTables, tuxTables)`):

```javascript
    const result = mapResult(spec, linkageVars, preDispatchNames, false, execSqlTables, tuxTables)
    const structuralCache = structuralCacheIn ?? {
      linkageVars, wsVars, calls, execSqlTables, constructs, selectFiles,
      tuxTables, errorEntries, evaluateDispatch, preDispatchNames,
      missingParagraphs: [...missingParagraphs],
      performGraph: serializePerformGraph(performGraph),
    }
    return { result, structuralCache }
```

For the large-file path at the end (was `return mapResult(spec, linkageVars, preDispatchNames, true, execSqlTables, tuxTables)`):

```javascript
  const result = mapResult(spec, linkageVars, preDispatchNames, true, execSqlTables, tuxTables)
  const structuralCache = structuralCacheIn ?? {
    linkageVars, wsVars, calls, execSqlTables, constructs, selectFiles,
    tuxTables, errorEntries, evaluateDispatch, preDispatchNames,
    missingParagraphs: [...missingParagraphs],
    performGraph: serializePerformGraph(performGraph),
  }
  return { result, structuralCache }
```

- [ ] **Step 4.8: Update analysisService.js to use the new return shape**

In `server/src/services/analysisService.js`, update `runAnalysisCore`:

1. Add `saveStructuralCache` to the imports from programs model:

Old:
```javascript
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath, updateProgramApplicationId, deleteProgramById, deleteOrphanedPhantoms } from '../models/programs.js'
```

New:
```javascript
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath, updateProgramApplicationId, deleteProgramById, deleteOrphanedPhantoms, saveStructuralCache } from '../models/programs.js'
```

2. In `runAnalysisCore`, in the `else` branch for COBOL files (around line 52), change:

Old:
```javascript
      result = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName, signal: controller.signal })
```

New:
```javascript
      const structuralCacheIn = program.structural_cache ?? null
      const analysis = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName, signal: controller.signal, structuralCacheIn })
      result = analysis.result
      if (!structuralCacheIn) {
        await saveStructuralCache(programId, analysis.structuralCache)
      }
```

- [ ] **Step 4.9: Run all server tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS. If any test mocks `runAnalysis` and checks the return shape, update the mock to return `{ result: MOCK_RESULT, structuralCache: {} }`.

- [ ] **Step 4.10: Commit**

```bash
git add server/src/db/schema.sql server/src/models/programs.js server/src/ai/orchestrator.js server/src/services/analysisService.js server/tests/ai/orchestrator.test.js
git commit -m "feat(orchestrator): cache structural analysis in programs.structural_cache, skip re-extraction on re-analysis"
```

---

## Task 5: program_calls table for inter-program dependency graph

**Context:** `program_edges` exists for graph visualization but lacks a queryable dependency model. There's no way to ask "which programs call ARCUSACS?" or build a reverse-dependency graph. New table `program_calls` mirrors call relationships derived from structural `extractCalls()` (all CALLs, not AI-filtered), with FK constraints and an API endpoint for reverse lookups.

**Files:**
- Modify: `server/src/db/schema.sql`
- Create: `server/src/models/programCalls.js`
- Modify: `server/src/services/graphService.js`
- Modify: `server/src/services/analysisService.js`
- Modify: `server/src/routes/programs.js`
- Modify: `server/tests/services/graphService.test.js`

---

- [ ] **Step 5.1: Write failing tests for programCalls model and graphService**

In `server/tests/services/graphService.test.js`, check the existing test structure and add:

```javascript
import { getCallersOf, getCallsFromProgram } from '../../src/models/programCalls.js'

describe('programCalls model', () => {
  // These tests require a real DB — skip if no DB_URL env
  const skip = !process.env.DATABASE_URL

  test.skipIf(skip)('getCallsFromProgram returns empty array for program with no calls', async () => {
    // Uses a fake UUID that won't exist in DB
    const calls = await getCallsFromProgram('00000000-0000-0000-0000-000000000000')
    expect(Array.isArray(calls)).toBe(true)
    expect(calls.length).toBe(0)
  })

  test.skipIf(skip)('getCallersOf returns empty array for unknown callee', async () => {
    const callers = await getCallersOf('NONEXISTENT_PROGRAM_XYZ')
    expect(Array.isArray(callers)).toBe(true)
    expect(callers.length).toBe(0)
  })
})
```

- [ ] **Step 5.2: Run test to confirm it fails**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/services/graphService.test.js 2>&1 | tail -15
```

Expected: FAIL — `getCallersOf` / `getCallsFromProgram` not exported from `programCalls.js` (file doesn't exist yet).

- [ ] **Step 5.3: Add migration for program_calls table**

In `server/src/db/schema.sql`, append:

```sql
-- Inter-program call dependency table (from structural extraction, not AI-filtered)
CREATE TABLE IF NOT EXISTS program_calls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  callee_name       TEXT NOT NULL,
  callee_program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  call_context      TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (caller_program_id, callee_name)
);
```

Run migration:

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
node src/db/migrate.js
```

Expected: no error.

- [ ] **Step 5.4: Create programCalls.js model**

Create `server/src/models/programCalls.js`:

```javascript
import pool from '../db/client.js'

export async function upsertCall({ caller_program_id, callee_name, callee_program_id = null, call_context = '' }) {
  await pool.query(
    `INSERT INTO program_calls (caller_program_id, callee_name, callee_program_id, call_context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (caller_program_id, callee_name) DO UPDATE
       SET callee_program_id = EXCLUDED.callee_program_id`,
    [caller_program_id, callee_name, callee_program_id, call_context]
  )
}

export async function getCallsFromProgram(programId) {
  const { rows } = await pool.query(
    `SELECT callee_name, callee_program_id, call_context
     FROM program_calls WHERE caller_program_id = $1
     ORDER BY callee_name`,
    [programId]
  )
  return rows
}

export async function getCallersOf(calleeName) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, pc.call_context
     FROM program_calls pc
     JOIN programs p ON p.id = pc.caller_program_id
     WHERE pc.callee_name = $1
     ORDER BY p.name`,
    [calleeName.toUpperCase()]
  )
  return rows
}

export async function backfillCallTargets(callee_name, callee_id) {
  await pool.query(
    `UPDATE program_calls SET callee_program_id = $1
     WHERE callee_name = $2 AND callee_program_id IS NULL`,
    [callee_id, callee_name]
  )
}
```

- [ ] **Step 5.5: Run tests to confirm they pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run tests/services/graphService.test.js 2>&1 | tail -15
```

Expected: PASS (or SKIP if no DATABASE_URL, which is expected in unit-test environments).

- [ ] **Step 5.6: Wire upsertCall into graphService.js**

In `server/src/services/graphService.js`, add import at the top:

```javascript
import { upsertCall, backfillCallTargets } from '../models/programCalls.js'
```

In `updateGraphAfterAnalysis`, after the existing `upsertEdge(...)` call (inside the for loop), add:

```javascript
    await upsertCall({
      caller_program_id: fromProgramId,
      callee_name: name,
      callee_program_id: targetId,
      call_context: call.using ?? '',
    })
```

In `backfillEdgesForNewProgram`, after the existing `backfillPhantomEdges(...)` call, add:

```javascript
  await backfillCallTargets(program.name, program.id)
```

- [ ] **Step 5.7: Populate program_calls from structural extractCalls in analysisService.js**

The existing `updateGraphAfterAnalysis` is called with AI-filtered `external_dependencies` (excludes `C_*` utilities). To have a complete call record, also insert from the structural `extractCalls()` result.

In `server/src/services/analysisService.js`:

1. Add import at the top:

```javascript
import { extractCalls } from '../parser/cobolExtractor.js'
```

2. In `runAnalysisCore`, after the line `await updateGraphAfterAnalysis(...)` (currently line 59), add:

```javascript
    const allCalls = extractCalls(cobolText)
    for (const call of allCalls) {
      const name = call.program?.toUpperCase()
      if (!name) continue
      const target = await findProgramByName(name)
      const { upsertCall } = await import('../models/programCalls.js')
      await upsertCall({
        caller_program_id: programId,
        callee_name: name,
        callee_program_id: target?.id ?? null,
        call_context: call.using ?? '',
      })
    }
```

- [ ] **Step 5.8: Add GET /api/programs/callers/:name endpoint**

Find `server/src/routes/programs.js`. Add the following route (place it before or after the existing routes for `/api/programs/:id`):

```javascript
import { getCallersOf } from '../models/programCalls.js'

// GET /api/programs/callers/:name — returns all programs that CALL the given program name
router.get('/callers/:name', async (req, res) => {
  try {
    const callers = await getCallersOf(req.params.name)
    res.json({ callers })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

Note: place this route BEFORE any `router.get('/:id', ...)` route to prevent `callers` from being matched as an ID.

- [ ] **Step 5.9: Run all server tests**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server
npx vitest run 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5.10: Commit**

```bash
git add server/src/db/schema.sql server/src/models/programCalls.js server/src/services/graphService.js server/src/services/analysisService.js server/src/routes/programs.js server/tests/services/graphService.test.js
git commit -m "feat(graph): add program_calls table for structural inter-program dependency tracking and reverse-lookup API"
```

---

## Self-Review

**Spec coverage:**
- [x] Task 1 — PERFORM THRU range expansion + dynamic PERFORM logging via `collectMissingParagraphs`
- [x] Task 2 — Overlap increased from 20 to 45 lines
- [x] Task 3 — `validateDbTables` cross-validates against `execSqlTables + tuxTables`, flags `ai_hallucinated: true`
- [x] Task 4 — `structural_cache JSONB` added to `programs`, `runAnalysis` skips re-extraction on second run
- [x] Task 5 — `program_calls` table, `getCallersOf` query, backfill on new program upload, API endpoint

**Potential gaps:**
- Task 4: If an existing orchestrator test mocks `runAnalysis` and checks its return value, the test will need to be updated to destructure `{ result }` from the return. Step 4.9 notes this.
- Task 5, Step 5.7: `upsertCall` is dynamically imported inside the loop — move the import to the top of the file before merging to avoid repeated dynamic imports.
- Task 3: The `validateDbTables` function is exported. Make sure it's added to the export list, not just defined inside the module (it's currently written as `export function validateDbTables`).

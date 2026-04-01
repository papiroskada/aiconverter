# Analysis Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-chunk AI analysis pipeline with deterministic extraction + single AI call per file — eliminating JSON truncation errors and reducing token cost ~16x.

**Architecture:** `cobolParser.js` gains four extraction functions (linkage, calls, EXEC SQL, constructs). A new `INTERFACE_PROMPT` replaces all previous prompts except `DIAGRAM_PROMPT`. The orchestrator runs: extract → one AI call → store sections to chunks → diagram. `analysisService.js` wires the new orchestrator output to existing DB models.

**Tech Stack:** Node.js ESM, PostgreSQL, vitest, existing OpenAI/Claude providers

**Spec:** `docs/superpowers/specs/2026-03-25-analysis-pipeline-redesign.md`

---

## File Map

| File | What changes |
|---|---|
| `server/src/parser/cobolParser.js` | Add 4 exported extraction functions |
| `server/src/ai/prompts.js` | Remove 4 old prompts, add `INTERFACE_PROMPT` |
| `server/src/ai/providers/base.js` | Remove 3 old methods, add `extractInterface()` |
| `server/src/ai/providers/openai.js` | Same |
| `server/src/ai/providers/claude.js` | Same |
| `server/src/ai/orchestrator.js` | Full rewrite |
| `server/src/models/programChunks.js` | Add `updateChunkPurpose`, remove 3 unused functions |
| `server/src/services/analysisService.js` | Update `runAnalysisInBackground` and `reanalyze` |
| `server/tests/parser/cobolParser.test.js` | Add tests for 4 new functions |
| `server/tests/ai/orchestrator.test.js` | Rewrite for new pipeline |

---

## Task 1: Parser extraction functions

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

### Background for implementer

`cobolParser.js` already has `detectFixedFormat(lines)` and `stripSequenceNumber(line)` helpers. Fixed-format COBOL has 6-character sequence numbers at the start of each line that must be stripped before regex matching. The `parseCobol` export and all existing chunk logic must remain untouched.

---

- [ ] **Step 1: Write failing tests for `extractLinkage`**

Add to `server/tests/parser/cobolParser.test.js`:

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs } from '../../src/parser/cobolParser.js'

describe('extractLinkage', () => {
  it('returns empty string when no LINKAGE SECTION', () => {
    expect(extractLinkage('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toBe('')
  })

  it('extracts LINKAGE SECTION up to PROCEDURE DIVISION', () => {
    const src = `
 DATA DIVISION.
 LINKAGE SECTION.
 01 PARAM PIC X(8).
 PROCEDURE DIVISION USING PARAM.
 MAIN.
   STOP RUN.`.trim()
    const result = extractLinkage(src)
    expect(result).toContain('LINKAGE SECTION')
    expect(result).toContain('PARAM PIC X(8)')
    expect(result).not.toContain('PROCEDURE DIVISION')
  })

  it('stops at WORKING-STORAGE SECTION if it comes before PROCEDURE DIVISION', () => {
    const src = `LINKAGE SECTION.\n 01 A PIC X.\nWORKING-STORAGE SECTION.\n 01 B PIC X.`
    const result = extractLinkage(src)
    expect(result).toContain('01 A')
    expect(result).not.toContain('01 B')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

Expected: `extractLinkage is not a function`

- [ ] **Step 3: Implement `extractLinkage`**

Add at the bottom of `server/src/parser/cobolParser.js` (before the final blank line):

```js
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
```

- [ ] **Step 4: Run — expect PASS for extractLinkage tests**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

---

- [ ] **Step 5: Write failing tests for `extractCalls`**

Add to the same test file:

```js
describe('extractCalls', () => {
  it('returns empty array when no CALL statements', () => {
    expect(extractCalls('PROCEDURE DIVISION.\n PARA.\n   MOVE A TO B.')).toEqual([])
  })

  it('extracts CALL with USING', () => {
    const src = `PROCEDURE DIVISION.\n PARA.\n   CALL 'C_BEGCOM' USING WBCR-VARS.`
    const result = extractCalls(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ program: 'C_BEGCOM', using: 'WBCR-VARS' })
  })

  it('extracts CALL without USING', () => {
    const src = `PROCEDURE DIVISION.\n PARA.\n   CALL 'SYS-UTIL'.`
    const result = extractCalls(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ program: 'SYS-UTIL', using: null })
  })

  it('normalises program name to uppercase', () => {
    const src = `CALL 'getuser' USING WGET-USR-INFO.`
    expect(extractCalls(src)[0].program).toBe('GETUSER')
  })

  it('deduplicates calls to the same program', () => {
    const src = `CALL 'PROG-A' USING P1.\nCALL 'PROG-A' USING P2.\nCALL 'PROG-B' USING P3.`
    const result = extractCalls(src)
    expect(result.filter(c => c.program === 'PROG-A')).toHaveLength(1)
    expect(result.filter(c => c.program === 'PROG-B')).toHaveLength(1)
  })

  it('strips trailing punctuation from using value', () => {
    const src = `CALL 'PROG' USING PARAM-A,`
    const result = extractCalls(src)
    expect(result[0].using).toBe('PARAM-A')
  })
})
```

- [ ] **Step 6: Run — expect FAIL**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

- [ ] **Step 7: Implement `extractCalls`**

```js
export function extractCalls(cobolText) {
  const lines = cobolText.split('\n')
  const fixedFormat = detectFixedFormat(lines)
  const seen = new Set()
  const calls = []

  for (const line of lines) {
    const parsed = fixedFormat ? stripSequenceNumber(line) : line
    const match = parsed.match(/CALL\s+['"]([^'"]+)['"]\s*(?:USING\s+(\S+?))?(?:\s|,|;|$)/i)
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
```

- [ ] **Step 8: Run — expect PASS for extractCalls tests**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

---

- [ ] **Step 9: Write failing tests for `extractExecSql`**

```js
describe('extractExecSql', () => {
  it('returns empty array when no EXEC SQL', () => {
    expect(extractExecSql('PROCEDURE DIVISION.\n PARA.\n   MOVE A TO B.')).toEqual([])
  })

  it('extracts SELECT table', () => {
    const src = `EXEC SQL\n  SELECT USR_ID FROM USER_TABLE\nEND-EXEC.`
    const result = extractExecSql(src)
    expect(result).toHaveLength(1)
    expect(result[0].table).toBe('USER_TABLE')
    expect(result[0].operation).toBe('SELECT')
  })

  it('extracts INSERT INTO table', () => {
    const src = `EXEC SQL INSERT INTO LOG_TABLE (COL1) VALUES (:V1) END-EXEC.`
    const result = extractExecSql(src)
    expect(result[0].table).toBe('LOG_TABLE')
    expect(result[0].operation).toBe('INSERT')
  })

  it('merges operations for the same table', () => {
    const src = `EXEC SQL SELECT A FROM ORDERS END-EXEC.\nEXEC SQL UPDATE ORDERS SET A=1 END-EXEC.`
    const result = extractExecSql(src)
    expect(result).toHaveLength(1)
    expect(result[0].operation).toContain('SELECT')
    expect(result[0].operation).toContain('UPDATE')
  })
})
```

- [ ] **Step 10: Run — expect FAIL**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

- [ ] **Step 11: Implement `extractExecSql`**

```js
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
```

- [ ] **Step 12: Run — expect PASS for extractExecSql tests**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

---

- [ ] **Step 13: Write failing tests for `extractConstructs`**

```js
describe('extractConstructs', () => {
  it('returns empty array for empty source', () => {
    expect(extractConstructs('')).toEqual([])
  })

  it('detects PERFORM and IF', () => {
    const src = `PARA.\n  PERFORM OTHER-PARA.\n  IF X > 0 MOVE 1 TO Y.`
    const result = extractConstructs(src)
    expect(result).toContain('PERFORM')
    expect(result).toContain('IF')
  })

  it('does not false-positive on partial word match', () => {
    // PERFORM embedded in SUPERFORM — should not match
    const src = `01 SUPERFORM PIC X.`
    expect(extractConstructs(src)).not.toContain('PERFORM')
  })
})
```

- [ ] **Step 14: Run — expect FAIL**

```bash
cd server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -15
```

- [ ] **Step 15: Implement `extractConstructs`**

```js
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
```

- [ ] **Step 16: Run all tests — expect all passing**

```bash
cd server && npm test 2>&1 | tail -10
```

- [ ] **Step 17: Commit**

```bash
cd server && git add src/parser/cobolParser.js tests/parser/cobolParser.test.js
git commit -m "feat: add deterministic COBOL extraction functions (linkage, calls, sql, constructs)"
```

---

## Task 2: Replace prompts

**Files:**
- Modify: `server/src/ai/prompts.js`

Remove `METADATA_PROMPT`, `CHUNK_PROMPT`, `DATA_PROMPT`, `SYNTHESIS_PROMPT`. Add `INTERFACE_PROMPT`. Keep `DIAGRAM_PROMPT` unchanged.

- [ ] **Step 1: Replace `server/src/ai/prompts.js` entirely**

```js
export const INTERFACE_PROMPT = (context) => `
You are a COBOL expert analysing a program for documentation and JavaScript rewrite.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "programType": "subroutine",
  "description": "2-3 factual sentences: what the program receives, what it does, what external programs or files it uses. No filler phrases.",
  "flow_narrative": "5-8 sentences describing execution from entry to exit in plain English, including main branches and error paths.",
  "parameters": [
    { "name": "camelCaseName", "cobolName": "ORIGINAL-COBOL-NAME", "type": "string|number|boolean|object", "direction": "in|out|inout" }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ],
  "externalCalls": [
    { "program": "program-name", "using": "PARAM-NAME-OR-NULL" }
  ],
  "dbTables": [
    { "table": "TABLE-NAME", "operation": "SELECT|INSERT|UPDATE|DELETE", "fields": ["FIELD-NAME"] }
  ],
  "sections": [
    { "name": "PARAGRAPH-NAME", "purpose": "one sentence in plain business English" }
  ]
}

programType values: "subroutine" (has LINKAGE SECTION / USING parameters), "batch" (reads/writes files via FILE SECTION), "transaction" (uses ACCEPT/DISPLAY for user interaction), "unknown".
parameters: extract from LINKAGE SECTION. direction — "in": read-only input, "out": filled by this program, "inout": passed in and modified.
externalCalls: list every CALL statement from the context. "using" is the first USING parameter, or null if none.
dbTables: confirm and enrich the SQL tables listed in the context. Return [] if none.
sections: cover EVERY paragraph listed in the context. One plain-English sentence per paragraph.
`

export const DIAGRAM_PROMPT = (summary) => `
You are analyzing a COBOL business application.
Based on the following program summary, create a Mermaid flowchart of the business logic flow.

Rules:
- Use flowchart TD syntax
- Maximum 15 nodes
- Show business events and decisions only — no COBOL variable names, no technical internals
- Use plain business language (e.g. "Validate Customer" not "PERFORM VALIDATE-CUST-PARA")
- Return ONLY the Mermaid code — no explanation, no markdown fences

PROGRAM SUMMARY:
${summary}
`
```

- [ ] **Step 2: Run tests — expect failures (providers import removed prompts)**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: import errors in provider tests referencing old prompt names.

- [ ] **Step 3: Commit**

```bash
cd server && git add src/ai/prompts.js
git commit -m "feat: replace analysis prompts with single INTERFACE_PROMPT"
```

---

## Task 3: Update AI providers

**Files:**
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/openai.js`
- Modify: `server/src/ai/providers/claude.js`

Remove `extractMetadata`, `analyzeChunk`, `analyzeData`, `synthesize`. Add `extractInterface`. Keep `generateDiagram`.

- [ ] **Step 1: Replace `server/src/ai/providers/base.js`**

```js
export class BaseProvider {
  async extractInterface(context) {
    throw new Error('Not implemented')
  }

  async generateDiagram(summary) {
    throw new Error('Not implemented')
  }
}

export async function getProvider() {
  const name = process.env.AI_PROVIDER || 'claude'
  if (name === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider()
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider()
}
```

- [ ] **Step 2: Replace `server/src/ai/providers/openai.js`**

```js
import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  async #callOpenAI(prompt, maxTokens = 4096) {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractInterface(context) {
    return this.#callOpenAI(INTERFACE_PROMPT(context), 4096)
  }

  async generateDiagram(summary) {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return completion.choices[0].message.content.trim()
  }
}
```

- [ ] **Step 3: Replace `server/src/ai/providers/claude.js`**

```js
import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async #callClaude(prompt, maxTokens = 4096) {
    const message = await this.client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractInterface(context) {
    return this.#callClaude(INTERFACE_PROMPT(context), 4096)
  }

  async generateDiagram(summary) {
    const message = await this.client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return message.content[0].text.trim()
  }
}
```

- [ ] **Step 4: Run tests — note which still fail (orchestrator tests will fail)**

```bash
cd server && npm test 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
cd server && git add src/ai/providers/base.js src/ai/providers/openai.js src/ai/providers/claude.js
git commit -m "feat: update AI providers — extractInterface replaces old per-chunk methods"
```

---

## Task 4: Update programChunks model

**Files:**
- Modify: `server/src/models/programChunks.js`

Add `updateChunkPurpose`. Remove `getRetryableChunks`, `updateChunkAnalysis`, `markChunkFailed` (no longer called anywhere).

- [ ] **Step 1: Replace `server/src/models/programChunks.js`**

```js
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

export async function updateChunkPurpose(id, purpose) {
  await pool.query(
    `UPDATE program_chunks SET analysis = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ purpose }), id]
  )
}
```

- [ ] **Step 2: Run tests — expect all still passing (removed functions were not tested)**

```bash
cd server && npm test 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
cd server && git add src/models/programChunks.js
git commit -m "feat: add updateChunkPurpose, remove unused chunk analysis functions"
```

---

## Task 5: Rewrite orchestrator

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

This is the core of the redesign. The new orchestrator:
1. Builds context from deterministic extraction + paragraph snippets
2. Calls `provider.extractInterface(context)` once
3. Maps AI output to storage shape
4. Calls `provider.generateDiagram(flow_narrative)`

- [ ] **Step 1: Write failing orchestrator tests**

Replace the entire content of `server/tests/ai/orchestrator.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractInterface', async () => {
    await expect(new BaseProvider().extractInterface('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on generateDiagram', async () => {
    await expect(new BaseProvider().generateDiagram('')).rejects.toThrow('Not implemented')
  })
})

const makeProvider = (overrides = {}) => ({
  extractInterface: vi.fn().mockResolvedValue({
    programType: 'subroutine',
    description: 'Test program description.',
    flow_narrative: 'Entry → process → exit.',
    parameters: [{ name: 'userInfo', cobolName: 'WGET-USR-INFO', type: 'object', direction: 'inout' }],
    fileIO: [{ file: 'USR-FILE', operations: ['READ', 'WRITE'] }],
    externalCalls: [{ program: 'C_BEGCOM', using: 'WBCR-VARS' }],
    dbTables: [{ table: 'USER_TABLE', operation: 'SELECT', fields: ['USR_ID'] }],
    sections: [{ name: 'MAIN-LOGIC', purpose: 'Initialises and runs main flow' }],
  }),
  generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A --> B'),
  ...overrides,
})

const makeChunks = () => [
  { id: 'c1', chunk_name: 'MAIN-LOGIC', chunk_type: 'paragraph', cobol_text: 'MAIN-LOGIC.\n   PERFORM INIT.\n   STOP RUN.' },
  { id: 'c2', chunk_name: 'WORKING-STORAGE', chunk_type: 'data_summary', cobol_text: '01 WS-VAR PIC X.' },
]

describe('runAnalysis', () => {
  it('calls extractInterface once with context string', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: 'PROCEDURE DIVISION.', chunks: makeChunks(), provider, emit: () => {}, programName: 'TEST' })
    expect(provider.extractInterface).toHaveBeenCalledTimes(1)
    expect(typeof provider.extractInterface.mock.calls[0][0]).toBe('string')
  })

  it('does NOT call analyzeChunk or synthesize (old methods removed)', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.analyzeChunk).toBeUndefined()
    expect(provider.synthesize).toBeUndefined()
  })

  it('calls generateDiagram with flow_narrative', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.generateDiagram).toHaveBeenCalledWith('Entry → process → exit.')
  })

  it('returns description and flow_narrative from interface spec', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.description).toBe('Test program description.')
    expect(result.flow_narrative).toBe('Entry → process → exit.')
  })

  it('maps externalCalls to snake_case external_calls with empty string for null using', async () => {
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        ...makeProvider().extractInterface.mock.results?.[0]?.value ?? {},
        externalCalls: [
          { program: 'PROG-A', using: 'PARAM-1' },
          { program: 'PROG-B', using: null },
        ],
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], dbTables: [], sections: [],
      }),
    })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.external_calls).toEqual([
      { program: 'PROG-A', using: 'PARAM-1' },
      { program: 'PROG-B', using: '' },
    ])
  })

  it('returns sections array for chunk purpose mapping', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.sections).toEqual([{ name: 'MAIN-LOGIC', purpose: 'Initialises and runs main flow' }])
  })

  it('context includes only paragraph/sub_paragraph chunks as snippets (not data_summary)', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    expect(context).toContain('MAIN-LOGIC')
    expect(context).not.toContain('WORKING-STORAGE')
  })

  it('diagram failure is non-fatal — result.diagram is null', async () => {
    const provider = makeProvider({ generateDiagram: vi.fn().mockRejectedValue(new Error('timeout')) })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.diagram).toBeNull()
  })

  it('emits progress events for interface and diagram stages', async () => {
    const provider = makeProvider()
    const events = []
    const emit = (e, d) => events.push({ e, d })
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit, programName: 'T' })
    const stages = events.map(ev => ev.d?.stage)
    expect(stages).toContain('interface')
    expect(stages).toContain('diagram')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd server && npm test tests/ai/orchestrator.test.js 2>&1 | tail -20
```

- [ ] **Step 3: Write the new orchestrator**

Replace the entire content of `server/src/ai/orchestrator.js`:

```js
import { logger } from '../logger.js'
import { extractLinkage, extractCalls, extractExecSql, extractConstructs } from '../parser/cobolParser.js'

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

function buildInterfaceContext(linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs) {
  const paragraphList = paragraphChunks
    .map(c => {
      const snippet = c.cobol_text.split('\n').slice(0, 5).join('\n')
      return `[${c.chunk_name}]\n${snippet}`
    })
    .join('\n\n')

  const callList = calls.map(c =>
    `  CALL '${c.program}'${c.using ? ` USING ${c.using}` : ''}`
  ).join('\n') || '  (none)'

  const fileList = selectFiles.join('\n') || '  (none)'

  const sqlList = execSqlTables.map(t =>
    `  ${t.table}: ${t.operation}`
  ).join('\n') || '  (none)'

  return [
    `LINKAGE SECTION:\n${linkage || '(none)'}`,
    `PARAGRAPHS (name + first 5 lines):\n${paragraphList || '(none)'}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
  ].join('\n\n')
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName }) {
  const paragraphChunks = chunks.filter(
    c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph'
  )

  // Step 1: Interface spec (single AI call)
  const ti = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'interface', message: 'Analysing interface...' })

  const linkage = extractLinkage(cobolText)
  const calls = extractCalls(cobolText)
  const execSqlTables = extractExecSql(cobolText)
  const constructs = extractConstructs(cobolText)
  const selectFiles = extractSelectFiles(cobolText)

  const context = buildInterfaceContext(linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs)
  const spec = await provider.extractInterface(context)

  logAndEmit(emit, programName, 'done', {
    stage: 'interface', message: 'Interface done', durationMs: Date.now() - ti,
  })

  // Map to storage shape (camelCase → snake_case, null using → '')
  const external_calls = (spec.externalCalls ?? []).map(c => ({
    program: c.program,
    using: c.using ?? '',
  }))
  const db_tables = spec.dbTables ?? []
  const file_ops = (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations }))
  const input_contract = JSON.stringify(
    (spec.parameters ?? []).filter(p => p.direction !== 'out')
  )
  const output_contract = JSON.stringify(
    (spec.parameters ?? []).filter(p => p.direction !== 'in')
  )

  // Step 2: Diagram
  const td = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'diagram', message: 'Generating diagram...' })
  let diagram = null
  try {
    diagram = await provider.generateDiagram(spec.flow_narrative ?? spec.description ?? '')
    logAndEmit(emit, programName, 'done', { stage: 'diagram', message: 'Diagram done', durationMs: Date.now() - td })
  } catch (err) {
    logAndEmit(emit, programName, 'error', {
      stage: 'diagram', message: `Diagram failed: ${err.message}`, durationMs: Date.now() - td,
    })
  }

  return {
    description: spec.description ?? '',
    flow_narrative: spec.flow_narrative ?? '',
    input_contract,
    output_contract,
    external_calls,
    db_tables,
    file_ops,
    sections: spec.sections ?? [],
    diagram,
  }
}
```

- [ ] **Step 4: Run orchestrator tests — expect PASS**

```bash
cd server && npm test tests/ai/orchestrator.test.js 2>&1 | tail -15
```

- [ ] **Step 5: Run all tests**

```bash
cd server && npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
cd server && git add src/ai/orchestrator.js tests/ai/orchestrator.test.js
git commit -m "feat: rewrite orchestrator — deterministic extraction + single interface AI call"
```

---

## Task 6: Update analysisService

**Files:**
- Modify: `server/src/services/analysisService.js`

Update `runAnalysisInBackground` to use the new orchestrator output. Update `reanalyze` to stop using `getRetryableChunks`. Remove unused imports.

- [ ] **Step 1: Replace `server/src/services/analysisService.js`**

```js
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { logger } from '../logger.js'
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath, deleteProgramById, deleteOrphanedPhantoms } from '../models/programs.js'
import { upsertAnalysis, updateDiagram, updateAnalysisFields } from '../models/programAnalysis.js'
import { insertChunks, getChunksByProgramId, updateChunkPurpose } from '../models/programChunks.js'
import { backfillEdgesForNewProgram, updateGraphAfterAnalysis } from './graphService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

function makeEmit(programId, sseEmitters) {
  return (event, data) => {
    const emitters = sseEmitters.get(programId) || []
    for (const res of emitters) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }
}

export async function uploadAndStartAnalysis(file, sseEmitters) {
  mkdirSync(UPLOADS_DIR, { recursive: true })

  const cobolText = file.buffer.toString('utf8')
  const programName = file.originalname.replace(/\.cbl$/i, '').toUpperCase()

  let program = await findProgramByName(programName)
  if (!program) {
    program = await createProgram({ name: programName, status: 'analyzing' })
  } else {
    if (program.status === 'analyzing') {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
  }

  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  writeFileSync(filePath, cobolText)
  await updateFilePath(program.id, filePath)

  await backfillEdgesForNewProgram(program)

  const emit = makeEmit(program.id, sseEmitters)

  const t0 = Date.now()
  logger.start(programName, 'Parsing COBOL file...')
  emit('progress', { stage: 'parsing', message: 'Parsing COBOL file...' })
  const parsedChunks = parseCobol(cobolText)
  const savedChunks = await insertChunks(program.id, parsedChunks)
  const parseDuration = Date.now() - t0
  logger.done(programName, `Parsed ${savedChunks.length} chunks`, parseDuration)
  emit('progress', { stage: 'parsing', message: `Parsed ${savedChunks.length} chunks`, durationMs: parseDuration })

  runAnalysisInBackground(program.id, programName, cobolText, savedChunks, sseEmitters)

  return program
}

async function runAnalysisInBackground(programId, programName, cobolText, savedChunks, sseEmitters) {
  const provider = await getProvider()
  const emit = makeEmit(programId, sseEmitters)

  try {
    const {
      description, flow_narrative, input_contract, output_contract,
      external_calls, db_tables, file_ops, sections, diagram,
    } = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName })

    // Create program_analysis row, then populate all fields
    await upsertAnalysis({ program_id: programId, description, call_parameters: [], external_calls: [], db_tables: [] })
    await updateAnalysisFields(programId, { external_calls, db_tables, file_ops, input_contract, output_contract, flow_narrative })
    if (diagram != null) await updateDiagram(programId, diagram)

    // Store per-paragraph purposes
    const chunkNameMap = new Map(savedChunks.map(c => [c.chunk_name, c.id]))
    for (const section of sections) {
      const chunkId = chunkNameMap.get(section.name)
      if (chunkId) await updateChunkPurpose(chunkId, section.purpose)
    }

    await updateGraphAfterAnalysis(programId, external_calls)
    await updateProgramStatus(programId, 'analyzed', { analyzed_at: true })
    emit('done', { programId })
  } catch (err) {
    logger.error(programName, `Analysis failed: ${err.message}`)
    emit('progress', { stage: 'failed', message: `Analysis failed: ${err.message}` })
    await updateProgramStatus(programId, 'failed')
    emit('failed', { error: err.message })
  }
}

export async function reanalyze(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') throw Object.assign(new Error('Already analyzing'), { status: 409 })

  await updateProgramStatus(programId, 'analyzing')
  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  const cobolText = readFileSync(filePath, 'utf8')
  const existingChunks = await getChunksByProgramId(programId)

  runAnalysisInBackground(programId, program.name, cobolText, existingChunks, sseEmitters)
}

export async function deleteProgram(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') {
    throw Object.assign(new Error('Cannot delete program while analyzing'), { status: 409 })
  }

  await deleteProgramById(programId)
  await deleteOrphanedPhantoms()

  if (program.file_path) {
    try {
      rmSync(program.file_path, { force: true })
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(program.name, `Failed to remove file: ${err.message}`)
      }
    }
  }

  const emitters = sseEmitters.get(programId)
  if (emitters) {
    for (const res of emitters) res.end()
    sseEmitters.delete(programId)
  }
}
```

- [ ] **Step 2: Run all tests — expect all passing**

```bash
cd server && npm test 2>&1 | tail -10
```

Expected: all test files pass. If any fail, check import paths.

- [ ] **Step 3: Commit**

```bash
cd server && git add src/services/analysisService.js
git commit -m "feat: wire new orchestrator into analysisService, update reanalyze flow"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
cd server && npm test 2>&1
```

Expected: all test files pass, 0 failures.

- [ ] **Smoke test: verify server starts without errors**

```bash
cd server && node --input-type=module <<'EOF'
import './src/ai/orchestrator.js'
import './src/parser/cobolParser.js'
import './src/models/programChunks.js'
console.log('imports ok')
EOF
```

Expected: `imports ok`

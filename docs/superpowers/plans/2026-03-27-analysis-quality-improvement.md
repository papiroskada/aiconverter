# Analysis Quality Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WORKING-STORAGE extraction and per-paragraph business rules to the analysis pipeline, with smart context sizing and automatic two-pass fallback for large programs.

**Architecture:** `cobolParser.js` gains `extractWorkingStorage()`. `INTERFACE_PROMPT` gains a `rules` field in sections. A new `RULES_PROMPT` handles the two-pass fallback. The orchestrator classifies paragraphs as complex/simple, builds adaptive context, and runs two-pass automatically when the context exceeds 80k tokens. `updateChunkPurpose` is updated to store `{ purpose, rules }`.

**Tech Stack:** Node.js ESM, PostgreSQL, vitest, existing OpenAI/Claude providers

**Spec:** `docs/superpowers/specs/2026-03-27-analysis-quality-improvement.md`

---

## File Map

| File | Change |
|---|---|
| `server/src/parser/cobolParser.js` | Add `extractWorkingStorage()` |
| `server/src/ai/prompts.js` | Update `INTERFACE_PROMPT` sections schema; add `RULES_PROMPT` |
| `server/src/ai/providers/base.js` | Add `extractRules(context)` abstract method |
| `server/src/ai/providers/openai.js` | Implement `extractRules()` |
| `server/src/ai/providers/claude.js` | Implement `extractRules()` |
| `server/src/models/programChunks.js` | Update `updateChunkPurpose(id, purpose, rules = [])` |
| `server/src/services/analysisService.js` | Pass `section.rules` to `updateChunkPurpose` |
| `server/src/ai/orchestrator.js` | Add `isComplex`, `estimateTokens`, update `buildInterfaceContext`, add two-pass logic |
| `server/tests/parser/cobolParser.test.js` | Add `extractWorkingStorage` tests |
| `server/tests/ai/orchestrator.test.js` | Add tests for `isComplex`, smart context, two-pass, WS section |

---

## Task 1: `extractWorkingStorage` function

**Files:**
- Modify: `server/src/parser/cobolParser.js`
- Modify: `server/tests/parser/cobolParser.test.js`

### Background for implementer

`cobolParser.js` already has `detectFixedFormat(lines)` and `stripSequenceNumber(line)` helpers. The new function must use these for fixed-format COBOL support. Add the function at the end of the file (before the final blank line). **Do not touch any existing code.**

---

- [ ] **Step 1: Write failing tests**

Update the import at the top of `server/tests/parser/cobolParser.test.js`:

```js
import { parseCobol, extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage } from '../../src/parser/cobolParser.js'
```

Add at the end of the file:

```js
describe('extractWorkingStorage', () => {
  it('returns empty array when no WORKING-STORAGE SECTION', () => {
    expect(extractWorkingStorage('PROCEDURE DIVISION.\n PARA.\n   STOP RUN.')).toEqual([])
  })

  it('returns empty array for empty input', () => {
    expect(extractWorkingStorage('')).toEqual([])
  })

  it('extracts 01-level variable with PIC', () => {
    const src = `DATA DIVISION.\nWORKING-STORAGE SECTION.\n 01 WS-FLAG PIC X.\nPROCEDURE DIVISION.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ level: '01', name: 'WS-FLAG', pic: 'X', conditions: [] })
  })

  it('extracts 88-level conditions attached to parent variable', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-STATUS PIC X(2).\n    88 STATUS-OK VALUE '00'.\n    88 STATUS-ERR VALUE '99'.`
    const result = extractWorkingStorage(src)
    expect(result[0].conditions).toHaveLength(2)
    expect(result[0].conditions[0]).toEqual({ name: 'STATUS-OK', value: "'00'" })
    expect(result[0].conditions[1]).toEqual({ name: 'STATUS-ERR', value: "'99'" })
  })

  it('stops at PROCEDURE DIVISION', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-A PIC X.\nPROCEDURE DIVISION.\n 01 NOT-WS PIC X.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('WS-A')
  })

  it('stops at LINKAGE SECTION', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-A PIC X.\nLINKAGE SECTION.\n 01 LP-B PIC X.`
    const result = extractWorkingStorage(src)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('WS-A')
  })

  it('extracts group level variable (no PIC) with nested fields', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 WS-GROUP.\n    05 WS-A PIC X.\n    05 WS-B PIC 9.`
    const result = extractWorkingStorage(src)
    const group = result.find(v => v.name === 'WS-GROUP')
    expect(group.pic).toBeNull()
    expect(result.find(v => v.name === 'WS-A').pic).toBe('X')
    expect(result.find(v => v.name === 'WS-B').pic).toBe('9')
  })

  it('normalises variable names to uppercase', () => {
    const src = `WORKING-STORAGE SECTION.\n 01 ws-flag PIC X.`
    const result = extractWorkingStorage(src)
    expect(result[0].name).toBe('WS-FLAG')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -10
```

Expected: `extractWorkingStorage is not a function`

- [ ] **Step 3: Implement `extractWorkingStorage`**

Add at the end of `server/src/parser/cobolParser.js` (after the last export, before final blank line):

```js
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test tests/parser/cobolParser.test.js 2>&1 | tail -10
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1 | tail -5
```

Expected: all tests passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/dariasidenko/aiconverter2 && git add server/src/parser/cobolParser.js server/tests/parser/cobolParser.test.js && git commit -m "feat: add extractWorkingStorage to cobolParser"
```

---

## Task 2: Update `updateChunkPurpose` and `analysisService`

**Files:**
- Modify: `server/src/models/programChunks.js`
- Modify: `server/src/services/analysisService.js`

Simple change — no new tests needed (no unit tests exist for DB model functions; the integration is covered by orchestrator tests).

---

- [ ] **Step 1: Update `updateChunkPurpose` in `server/src/models/programChunks.js`**

Replace:

```js
export async function updateChunkPurpose(id, purpose) {
  await pool.query(
    `UPDATE program_chunks SET analysis = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ purpose }), id]
  )
}
```

With:

```js
export async function updateChunkPurpose(id, purpose, rules = []) {
  await pool.query(
    `UPDATE program_chunks SET analysis = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify({ purpose, rules }), id]
  )
}
```

- [ ] **Step 2: Update `updateChunkPurpose` call in `server/src/services/analysisService.js`**

Find this line (inside `runAnalysisInBackground`):

```js
if (chunkId) await updateChunkPurpose(chunkId, section.purpose)
```

Replace with:

```js
if (chunkId) await updateChunkPurpose(chunkId, section.purpose, section.rules ?? [])
```

- [ ] **Step 3: Run all tests — expect all passing**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dariasidenko/aiconverter2 && git add server/src/models/programChunks.js server/src/services/analysisService.js && git commit -m "feat: updateChunkPurpose stores rules alongside purpose"
```

---

## Task 3: Update prompts

**Files:**
- Modify: `server/src/ai/prompts.js`

---

- [ ] **Step 1: Update `INTERFACE_PROMPT` sections schema**

In `server/src/ai/prompts.js`, find this line in `INTERFACE_PROMPT`:

```js
  "sections": [
    { "name": "PARAGRAPH-NAME", "purpose": "one sentence in plain business English" }
  ]
```

Replace with:

```js
  "sections": [
    {
      "name": "PARAGRAPH-NAME",
      "purpose": "one sentence in plain business English",
      "rules": ["IF condition → action", "IF condition → action"]
    }
  ]
```

Also find this instruction line at the bottom of `INTERFACE_PROMPT`:

```js
sections: cover EVERY paragraph listed in the context. One plain-English sentence per paragraph.
```

Replace with:

```js
sections: cover EVERY paragraph listed in the context. Per section:
  - "purpose": one plain-English sentence describing what the paragraph does
  - "rules": array of business rules in "IF ... → ..." format. Cover ALL branches of IF/EVALUATE trees, include status codes and error paths. For simple paragraphs with only MOVE/PERFORM: return []. Maximum 10 rules per paragraph.
```

- [ ] **Step 2: Add `RULES_PROMPT` export**

Add after the `INTERFACE_PROMPT` export and before `DIAGRAM_PROMPT`:

```js
export const RULES_PROMPT = (complexParagraphs) => `
You are a COBOL expert. For each paragraph below, extract all business rules as plain-English IF-THEN statements.

${complexParagraphs}

Return ONLY valid JSON matching this schema exactly:
{
  "paragraphRules": [
    {
      "name": "PARAGRAPH-NAME",
      "rules": [
        "IF condition AND condition → action with status code",
        "IF condition → action"
      ]
    }
  ]
}

Rules guide:
- Each rule is ONE business decision or action in "IF ... → ..." format
- Cover EVERY branch of IF/EVALUATE trees including WHEN OTHER and ELSE
- Include status codes, error paths, rejection codes, and return values
- For paragraphs with only MOVE/PERFORM and no conditional logic: return "rules": []
- Maximum 10 rules per paragraph
`
```

- [ ] **Step 3: Run all tests — expect all passing**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
cd /Users/dariasidenko/aiconverter2 && git add server/src/ai/prompts.js && git commit -m "feat: add rules to INTERFACE_PROMPT sections, add RULES_PROMPT"
```

---

## Task 4: Add `extractRules()` to AI providers

**Files:**
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/openai.js`
- Modify: `server/src/ai/providers/claude.js`
- Modify: `server/tests/ai/orchestrator.test.js` (add BaseProvider test)

### Background

`RULES_PROMPT` asks the AI to return `{ "paragraphRules": [...] }` — a wrapper object (required because OpenAI's `json_object` mode only accepts root-level JSON objects, not arrays). Both providers unwrap to return just the array.

---

- [ ] **Step 1: Write failing test for BaseProvider**

In `server/tests/ai/orchestrator.test.js`, inside the existing `describe('BaseProvider', ...)` block, add:

```js
  it('throws NotImplemented on extractRules', async () => {
    await expect(new BaseProvider().extractRules('')).rejects.toThrow('Not implemented')
  })
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test tests/ai/orchestrator.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Add abstract method to `base.js`**

In `server/src/ai/providers/base.js`, add after `extractInterface`:

```js
  async extractRules(context) {
    throw new Error('Not implemented')
  }
```

- [ ] **Step 4: Implement in `openai.js`**

Add after `extractInterface` in `server/src/ai/providers/openai.js`:

```js
  async extractRules(context) {
    const result = await this.#callOpenAI(RULES_PROMPT(context), 4096)
    return result.paragraphRules ?? []
  }
```

Also update the import at the top of `openai.js`:

```js
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'
```

- [ ] **Step 5: Implement in `claude.js`**

Add after `extractInterface` in `server/src/ai/providers/claude.js`:

```js
  async extractRules(context) {
    const result = await this.#callClaude(RULES_PROMPT(context), 4096)
    return result.paragraphRules ?? []
  }
```

Also update the import at the top of `claude.js`:

```js
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'
```

- [ ] **Step 6: Run — expect all tests passing**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
cd /Users/dariasidenko/aiconverter2 && git add server/src/ai/providers/base.js server/src/ai/providers/openai.js server/src/ai/providers/claude.js server/tests/ai/orchestrator.test.js && git commit -m "feat: add extractRules to AI providers"
```

---

## Task 5: Update orchestrator — smart context + two-pass

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

### Background for implementer

Current `orchestrator.js` exports only `runAnalysis`. You will:
1. Add `isComplex(chunk)` and `estimateTokens(text)` as **named exports** (needed for direct unit testing)
2. Add a `formatWsVars(wsVars)` internal helper (not exported)
3. Update `buildInterfaceContext` — add `wsVars` as 7th param, add `adaptive` as 8th param (default `true`). Adaptive=true → complex chunks get full text, simple get 5 lines. Adaptive=false → all get 5 lines (used in two-pass pass 1).
4. Update `runAnalysis` — add `tokenLimit = 80000` optional param, add two-pass logic, import `extractWorkingStorage`

`makeChunks` in the test file must be updated so at least one chunk is complex (has EVALUATE) to test the two-pass path.

---

- [ ] **Step 1: Write failing tests**

Replace the entire `server/tests/ai/orchestrator.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis, isComplex, estimateTokens } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractInterface', async () => {
    await expect(new BaseProvider().extractInterface('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on generateDiagram', async () => {
    await expect(new BaseProvider().generateDiagram('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on extractRules', async () => {
    await expect(new BaseProvider().extractRules('')).rejects.toThrow('Not implemented')
  })
})

describe('isComplex', () => {
  it('returns false for simple paragraph', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   MOVE A TO B.\n   STOP RUN.' })).toBe(false)
  })

  it('returns true when EVALUATE is present', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   EVALUATE WS-S\n   WHEN 1 MOVE A TO B\n   END-EVALUATE.' })).toBe(true)
  })

  it('returns true when 2 or more IF keywords are present', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   IF A > 0\n     IF B > 0\n       MOVE X TO Y\n     END-IF\n   END-IF.' })).toBe(true)
  })

  it('returns false for exactly one IF keyword', () => {
    expect(isComplex({ cobol_text: 'PARA.\n   IF A > 0\n     MOVE X TO Y\n   END-IF.' })).toBe(false)
  })

  it('returns true for paragraph over 30 lines', () => {
    const text = Array(32).fill('   MOVE A TO B.').join('\n')
    expect(isComplex({ cobol_text: text })).toBe(true)
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('a'.repeat(101))).toBe(26)
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
    sections: [
      { name: 'VALIDATE-ORDER', purpose: 'Validates order status', rules: [] },
      { name: 'SIMPLE-PARA', purpose: 'Moves A to B', rules: [] },
    ],
  }),
  extractRules: vi.fn().mockResolvedValue([
    { name: 'VALIDATE-ORDER', rules: ['IF WS-STATUS = 1 → approve', 'IF other → reject'] },
  ]),
  generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A --> B'),
  ...overrides,
})

// VALIDATE-ORDER has EVALUATE → complex; SIMPLE-PARA has no conditions → simple
const makeChunks = () => [
  {
    id: 'c1',
    chunk_name: 'VALIDATE-ORDER',
    chunk_type: 'paragraph',
    cobol_text: 'VALIDATE-ORDER.\n   EVALUATE WS-STATUS\n   WHEN 1 MOVE A TO B\n   WHEN OTHER MOVE C TO D\n   END-EVALUATE.',
  },
  {
    id: 'c2',
    chunk_name: 'SIMPLE-PARA',
    chunk_type: 'paragraph',
    cobol_text: 'SIMPLE-PARA.\n   MOVE A TO B.',
  },
  {
    id: 'c3',
    chunk_name: 'WS-DATA',
    chunk_type: 'data_summary',
    cobol_text: '01 WS-VAR PIC X.',
  },
]

describe('runAnalysis', () => {
  it('calls extractInterface once with context string', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: 'PROCEDURE DIVISION.', chunks: makeChunks(), provider, emit: () => {}, programName: 'TEST' })
    expect(provider.extractInterface).toHaveBeenCalledTimes(1)
    expect(typeof provider.extractInterface.mock.calls[0][0]).toBe('string')
  })

  it('does NOT have analyzeChunk or synthesize (old methods removed)', async () => {
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
        externalCalls: [{ program: 'PROG-A', using: 'PARAM-1' }, { program: 'PROG-B', using: null }],
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], dbTables: [], sections: [],
      }),
    })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.external_calls).toEqual([
      { program: 'PROG-A', using: 'PARAM-1' },
      { program: 'PROG-B', using: '' },
    ])
  })

  it('returns sections array including rules', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.sections[0]).toHaveProperty('rules')
    expect(Array.isArray(result.sections[0].rules)).toBe(true)
  })

  it('context does NOT include data_summary chunks in PARAGRAPHS section', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    expect(context).toContain('VALIDATE-ORDER')
    expect(context).not.toContain('WS-DATA')
  })

  it('context includes WORKING-STORAGE VARIABLES section', async () => {
    const cobolText = 'WORKING-STORAGE SECTION.\n 01 WS-FLAG PIC X.\nPROCEDURE DIVISION.'
    const provider = makeProvider()
    await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    expect(context).toContain('WORKING-STORAGE VARIABLES')
  })

  it('single-pass: complex paragraph gets full text in context', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    // VALIDATE-ORDER has EVALUATE → complex → full text (more than 5 lines worth)
    expect(context).toContain('END-EVALUATE')
  })

  it('single-pass: simple paragraph gets snippet (first 5 lines) in context', async () => {
    const longSimpleText = Array(20).fill('   MOVE A TO B.').join('\n')
    const chunks = [
      { id: 'c1', chunk_name: 'SIMPLE-PARA', chunk_type: 'paragraph', cobol_text: longSimpleText },
    ]
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], externalCalls: [], dbTables: [], sections: [],
      }),
    })
    await runAnalysis({ cobolText: '', chunks, provider, emit: () => {}, programName: 'T' })
    const context = provider.extractInterface.mock.calls[0][0]
    const paraSection = context.split('[SIMPLE-PARA]')[1] ?? ''
    const linesInPara = paraSection.split('\n\n')[0].split('\n').filter(Boolean)
    expect(linesInPara.length).toBeLessThanOrEqual(5)
  })

  it('single-pass: extractRules is NOT called', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractRules).not.toHaveBeenCalled()
  })

  it('two-pass: extractRules called when tokenLimit exceeded', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    expect(provider.extractRules).toHaveBeenCalledTimes(1)
  })

  it('two-pass: extractRules called only with complex paragraphs', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const rulesContext = provider.extractRules.mock.calls[0][0]
    expect(rulesContext).toContain('VALIDATE-ORDER')  // complex
    expect(rulesContext).not.toContain('SIMPLE-PARA') // simple
  })

  it('two-pass: merges pass 2 rules into complex sections', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const validateSection = result.sections.find(s => s.name === 'VALIDATE-ORDER')
    expect(validateSection.rules).toEqual(['IF WS-STATUS = 1 → approve', 'IF other → reject'])
  })

  it('two-pass: keeps pass 1 rules for simple sections', async () => {
    const provider = makeProvider({
      extractInterface: vi.fn().mockResolvedValue({
        description: 'd', flow_narrative: 'f', parameters: [], fileIO: [], externalCalls: [], dbTables: [],
        sections: [
          { name: 'VALIDATE-ORDER', purpose: 'Validates order', rules: ['pass1-rule'] },
          { name: 'SIMPLE-PARA', purpose: 'Moves A to B', rules: ['simple-rule'] },
        ],
      }),
    })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    const simpleSection = result.sections.find(s => s.name === 'SIMPLE-PARA')
    expect(simpleSection.rules).toEqual(['simple-rule'])
  })

  it('two-pass: pass 2 failure is non-fatal — sections still returned', async () => {
    const provider = makeProvider({ extractRules: vi.fn().mockRejectedValue(new Error('timeout')) })
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T', tokenLimit: 1 })
    expect(result.sections).toBeDefined()
    expect(result.sections.length).toBeGreaterThan(0)
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
cd /Users/dariasidenko/aiconverter2/server && npm test tests/ai/orchestrator.test.js 2>&1 | tail -20
```

Expected: many failures — `isComplex is not a function`, `estimateTokens is not a function`, new test assertions failing.

- [ ] **Step 3: Write the new orchestrator**

Replace the entire content of `server/src/ai/orchestrator.js`:

```js
import { logger } from '../logger.js'
import { extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage } from '../parser/cobolParser.js'

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

export function isComplex(chunk) {
  const text = chunk.cobol_text.toUpperCase()
  const lines = text.split('\n')
  if (lines.length > 30) return true
  if (text.includes('EVALUATE')) return true
  const ifCount = (text.match(/\bIF\b/g) ?? []).length
  if (ifCount >= 2) return true
  return false
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function formatWsVars(wsVars) {
  if (!wsVars.length) return '  (none)'
  return wsVars.map(v => {
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

function buildInterfaceContext(linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, adaptive = true) {
  const paragraphList = paragraphChunks
    .map(c => {
      const text = (adaptive && isComplex(c))
        ? c.cobol_text
        : c.cobol_text.split('\n').slice(0, 5).join('\n')
      return `[${c.chunk_name}]\n${text}`
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
    `WORKING-STORAGE VARIABLES:\n${formatWsVars(wsVars)}`,
    `PARAGRAPHS (name + code):\n${paragraphList || '(none)'}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
  ].join('\n\n')
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName, tokenLimit = 80000 }) {
  const paragraphChunks = chunks.filter(
    c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph'
  )

  const ti = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'interface', message: 'Analysing interface...' })

  const linkage = extractLinkage(cobolText)
  const wsVars = extractWorkingStorage(cobolText)
  const calls = extractCalls(cobolText)
  const execSqlTables = extractExecSql(cobolText)
  const constructs = extractConstructs(cobolText)
  const selectFiles = extractSelectFiles(cobolText)

  const complexChunks = paragraphChunks.filter(isComplex)
  const complexNames = new Set(complexChunks.map(c => c.chunk_name))

  const adaptiveContext = buildInterfaceContext(
    linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, true
  )

  let spec
  if (estimateTokens(adaptiveContext) <= tokenLimit) {
    // Single-pass: full text for complex paragraphs, snippets for simple
    spec = await provider.extractInterface(adaptiveContext)
  } else {
    // Two-pass: pass 1 with all snippets, pass 2 for complex paragraphs only
    const snippetContext = buildInterfaceContext(
      linkage, paragraphChunks, calls, execSqlTables, selectFiles, constructs, wsVars, false
    )
    spec = await provider.extractInterface(snippetContext)

    if (complexChunks.length > 0) {
      try {
        const complexContext = complexChunks
          .map(c => `[${c.chunk_name}]\n${c.cobol_text}`)
          .join('\n\n')
        const pass2Results = await provider.extractRules(complexContext)
        const rulesMap = new Map(pass2Results.map(r => [r.name, r.rules]))
        spec = {
          ...spec,
          sections: (spec.sections ?? []).map(section => ({
            ...section,
            rules: complexNames.has(section.name)
              ? (rulesMap.get(section.name) ?? [])
              : (section.rules ?? []),
          })),
        }
      } catch (err) {
        logger.error(programName, `Rules extraction failed (non-fatal): ${err.message}`)
      }
    }
  }

  logAndEmit(emit, programName, 'done', {
    stage: 'interface', message: 'Interface done', durationMs: Date.now() - ti,
  })

  // Map to storage shape
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

  // Diagram
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
cd /Users/dariasidenko/aiconverter2/server && npm test tests/ai/orchestrator.test.js 2>&1 | tail -20
```

- [ ] **Step 5: Run all tests — expect all passing**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1 | tail -10
```

Expected: all test files pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
cd /Users/dariasidenko/aiconverter2 && git add server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js && git commit -m "feat: smart context, isComplex, two-pass fallback in orchestrator"
```

---

## Final verification

- [ ] **Run full test suite**

```bash
cd /Users/dariasidenko/aiconverter2/server && npm test 2>&1
```

Expected: all test files pass, 0 failures.

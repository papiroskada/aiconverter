# Business Logic Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current code-structure analysis (description, flow_narrative, paragraph rules) with business-logic-focused extraction: entry points with steps/side effects, error catalog, and rich external dependency descriptions — structured for JavaScript rewrite.

**Architecture:** Single AI call for small files (< 80k tokens); two-step for large files (snippet context → identify entry points + paragraphs → full code per entry point in parallel). New DB columns replace old ones. New `Logic` tab in UI replaces diagram + overview clutter.

**Tech Stack:** Node.js/Express, PostgreSQL (JSONB), React 18, Vitest, Claude Sonnet (main step), Claude Haiku (large-file step 2).

---

## File Map

**Modify:**
- `server/src/db/schema.sql` — update `program_analysis` table definition + ALTER TABLE for existing DBs
- `server/src/models/programAnalysis.js` — replace all functions with new schema
- `server/src/ai/prompts.js` — replace 3 old prompts with 2 new ones
- `server/src/ai/providers/base.js` — replace 3 methods with 2 new ones
- `server/src/ai/providers/claude.js` — implement new provider methods
- `server/src/ai/providers/openai.js` — implement new provider methods
- `server/src/ai/orchestrator.js` — full redesign: small/large file logic, new return shape
- `server/src/services/analysisService.js` — update to use new return shape + model functions
- `server/tests/ai/orchestrator.test.js` — replace tests for new schema
- `client/src/components/Panel/DetailPanel.jsx` — swap tabs array
- `client/src/components/Panel/OverviewTab.jsx` — show businessPurpose + parameters only
- `client/src/components/Panel/ConnectionsTab.jsx` — show externalDependencies (richer)
- `client/src/components/Panel/DataTab.jsx` — unchanged

**Create:**
- `client/src/components/Panel/LogicTab.jsx` — entry points + error catalog

---

## Task 1: DB Migration

**Files:**
- Modify: `server/src/db/schema.sql`

New `program_analysis` schema keeps `input_contract`, `output_contract`, `db_tables`, `file_ops` and adds `business_purpose`, `entry_points`, `error_catalog`, `external_dependencies`. Drops `description`, `flow_narrative`, `call_parameters`, `external_calls`, `diagram`.

- [ ] **Step 1: Update `CREATE TABLE program_analysis` in schema.sql**

Replace the `program_analysis` block with:

```sql
CREATE TABLE IF NOT EXISTS program_analysis (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  business_purpose      TEXT,
  input_contract        TEXT,
  output_contract       TEXT,
  entry_points          JSONB NOT NULL DEFAULT '[]',
  error_catalog         JSONB NOT NULL DEFAULT '[]',
  external_dependencies JSONB NOT NULL DEFAULT '[]',
  db_tables             JSONB NOT NULL DEFAULT '[]',
  file_ops              JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (program_id)
);
```

- [ ] **Step 2: Add ALTER TABLE statements at the end of schema.sql (for existing DBs)**

Append after all CREATE TABLE blocks:

```sql
-- Migrate program_analysis to business-logic schema
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS business_purpose      TEXT,
  ADD COLUMN IF NOT EXISTS entry_points          JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS error_catalog         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS external_dependencies JSONB NOT NULL DEFAULT '[]';

ALTER TABLE program_analysis
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS flow_narrative,
  DROP COLUMN IF EXISTS call_parameters,
  DROP COLUMN IF EXISTS external_calls,
  DROP COLUMN IF EXISTS diagram;
```

- [ ] **Step 3: Run migration**

```bash
cd server && npm run migrate
```

Expected: `Migration complete`

- [ ] **Step 4: Verify columns**

```bash
psql postgresql://postgres:postgres@localhost:5432/cobol_converter -c "\d program_analysis"
```

Expected: columns `business_purpose`, `entry_points`, `error_catalog`, `external_dependencies` present; `description`, `flow_narrative`, `diagram` absent.

- [ ] **Step 5: Commit**

```bash
git add server/src/db/schema.sql
git commit -m "feat: migrate program_analysis to business-logic schema"
```

---

## Task 2: Update `programAnalysis.js` Model

**Files:**
- Modify: `server/src/models/programAnalysis.js`

- [ ] **Step 1: Replace entire file**

```js
import pool from '../db/client.js'

export async function upsertBusinessAnalysis(program_id, {
  business_purpose, input_contract, output_contract,
  entry_points, error_catalog, external_dependencies,
  db_tables, file_ops,
}) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis
       (program_id, business_purpose, input_contract, output_contract,
        entry_points, error_catalog, external_dependencies, db_tables, file_ops)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (program_id) DO UPDATE SET
       business_purpose      = EXCLUDED.business_purpose,
       input_contract        = EXCLUDED.input_contract,
       output_contract       = EXCLUDED.output_contract,
       entry_points          = EXCLUDED.entry_points,
       error_catalog         = EXCLUDED.error_catalog,
       external_dependencies = EXCLUDED.external_dependencies,
       db_tables             = EXCLUDED.db_tables,
       file_ops              = EXCLUDED.file_ops,
       updated_at            = NOW()
     RETURNING *`,
    [
      program_id,
      business_purpose ?? null,
      input_contract ?? null,
      output_contract ?? null,
      JSON.stringify(entry_points ?? []),
      JSON.stringify(error_catalog ?? []),
      JSON.stringify(external_dependencies ?? []),
      JSON.stringify(db_tables ?? []),
      JSON.stringify(file_ops ?? []),
    ]
  )
  return rows[0]
}

export async function getAnalysisByProgramId(program_id) {
  const { rows } = await pool.query(
    'SELECT * FROM program_analysis WHERE program_id = $1',
    [program_id]
  )
  return rows[0] || null
}
```

- [ ] **Step 2: Run existing tests to catch any immediate breakage**

```bash
cd server && npx vitest run 2>&1 | tail -8
```

Expected: some tests will fail (orchestrator tests reference old model API) — that is expected and will be fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add server/src/models/programAnalysis.js
git commit -m "feat: replace programAnalysis model with business-logic schema"
```

---

## Task 3: New AI Prompts

**Files:**
- Modify: `server/src/ai/prompts.js`

Two prompts replace three: `BUSINESS_ANALYSIS_PROMPT` (main step, works for both small files and large-file step 1 with snippet context) and `ANALYZE_ENTRY_POINT_PROMPT` (large-file step 2, per-entry-point detail).

- [ ] **Step 1: Replace entire `prompts.js`**

```js
export const BUSINESS_ANALYSIS_PROMPT = (context) => `
You are a COBOL expert analyzing a legacy program to document its business logic for JavaScript rewrite.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "businessPurpose": "one sentence: what business problem this program solves",
  "parameters": [
    {
      "name": "camelCaseName",
      "cobolName": "ORIGINAL-COBOL-NAME",
      "type": "string|number|boolean|object",
      "direction": "in|out|inout",
      "description": "business meaning of this parameter"
    }
  ],
  "entryPoints": [
    {
      "condition": "parameter condition that activates this mode e.g. FUNC='INS', or 'always' if no dispatch",
      "businessName": "human-readable operation name e.g. Create Record",
      "paragraphNames": ["PARAGRAPH-NAME-1", "PARAGRAPH-NAME-2"],
      "steps": ["ordered business action 1", "ordered business action 2"],
      "sideEffects": ["what changes in the system: inserts into TABLE-X", "increments COUNTER-Y"],
      "returns": "what is set or returned on success",
      "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"]
    }
  ],
  "errorCatalog": [
    {
      "code": "error code, status value, or COBOL condition name",
      "businessMeaning": "what this error means for the business process",
      "systemAction": "what the program does when this error occurs"
    }
  ],
  "externalDependencies": [
    {
      "program": "CALLED-PROGRAM-NAME",
      "purpose": "why this program is called in business terms",
      "dataIn": "what data is passed to it",
      "dataOut": "what data comes back from it"
    }
  ],
  "dbTables": [
    { "table": "TABLE-NAME", "operation": "SELECT|INSERT|UPDATE|DELETE", "fields": ["FIELD-NAME"] }
  ],
  "fileIO": [
    { "file": "FILE-NAME", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ]
}

Rules:
- businessPurpose: one sentence, business domain language, not code language
- parameters: extract from LINKAGE SECTION only
- entryPoints: if program dispatches on a parameter (EVALUATE/IF on FUNC, MODE, ACTION etc.) create one entry per value; if no dispatch create one entry with condition "always"
- entryPoints[].paragraphNames: list ALL paragraph names relevant to this entry point (for large-file second-pass use)
- entryPoints[].steps: WHAT HAPPENS FOR THE BUSINESS, not code mechanics — "validates user credentials", not "performs VALIDATE-CREDS paragraph"
- entryPoints[].sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- errorCatalog: every error code, status value, or failure condition with its business meaning
- externalDependencies: every CALL statement — describe WHY it is called and what data flows in/out
- dbTables: confirm and enrich SQL tables from context; return [] if none
- fileIO: file I/O from SELECT/ASSIGN and OPEN/READ/WRITE/CLOSE; return [] if none
`

export const ANALYZE_ENTRY_POINT_PROMPT = (condition, businessName, context) => `
You are a COBOL expert analyzing one specific operation of a legacy program for JavaScript rewrite documentation.

Operation: ${businessName} (triggered when ${condition})

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "steps": ["ordered business action 1", "ordered business action 2"],
  "sideEffects": ["what changes in the system: inserts into TABLE-X", "increments COUNTER-Y"],
  "returns": "what is set or returned on success",
  "errors": ["ERROR-CODE-OR-CONDITION: business meaning and consequence"]
}

Rules:
- steps: WHAT HAPPENS FOR THE BUSINESS in this operation, not code mechanics
- sideEffects: every data change, record creation/update/deletion, counter change, external call triggered
- returns: what output parameters or status values are set on success
- errors: every error code or failure condition specific to this operation
`
```

- [ ] **Step 2: Commit**

```bash
git add server/src/ai/prompts.js
git commit -m "feat: replace code-analysis prompts with business-logic prompts"
```

---

## Task 4: Update Providers

**Files:**
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/claude.js`
- Modify: `server/src/ai/providers/openai.js`

Replace `extractInterface`/`extractRules`/`generateDiagram` with `extractBusinessAnalysis`/`analyzeEntryPoint`.

- [ ] **Step 1: Replace `base.js`**

```js
export class BaseProvider {
  async extractBusinessAnalysis(context, signal) { throw new Error('Not implemented') }
  async analyzeEntryPoint(condition, businessName, context, signal) { throw new Error('Not implemented') }
}

export async function getProvider(config = {}) {
  const provider = config.ai_provider || process.env.AI_PROVIDER || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
```

- [ ] **Step 2: Replace `claude.js`**

```js
import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.claude_api_key || process.env.ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
    this.modelMain   = config.claude_model_interface || process.env.CLAUDE_MODEL_INTERFACE || 'claude-sonnet-4-6'
    this.modelDetail = config.claude_model_rules     || process.env.CLAUDE_MODEL_RULES     || 'claude-haiku-4-5-20251001'
  }

  async #callClaude(prompt, maxTokens, model, signal) {
    const message = await this.client.messages.create(
      { model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] },
      { signal }
    )
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractBusinessAnalysis(context, signal) {
    return this.#callClaude(BUSINESS_ANALYSIS_PROMPT(context), 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal) {
    return this.#callClaude(ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context), 4096, this.modelDetail, signal)
  }
}
```

- [ ] **Step 3: Replace `openai.js`**

```js
import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY
    this.client = new OpenAI({ apiKey })
    this.modelMain   = config.openai_model_interface || process.env.OPENAI_MODEL_INTERFACE || 'gpt-4o'
    this.modelDetail = config.openai_model_rules     || process.env.OPENAI_MODEL_RULES     || 'gpt-4o-mini'
  }

  async #callOpenAI(prompt, maxTokens, model, signal) {
    const completion = await this.client.chat.completions.create(
      { model, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] },
      { signal }
    )
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractBusinessAnalysis(context, signal) {
    return this.#callOpenAI(BUSINESS_ANALYSIS_PROMPT(context), 8000, this.modelMain, signal)
  }

  async analyzeEntryPoint(condition, businessName, context, signal) {
    return this.#callOpenAI(ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context), 4096, this.modelDetail, signal)
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/providers/base.js server/src/ai/providers/claude.js server/src/ai/providers/openai.js
git commit -m "feat: replace provider methods with extractBusinessAnalysis + analyzeEntryPoint"
```

---

## Task 5: Redesign Orchestrator

**Files:**
- Modify: `server/src/ai/orchestrator.js`

**Return shape of `runAnalysis`:**
```js
{
  business_purpose,    // string
  input_contract,      // JSON string — parameters where direction !== 'out'
  output_contract,     // JSON string — parameters where direction !== 'in'
  entry_points,        // array
  error_catalog,       // array
  external_dependencies, // array
  db_tables,           // array
  file_ops,            // array
}
```

**Small file (≤ TOKEN_LIMIT):** one call to `extractBusinessAnalysis` with full paragraph code.

**Large file (> TOKEN_LIMIT, snippet context ≤ MODEL_LIMIT):** one call to `extractBusinessAnalysis` with 5-line snippets — returns entry points with `paragraphNames`, then parallel calls to `analyzeEntryPoint` per entry point with full code of only those paragraphs.

**Very large file (snippet context > MODEL_LIMIT):** same two-step but snippet is further limited to 3 lines per paragraph.

- [ ] **Step 1: Replace entire `orchestrator.js`**

```js
import { logger } from '../logger.js'
import { extractLinkage, extractCalls, extractExecSql, extractConstructs, extractWorkingStorage } from '../parser/cobolParser.js'

const TOKEN_LIMIT = 80000   // above this → two-step
const MODEL_LIMIT = 100000  // above this → shrink snippets further

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

export function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function extractSelectFiles(cobolText) {
  return (cobolText.match(/SELECT\s+\S+\s+ASSIGN[^\n]*/gi) ?? [])
}

function formatWsVars(wsVars) {
  if (!wsVars.length) return '  (none)'
  return wsVars.map(v => {
    const header = `  ${v.level} ${v.name}${v.pic ? ` (${v.pic})` : ''}`
    const conditions = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
    return conditions ? `${header}\n${conditions}` : header
  }).join('\n')
}

function buildStructural(linkage, calls, execSqlTables, selectFiles, constructs, wsVars) {
  const callList = calls.map(c => `  CALL '${c.program}'${c.using ? ` USING ${c.using}` : ''}`).join('\n') || '  (none)'
  const fileList = selectFiles.join('\n') || '  (none)'
  const sqlList  = execSqlTables.map(t => `  ${t.table}: ${t.operation}`).join('\n') || '  (none)'
  return [
    `LINKAGE SECTION:\n${linkage || '(none)'}`,
    `WORKING-STORAGE VARIABLES:\n${formatWsVars(wsVars)}`,
    `CALL STATEMENTS:\n${callList}`,
    `FILE I/O (SELECT statements):\n${fileList}`,
    `DATABASE OPERATIONS (EXEC SQL):\n${sqlList}`,
    `CONSTRUCTS USED: ${constructs.join(', ') || 'none'}`,
  ].join('\n\n')
}

function buildContext(structural, paragraphChunks, linesPerParagraph = Infinity) {
  const paragraphList = paragraphChunks.map(c => {
    const lines = linesPerParagraph === Infinity
      ? c.cobol_text
      : c.cobol_text.split('\n').slice(0, linesPerParagraph).join('\n')
    return `[${c.chunk_name}]\n${lines}`
  }).join('\n\n')
  return `${structural}\n\nPARAGRAPHS:\n${paragraphList || '(none)'}`
}

function buildEntryPointContext(structural, paragraphChunks, paragraphNames) {
  const relevant = paragraphChunks.filter(c => paragraphNames.includes(c.chunk_name))
  const paragraphList = relevant.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n')
  return `${structural}\n\nPARAGRAPHS:\n${paragraphList || '(none)'}`
}

function mapResult(spec) {
  const params = spec.parameters ?? []
  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(params.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(params.filter(p => p.direction !== 'in')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations })),
  }
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName, signal }) {
  const paragraphChunks = chunks.filter(c => c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph')

  const linkage       = extractLinkage(cobolText)
  const wsVars        = extractWorkingStorage(cobolText)
  const calls         = extractCalls(cobolText)
  const execSqlTables = extractExecSql(cobolText)
  const constructs    = extractConstructs(cobolText)
  const selectFiles   = extractSelectFiles(cobolText)

  const structural = buildStructural(linkage, calls, execSqlTables, selectFiles, constructs, wsVars)
  const fullContext = buildContext(structural, paragraphChunks)

  logAndEmit(emit, programName, 'start', { stage: 'analysis', message: 'Analysing business logic...' })
  emit('progress', { stage: 'step', step: 1, total: 2 })

  if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })

  let spec

  if (estimateTokens(fullContext) <= TOKEN_LIMIT) {
    // ── Small file: one call with full paragraph code ──────────────────────
    spec = await provider.extractBusinessAnalysis(fullContext, signal)
  } else {
    // ── Large file: two-step ───────────────────────────────────────────────
    const snippetLines = estimateTokens(buildContext(structural, paragraphChunks, 5)) > MODEL_LIMIT ? 3 : 5
    const snippetContext = buildContext(structural, paragraphChunks, snippetLines)

    logAndEmit(emit, programName, 'start', {
      stage: 'analysis',
      message: `Large file — step 1: identifying entry points (${snippetLines}-line snippets)`,
    })

    spec = await provider.extractBusinessAnalysis(snippetContext, signal)

    const entryPoints = spec.entryPoints ?? []
    if (entryPoints.length > 0) {
      logAndEmit(emit, programName, 'start', {
        stage: 'analysis',
        message: `Step 2: analysing ${entryPoints.length} entry point(s) in detail`,
      })

      emit('progress', { stage: 'step', step: 2, total: 2 })

      // parallel detail analysis per entry point
      const detailed = await Promise.all(
        entryPoints.map(async (ep) => {
          if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' })
          const names = ep.paragraphNames ?? []
          if (names.length === 0) return ep
          try {
            const epContext = buildEntryPointContext(structural, paragraphChunks, names)
            const detail = await provider.analyzeEntryPoint(ep.condition, ep.businessName, epContext, signal)
            return { ...ep, ...detail, paragraphNames: undefined }
          } catch (err) {
            if (err.name === 'AbortError') throw err
            logger.error(programName, `Entry point detail failed for "${ep.businessName}": ${err.message}`)
            return { ...ep, paragraphNames: undefined }
          }
        })
      )
      spec = { ...spec, entryPoints: detailed }
    }
  }

  logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })

  return mapResult(spec)
}
```

- [ ] **Step 2: Run syntax check**

```bash
cd server && node --check src/ai/orchestrator.js && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/orchestrator.js
git commit -m "feat: redesign orchestrator for business-logic extraction, small/large file split"
```

---

## Task 6: Update Tests

**Files:**
- Modify: `server/tests/ai/orchestrator.test.js`

- [ ] **Step 1: Replace entire test file**

```js
import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis, estimateTokens } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractBusinessAnalysis', async () => {
    await expect(new BaseProvider().extractBusinessAnalysis('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on analyzeEntryPoint', async () => {
    await expect(new BaseProvider().analyzeEntryPoint('', '', '')).rejects.toThrow('Not implemented')
  })
})

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
    expect(estimateTokens('a'.repeat(101))).toBe(26)
  })
})

const MOCK_SPEC = {
  businessPurpose: 'Manages user record lifecycle.',
  parameters: [
    { name: 'userInfo', cobolName: 'WGET-USR-INFO', type: 'object', direction: 'inout', description: 'User record' },
  ],
  entryPoints: [
    {
      condition: "FUNC='RD'",
      businessName: 'Read User',
      paragraphNames: ['READ-USER'],
      steps: ['Reads user from USER-FILE'],
      sideEffects: [],
      returns: 'WGET-USR-INFO populated',
      errors: ['STATUS-35: file not found'],
    },
  ],
  errorCatalog: [
    { code: 'STATUS-35', businessMeaning: 'File not found', systemAction: 'Sets error flag and returns' },
  ],
  externalDependencies: [
    { program: 'C_CURPID', purpose: 'Gets current process ID', dataIn: 'none', dataOut: 'process ID' },
  ],
  dbTables: [{ table: 'USER_TABLE', operation: 'SELECT', fields: ['USR_ID'] }],
  fileIO: [{ file: 'USR-FILE', operations: ['OPEN', 'READ', 'CLOSE'] }],
}

const makeProvider = (overrides = {}) => ({
  extractBusinessAnalysis: vi.fn().mockResolvedValue(MOCK_SPEC),
  analyzeEntryPoint: vi.fn().mockResolvedValue({
    steps: ['detailed step'],
    sideEffects: ['updates counter'],
    returns: 'OK',
    errors: [],
  }),
  ...overrides,
})

const makeChunks = () => [
  { id: 'c1', chunk_name: 'READ-USER',   chunk_type: 'paragraph',     cobol_text: 'READ-USER.\n   READ USR-FILE.' },
  { id: 'c2', chunk_name: 'WS-DATA',     chunk_type: 'data_summary',  cobol_text: '01 WS-VAR PIC X.' },
]

describe('runAnalysis — small file', () => {
  it('calls extractBusinessAnalysis once', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledTimes(1)
  })

  it('does NOT call analyzeEntryPoint for small files', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(provider.analyzeEntryPoint).not.toHaveBeenCalled()
  })

  it('context includes paragraph code but not data_summary chunks', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const ctx = provider.extractBusinessAnalysis.mock.calls[0][0]
    expect(ctx).toContain('READ-USER')
    expect(ctx).not.toContain('WS-DATA')
  })

  it('returns business_purpose from spec', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.business_purpose).toBe('Manages user record lifecycle.')
  })

  it('splits parameters into input_contract and output_contract', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    const input = JSON.parse(result.input_contract)
    const output = JSON.parse(result.output_contract)
    expect(input.some(p => p.direction === 'out')).toBe(false)
    expect(output.some(p => p.direction === 'in')).toBe(false)
  })

  it('returns entry_points array', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(Array.isArray(result.entry_points)).toBe(true)
    expect(result.entry_points[0].businessName).toBe('Read User')
  })

  it('returns error_catalog array', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.error_catalog[0].code).toBe('STATUS-35')
  })

  it('returns external_dependencies array', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.external_dependencies[0].program).toBe('C_CURPID')
    expect(result.external_dependencies[0].purpose).toBeDefined()
  })

  it('maps fileIO to file_ops', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
    expect(result.file_ops[0]).toEqual({ file: 'USR-FILE', operations: ['OPEN', 'READ', 'CLOSE'] })
  })

  it('emits progress events', async () => {
    const provider = makeProvider()
    const events = []
    await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: (e, d) => events.push({ e, d }), programName: 'T' })
    const stages = events.map(ev => ev.d?.stage)
    expect(stages).toContain('analysis')
  })
})

describe('runAnalysis — large file two-step', () => {
  const hugeChunks = Array.from({ length: 5 }, (_, i) => ({
    id: `c${i}`,
    chunk_name: `PARA-${i}`,
    chunk_type: 'paragraph',
    cobol_text: 'x'.repeat(80000),
  }))

  it('calls extractBusinessAnalysis once then analyzeEntryPoint per entry point', async () => {
    const provider = makeProvider()
    await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(provider.extractBusinessAnalysis).toHaveBeenCalledTimes(1)
    expect(provider.analyzeEntryPoint).toHaveBeenCalledTimes(1) // MOCK_SPEC has 1 entry point
  })

  it('analyzeEntryPoint failure is non-fatal — entry point still returned', async () => {
    const provider = makeProvider({
      analyzeEntryPoint: vi.fn().mockRejectedValue(new Error('timeout')),
    })
    const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.entry_points.length).toBe(1)
    expect(result.entry_points[0].businessName).toBe('Read User')
  })

  it('merges detail steps into entry_points', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.entry_points[0].steps).toEqual(['detailed step'])
    expect(result.entry_points[0].sideEffects).toEqual(['updates counter'])
  })

  it('strips paragraphNames from final entry_points', async () => {
    const provider = makeProvider()
    const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
    expect(result.entry_points[0].paragraphNames).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js 2>&1 | tail -10
```

Expected: all new tests pass.

- [ ] **Step 3: Run full test suite**

```bash
cd server && npx vitest run 2>&1 | tail -8
```

Expected: all non-orchestrator tests still pass (routes, services, graph).

- [ ] **Step 4: Commit**

```bash
git add server/tests/ai/orchestrator.test.js
git commit -m "test: update orchestrator tests for business-logic schema"
```

---

## Task 7: Update `analysisService.js`

**Files:**
- Modify: `server/src/services/analysisService.js`

- [ ] **Step 1: Replace imports and update `runAnalysisCore`**

Replace the import line:
```js
import { upsertAnalysis, updateDiagram, updateAnalysisFields } from '../models/programAnalysis.js'
```
with:
```js
import { upsertBusinessAnalysis } from '../models/programAnalysis.js'
```

Replace the `runAnalysisCore` try block (lines 35–51):
```js
    const result = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName, signal: controller.signal })
    await upsertBusinessAnalysis(programId, result)
    await updateGraphAfterAnalysis(programId, (result.external_dependencies ?? []).map(d => ({ program: d.program, using: '' })))
    await updateProgramStatus(programId, 'analyzed', { analyzed_at: true })
    emit('done', { programId })
```

Remove these lines (no longer needed):
```js
    await upsertAnalysis({ ... })
    await updateAnalysisFields(...)
    if (diagram != null) await updateDiagram(...)
    const chunkNameMap = ...
    for (const section of sections) { ... }
```

- [ ] **Step 2: Run full test suite**

```bash
cd server && npx vitest run 2>&1 | tail -8
```

Expected: `83 passed` (or similar — all pass).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/analysisService.js
git commit -m "feat: update analysisService to use upsertBusinessAnalysis"
```

---

## Task 8: New `LogicTab` UI Component

**Files:**
- Create: `client/src/components/Panel/LogicTab.jsx`

Displays `entry_points` and `error_catalog` from analysis.

- [ ] **Step 1: Create `LogicTab.jsx`**

```jsx
const sectionStyle = { marginBottom: 20 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 8 }
const cardStyle = { background: '#0f172a', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }
const tagStyle = { display: 'inline-block', background: '#1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '2px 7px', fontSize: 11, marginBottom: 6 }

export default function LogicTab({ analysis }) {
  const entryPoints = analysis?.entry_points ?? []
  const errorCatalog = analysis?.error_catalog ?? []

  if (!entryPoints.length && !errorCatalog.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No business logic extracted yet.</p>
  }

  return (
    <div>
      {entryPoints.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Entry Points</label>
          {entryPoints.map((ep, i) => (
            <div key={i} style={cardStyle}>
              <div style={tagStyle}>{ep.condition}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{ep.businessName}</div>

              {ep.steps?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Steps</div>
                  {ep.steps.map((s, j) => (
                    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                      <span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>{j + 1}.</span>
                      <span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}

              {ep.sideEffects?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Side Effects</div>
                  {ep.sideEffects.map((s, j) => (
                    <div key={j} style={{ color: '#fbbf24', fontSize: 11, marginBottom: 2 }}>⚡ {s}</div>
                  ))}
                </div>
              )}

              {ep.returns && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Returns</div>
                  <div style={{ color: '#4ade80', fontSize: 12 }}>✓ {ep.returns}</div>
                </div>
              )}

              {ep.errors?.length > 0 && (
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Errors</div>
                  {ep.errors.map((e, j) => (
                    <div key={j} style={{ color: '#f87171', fontSize: 11, marginBottom: 2 }}>✗ {e}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {errorCatalog.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Error Catalog</label>
          {errorCatalog.map((e, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{e.code}</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 4 }}>{e.businessMeaning}</div>
              {e.systemAction && (
                <div style={{ color: '#94a3b8', fontSize: 11 }}>→ {e.systemAction}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Panel/LogicTab.jsx
git commit -m "feat: add LogicTab component for entry points and error catalog"
```

---

## Task 9: Update Existing UI Tabs and DetailPanel

**Files:**
- Modify: `client/src/components/Panel/OverviewTab.jsx`
- Modify: `client/src/components/Panel/ConnectionsTab.jsx`
- Modify: `client/src/components/Panel/DetailPanel.jsx`

- [ ] **Step 1: Replace `OverviewTab.jsx`**

Shows `businessPurpose` + input/output parameters. No more diagram, no more description/external_calls.

```jsx
export default function OverviewTab({ analysis }) {
  if (!analysis) return <p style={{ color: '#64748b' }}>No analysis yet.</p>

  const inputParams  = tryParse(analysis.input_contract)
  const outputParams = tryParse(analysis.output_contract)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {analysis.business_purpose && (
        <section>
          <label style={labelStyle}>Business Purpose</label>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{analysis.business_purpose}</p>
        </section>
      )}

      {inputParams.length > 0 && (
        <section>
          <label style={labelStyle}>Input Parameters</label>
          {inputParams.map((p, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: '#475569', fontSize: 11 }}>{p.type}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{p.cobolName}</div>
              {p.description && <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>}
            </div>
          ))}
        </section>
      )}

      {outputParams.length > 0 && (
        <section>
          <label style={labelStyle}>Output Parameters</label>
          {outputParams.map((p, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: '#475569', fontSize: 11 }}>{p.type}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{p.cobolName}</div>
              {p.description && <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function tryParse(str) {
  try { return JSON.parse(str) ?? [] } catch { return [] }
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
```

- [ ] **Step 2: Replace `ConnectionsTab.jsx`**

Shows called-by/calls graph edges + `external_dependencies` (richer than old `external_calls`).

```jsx
export default function ConnectionsTab({ edges, programId, onNavigate, analysis }) {
  const incoming = edges.filter(e => e.to_program_id === programId)
  const outgoing  = edges.filter(e => e.from_program_id === programId)
  const deps = analysis?.external_dependencies ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>Called by ({incoming.length})</label>
        {incoming.length === 0 ? <p style={emptyStyle}>None</p> : incoming.map((e, i) => (
          <div key={i} style={rowStyle} onClick={() => onNavigate(e.from_program_id)}>
            <span style={{ color: '#60a5fa', cursor: 'pointer' }}>{e.from_program_name}</span>
          </div>
        ))}
      </section>

      <section>
        <label style={labelStyle}>Calls ({outgoing.length})</label>
        {outgoing.length === 0 ? <p style={emptyStyle}>None</p> : outgoing.map((e, i) => {
          const isPending = e.to_program_status === 'pending'
          const isUnknown = !e.to_program_id
          const clickable = !isPending && !isUnknown
          return (
            <div key={i} style={rowStyle} onClick={() => clickable && onNavigate(e.to_program_id)}>
              <span style={{ color: clickable ? '#60a5fa' : '#64748b', cursor: clickable ? 'pointer' : 'default' }}>
                {e.to_program_name}
              </span>
              {isPending && <span style={badgeStyle}>not analyzed</span>}
              {isUnknown && <span style={badgeStyle}>not uploaded</span>}
            </div>
          )
        })}
      </section>

      {deps.length > 0 && (
        <section>
          <label style={labelStyle}>External Dependencies ({deps.length})</label>
          {deps.map((d, i) => (
            <div key={i} style={{ ...rowStyle, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: 12 }}>{d.program}</span>
              {d.purpose && <span style={{ color: '#cbd5e1', fontSize: 12 }}>{d.purpose}</span>}
              {d.dataIn  && <span style={{ color: '#94a3b8', fontSize: 11 }}>→ in: {d.dataIn}</span>}
              {d.dataOut && <span style={{ color: '#94a3b8', fontSize: 11 }}>← out: {d.dataOut}</span>}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle   = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const emptyStyle = { color: '#475569', fontSize: 12, margin: 0 }
const badgeStyle = { fontSize: 10, color: '#475569', marginLeft: 8 }
```

- [ ] **Step 3: Update `DetailPanel.jsx` — swap tabs**

Replace the `TABS` constant and add `LogicTab` import:

```jsx
import LogicTab from './LogicTab.jsx'
// remove: import OverviewTab (keep), remove mermaid-related imports if any

const TABS = ['Overview', 'Logic', 'Connections', 'Data']
```

Replace the tab content section:
```jsx
        {!program ? <p style={{ color: '#64748b' }}>Loading…</p> : (
          <>
            {tab === 'Overview'     && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic'        && <LogicTab analysis={program.analysis} />}
            {tab === 'Connections'  && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />}
            {tab === 'Data'         && <DataTab analysis={program.analysis} />}
          </>
        )}
```

- [ ] **Step 4: Build client to check for errors**

```bash
cd client && npx vite build 2>&1 | grep -E "error|✓ built"
```

Expected: `✓ built in ...s`

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Panel/OverviewTab.jsx \
        client/src/components/Panel/ConnectionsTab.jsx \
        client/src/components/Panel/DetailPanel.jsx
git commit -m "feat: update UI tabs for business-logic schema (Overview, Logic, Connections, Data)"
```

---

## Self-Review

**Spec coverage:**
- ✅ businessPurpose → OverviewTab
- ✅ entryPoints (condition, steps, sideEffects, returns, errors) → LogicTab
- ✅ errorCatalog → LogicTab
- ✅ externalDependencies (purpose, dataIn, dataOut) → ConnectionsTab
- ✅ db_tables, file_ops → DataTab (unchanged)
- ✅ input/output parameters → OverviewTab
- ✅ Small file: single call
- ✅ Large file: two-step with parallel entry-point detail
- ✅ DB migration: new columns, old columns dropped
- ✅ Tests updated for new schema

**Placeholder scan:** None found — all steps contain actual code.

**Type consistency:**
- `runAnalysis` returns `{ business_purpose, input_contract, output_contract, entry_points, error_catalog, external_dependencies, db_tables, file_ops }` — matches `upsertBusinessAnalysis` params in Task 2
- `external_dependencies[].program` used in `updateGraphAfterAnalysis` call in Task 7 — ✅ matches
- `analysis.entry_points` in `LogicTab` — ✅ matches DB column name and API response
- `analysis.business_purpose` in `OverviewTab` — ✅ matches

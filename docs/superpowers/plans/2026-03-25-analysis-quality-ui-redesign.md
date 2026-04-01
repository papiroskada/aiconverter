# Analysis Quality & UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix AI prompts to extract accurate external calls and DB tables, aggregate them at the program level, and redesign the Detail Panel tabs (Overview + diagram, Connections + external calls, Data for DB tables) with a resizable panel.

**Architecture:** Backend: fix CHUNK_PROMPT to distinguish CALL from PERFORM and restrict db_ops to EXEC SQL only; SYNTHESIS_PROMPT now also returns a short factual `description`; orchestrator aggregates calls/db_ops from all chunks in code (not AI); graphService updated for new call shape. Frontend: three tabs (Overview/Connections/Data) replace four; diagram moves into Overview with fullscreen; new DataTab; panel is draggable to resize.

**Tech Stack:** Node.js/Express, PostgreSQL, React 18, Vitest, @testing-library/react, mermaid

---

## File Map

**Modified (backend):**
- `server/src/ai/prompts.js` — fix CHUNK_PROMPT `calls`/`db_ops` instructions; add `description` to SYNTHESIS_PROMPT
- `server/src/ai/orchestrator.js` — add aggregation step after chunk analysis; expand return value
- `server/src/models/programAnalysis.js` — add `updateAnalysisFields`
- `server/src/services/analysisService.js` — destructure + save `description`, `external_calls`, `db_tables`; pass new shape to `updateGraphAfterAnalysis`
- `server/src/services/graphService.js` — read `call.program` instead of `call.program_name`; remove `is_system_call` filter

**Modified (frontend):**
- `client/src/components/Panel/DetailPanel.jsx` — new TABS array; add Data tab render; pass `analysis` to ConnectionsTab; add resize handle + width state
- `client/src/components/Panel/OverviewTab.jsx` — add mermaid diagram rendering + fullscreen overlay
- `client/src/components/Panel/ConnectionsTab.jsx` — add `analysis` prop; add External Calls section

**Created (frontend):**
- `client/src/components/Panel/DataTab.jsx` — DB tables list with operation color coding

**Deleted:**
- `client/src/components/Panel/LogicBlocksTab.jsx`
- `client/src/components/Panel/DiagramTab.jsx`

**Tests modified:**
- `server/tests/ai/orchestrator.test.js` — update mocks + assertions for new return shape
- `server/tests/services/graphService.test.js` — update call shape to `{ program, using }`

**Tests created:**
- `client/tests/components/DataTab.test.jsx`
- `client/tests/components/OverviewTab.test.jsx`

**Tests modified:**
- `client/tests/components/ConnectionsTab.test.jsx` — external calls tests appended
- `client/tests/components/DetailPanel.test.jsx` — resize tests appended

---

## Task 1: Fix AI prompts + orchestrator aggregation

**Files:**
- Modify: `server/src/ai/prompts.js`
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

### Context

`CHUNK_PROMPT.calls` currently asks for a flat string array — AI mixes CALL and PERFORM. `CHUNK_PROMPT.db_ops` has no restriction — AI hallucinates table names from variable names. `SYNTHESIS_PROMPT` only returns `{ summary }` — we need it to also return a short factual `description`.

After all chunks are analyzed, the orchestrator must aggregate calls/db_ops from chunk results into `external_calls` and `db_tables` arrays (pure JS, no AI). These plus `description` are added to the return value.

- [ ] **Step 1: Update failing orchestrator tests first**

Open `server/tests/ai/orchestrator.test.js`. The existing tests need updating for the new behavior. Replace the file with:

```js
import { describe, it, expect, vi } from 'vitest'
import { BaseProvider } from '../../src/ai/providers/base.js'
import { runAnalysis } from '../../src/ai/orchestrator.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractMetadata', async () => {
    const p = new BaseProvider()
    await expect(p.extractMetadata('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on analyzeChunk', async () => {
    const p = new BaseProvider()
    await expect(p.analyzeChunk('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on synthesize', async () => {
    const p = new BaseProvider()
    await expect(p.synthesize('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on generateDiagram', async () => {
    const p = new BaseProvider()
    await expect(p.generateDiagram('')).rejects.toThrow('Not implemented')
  })
})

describe('runAnalysis', () => {
  it('calls extractMetadata, analyzeChunk per chunk, synthesize; aggregates calls and db_ops', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({
        description: 'test desc',
        call_parameters: [],
        external_calls: [],
        db_tables: [],
      }),
      analyzeChunk: vi.fn().mockResolvedValue({
        description: 'chunk desc',
        flow_steps: ['step 1'],
        variables_used: [],
        calls: [{ program: 'c_writelnkarea', using: 'PGM-NM' }],
        db_ops: [{ table: 'ECO', operation: 'READ', fields: ['ECO-KEY-CD'] }],
      }),
      synthesize: vi.fn().mockResolvedValue({ summary: 'overall summary', description: 'Receives X. Does Y.' }),
      generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A[Start] --> B[End]'),
    }

    const chunks = [
      { id: 'c1', chunk_type: 'paragraph', chunk_name: 'MAIN-PARA', cobol_text: 'MOVE 1 TO X.' },
    ]

    const events = []
    const result = await runAnalysis({
      cobolText: 'IDENTIFICATION DIVISION.',
      chunks,
      provider: mockProvider,
      emit: (event, data) => events.push({ event, data }),
      programName: 'TEST',
    })

    expect(mockProvider.extractMetadata).toHaveBeenCalledOnce()
    expect(mockProvider.analyzeChunk).toHaveBeenCalledWith('MOVE 1 TO X.')
    expect(mockProvider.synthesize).toHaveBeenCalledWith('MAIN-PARA: chunk desc')
    expect(result.metadata.description).toBe('test desc')
    expect(result.chunkResults).toHaveLength(1)
    expect(result.summary).toBe('overall summary')
    expect(result.description).toBe('Receives X. Does Y.')

    // Aggregated from chunks
    expect(result.external_calls).toEqual([{ program: 'c_writelnkarea', using: 'PGM-NM' }])
    expect(result.db_tables).toHaveLength(1)
    expect(result.db_tables[0].table).toBe('ECO')
    expect(result.db_tables[0].fields).toContain('ECO-KEY-CD')

    const progressEvents = events.filter(e => e.event === 'progress')
    expect(progressEvents.some(e => e.data.stage === 'metadata')).toBe(true)
    expect(progressEvents.some(e => e.data.stage === 'chunk')).toBe(true)
    expect(progressEvents.some(e => e.data.stage === 'synthesis')).toBe(true)
    expect(progressEvents.some(e => e.data.stage === 'diagram')).toBe(true)
    expect(mockProvider.generateDiagram).toHaveBeenCalledWith('overall summary')
    expect(result.diagram).toBe('flowchart TD\n  A[Start] --> B[End]')
  })

  it('deduplicates external calls by program name across chunks', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn()
        .mockResolvedValueOnce({ description: 'a', flow_steps: [], variables_used: [], calls: [{ program: 'PROG-A', using: 'PARAM1' }], db_ops: [] })
        .mockResolvedValueOnce({ description: 'b', flow_steps: [], variables_used: [], calls: [{ program: 'PROG-A', using: 'PARAM2' }, { program: 'PROG-B', using: 'X' }], db_ops: [] }),
      synthesize: vi.fn().mockResolvedValue({ summary: 's', description: 'd' }),
      generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n A-->B'),
    }
    const chunks = [
      { id: 'c1', chunk_name: 'P1', cobol_text: '' },
      { id: 'c2', chunk_name: 'P2', cobol_text: '' },
    ]
    const result = await runAnalysis({ cobolText: '', chunks, provider: mockProvider, emit: () => {}, programName: 'T' })
    // PROG-A appears twice — deduped to one entry (first occurrence kept)
    const progAEntries = result.external_calls.filter(c => c.program === 'PROG-A')
    expect(progAEntries).toHaveLength(1)
    expect(progAEntries[0].using).toBe('PARAM1')
    expect(result.external_calls).toHaveLength(2)
  })

  it('merges db_ops fields for the same table across chunks', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn()
        .mockResolvedValueOnce({ description: 'a', flow_steps: [], variables_used: [], calls: [], db_ops: [{ table: 'ECO', operation: 'READ', fields: ['ECO-ID'] }] })
        .mockResolvedValueOnce({ description: 'b', flow_steps: [], variables_used: [], calls: [], db_ops: [{ table: 'ECO', operation: 'WRITE', fields: ['ECO-STATUS'] }] }),
      synthesize: vi.fn().mockResolvedValue({ summary: 's', description: 'd' }),
      generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n A-->B'),
    }
    const chunks = [
      { id: 'c1', chunk_name: 'P1', cobol_text: '' },
      { id: 'c2', chunk_name: 'P2', cobol_text: '' },
    ]
    const result = await runAnalysis({ cobolText: '', chunks, provider: mockProvider, emit: () => {}, programName: 'T' })
    expect(result.db_tables).toHaveLength(1)
    const eco = result.db_tables[0]
    expect(eco.table).toBe('ECO')
    expect(eco.fields).toContain('ECO-ID')
    expect(eco.fields).toContain('ECO-STATUS')
    expect(eco.operation).toContain('READ')
    expect(eco.operation).toContain('WRITE')
  })

  it('skips db_ops with table "unknown"', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn().mockResolvedValue({
        description: 'a', flow_steps: [], variables_used: [], calls: [],
        db_ops: [{ table: 'unknown', operation: 'WRITE', fields: [] }, { table: 'REAL-TABLE', operation: 'READ', fields: ['F1'] }],
      }),
      synthesize: vi.fn().mockResolvedValue({ summary: 's', description: 'd' }),
      generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n A-->B'),
    }
    const result = await runAnalysis({ cobolText: '', chunks: [{ id: 'c1', chunk_name: 'P', cobol_text: '' }], provider: mockProvider, emit: () => {}, programName: 'T' })
    expect(result.db_tables.find(t => t.table === 'unknown')).toBeUndefined()
    expect(result.db_tables).toHaveLength(1)
  })

  it('continues after chunk failure and emits chunk_failed', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn()
        .mockRejectedValueOnce(new Error('AI timeout'))
        .mockResolvedValueOnce({ description: 'ok', flow_steps: [], variables_used: [], calls: [], db_ops: [] }),
      synthesize: vi.fn().mockResolvedValue({ summary: 'partial summary', description: 'short' }),
      generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A --> B'),
    }
    const chunks = [
      { id: 'c1', chunk_name: 'FAIL-PARA', cobol_text: 'MOVE 1 TO X.' },
      { id: 'c2', chunk_name: 'OK-PARA', cobol_text: 'MOVE 2 TO Y.' },
    ]
    const events = []
    const result = await runAnalysis({
      cobolText: '',
      chunks,
      provider: mockProvider,
      emit: (event, data) => events.push({ event, data }),
      programName: 'TEST',
    })
    expect(result.chunkResults).toHaveLength(2)
    expect(result.chunkResults[0].analysis).toBeNull()
    expect(result.chunkResults[0].error).toBe('AI timeout')
    expect(result.chunkResults[1].analysis.description).toBe('ok')
    expect(events.some(e => e.event === 'chunk_failed')).toBe(true)
    expect(events.some(e => e.event === 'chunk_done')).toBe(true)
    expect(mockProvider.synthesize).toHaveBeenCalledWith('OK-PARA: ok')
  })

  it('returns diagram: null when generateDiagram fails', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn().mockResolvedValue({ description: 'ok', flow_steps: [], variables_used: [], calls: [], db_ops: [] }),
      synthesize: vi.fn().mockResolvedValue({ summary: 'summary', description: 'short' }),
      generateDiagram: vi.fn().mockRejectedValue(new Error('AI timeout')),
    }
    const events = []
    const result = await runAnalysis({
      cobolText: '',
      chunks: [{ id: 'c1', chunk_name: 'PARA', cobol_text: 'MOVE 1 TO X.' }],
      provider: mockProvider,
      emit: (event, data) => events.push({ event, data }),
      programName: 'TEST',
    })
    expect(result.diagram).toBeNull()
    expect(result.summary).toBe('summary')
    const progressEvents = events.filter(e => e.event === 'progress')
    expect(progressEvents.some(e => e.data.stage === 'diagram' && e.data.message.includes('failed'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|×"
```

Expected: several test failures because `result.description`, `result.external_calls`, `result.db_tables` don't exist yet.

- [ ] **Step 3: Update `server/src/ai/prompts.js`**

Replace the file content:

```js
export const METADATA_PROMPT = (cobolText) => `
You are a COBOL expert. Analyze this COBOL program header and extract structured metadata.

Return ONLY valid JSON matching this schema exactly:
{
  "description": "brief description of what this program does",
  "call_parameters": [
    { "name": "PARAM-NAME", "type": "data type", "description": "what it controls", "future_endpoint": null }
  ],
  "external_calls": [
    { "program_name": "PROGNAME", "context": "why it is called", "is_system_call": false }
  ],
  "db_tables": [
    { "table": "TABLE-NAME", "operation": "READ|WRITE|READ/WRITE", "fields": ["FIELD-A"] }
  ]
}

COBOL CODE:
${cobolText}
`

export const CHUNK_PROMPT = (chunkText) => `
You are a COBOL expert. Analyze this COBOL paragraph and extract its business logic.

Return ONLY valid JSON matching this schema exactly:
{
  "description": "one sentence description of what this paragraph does",
  "flow_steps": ["step 1", "step 2"],
  "variables_used": ["VAR-NAME"],
  "calls": [
    { "program": "CALLED-PROGRAM-NAME", "using": "PARAMETER-NAME" }
  ],
  "db_ops": [
    { "table": "TABLE-NAME", "operation": "READ|WRITE|READ/WRITE|DELETE", "fields": ["FIELD"] }
  ]
}

Rules for "calls":
- Include ONLY external CALL statements of the form: CALL 'program-name' USING parameter
- Do NOT include PERFORM statements — those are internal paragraph calls, not external programs
- "using" should be the first USING parameter name only

Rules for "db_ops":
- Extract ONLY from EXEC SQL ... END-EXEC blocks
- Do NOT infer table names from variable names or surrounding context
- If there are no EXEC SQL blocks, return an empty array

COBOL CODE:
${chunkText}
`

export const SYNTHESIS_PROMPT = (descriptions) => `
You are a COBOL expert. Based on these paragraph descriptions from a single COBOL program,
write a concise overall summary of what the program does as a whole.

Return ONLY valid JSON:
{
  "summary": "one to three sentence summary for diagram generation",
  "description": "2-3 factual sentences. State what the program receives, what it does, and what external programs or tables it uses. No filler phrases like 'This program...' or 'The purpose of...'."
}

PARAGRAPH DESCRIPTIONS:
${descriptions}
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

- [ ] **Step 4: Update `server/src/ai/orchestrator.js`**

Replace the file content:

```js
import { logger } from '../logger.js'

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}

function aggregateCalls(chunkResults) {
  const callMap = new Map()
  for (const { analysis } of chunkResults) {
    for (const c of (analysis?.calls ?? [])) {
      if (c?.program && !callMap.has(c.program)) callMap.set(c.program, c)
    }
  }
  return [...callMap.values()]
}

function aggregateDbTables(chunkResults) {
  const tableMap = new Map()
  for (const { analysis } of chunkResults) {
    for (const op of (analysis?.db_ops ?? [])) {
      if (!op?.table || op.table === 'unknown') continue
      if (!tableMap.has(op.table)) {
        tableMap.set(op.table, { table: op.table, operations: new Set(), fields: new Set() })
      }
      const entry = tableMap.get(op.table)
      entry.operations.add(op.operation)
      for (const f of (op.fields ?? [])) entry.fields.add(f)
    }
  }
  return [...tableMap.values()].map(e => ({
    table: e.table,
    operation: [...e.operations].join('/'),
    fields: [...e.fields],
  }))
}

export async function runAnalysis({ cobolText, chunks, provider, emit, programName }) {
  // Step 1: extract metadata
  const t0 = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'metadata', message: 'Analyzing metadata...' })
  const metadata = await provider.extractMetadata(cobolText.split('\n').slice(0, 100).join('\n'))
  logAndEmit(emit, programName, 'done', { stage: 'metadata', message: 'Metadata done', durationMs: Date.now() - t0 })
  emit('metadata', metadata)

  // Step 2: analyze each chunk
  const chunkResults = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const tc = Date.now()
    logAndEmit(emit, programName, 'start', {
      stage: 'chunk',
      message: `Chunk ${i + 1}/${chunks.length}: ${chunk.chunk_name}...`,
      chunkIndex: i + 1,
      total: chunks.length,
    })
    try {
      const analysis = await provider.analyzeChunk(chunk.cobol_text)
      chunkResults.push({ chunk, analysis })
      logAndEmit(emit, programName, 'done', {
        stage: 'chunk',
        message: `Chunk ${i + 1}/${chunks.length} done`,
        chunkIndex: i + 1,
        total: chunks.length,
        durationMs: Date.now() - tc,
      })
      emit('chunk_done', { chunkId: chunk.id, index: i + 1, total: chunks.length })
    } catch (err) {
      logAndEmit(emit, programName, 'error', {
        stage: 'chunk',
        message: `Chunk ${i + 1}/${chunks.length} failed: ${err.message}`,
        chunkIndex: i + 1,
        total: chunks.length,
        durationMs: Date.now() - tc,
      })
      emit('chunk_failed', { chunkId: chunk.id, error: err.message })
      chunkResults.push({ chunk, analysis: null, error: err.message })
    }
  }

  // Aggregate calls and db_ops from chunk results (deterministic, no AI)
  const external_calls = aggregateCalls(chunkResults)
  const db_tables = aggregateDbTables(chunkResults)

  // Step 3: synthesize
  const ts = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'synthesis', message: 'Synthesizing summary...' })
  const descriptions = chunkResults
    .filter(r => r.analysis)
    .map(r => `${r.chunk.chunk_name}: ${r.analysis.description}`)
    .join('\n')
  const { summary, description } = await provider.synthesize(descriptions)
  logAndEmit(emit, programName, 'done', { stage: 'synthesis', message: 'Synthesis done', durationMs: Date.now() - ts })

  // Step 4: generate diagram
  const td = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'diagram', message: 'Generating diagram...' })
  let diagram = null
  try {
    diagram = await provider.generateDiagram(summary)
    logAndEmit(emit, programName, 'done', { stage: 'diagram', message: 'Diagram done', durationMs: Date.now() - td })
  } catch (err) {
    logAndEmit(emit, programName, 'error', { stage: 'diagram', message: `Diagram failed: ${err.message}`, durationMs: Date.now() - td })
  }

  return { metadata, chunkResults, summary, description, diagram, external_calls, db_tables }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/ai/prompts.js server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js
git commit -m "feat: fix chunk prompts for CALL/PERFORM distinction and EXEC SQL; aggregate external_calls and db_tables in orchestrator"
```

---

## Task 2: Backend model, service, and graph updates

**Files:**
- Modify: `server/src/models/programAnalysis.js`
- Modify: `server/src/services/analysisService.js`
- Modify: `server/src/services/graphService.js`
- Modify: `server/tests/services/graphService.test.js`

### Context

Three coordinated backend changes:
1. `programAnalysis.js` needs a new `updateAnalysisFields` function to save aggregated `external_calls` and `db_tables`.
2. `analysisService.js` must destructure the expanded return value from `runAnalysis` and call the new save functions; also pass `external_calls` (new shape) to `updateGraphAfterAnalysis` instead of `metadata.external_calls`.
3. `graphService.js` reads `call.program` and `call.using` from the new shape (was `call.program_name`, `call.context`, `call.is_system_call`).

- [ ] **Step 1: Update failing graphService tests**

Replace `server/tests/services/graphService.test.js` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/models/programs.js', () => ({
  findProgramByName: vi.fn(),
  createProgram: vi.fn(),
  updateProgramStatus: vi.fn(),
}))
vi.mock('../../src/models/programEdges.js', () => ({
  upsertEdge: vi.fn(),
  backfillPhantomEdges: vi.fn(),
}))

import { updateGraphAfterAnalysis, backfillEdgesForNewProgram } from '../../src/services/graphService.js'
import * as programsModel from '../../src/models/programs.js'
import * as edgesModel from '../../src/models/programEdges.js'

describe('updateGraphAfterAnalysis', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates pending program node for unknown external call', async () => {
    programsModel.findProgramByName.mockResolvedValue(null)
    programsModel.createProgram.mockResolvedValue({ id: 'new-id', name: 'ARCUST' })
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'ARCUST', using: 'CUST-AREA' }
    ])

    expect(programsModel.createProgram).toHaveBeenCalledWith({ name: 'ARCUST', status: 'pending' })
    expect(edgesModel.upsertEdge).toHaveBeenCalledWith({
      from_program_id: 'prog-id',
      to_program_name: 'ARCUST',
      to_program_id: 'new-id',
      context: 'CUST-AREA',
    })
  })

  it('includes all calls — no is_system_call filter', async () => {
    programsModel.findProgramByName.mockResolvedValue(null)
    programsModel.createProgram.mockResolvedValue({ id: 'sys-id', name: 'c_writelnkarea' })
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'c_writelnkarea', using: 'PGM-NM' }
    ])

    // System utilities are now included — they become phantom nodes
    expect(programsModel.findProgramByName).toHaveBeenCalledWith('c_writelnkarea')
    expect(edgesModel.upsertEdge).toHaveBeenCalled()
  })

  it('links edge to existing program without creating a new one', async () => {
    programsModel.findProgramByName.mockResolvedValue({ id: 'existing-id', name: 'ARCUST' })
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'ARCUST', using: 'CUST-AREA' }
    ])

    expect(programsModel.createProgram).not.toHaveBeenCalled()
    expect(edgesModel.upsertEdge).toHaveBeenCalledWith({
      from_program_id: 'prog-id',
      to_program_name: 'ARCUST',
      to_program_id: 'existing-id',
      context: 'CUST-AREA',
    })
  })

  it('sets fromProgram status to analyzed', async () => {
    programsModel.findProgramByName.mockResolvedValue({ id: 'existing-id', name: 'PROG' })
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: 'PROG', using: '' }
    ])

    expect(programsModel.updateProgramStatus).toHaveBeenCalledWith('prog-id', 'analyzed', { analyzed_at: true })
  })

  it('skips entries with missing program name', async () => {
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program: '', using: 'X' },
      { using: 'Y' },
    ])

    expect(programsModel.findProgramByName).not.toHaveBeenCalled()
    expect(edgesModel.upsertEdge).not.toHaveBeenCalled()
  })
})

describe('backfillEdgesForNewProgram', () => {
  it('calls backfillPhantomEdges with program name and id', async () => {
    await backfillEdgesForNewProgram({ id: 'p-id', name: 'NEWPROG' })
    expect(edgesModel.backfillPhantomEdges).toHaveBeenCalledWith('NEWPROG', 'p-id')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test -- tests/services/graphService.test.js --reporter=verbose 2>&1 | tail -20
```

Expected: failures because `graphService` still reads `call.program_name`.

- [ ] **Step 3: Update `server/src/services/graphService.js`**

Replace the file content:

```js
import { findProgramByName, createProgram, updateProgramStatus } from '../models/programs.js'
import { upsertEdge, backfillPhantomEdges } from '../models/programEdges.js'

export async function updateGraphAfterAnalysis(fromProgramId, externalCalls) {
  for (const call of externalCalls) {
    const name = call.program
    if (!name) continue

    let target = await findProgramByName(name)
    let targetId = target ? target.id : null

    if (!target) {
      const created = await createProgram({ name, status: 'pending' })
      targetId = created.id
    }

    await upsertEdge({
      from_program_id: fromProgramId,
      to_program_name: name,
      to_program_id: targetId,
      context: call.using ?? '',
    })
  }

  await updateProgramStatus(fromProgramId, 'analyzed', { analyzed_at: true })
}

export async function backfillEdgesForNewProgram(program) {
  await backfillPhantomEdges(program.name, program.id)
}
```

- [ ] **Step 4: Add `updateAnalysisFields` to `server/src/models/programAnalysis.js`**

Append to the end of the file (after `updateDiagram`):

```js
export async function updateAnalysisFields(program_id, { external_calls, db_tables }) {
  await pool.query(
    `UPDATE program_analysis
     SET external_calls = $1, db_tables = $2, updated_at = NOW()
     WHERE program_id = $3`,
    [JSON.stringify(external_calls), JSON.stringify(db_tables), program_id]
  )
}
```

- [ ] **Step 5: Update `server/src/services/analysisService.js`**

Change the import line for `programAnalysis.js`:
```js
// Before:
import { upsertAnalysis, updateDescription, updateDiagram } from '../models/programAnalysis.js'
// After:
import { upsertAnalysis, updateDescription, updateDiagram, updateAnalysisFields } from '../models/programAnalysis.js'
```

Change the destructuring in `runAnalysisInBackground`:
```js
// Before:
const { metadata, chunkResults, summary, diagram } = await runAnalysis({
// After:
const { metadata, chunkResults, summary, description, diagram, external_calls, db_tables } = await runAnalysis({
```

Change the save block (replace the three lines after "Save synthesis summary"):
```js
// Before:
// Save synthesis summary
await updateDescription(programId, summary)
if (diagram != null) await updateDiagram(programId, diagram)

// Update graph
await updateGraphAfterAnalysis(programId, metadata.external_calls)

// After:
// Save synthesis description and aggregated arrays
await updateDescription(programId, description ?? summary)
await updateAnalysisFields(programId, { external_calls, db_tables })
if (diagram != null) await updateDiagram(programId, diagram)

// Update graph (uses aggregated external_calls, new shape { program, using })
await updateGraphAfterAnalysis(programId, external_calls)
```

- [ ] **Step 6: Run all server tests**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | tail -15
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/models/programAnalysis.js server/src/services/analysisService.js server/src/services/graphService.js server/tests/services/graphService.test.js
git commit -m "feat: add updateAnalysisFields, wire aggregated external_calls/db_tables through service, update graphService for new call shape"
```

---

## Task 3: New DataTab component

**Files:**
- Create: `client/src/components/Panel/DataTab.jsx`
- Create: `client/tests/components/DataTab.test.jsx`

### Context

New tab that shows DB tables from `program.analysis.db_tables`. Each row shows table name, operation (color-coded), and field list. `opColor` uses `.includes()` because operation strings can be compound (e.g. `READ/WRITE/DELETE`) produced by the orchestrator's Set join.

- [ ] **Step 1: Write the failing tests**

Create `client/tests/components/DataTab.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import DataTab from '../../src/components/Panel/DataTab.jsx'

test('shows "No database tables found" when db_tables is empty', () => {
  render(<DataTab analysis={{ db_tables: [] }} />)
  expect(screen.getByText('No database tables found.')).toBeInTheDocument()
})

test('shows "No database tables found" when analysis is null', () => {
  render(<DataTab analysis={null} />)
  expect(screen.getByText('No database tables found.')).toBeInTheDocument()
})

test('renders table name and operation for each db_table entry', () => {
  render(<DataTab analysis={{
    db_tables: [
      { table: 'ECO', operation: 'READ', fields: ['ECO-KEY-CD', 'ECO-STATUS'] },
      { table: 'SYTABLEP', operation: 'READ/WRITE', fields: [] },
    ]
  }} />)
  expect(screen.getByText('ECO')).toBeInTheDocument()
  expect(screen.getByText('READ')).toBeInTheDocument()
  expect(screen.getByText('ECO-KEY-CD, ECO-STATUS')).toBeInTheDocument()
  expect(screen.getByText('SYTABLEP')).toBeInTheDocument()
  expect(screen.getByText('READ/WRITE')).toBeInTheDocument()
})

test('does not render fields line when fields array is empty', () => {
  render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'WRITE', fields: [] }] }} />)
  // The fields paragraph should not be present
  expect(screen.queryByText(',')).not.toBeInTheDocument()
})

test('opColor: READ-only operation shows in the document', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ', fields: [] }] }} />)
  // READ → green (#4ade80)
  const opSpan = container.querySelector('span[style*="4ade80"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: WRITE-only operation shows in the document', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'WRITE', fields: [] }] }} />)
  // WRITE → red (#f87171)
  const opSpan = container.querySelector('span[style*="f87171"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: READ/WRITE compound operation shows amber color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ/WRITE', fields: [] }] }} />)
  // READ/WRITE → amber (#f59e0b)
  const opSpan = container.querySelector('span[style*="f59e0b"]')
  expect(opSpan).not.toBeNull()
})

test('opColor: READ/DELETE compound operation shows amber color', () => {
  const { container } = render(<DataTab analysis={{ db_tables: [{ table: 'T1', operation: 'READ/DELETE', fields: [] }] }} />)
  // READ + DELETE → amber (#f59e0b)
  const opSpan = container.querySelector('span[style*="f59e0b"]')
  expect(opSpan).not.toBeNull()
})
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd client && npx vitest run tests/components/DataTab.test.jsx 2>&1 | tail -10
```

Expected: FAIL — `DataTab.jsx` does not exist.

- [ ] **Step 3: Create `client/src/components/Panel/DataTab.jsx`**

```jsx
function opColor(op = '') {
  const hasRead = op.includes('READ')
  const hasWrite = op.includes('WRITE') || op.includes('DELETE')
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }

export default function DataTab({ analysis }) {
  if (!analysis?.db_tables?.length) return <p style={{ color: '#64748b' }}>No database tables found.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={labelStyle}>DB Tables ({analysis.db_tables.length})</label>
      {analysis.db_tables.map((t, i) => (
        <div key={i} style={rowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{t.table}</span>
            <span style={{ fontSize: 11, color: opColor(t.operation) }}>{t.operation}</span>
          </div>
          {t.fields?.length > 0 && (
            <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>{t.fields.join(', ')}</p>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run tests/components/DataTab.test.jsx 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Panel/DataTab.jsx client/tests/components/DataTab.test.jsx
git commit -m "feat: add DataTab component for DB tables display"
```

---

## Task 4: OverviewTab with diagram and fullscreen

**Files:**
- Modify: `client/src/components/Panel/OverviewTab.jsx`
- Create: `client/tests/components/OverviewTab.test.jsx`

### Context

Move mermaid diagram rendering from `DiagramTab.jsx` into `OverviewTab.jsx`. Add a fullscreen button that opens an overlay. The overlay renders the diagram into a separate ref (mermaid requires explicit re-render). Escape key and clicking outside the diagram container close the overlay.

The `mermaidInitialized` module-level flag and `useEffect` dependency on `[analysis?.diagram, fullscreen]` are the key details.

- [ ] **Step 1: Write failing tests**

Create `client/tests/components/OverviewTab.test.jsx`:

```jsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi } from 'vitest'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(() => Promise.resolve({ svg: '<svg id="test">diagram</svg>' })),
  }
}))

import OverviewTab from '../../src/components/Panel/OverviewTab.jsx'

const analysisWithDiagram = {
  description: 'Validates customer data.',
  call_parameters: [],
  diagram: 'flowchart TD\n  A[Start] --> B[End]',
}

const analysisNoDiagram = {
  description: 'Simple program.',
  call_parameters: [],
  diagram: null,
}

test('shows "No analysis yet" when analysis is null', () => {
  render(<OverviewTab analysis={null} />)
  expect(screen.getByText('No analysis yet.')).toBeInTheDocument()
})

test('renders description text', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  expect(screen.getByText('Validates customer data.')).toBeInTheDocument()
})

test('renders diagram container when diagram is present', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  // The fullscreen button should be visible
  expect(screen.getByTitle('Fullscreen')).toBeInTheDocument()
})

test('shows "Diagram not available" when diagram is null', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisNoDiagram} />)
  })
  expect(screen.getByText('Diagram not available.')).toBeInTheDocument()
})

test('opens fullscreen overlay on button click', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  const btn = screen.getByTitle('Fullscreen')
  await act(async () => { fireEvent.click(btn) })
  // Overlay is rendered — look for the close affordance (clicking outside)
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).not.toBeNull()
})

test('closes fullscreen overlay when clicking outside the diagram', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  const overlay = document.querySelector('[data-testid="fullscreen-overlay"]')
  await act(async () => { fireEvent.click(overlay) })
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).toBeNull()
})

test('closes fullscreen overlay on Escape key', async () => {
  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(document.querySelector('[data-testid="fullscreen-overlay"]')).toBeNull()
})

test('calls mermaid.render a second time when fullscreen opens', async () => {
  const { render: mermaidRender } = await import('mermaid')
  mermaidRender.mockClear()

  await act(async () => {
    render(<OverviewTab analysis={analysisWithDiagram} />)
  })
  // First render (inline)
  expect(mermaidRender).toHaveBeenCalledTimes(1)

  await act(async () => { fireEvent.click(screen.getByTitle('Fullscreen')) })
  // Second render (fullscreen container)
  expect(mermaidRender).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd client && npx vitest run tests/components/OverviewTab.test.jsx 2>&1 | tail -10
```

Expected: FAIL — OverviewTab doesn't have diagram/fullscreen yet.

- [ ] **Step 3: Replace `client/src/components/Panel/OverviewTab.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }

export default function OverviewTab({ analysis }) {
  const [fullscreen, setFullscreen] = useState(false)
  const inlineRef = useRef(null)
  const fullscreenRef = useRef(null)
  const renderIdRef = useRef(0)

  useEffect(() => {
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark' })
      mermaidInitialized = true
    }
  }, [])

  // Re-render diagram whenever diagram text changes or fullscreen toggles
  useEffect(() => {
    const target = fullscreen ? fullscreenRef.current : inlineRef.current
    if (!analysis?.diagram || !target) return
    const id = `mermaid-overview-${++renderIdRef.current}`
    mermaid.render(id, analysis.diagram)
      .then(({ svg }) => { if (target) target.innerHTML = svg })
      .catch(() => { if (target) target.innerHTML = '<p style="color:#f87171;margin:0">Failed to render diagram</p>' })
  }, [analysis?.diagram, fullscreen])

  // Escape key closes fullscreen
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  if (!analysis) return <p style={{ color: '#64748b' }}>No analysis yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {analysis.description && (
        <section>
          <label style={labelStyle}>Description</label>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{analysis.description}</p>
        </section>
      )}

      {analysis.call_parameters?.length > 0 && (
        <section>
          <label style={labelStyle}>Call Parameters</label>
          {analysis.call_parameters.map((p, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: '#94a3b8', fontSize: 12, marginLeft: 8 }}>{p.type}</span>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>
            </div>
          ))}
        </section>
      )}

      <section>
        <label style={labelStyle}>Diagram</label>
        {!analysis.diagram ? (
          <p style={{ color: '#64748b', fontSize: 12 }}>Diagram not available.</p>
        ) : (
          <>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setFullscreen(true)}
                title="Fullscreen"
                style={{
                  position: 'absolute', top: 4, right: 4, zIndex: 2,
                  background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
                  borderRadius: 4, padding: '2px 6px', fontSize: 14, cursor: 'pointer',
                }}
              >⛶</button>
              <div ref={inlineRef} style={{ overflowX: 'auto' }} />
            </div>

            {fullscreen && (
              <div
                data-testid="fullscreen-overlay"
                onClick={() => setFullscreen(false)}
                style={{
                  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  zIndex: 100,
                }}
              >
                <div
                  ref={fullscreenRef}
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#1e293b', borderRadius: 8, padding: 24,
                    maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto',
                  }}
                />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd client && npx vitest run tests/components/OverviewTab.test.jsx 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Panel/OverviewTab.jsx client/tests/components/OverviewTab.test.jsx
git commit -m "feat: add diagram rendering and fullscreen to OverviewTab"
```

---

## Task 5: ConnectionsTab external calls section

**Files:**
- Modify: `client/src/components/Panel/ConnectionsTab.jsx`
- Modify: `client/tests/components/ConnectionsTab.test.jsx`

### Context

Add an `analysis` prop to `ConnectionsTab`. If `analysis.external_calls` is non-empty, render a new "External Calls" section below the existing Programs sections. Format: `program_name (using_param)` in monospace, no click navigation. Existing Programs/edges logic is unchanged.

- [ ] **Step 1: Add failing tests to `client/tests/components/ConnectionsTab.test.jsx`**

Append these tests to the existing file:

```jsx
// --- External Calls section ---

test('renders External Calls section with program (using) format', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_calls: [
        { program: 'c_writelnkarea', using: 'PGM-NM' },
        { program: 'c_getplenv', using: 'WGET-USR' },
      ]}}
    />
  )
  expect(screen.getByText('c_writelnkarea (PGM-NM)')).toBeInTheDocument()
  expect(screen.getByText('c_getplenv (WGET-USR)')).toBeInTheDocument()
})

test('hides External Calls section when external_calls is empty', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={{ external_calls: [] }}
    />
  )
  expect(screen.queryByText(/external calls/i)).not.toBeInTheDocument()
})

test('hides External Calls section when analysis is null', () => {
  render(
    <ConnectionsTab
      edges={[]}
      programId="p1"
      onNavigate={() => {}}
      analysis={null}
    />
  )
  expect(screen.queryByText(/external calls/i)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd client && npx vitest run tests/components/ConnectionsTab.test.jsx 2>&1 | tail -10
```

Expected: 3 new failures.

- [ ] **Step 3: Update `client/src/components/Panel/ConnectionsTab.jsx`**

Replace the file content:

```jsx
export default function ConnectionsTab({ edges, programId, onNavigate, analysis }) {
  const incoming = edges.filter(e => e.to_program_id === programId)
  const outgoing = edges.filter(e => e.from_program_id === programId)
  const externalCalls = analysis?.external_calls ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>Called by ({incoming.length})</label>
        {incoming.length === 0 ? <p style={emptyStyle}>None</p> : incoming.map((e, i) => (
          <div key={i} style={rowStyle} onClick={() => onNavigate(e.from_program_id)} className="clickable">
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
            <div
              key={i}
              style={rowStyle}
              onClick={() => clickable && onNavigate(e.to_program_id)}
            >
              <span style={{ color: clickable ? '#60a5fa' : '#64748b', cursor: clickable ? 'pointer' : 'default' }}>
                {e.to_program_name}
              </span>
              {isPending && <span style={badgeStyle}>not analyzed</span>}
              {isUnknown && <span style={badgeStyle}>not uploaded</span>}
            </div>
          )
        })}
      </section>

      {externalCalls.length > 0 && (
        <section>
          <label style={labelStyle}>External Calls ({externalCalls.length})</label>
          {externalCalls.map((c, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>
                {c.program}{c.using ? ` (${c.using})` : ''}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const emptyStyle = { color: '#475569', fontSize: 12, margin: 0 }
const badgeStyle = { fontSize: 10, color: '#475569', marginLeft: 8 }
```

- [ ] **Step 4: Run all client tests to verify everything passes**

```bash
cd client && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Panel/ConnectionsTab.jsx client/tests/components/ConnectionsTab.test.jsx
git commit -m "feat: add External Calls section to ConnectionsTab"
```

---

## Task 6: DetailPanel tab restructure + resizable panel

**Files:**
- Modify: `client/src/components/Panel/DetailPanel.jsx`
- Delete: `client/src/components/Panel/LogicBlocksTab.jsx`
- Delete: `client/src/components/Panel/DiagramTab.jsx`

### Context

Final wiring task. Updates DetailPanel to:
1. Use `['Overview', 'Connections', 'Data']` tabs
2. Remove Logic Blocks and Diagram tab renders
3. Import and render DataTab
4. Pass `analysis={program.analysis}` to ConnectionsTab
5. Add resizable panel: `width` state from localStorage, drag handle on left edge

After this task, `LogicBlocksTab.jsx` and `DiagramTab.jsx` are deleted.

- [ ] **Step 1: Read the current DetailPanel to understand existing structure**

File: `client/src/components/Panel/DetailPanel.jsx` (already read — see context above)

- [ ] **Step 2: Replace `client/src/components/Panel/DetailPanel.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react'
import { fetchProgram, deleteProgram } from '../../api/programs.js'
import OverviewTab from './OverviewTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'
import DataTab from './DataTab.jsx'

const TABS = ['Overview', 'Connections', 'Data']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

function eventIcon(event) {
  if (event.message && (event.message.includes('failed') || event.stage === 'failed')) {
    return { icon: '✗', color: '#f87171' }
  }
  if (event.durationMs != null) {
    return { icon: '✓', color: '#4ade80' }
  }
  return { icon: '▶', color: '#94a3b8' }
}

function ProgressUI({ progressEvents }) {
  const logRef = useRef(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progressEvents.length])

  const latestChunk = [...progressEvents].reverse().find(e => e.stage === 'chunk' && e.total)
  const latestEvent = progressEvents[progressEvents.length - 1]
  const progressPercent = latestChunk
    ? Math.round((latestChunk.chunkIndex / latestChunk.total) * 100)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
          {latestEvent ? latestEvent.message : 'Analyzing…'}
        </div>
        <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
          {progressPercent != null ? (
            <div style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: '#60a5fa',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          ) : (
            <div style={{
              height: '100%',
              width: '40%',
              background: '#60a5fa',
              borderRadius: 2,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          )}
        </div>
        {progressPercent != null && (
          <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
            {latestChunk.chunkIndex} / {latestChunk.total} chunks ({progressPercent}%)
          </div>
        )}
      </div>
      <div
        ref={logRef}
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          fontSize: 11,
          fontFamily: 'monospace',
        }}
      >
        {progressEvents.map((event, i) => {
          const { icon, color } = eventIcon(event)
          const duration = event.durationMs != null ? ` (${event.durationMs}ms)` : ''
          return (
            <div key={i} style={{ display: 'flex', gap: 6, color: '#94a3b8' }}>
              <span style={{ color, flexShrink: 0 }}>{icon}</span>
              <span>{event.message}{duration}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DetailPanel({ programId, onClose, onNavigate, onDeleted, progressForId, progressEvents = [], refreshTrigger = 0 }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [width, setWidth] = useState(() => parseInt(localStorage.getItem('panelWidth') || '340'))

  useEffect(() => {
    if (!programId) return
    setProgram(null)
    setTab('Overview')
    setDeleteError(null)
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId])

  useEffect(() => {
    if (!programId || refreshTrigger === 0) return
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId, refreshTrigger])

  function startResize(e) {
    e.preventDefault()
    const onMove = (e) => {
      const newWidth = Math.min(600, Math.max(280, window.innerWidth - e.clientX))
      setWidth(newWidth)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setWidth(w => { localStorage.setItem('panelWidth', String(w)); return w })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function handleDelete() {
    if (!programId || deleting) return
    const confirmed = window.confirm('Delete this program and all related data?')
    if (!confirmed) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProgram(programId)
      onDeleted?.(programId)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  if (!programId) return null

  const isAnalyzing = programId === progressForId && progressEvents.length > 0

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width, height: '100%',
      background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column',
      zIndex: 10, overflowY: 'hidden',
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        style={{ position: 'absolute', left: 0, top: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 11 }}
      />

      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{program?.name || '…'}</div>
          {program && <div style={{ fontSize: 11, color: STATUS_COLOR[program.status], marginTop: 2 }}>● {program.status}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleDelete}
            disabled={deleting || program?.status === 'analyzing'}
            title={program?.status === 'analyzing' ? 'Cannot delete while analyzing' : 'Delete program'}
            style={{
              background: '#7f1d1d',
              border: '1px solid #991b1b',
              color: '#fecaca',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 11,
              cursor: deleting || program?.status === 'analyzing' ? 'not-allowed' : 'pointer',
              opacity: deleting || program?.status === 'analyzing' ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#0f172a', borderBottom: '1px solid #334155' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #60a5fa' : '2px solid transparent',
            color: tab === t ? '#60a5fa' : '#475569', fontSize: 12, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
        {deleteError && (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>
        )}
        {isAnalyzing && (
          <div style={{ marginBottom: 16 }}>
            <ProgressUI progressEvents={progressEvents} />
          </div>
        )}
        {!program ? <p style={{ color: '#64748b' }}>Loading…</p> : (
          <>
            {tab === 'Overview' && <OverviewTab analysis={program.analysis} />}
            {tab === 'Connections' && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />}
            {tab === 'Data' && <DataTab analysis={program.analysis} />}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add resize tests to `client/tests/components/DetailPanel.test.jsx`**

Append these tests to the existing file (after the last test):

```jsx
import { fireEvent } from '@testing-library/react'

// --- Resizable panel ---

test('restores panel width from localStorage on mount', async () => {
  localStorage.setItem('panelWidth', '450')
  const { container } = render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})
  const panel = container.firstChild
  expect(panel.style.width).toBe('450px')
  localStorage.removeItem('panelWidth')
})

test('defaults panel width to 340 when localStorage is empty', async () => {
  localStorage.removeItem('panelWidth')
  const { container } = render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})
  const panel = container.firstChild
  expect(panel.style.width).toBe('340px')
})

test('clamps panel width to minimum 280 during resize', async () => {
  const { container } = render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  // clientX near the right edge → width would be < 280 → clamped
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 100 })
  fireEvent.mouseUp(document)

  const panel = container.firstChild
  const w = parseInt(panel.style.width)
  expect(w).toBeGreaterThanOrEqual(280)
})

test('clamps panel width to maximum 600 during resize', async () => {
  const { container } = render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  // clientX near 0 → width would be > 600 → clamped
  fireEvent.mouseMove(document, { clientX: 0 })
  fireEvent.mouseUp(document)

  const panel = container.firstChild
  const w = parseInt(panel.style.width)
  expect(w).toBeLessThanOrEqual(600)
})

test('persists panel width to localStorage on mouseup', async () => {
  localStorage.removeItem('panelWidth')
  const { container } = render(
    <DetailPanel
      programId="abc"
      progressForId={null}
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )
  await act(async () => {})

  const handle = container.firstChild.querySelector('[style*="col-resize"]')
  fireEvent.mouseDown(handle)
  fireEvent.mouseMove(document, { clientX: window.innerWidth - 400 })
  fireEvent.mouseUp(document)

  expect(localStorage.getItem('panelWidth')).not.toBeNull()
})
```

- [ ] **Step 4: Run resize tests to verify they fail**

```bash
cd client && npx vitest run tests/components/DetailPanel.test.jsx 2>&1 | tail -15
```

Expected: new resize tests fail (current DetailPanel has hardcoded 340, no drag handle).

- [ ] **Step 5: Delete removed files**

```bash
rm client/src/components/Panel/LogicBlocksTab.jsx
rm client/src/components/Panel/DiagramTab.jsx
```

- [ ] **Step 6: Run all client tests**

```bash
cd client && npx vitest run 2>&1 | tail -15
```

Expected: all tests pass. If any test imports `LogicBlocksTab` or `DiagramTab` directly, delete those test files too (they were for now-removed components).

- [ ] **Step 7: Run all server tests**

```bash
cd server && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Panel/DetailPanel.jsx client/tests/components/DetailPanel.test.jsx
git rm client/src/components/Panel/LogicBlocksTab.jsx client/src/components/Panel/DiagramTab.jsx
git commit -m "feat: restructure Detail Panel tabs (Overview/Connections/Data), add resizable panel, remove Logic Blocks and Diagram tabs"
```

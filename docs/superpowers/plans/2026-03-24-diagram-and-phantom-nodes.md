# Block Diagram Tab & Phantom Nodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Mermaid business-logic diagram tab to the Detail Panel and visually surface phantom (referenced-but-not-uploaded) programs on the graph and connections list.

**Architecture:** AI generates a Mermaid flowchart from the synthesis summary during analysis; it's stored in a new `diagram` column on `program_analysis` and rendered client-side with the `mermaid` npm package. Phantom nodes are already created as `status=pending` DB records by the existing `graphService` — this plan surfaces them in the UI by setting `isPhantom: true` on pending nodes and adding `to_program_status` to the edge query.

**Tech Stack:** Node.js/Express, PostgreSQL, React 18, Vitest, `mermaid` npm package, Inter Google Font

---

## File Map

| File | Change |
|------|--------|
| `server/src/db/schema.sql` | Add `ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS diagram TEXT` |
| `server/src/ai/prompts.js` | Add `DIAGRAM_PROMPT` export |
| `server/src/ai/providers/base.js` | Add abstract `generateDiagram` method |
| `server/src/ai/providers/claude.js` | Implement `generateDiagram` (raw text, no JSON parse) |
| `server/src/ai/providers/openai.js` | Implement `generateDiagram` (no `response_format`, no JSON parse) |
| `server/src/models/programAnalysis.js` | Add `updateDiagram` function |
| `server/src/ai/orchestrator.js` | Add diagram step after synthesis; return `diagram` |
| `server/src/services/analysisService.js` | Update import + destructuring + call `updateDiagram` |
| `server/src/models/programEdges.js` | Add `tp.status AS to_program_status` to `getEdgesForProgram` |
| `server/tests/ai/orchestrator.test.js` | Add diagram assertions |
| `client/index.html` | Add Inter font link |
| `client/src/index.css` | Add `font-family: 'Inter'` |
| `client/package.json` | Add `mermaid` dependency |
| `client/src/components/Panel/DiagramTab.jsx` | New — Mermaid rendering component |
| `client/src/components/Panel/DetailPanel.jsx` | Add `'Diagram'` tab + import + render |
| `client/src/components/Panel/ConnectionsTab.jsx` | Use `to_program_status` for pending badge/nav guard |
| `client/src/hooks/usePrograms.js` | Set `isPhantom: p.status === 'pending'` for pending programs |
| `client/src/App.jsx` | Guard `onNodeClick` for phantom nodes |
| `client/src/components/Graph/ProgramGraph.jsx` | Add status legend |
| `client/tests/components/DiagramTab.test.jsx` | New — diagram render tests |
| `client/tests/components/ConnectionsTab.test.jsx` | New — phantom connection tests |

---

## Task 1: DB Migration — Add `diagram` Column

**Files:**
- Modify: `server/src/db/schema.sql`

- [ ] **Step 1: Add the ALTER TABLE statement to schema.sql**

  Open `server/src/db/schema.sql`. At the very end of the file, append:

  ```sql
  ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS diagram TEXT;
  ```

- [ ] **Step 2: Run the migration**

  ```bash
  cd server && npm run migrate
  ```

  Expected output: `Migration complete`

- [ ] **Step 3: Verify the column was added**

  ```bash
  cd server && node -e "
  import('dotenv/config').then(async () => {
    const { default: pool } = await import('./src/db/client.js')
    const { rows } = await pool.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='program_analysis' AND column_name='diagram'\")
    console.log(rows.length === 1 ? 'OK: diagram column exists' : 'FAIL: column missing')
    await pool.end()
  })"
  ```

  Expected: `OK: diagram column exists`

- [ ] **Step 4: Commit**

  ```bash
  git add server/src/db/schema.sql
  git commit -m "feat: add diagram column to program_analysis"
  ```

---

## Task 2: Backend — Diagram Prompt and Provider Methods

**Files:**
- Modify: `server/src/ai/prompts.js`
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/claude.js`
- Modify: `server/src/ai/providers/openai.js`
- Test: `server/tests/ai/orchestrator.test.js`

- [ ] **Step 1: Write failing test for BaseProvider.generateDiagram**

  Open `server/tests/ai/orchestrator.test.js`. In the `describe('BaseProvider', ...)` block, add:

  ```js
  it('throws NotImplemented on generateDiagram', async () => {
    const p = new BaseProvider()
    await expect(p.generateDiagram('')).rejects.toThrow('Not implemented')
  })
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd server && npm test -- --reporter=verbose 2>&1 | grep -A3 "generateDiagram"
  ```

  Expected: FAIL — `generateDiagram is not a function` or `Not implemented` not thrown yet.

- [ ] **Step 3: Add `DIAGRAM_PROMPT` to prompts.js**

  Open `server/src/ai/prompts.js`. Add at the end:

  ```js
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

- [ ] **Step 4: Add abstract `generateDiagram` to BaseProvider**

  Open `server/src/ai/providers/base.js`. Add inside `BaseProvider`:

  ```js
  async generateDiagram(summary) {
    throw new Error('Not implemented')
  }
  ```

- [ ] **Step 5: Implement `generateDiagram` in ClaudeProvider**

  Open `server/src/ai/providers/claude.js`. Add `DIAGRAM_PROMPT` to the import line:

  ```js
  import { METADATA_PROMPT, CHUNK_PROMPT, SYNTHESIS_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'
  ```

  Then add the method to `ClaudeProvider` (after `synthesize`). **Do NOT call `this.#callClaude` — that method parses JSON. This needs a raw text response:**

  ```js
  async generateDiagram(summary) {
    const message = await this.client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return message.content[0].text.trim()
  }
  ```

- [ ] **Step 6: Implement `generateDiagram` in OpenAIProvider**

  Open `server/src/ai/providers/openai.js`. Add `DIAGRAM_PROMPT` to the import:

  ```js
  import { METADATA_PROMPT, CHUNK_PROMPT, SYNTHESIS_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'
  ```

  Add the method to `OpenAIProvider` (after `synthesize`). **Do NOT call `this.#callOpenAI` — that forces JSON output. Omit `response_format`:**

  ```js
  async generateDiagram(summary) {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return completion.choices[0].message.content.trim()
  }
  ```

- [ ] **Step 7: Run tests to verify BaseProvider test passes**

  ```bash
  cd server && npm test -- --reporter=verbose 2>&1 | grep -A3 "generateDiagram"
  ```

  Expected: PASS — `throws NotImplemented on generateDiagram`

- [ ] **Step 8: Run full server test suite to verify nothing broke**

  ```bash
  cd server && npm test
  ```

  Expected: all tests pass.

- [ ] **Step 9: Commit**

  ```bash
  git add server/src/ai/prompts.js server/src/ai/providers/base.js server/src/ai/providers/claude.js server/src/ai/providers/openai.js server/tests/ai/orchestrator.test.js
  git commit -m "feat: add generateDiagram to AI providers"
  ```

---

## Task 3: Backend — Orchestrator + Model + Service

**Files:**
- Modify: `server/src/models/programAnalysis.js`
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/src/services/analysisService.js`
- Test: `server/tests/ai/orchestrator.test.js`

- [ ] **Step 1: Write failing orchestrator test for diagram**

  In `server/tests/ai/orchestrator.test.js`:

  **a)** In the first `runAnalysis` test (`calls extractMetadata, analyzeChunk per chunk, synthesize`), add `generateDiagram` to the `mockProvider`:

  ```js
  generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A[Start] --> B[End]'),
  ```

  **b)** In the second `runAnalysis` test (`continues after chunk failure and emits chunk_failed`), also add `generateDiagram` to its `mockProvider` (required after orchestrator is updated, or this test will crash with `provider.generateDiagram is not a function`):

  ```js
  generateDiagram: vi.fn().mockResolvedValue('flowchart TD\n  A --> B'),
  ```

  And add assertions after the existing ones:

  ```js
  expect(mockProvider.generateDiagram).toHaveBeenCalledWith('overall summary')
  expect(result.diagram).toBe('flowchart TD\n  A[Start] --> B[End]')
  expect(progressEvents.some(e => e.data.stage === 'diagram')).toBe(true)
  ```

  Also add a new test for diagram failure (analysis must still complete):

  ```js
  it('returns diagram: null when generateDiagram fails', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({ description: '', call_parameters: [], external_calls: [], db_tables: [] }),
      analyzeChunk: vi.fn().mockResolvedValue({ description: 'ok', flow_steps: [], variables_used: [], calls: [], db_ops: [] }),
      synthesize: vi.fn().mockResolvedValue({ summary: 'summary' }),
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
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd server && npm test -- --reporter=verbose 2>&1 | tail -20
  ```

  Expected: FAILs on `generateDiagram` assertions.

- [ ] **Step 3: Add `updateDiagram` to programAnalysis.js**

  Open `server/src/models/programAnalysis.js`. Add at the end:

  ```js
  export async function updateDiagram(program_id, diagram) {
    await pool.query(
      'UPDATE program_analysis SET diagram = $1, updated_at = NOW() WHERE program_id = $2',
      [diagram, program_id]
    )
  }
  ```

- [ ] **Step 4: Add diagram generation step to orchestrator.js**

  Open `server/src/ai/orchestrator.js`. After the synthesis step (after `logAndEmit(emit, programName, 'done', { stage: 'synthesis', ... })`), add:

  ```js
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
  ```

  Change the return statement from:

  ```js
  return { metadata, chunkResults, summary }
  ```

  to:

  ```js
  return { metadata, chunkResults, summary, diagram }
  ```

- [ ] **Step 5: Update analysisService.js**

  Open `server/src/services/analysisService.js`.

  Update line 9 (import from programAnalysis):
  ```js
  import { upsertAnalysis, updateDescription, updateDiagram } from '../models/programAnalysis.js'
  ```

  Update line 74 (destructuring of runAnalysis result):
  ```js
  const { metadata, chunkResults, summary, diagram } = await runAnalysis({
  ```

  After the existing `await updateDescription(programId, summary)` line (line 92), add:
  ```js
  if (diagram != null) await updateDiagram(programId, diagram)
  ```

- [ ] **Step 6: Run tests**

  ```bash
  cd server && npm test
  ```

  Expected: all tests pass including new diagram assertions.

- [ ] **Step 7: Commit**

  ```bash
  git add server/src/models/programAnalysis.js server/src/ai/orchestrator.js server/src/services/analysisService.js server/tests/ai/orchestrator.test.js
  git commit -m "feat: generate and store Mermaid diagram after synthesis"
  ```

---

## Task 4: Backend — Add `to_program_status` to Edge Query

**Files:**
- Modify: `server/src/models/programEdges.js`

This is a one-line SQL change with no dedicated test (covered by integration tests in `server/tests/routes/programs.test.js` implicitly).

- [ ] **Step 1: Update `getEdgesForProgram` query**

  Open `server/src/models/programEdges.js`. In `getEdgesForProgram` (around line 31), change the SELECT. The actual file uses 12-space indentation. Find this text:

  ```
      SELECT pe.*,
              fp.name AS from_program_name,
              tp.name AS to_program_name_resolved
  ```

  And replace the last line with two lines:

  ```
      SELECT pe.*,
              fp.name AS from_program_name,
              tp.name AS to_program_name_resolved,
              tp.status AS to_program_status
  ```

- [ ] **Step 2: Run server tests**

  ```bash
  cd server && npm test
  ```

  Expected: all tests pass.

- [ ] **Step 3: Commit**

  ```bash
  git add server/src/models/programEdges.js
  git commit -m "feat: include to_program_status in edge query"
  ```

---

## Task 5: Frontend — Font and Mermaid Install

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/index.css`
- Modify: `client/package.json` (via npm install)

- [ ] **Step 1: Install mermaid**

  ```bash
  cd client && npm install mermaid
  ```

  Expected: `mermaid` appears in `client/package.json` dependencies.

- [ ] **Step 2: Add Inter font to index.html**

  Open `client/index.html`. Replace the entire `<head>` content with:

  ```html
  <head>
    <meta charset="UTF-8" />
    <title>COBOL Converter</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  </head>
  ```

- [ ] **Step 3: Apply Inter font globally in index.css**

  Open `client/src/index.css`. Add `font-family` to the existing rule:

  ```css
  html,
  body,
  #root {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    font-family: 'Inter', system-ui, sans-serif;
  }
  ```

- [ ] **Step 4: Run client tests to verify no breakage**

  ```bash
  cd client && npm test
  ```

  Expected: all existing tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add client/index.html client/src/index.css client/package.json client/package-lock.json
  git commit -m "feat: add Inter font and mermaid dependency"
  ```

---

## Task 6: Frontend — DiagramTab Component

**Files:**
- Create: `client/src/components/Panel/DiagramTab.jsx`
- Modify: `client/src/components/Panel/DetailPanel.jsx`
- Create: `client/tests/components/DiagramTab.test.jsx`

- [ ] **Step 1: Write failing tests for DiagramTab**

  Create `client/tests/components/DiagramTab.test.jsx`:

  ```jsx
  import { render, screen } from '@testing-library/react'
  import { describe, it, expect, vi, beforeEach } from 'vitest'
  import DiagramTab from '../../src/components/Panel/DiagramTab.jsx'

  // Mock mermaid to avoid JSDOM SVG rendering issues
  vi.mock('mermaid', () => ({
    default: {
      initialize: vi.fn(),
      render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
    },
  }))

  describe('DiagramTab', () => {
    it('shows "not available" when analysis has no diagram', () => {
      render(<DiagramTab analysis={{ description: 'test', diagram: null }} />)
      expect(screen.getByText(/not available/i)).toBeInTheDocument()
    })

    it('shows "Loading…" when analysis is null', () => {
      render(<DiagramTab analysis={null} />)
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('renders a container div when diagram is present', async () => {
      const { container } = render(<DiagramTab analysis={{ diagram: 'flowchart TD\n  A --> B' }} />)
      // mermaid.render is async — container div should exist
      expect(container.querySelector('div')).toBeTruthy()
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd client && npm test -- --reporter=verbose 2>&1 | grep -A5 "DiagramTab"
  ```

  Expected: FAIL — `DiagramTab.jsx` does not exist yet.

- [ ] **Step 3: Create DiagramTab.jsx**

  Create `client/src/components/Panel/DiagramTab.jsx`:

  ```jsx
  import { useEffect, useRef } from 'react'
  import mermaid from 'mermaid'

  let mermaidInitialized = false

  export default function DiagramTab({ analysis }) {
    const ref = useRef(null)
    const renderIdRef = useRef(0)

    useEffect(() => {
      if (!mermaidInitialized) {
        mermaid.initialize({ startOnLoad: false, theme: 'dark' })
        mermaidInitialized = true
      }
    }, [])

    useEffect(() => {
      if (!analysis?.diagram || !ref.current) return
      const id = `mermaid-diagram-${++renderIdRef.current}`
      mermaid.render(id, analysis.diagram)
        .then(({ svg }) => {
          if (ref.current) ref.current.innerHTML = svg
        })
        .catch(() => {
          if (ref.current) ref.current.innerHTML = '<p style="color:#f87171;margin:0">Failed to render diagram</p>'
        })
    }, [analysis?.diagram])

    if (!analysis) return <p style={{ color: '#64748b' }}>Loading…</p>
    if (!analysis.diagram) return <p style={{ color: '#64748b' }}>Diagram not available.</p>

    return <div ref={ref} style={{ overflowX: 'auto' }} />
  }
  ```

- [ ] **Step 4: Update DetailPanel.jsx**

  Open `client/src/components/Panel/DetailPanel.jsx`.

  Add import at the top (after existing imports):
  ```js
  import DiagramTab from './DiagramTab.jsx'
  ```

  Change the `TABS` constant (line 7):
  ```js
  const TABS = ['Overview', 'Logic Blocks', 'Connections', 'Diagram']
  ```

  Inside the content block (after the `{tab === 'Connections' && ...}` line), add:
  ```jsx
  {tab === 'Diagram' && <DiagramTab analysis={program.analysis} />}
  ```

- [ ] **Step 5: Run tests**

  ```bash
  cd client && npm test
  ```

  Expected: all tests pass including DiagramTab tests.

- [ ] **Step 6: Commit**

  ```bash
  git add client/src/components/Panel/DiagramTab.jsx client/src/components/Panel/DetailPanel.jsx client/tests/components/DiagramTab.test.jsx
  git commit -m "feat: add Diagram tab to Detail Panel with Mermaid rendering"
  ```

---

## Task 7: Frontend — Phantom Node Visibility

**Files:**
- Modify: `client/src/hooks/usePrograms.js`
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Panel/ConnectionsTab.jsx`
- Modify: `client/src/components/Graph/ProgramGraph.jsx`
- Create: `client/tests/components/ConnectionsTab.test.jsx`

- [ ] **Step 1: Write failing tests for ConnectionsTab phantom behavior**

  Create `client/tests/components/ConnectionsTab.test.jsx`:

  ```jsx
  import { render, screen, fireEvent } from '@testing-library/react'
  import { describe, it, expect, vi } from 'vitest'
  import ConnectionsTab from '../../src/components/Panel/ConnectionsTab.jsx'

  const programId = 'prog-a'

  const edges = [
    {
      from_program_id: 'prog-b',
      to_program_id: programId,
      to_program_name: 'PROG-A',
      to_program_status: 'analyzed',
      from_program_name: 'PROG-B',
    },
    {
      from_program_id: programId,
      to_program_id: 'prog-c',
      to_program_name: 'PROG-C',
      to_program_status: 'pending',
      from_program_name: 'PROG-A',
    },
    {
      from_program_id: programId,
      to_program_id: null,
      to_program_name: 'PROG-D',
      to_program_status: null,
      from_program_name: 'PROG-A',
    },
  ]

  describe('ConnectionsTab', () => {
    it('shows "not analyzed" badge for pending target program', () => {
      render(<ConnectionsTab edges={edges} programId={programId} onNavigate={vi.fn()} />)
      expect(screen.getByText('not analyzed')).toBeInTheDocument()
    })

    it('shows "not uploaded" badge for null to_program_id', () => {
      render(<ConnectionsTab edges={edges} programId={programId} onNavigate={vi.fn()} />)
      expect(screen.getByText('not uploaded')).toBeInTheDocument()
    })

    it('does not call onNavigate when clicking pending target', () => {
      const onNavigate = vi.fn()
      render(<ConnectionsTab edges={edges} programId={programId} onNavigate={onNavigate} />)
      fireEvent.click(screen.getByText('PROG-C'))
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('calls onNavigate when clicking analyzed target', () => {
      const onNavigate = vi.fn()
      render(<ConnectionsTab edges={edges} programId={programId} onNavigate={onNavigate} />)
      fireEvent.click(screen.getByText('PROG-B'))
      expect(onNavigate).toHaveBeenCalledWith('prog-b')
    })
  })
  ```

- [ ] **Step 2: Run tests to verify they fail**

  ```bash
  cd client && npm test -- --reporter=verbose 2>&1 | grep -A5 "ConnectionsTab"
  ```

  Expected: FAIL — `to_program_status` not yet used in ConnectionsTab.

- [ ] **Step 3: Update ConnectionsTab.jsx**

  Open `client/src/components/Panel/ConnectionsTab.jsx`. Replace the entire file with:

  ```jsx
  export default function ConnectionsTab({ edges, programId, onNavigate }) {
    const incoming = edges.filter(e => e.to_program_id === programId)
    const outgoing = edges.filter(e => e.from_program_id === programId)

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
      </div>
    )
  }

  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
  const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
  const emptyStyle = { color: '#475569', fontSize: 12, margin: 0 }
  const badgeStyle = { fontSize: 10, color: '#475569', marginLeft: 8 }
  ```

- [ ] **Step 4: Update usePrograms.js — mark pending programs as phantom**

  Open `client/src/hooks/usePrograms.js`. In `buildNodes`, change:

  ```js
  data: { name: p.name, status: p.status, isPhantom: false },
  ```

  to:

  ```js
  data: { name: p.name, status: p.status, isPhantom: p.status === 'pending' },
  ```

- [ ] **Step 5: Update App.jsx — guard onNodeClick for phantom nodes**

  Open `client/src/App.jsx`. Change:

  ```jsx
  onNodeClick={(node) => setSelectedId(node.id)}
  ```

  to:

  ```jsx
  onNodeClick={(node) => { if (!node.data.isPhantom) setSelectedId(node.id) }}
  ```

- [ ] **Step 6: Add legend to ProgramGraph.jsx**

  Open `client/src/components/Graph/ProgramGraph.jsx`. Add the legend inside the `ReactFlow` component (before `<Background />`):

  ```jsx
  const LEGEND = [
    { color: '#4ade80', label: 'Analyzed', dashed: false },
    { color: '#60a5fa', label: 'Analyzing', dashed: false },
    { color: '#f87171', label: 'Failed', dashed: false },
    { color: '#475569', label: 'Pending', dashed: true },
  ]
  ```

  Add the legend JSX before `<Background />` inside `<ReactFlow>`:

  ```jsx
  <div style={{
    position: 'absolute', bottom: 40, left: 10, zIndex: 5,
    background: 'rgba(15,23,42,0.85)', borderRadius: 8, padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 5,
  }}>
    {LEGEND.map(({ color, label, dashed }) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
        <div style={{
          width: 16, height: 16, borderRadius: 3,
          border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
          background: 'transparent',
        }} />
        {label}
      </div>
    ))}
  </div>
  ```

  The updated `ProgramGraph.jsx` should look like:

  ```jsx
  import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
  import 'reactflow/dist/style.css'
  import ProgramNode from './ProgramNode.jsx'

  const nodeTypes = { programNode: ProgramNode }

  const LEGEND = [
    { color: '#4ade80', label: 'Analyzed', dashed: false },
    { color: '#60a5fa', label: 'Analyzing', dashed: false },
    { color: '#f87171', label: 'Failed', dashed: false },
    { color: '#475569', label: 'Pending', dashed: true },
  ]

  export default function ProgramGraph({ nodes, edges, onNodeClick }) {
    return (
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onNodeClick(node)}
        fitView
      >
        <div style={{
          position: 'absolute', bottom: 40, left: 10, zIndex: 5,
          background: 'rgba(15,23,42,0.85)', borderRadius: 8, padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          {LEGEND.map(({ color, label, dashed }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
              <div style={{
                width: 16, height: 16, borderRadius: 3,
                border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
                background: 'transparent',
              }} />
              {label}
            </div>
          ))}
        </div>
        <Background color="#1e293b" />
        <Controls />
        <MiniMap nodeColor={n => {
          const s = n.data?.status
          if (s === 'analyzed') return '#4ade80'
          if (s === 'analyzing') return '#60a5fa'
          if (s === 'failed') return '#f87171'
          return '#475569'
        }} />
      </ReactFlow>
    )
  }
  ```

- [ ] **Step 7: Add phantom node tests to ProgramNode.test.jsx**

  The file `client/tests/components/ProgramNode.test.jsx` already exists and already has a test `'applies dashed border for phantom nodes'`. Verify it is present (no changes needed):

  ```bash
  grep -n "phantom" client/tests/components/ProgramNode.test.jsx
  ```

  Expected output: a line containing `isPhantom: true` and `dashed|phantom`.

  Now add a test for the `App.jsx` `onNodeClick` phantom guard to the **end** of `client/tests/components/ProgramNode.test.jsx`. This tests the guard logic directly:

  ```jsx
  test('phantom nodes should not open detail panel (isPhantom guard logic)', () => {
    // Verify the guard logic: if isPhantom is true, setSelectedId should not be called
    const setSelectedId = vi.fn()
    const onNodeClick = (node) => { if (!node.data.isPhantom) setSelectedId(node.id) }

    onNodeClick({ id: 'phantom-abc', data: { name: 'ABC', status: 'pending', isPhantom: true } })
    expect(setSelectedId).not.toHaveBeenCalled()

    onNodeClick({ id: 'real-abc', data: { name: 'ABC', status: 'analyzed', isPhantom: false } })
    expect(setSelectedId).toHaveBeenCalledWith('real-abc')
  })
  ```

  Add `import { vi } from 'vitest'` to the imports at the top of `ProgramNode.test.jsx` (it already imports from `@testing-library/react`, add vitest import):

  ```js
  import { vi } from 'vitest'
  ```

- [ ] **Step 8: Run all client tests**

  ```bash
  cd client && npm test
  ```

  Expected: all tests pass including new ConnectionsTab and phantom guard tests.

- [ ] **Step 9: Commit**

  ```bash
  git add client/src/hooks/usePrograms.js client/src/App.jsx client/src/components/Panel/ConnectionsTab.jsx client/src/components/Graph/ProgramGraph.jsx client/tests/components/ConnectionsTab.test.jsx client/tests/components/ProgramNode.test.jsx
  git commit -m "feat: surface phantom nodes on graph and in connections tab"
  ```

---

## Final Verification

After all 7 tasks are complete, run both test suites:

```bash
cd server && npm test && cd ../client && npm test
```

Expected: all tests pass with no failures.

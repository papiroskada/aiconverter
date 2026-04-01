# Progress Tracking & Backend Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add colored backend console logging and a real-time progress bar + log feed in the Detail Panel while a COBOL file is being analyzed.

**Architecture:** A new `logger.js` module wraps `picocolors` for console output. The orchestrator emits a new `progress` SSE event at each analysis step alongside the console log. The frontend accumulates `progress` events in `App.jsx` state and passes them to `DetailPanel` as props — no second SSE connection needed.

**Tech Stack:** Node.js/Express (backend), React 18 + Vite (frontend), `picocolors` (already in server/node_modules via vitest), Vitest + @testing-library/react (tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/logger.js` | Create | Colored console output using picocolors |
| `server/src/ai/orchestrator.js` | Modify | Add `programName` param, `logAndEmit` helper, progress events |
| `server/src/services/analysisService.js` | Modify | Pass `programName` to orchestrator, emit parsing events, emit fatal error progress |
| `client/src/hooks/useSSE.js` | Modify | Add `progress` to listened SSE event types |
| `client/src/App.jsx` | Modify | Remove toast, accumulate `progressEvents` array, pass to DetailPanel |
| `client/src/components/Panel/DetailPanel.jsx` | Modify | Add progress bar + scrollable log feed |
| `server/tests/ai/orchestrator.test.js` | Modify | Add `programName` to call, assert `progress` events emitted |
| `client/tests/components/DetailPanel.test.jsx` | Create | Test progress UI renders when analyzing |

---

## Task 1: Create the Logger Module

**Files:**
- Create: `server/src/logger.js`

`picocolors` is already in `server/node_modules` (installed as a transitive dep of vitest). Import it directly. If you get a module-not-found error, run `cd server && npm install picocolors` to make it an explicit dependency.

- [ ] **Step 1: Create `server/src/logger.js`**

```js
import pc from 'picocolors'

function timestamp() {
  return pc.gray(new Date().toTimeString().slice(0, 8))
}

function programTag(name) {
  return pc.cyan(`[${name}]`)
}

export const logger = {
  start(programName, message) {
    console.log(`${timestamp()} ${programTag(programName)} ${pc.yellow('▶')} ${message}`)
  },
  done(programName, message, durationMs) {
    const duration = durationMs != null ? pc.gray(` (${durationMs}ms)`) : ''
    console.log(`${timestamp()} ${programTag(programName)} ${pc.green('✓')} ${message}${duration}`)
  },
  error(programName, message, durationMs) {
    const duration = durationMs != null ? pc.gray(` (${durationMs}ms)`) : ''
    console.log(`${timestamp()} ${programTag(programName)} ${pc.red('✗')} ${message}${duration}`)
  },
}
```

- [ ] **Step 2: Manual visual check**

Temporarily add to `server/server.js` (top of file, remove after check):
```js
import { logger } from './src/logger.js'
logger.start('ARERCD', 'Parsing COBOL file...')
logger.done('ARERCD', 'Parsed 47 chunks', 230)
logger.error('ARERCD', 'Chunk 3 failed: timeout', 2000)
```

Run: `cd server && node server.js`

Expected: three colored lines in terminal — yellow ▶, green ✓, red ✗ — with grey timestamp and cyan program name.

Remove the test lines from `server.js` after confirming.

- [ ] **Step 3: Commit**

```bash
git add server/src/logger.js
git commit -m "feat: add colored console logger module"
```

---

## Task 2: Update Orchestrator — Add `programName` and Progress Events

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

- [ ] **Step 1: Update the existing orchestrator tests first (TDD)**

Open `server/tests/ai/orchestrator.test.js`. The existing `runAnalysis` calls don't pass `programName`. Update both test calls to include it, and add assertions for `progress` events:

In the `'calls extractMetadata, analyzeChunk per chunk, synthesize'` test — add `programName: 'TEST'` to the `runAnalysis` call and add these assertions at the end:

```js
// Add programName to the existing call:
const result = await runAnalysis({
  cobolText: 'IDENTIFICATION DIVISION.',
  chunks,
  provider: mockProvider,
  emit: mockEmit,
  programName: 'TEST',  // <-- add this
})

// Add these new assertions after existing ones:
const progressEvents = events.filter(e => e.event === 'progress')
expect(progressEvents.some(e => e.data.stage === 'metadata')).toBe(true)
expect(progressEvents.some(e => e.data.stage === 'chunk')).toBe(true)
expect(progressEvents.some(e => e.data.stage === 'synthesis')).toBe(true)
// chunk progress events include index and total
const chunkProgress = progressEvents.find(e => e.data.stage === 'chunk' && e.data.chunkIndex)
expect(chunkProgress.data.total).toBe(1)
expect(chunkProgress.data.chunkIndex).toBe(1)
```

In the `'continues after chunk failure'` test — add `programName: 'TEST'` to the `runAnalysis` call:

```js
const result = await runAnalysis({
  cobolText: '',
  chunks,
  provider: mockProvider,
  emit: (event, data) => events.push({ event, data }),
  programName: 'TEST',  // <-- add this
})

// Add after existing assertions:
const progressEvents = events.filter(e => e.event === 'progress')
expect(progressEvents.some(e => e.data.stage === 'chunk' && e.data.message.includes('failed'))).toBe(true)
```

- [ ] **Step 2: Run the tests — expect them to FAIL**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

Expected: tests fail because `runAnalysis` doesn't emit `progress` events yet and doesn't accept `programName`.

- [ ] **Step 3: Rewrite `server/src/ai/orchestrator.js`**

```js
import { logger } from '../logger.js'

function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
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

  // Step 3: synthesize
  const ts = Date.now()
  logAndEmit(emit, programName, 'start', { stage: 'synthesis', message: 'Synthesizing summary...' })
  const descriptions = chunkResults
    .filter(r => r.analysis)
    .map(r => `${r.chunk.chunk_name}: ${r.analysis.description}`)
    .join('\n')
  const { summary } = await provider.synthesize(descriptions)
  logAndEmit(emit, programName, 'done', { stage: 'synthesis', message: 'Synthesis done', durationMs: Date.now() - ts })
  emit('done', { summary })

  return { metadata, chunkResults, summary }
}
```

- [ ] **Step 4: Run tests — expect them to PASS**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js
git commit -m "feat: add progress events and logging to orchestrator"
```

---

## Task 3: Update Analysis Service — Parsing Events and `programName`

**Files:**
- Modify: `server/src/services/analysisService.js`

No new tests needed here — the integration is covered by existing routes tests and the orchestrator tests above. Just update the service to wire things together.

- [ ] **Step 1: Update `server/src/services/analysisService.js`**

In `uploadAndStartAnalysis`: add `emit` helper at the top of the function (it's already built in `runAnalysisInBackground` — extract it or duplicate minimally), emit parsing events around `parseCobol`/`insertChunks`, and pass `programName` to `runAnalysisInBackground`.

In `runAnalysisInBackground`: pass `programName` to `runAnalysis` and emit a fatal `progress` event in the catch block.

In `reanalyze`: pass `programName` to `runAnalysisInBackground`.

Full updated file:

```js
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { logger } from '../logger.js'
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath } from '../models/programs.js'
import { upsertAnalysis, updateDescription } from '../models/programAnalysis.js'
import { insertChunks, updateChunkAnalysis, markChunkFailed, getRetryableChunks } from '../models/programChunks.js'
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

  // Create or find program record
  let program = await findProgramByName(programName)
  if (!program) {
    program = await createProgram({ name: programName, status: 'analyzing' })
  } else {
    if (program.status === 'analyzing') {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
  }

  // Save file to disk
  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  writeFileSync(filePath, cobolText)
  await updateFilePath(program.id, filePath)

  // Backfill phantom edges that referenced this program name
  await backfillEdgesForNewProgram(program)

  // Emit helper for parsing events (before analysis background task starts)
  const emit = makeEmit(program.id, sseEmitters)

  // Parse COBOL into chunks (sync, fast)
  const t0 = Date.now()
  logger.start(programName, 'Parsing COBOL file...')
  emit('progress', { stage: 'parsing', message: 'Parsing COBOL file...' })
  const parsedChunks = parseCobol(cobolText)
  const savedChunks = await insertChunks(program.id, parsedChunks)
  const parseDuration = Date.now() - t0
  logger.done(programName, `Parsed ${savedChunks.length} chunks`, parseDuration)
  emit('progress', { stage: 'parsing', message: `Parsed ${savedChunks.length} chunks`, durationMs: parseDuration })

  // Start AI analysis in background (non-blocking)
  runAnalysisInBackground(program.id, programName, cobolText, savedChunks, sseEmitters)

  return program
}

async function runAnalysisInBackground(programId, programName, cobolText, parsedChunks, sseEmitters) {
  const provider = getProvider()
  const emit = makeEmit(programId, sseEmitters)

  try {
    const { metadata, chunkResults, summary } = await runAnalysis({
      cobolText,
      chunks: parsedChunks,
      provider,
      emit,
      programName,
    })

    // Save metadata
    await upsertAnalysis({ program_id: programId, ...metadata })

    // Save chunk results
    for (const { chunk, analysis, error } of chunkResults) {
      if (chunk.id && analysis) await updateChunkAnalysis(chunk.id, analysis)
      else if (chunk.id && error) await markChunkFailed(chunk.id)
    }

    // Save synthesis summary
    await updateDescription(programId, summary)

    // Update graph
    await updateGraphAfterAnalysis(programId, metadata.external_calls)

    await updateProgramStatus(programId, 'analyzed')
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
  const retryChunks = await getRetryableChunks(programId)

  runAnalysisInBackground(programId, program.name, cobolText, retryChunks, sseEmitters)
}
```

- [ ] **Step 2: Run all server tests**

```bash
cd server && npm test
```

Expected: all tests pass (routes tests, orchestrator tests, parser tests, graph service tests).

- [ ] **Step 3: Commit**

```bash
git add server/src/services/analysisService.js
git commit -m "feat: wire progress events and logging in analysis service"
```

---

## Task 4: Update `useSSE` — Listen to `progress` Events

**Files:**
- Modify: `client/src/hooks/useSSE.js`

- [ ] **Step 1: Update `client/src/hooks/useSSE.js`**

Change line 19 — add `'progress'` to the array:

```js
;['chunk_done', 'metadata', 'done', 'failed', 'progress'].forEach(event =>
  es.addEventListener(event, handle)
)
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useSSE.js
git commit -m "feat: listen to progress SSE events in useSSE hook"
```

---

## Task 5: Update `App.jsx` — Remove Toast, Accumulate Progress Events

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Rewrite `client/src/App.jsx`**

`analyzingId` tracks the active SSE connection. `progressForId` tracks which program owns the current `progressEvents` — it persists after failure so DetailPanel can still show the error log.

```jsx
import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import UploadButton from './components/Upload/UploadButton.jsx'
import DetailPanel from './components/Panel/DetailPanel.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useSSE } from './hooks/useSSE.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [progressEvents, setProgressEvents] = useState([])
  const [progressForId, setProgressForId] = useState(null)

  useSSE(analyzingId, (event, data) => {
    if (event === 'progress') {
      setProgressEvents(prev => [...prev, data])
    }
    if (event === 'done') {
      markAnalyzed(analyzingId)
      setAnalyzingId(null)
      setProgressForId(null)  // clear — progress UI disappears after success
      setProgressEvents([])
      refresh()
    }
    if (event === 'failed') {
      setAnalyzingId(null)
      // Do NOT clear progressForId or progressEvents — DetailPanel shows the final error log
      refresh()
    }
  })

  const handleUploaded = useCallback(async (program) => {
    setAnalyzingId(program.id)
    setProgressForId(program.id)
    setProgressEvents([])  // clear stale events from any previous run
    await refresh()
    markAnalyzing(program.id)
  }, [markAnalyzing, refresh])

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', position: 'relative' }}>
      <ProgramGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => setSelectedId(node.id)}
      />
      <UploadButton onUploaded={handleUploaded} />
      <DetailPanel
        programId={selectedId}
        progressForId={progressForId}
        progressEvents={progressEvents}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Run client tests**

```bash
cd client && npm test
```

Expected: existing `ProgramNode` tests still pass (we didn't touch that component).

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: accumulate progress events in App and pass to DetailPanel"
```

---

## Task 6: Update `DetailPanel` — Progress Bar + Log Feed

**Files:**
- Modify: `client/src/components/Panel/DetailPanel.jsx`
- Create: `client/tests/components/DetailPanel.test.jsx`

- [ ] **Step 1: Write failing tests in `client/tests/components/DetailPanel.test.jsx`**

```jsx
import { render, screen } from '@testing-library/react'
import DetailPanel from '../../src/components/Panel/DetailPanel.jsx'
import { vi } from 'vitest'

// Mock fetchProgram so the component doesn't make real HTTP calls
vi.mock('../../src/api/programs.js', () => ({
  fetchProgram: vi.fn(() => Promise.resolve({
    name: 'ARERCD',
    status: 'analyzing',
    analysis: null,
    chunks: [],
    edges: [],
  })),
}))

const noop = () => {}

test('shows progress bar and log feed when programId matches progressForId', async () => {
  const events = [
    { stage: 'parsing', message: 'Parsing COBOL file...' },
    { stage: 'parsing', message: 'Parsed 5 chunks', durationMs: 200 },
    { stage: 'metadata', message: 'Analyzing metadata...' },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )

  // Progress log entries should be visible
  expect(screen.getByText(/Parsing COBOL file/)).toBeInTheDocument()
  expect(screen.getByText(/Parsed 5 chunks/)).toBeInTheDocument()
  expect(screen.getByText(/Analyzing metadata/)).toBeInTheDocument()
})

test('shows done-type entries with ✓ icon', () => {
  const events = [
    { stage: 'parsing', message: 'Parsed 5 chunks', durationMs: 200 },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )

  expect(screen.getByText('✓')).toBeInTheDocument()
})

test('shows error-type entries with ✗ icon', () => {
  const events = [
    { stage: 'chunk', message: 'Chunk 1/5 failed: timeout', chunkIndex: 1, total: 5, durationMs: 2000 },
  ]

  render(
    <DetailPanel
      programId="abc"
      progressForId="abc"
      progressEvents={events}
      onClose={noop}
      onNavigate={noop}
    />
  )

  expect(screen.getByText('✗')).toBeInTheDocument()
  expect(screen.getByText(/Chunk 1\/5 failed/)).toBeInTheDocument()
})

test('does not show progress UI when programId does not match progressForId', () => {
  render(
    <DetailPanel
      programId="abc"
      progressForId="different-id"
      progressEvents={[{ stage: 'parsing', message: 'Parsing...' }]}
      onClose={noop}
      onNavigate={noop}
    />
  )

  expect(screen.queryByText('Parsing...')).not.toBeInTheDocument()
})

test('does not show progress UI when progressEvents is empty', () => {
  const { container } = render(
    <DetailPanel
      programId="abc"
      analyzingId="abc"
      progressEvents={[]}
      onClose={noop}
      onNavigate={noop}
    />
  )

  // No log entries rendered
  expect(screen.queryByText('✓')).not.toBeInTheDocument()
  expect(screen.queryByText('▶')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests — expect them to FAIL**

```bash
cd client && npx vitest run tests/components/DetailPanel.test.jsx
```

Expected: tests fail — `DetailPanel` doesn't accept `analyzingId`/`progressEvents` props yet.

- [ ] **Step 3: Implement the progress UI in `client/src/components/Panel/DetailPanel.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react'
import { fetchProgram } from '../../api/programs.js'
import OverviewTab from './OverviewTab.jsx'
import LogicBlocksTab from './LogicBlocksTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'

const TABS = ['Overview', 'Logic Blocks', 'Connections']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

// Determine icon and color for a progress event
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

  // Auto-scroll log to bottom on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [progressEvents.length])

  // Derive progress bar state from latest chunk event
  const latestChunk = [...progressEvents].reverse().find(e => e.stage === 'chunk' && e.total)
  const latestEvent = progressEvents[progressEvents.length - 1]
  const progressPercent = latestChunk
    ? Math.round((latestChunk.chunkIndex / latestChunk.total) * 100)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Progress bar */}
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

      {/* Log feed */}
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

export default function DetailPanel({ programId, onClose, onNavigate, progressForId, progressEvents = [] }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')

  useEffect(() => {
    if (!programId) return
    setProgram(null)
    setTab('Overview')
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId])

  if (!programId) return null

  const isAnalyzing = programId === progressForId && progressEvents.length > 0

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 340, height: '100%',
      background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column',
      zIndex: 10, overflowY: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{program?.name || '…'}</div>
          {program && <div style={{ fontSize: 11, color: STATUS_COLOR[program.status], marginTop: 2 }}>● {program.status}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer' }}>✕</button>
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
        {isAnalyzing && (
          <div style={{ marginBottom: 16 }}>
            <ProgressUI progressEvents={progressEvents} />
          </div>
        )}
        {!program ? <p style={{ color: '#64748b' }}>Loading…</p> : (
          <>
            {tab === 'Overview' && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic Blocks' && <LogicBlocksTab chunks={program.chunks} />}
            {tab === 'Connections' && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} />}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect them to PASS**

```bash
cd client && npx vitest run tests/components/DetailPanel.test.jsx
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run all client tests**

```bash
cd client && npm test
```

Expected: all tests pass (ProgramNode tests + new DetailPanel tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/Panel/DetailPanel.jsx client/tests/components/DetailPanel.test.jsx
git commit -m "feat: add progress bar and log feed to detail panel"
```

---

## Final Verification

- [ ] **Run all backend tests**

```bash
cd server && npm test
```

Expected: all pass.

- [ ] **Run all frontend tests**

```bash
cd client && npm test
```

Expected: all pass.

- [ ] **Manual end-to-end check**

1. Start backend: `cd server && npm run dev`
2. Start frontend: `cd client && npm run dev`
3. Upload `arercd.cbl`
4. Confirm: colored logs appear in backend terminal with timestamps and program name
5. Click the uploading node to open Detail Panel
6. Confirm: progress bar shows with current message, log feed updates in real time
7. Wait for analysis to complete — progress UI disappears, normal tabs visible

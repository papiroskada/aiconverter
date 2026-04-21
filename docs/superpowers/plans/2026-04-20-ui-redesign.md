# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph-centric layout with icon sidebar + program card grid + improved Logic tab showing DB operations per entry point with per-entry-point flagging.

**Architecture:** Add `flags` JSONB column to `program_analysis` with a `PATCH` API; restructure React app to use a `view` state (`list | graph | program`) controlling what the main content area shows; replace the overlay `DetailPanel` with a full-page `ProgramDetail`; update `LogicTab` to render `dbOperations` per entry point and a flag dropdown button.

**Tech Stack:** PostgreSQL (schema.sql ALTER TABLE pattern), Node.js/Express, React (no router — view state in App.jsx), Vite, Vitest + Supertest for server tests.

---

### Task 1: Add `flags` column to program_analysis

**Files:**
- Modify: `server/src/db/schema.sql`

- [ ] **Step 1: Append the ALTER TABLE at the end of `schema.sql`**

Add after line 119 (the last `ALTER TABLE program_analysis` block):

```sql
-- Per-entry-point user flags
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS flags JSONB NOT NULL DEFAULT '{}';
```

- [ ] **Step 2: Run migration**

```bash
cd server && node src/db/migrate.js
```

Expected output: `Migration complete`

- [ ] **Step 3: Verify column exists**

```bash
psql $DATABASE_URL -c "\d program_analysis" | grep flags
```

Expected: `flags | jsonb | not null | '{}'::jsonb`

- [ ] **Step 4: Commit**

```bash
git add server/src/db/schema.sql
git commit -m "feat(db): add flags column to program_analysis"
```

---

### Task 2: Add `updateFlag` to programAnalysis model

**Files:**
- Modify: `server/src/models/programAnalysis.js`

- [ ] **Step 1: Add `updateFlag` export after `getAnalysisByProgramId`**

```js
export async function updateFlag(program_id, condition, flag) {
  if (flag === null) {
    const { rows } = await pool.query(
      `UPDATE program_analysis
       SET flags = flags - $2, updated_at = NOW()
       WHERE program_id = $1
       RETURNING flags`,
      [program_id, condition]
    )
    return rows[0]?.flags ?? {}
  }
  const { rows } = await pool.query(
    `UPDATE program_analysis
     SET flags = flags || jsonb_build_object($2::text, $3::text), updated_at = NOW()
     WHERE program_id = $1
     RETURNING flags`,
    [program_id, condition, flag]
  )
  return rows[0]?.flags ?? {}
}
```

- [ ] **Step 2: Verify module loads without errors**

```bash
cd server && node -e "import('./src/models/programAnalysis.js').then(() => console.log('OK'))"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/src/models/programAnalysis.js
git commit -m "feat(model): add updateFlag to programAnalysis"
```

---

### Task 3: Add `PATCH /api/programs/:id/flags` route + tests

**Files:**
- Modify: `server/src/routes/programs.js`
- Modify: `server/tests/routes/programs.test.js`

- [ ] **Step 1: Write the failing tests**

In `server/tests/routes/programs.test.js`, update the `programAnalysis` mock to include `updateFlag`, and add the test block:

```js
// Replace the existing vi.mock for programAnalysis:
vi.mock('../../src/models/programAnalysis.js', () => ({
  getAnalysisByProgramId: vi.fn().mockResolvedValue(null),
  updateFlag: vi.fn().mockResolvedValue({ "FUNC='INS'": 'warning' }),
}))
```

Add at the end of the file:

```js
describe('PATCH /api/programs/:id/flags', () => {
  it('sets a warning flag and returns updated flags', async () => {
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ condition: "FUNC='INS'", flag: 'warning' })
    expect(res.status).toBe(200)
    expect(res.body["FUNC='INS'"]).toBe('warning')
  })

  it('returns 400 when condition is missing', async () => {
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ flag: 'warning' })
    expect(res.status).toBe(400)
  })

  it('accepts null flag to clear', async () => {
    const { updateFlag } = await import('../../src/models/programAnalysis.js')
    updateFlag.mockResolvedValueOnce({})
    const res = await request(app)
      .patch('/api/programs/p1/flags')
      .send({ condition: "FUNC='INS'", flag: null })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -A2 "PATCH /api"
```

Expected: 3 tests fail — route not yet implemented.

- [ ] **Step 3: Add import and route to `server/src/routes/programs.js`**

Update the import at line 5:

```js
import { getAnalysisByProgramId, updateFlag } from '../models/programAnalysis.js'
```

Add before `export default router`:

```js
// PATCH /api/programs/:id/flags
router.patch('/:id/flags', async (req, res) => {
  try {
    const { condition, flag } = req.body
    if (!condition) return res.status(400).json({ error: 'condition is required' })
    if (flag !== null && flag !== undefined && !['warning', 'deprecated'].includes(flag)) {
      return res.status(400).json({ error: 'flag must be warning, deprecated, or null' })
    }
    const flags = await updateFlag(req.params.id, condition, flag ?? null)
    res.json(flags)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd server && npm test -- --reporter=verbose 2>&1 | grep -A2 "PATCH /api"
```

Expected: all 3 pass.

- [ ] **Step 5: Run full test suite**

```bash
cd server && npm test
```

Expected: all tests pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/programs.js server/tests/routes/programs.test.js
git commit -m "feat(api): add PATCH /programs/:id/flags endpoint"
```

---

### Task 4: Extend `getAllPrograms` with analysis summary

**Files:**
- Modify: `server/src/models/programs.js`
- Modify: `client/src/hooks/usePrograms.js`

The card grid needs `entry_point_count`, `file_type`, and `flags` for each program. Add a LEFT JOIN to avoid N+1 queries.

- [ ] **Step 1: Replace `getAllPrograms` in `server/src/models/programs.js`**

```js
export async function getAllPrograms() {
  const { rows } = await pool.query(`
    SELECT
      p.id, p.name, p.status, p.application_id, p.file_type,
      COALESCE(jsonb_array_length(pa.entry_points), 0)::int AS entry_point_count,
      COALESCE(pa.flags, '{}') AS flags
    FROM programs p
    LEFT JOIN program_analysis pa ON pa.program_id = p.id
    ORDER BY p.created_at ASC
  `)
  return rows
}
```

- [ ] **Step 2: Update `buildNodes` in `client/src/hooks/usePrograms.js`**

Replace the `buildNodes` function:

```js
function buildNodes(programs) {
  return programs.map(p => ({
    id: p.id,
    type: 'programNode',
    position: { x: 0, y: 0 },
    data: {
      name: p.name,
      status: p.status,
      isPhantom: p.status === 'pending',
      applicationId: p.application_id ?? null,
      fileType: p.file_type ?? 'cobol',
      entryPointCount: p.entry_point_count ?? 0,
      flags: p.flags ?? {},
    },
  }))
}
```

- [ ] **Step 3: Commit**

```bash
git add server/src/models/programs.js client/src/hooks/usePrograms.js
git commit -m "feat(model): include entry_point_count and flags in getAllPrograms"
```

---

### Task 5: Add `patchFlags` to client API

**Files:**
- Modify: `client/src/api/programs.js`

- [ ] **Step 1: Add `patchFlags` after `cancelAnalysis`**

```js
export async function patchFlags(id, condition, flag) {
  const res = await fetch(`${BASE}/${id}/flags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ condition, flag }),
  })
  if (!res.ok) throw new Error('Failed to update flag')
  return res.json()
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api/programs.js
git commit -m "feat(client): add patchFlags API function"
```

---

### Task 6: Create `IconNav.jsx`

**Files:**
- Create: `client/src/components/Nav/IconNav.jsx`

- [ ] **Step 1: Create the file**

```jsx
const btnStyle = (active) => ({
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 6, cursor: 'pointer', fontSize: 16, border: 'none',
  background: active ? '#1e40af' : 'none',
  color: active ? '#fff' : '#475569',
})

export default function IconNav({ view, onViewChange, onSettingsOpen }) {
  return (
    <div style={{
      width: 44, background: '#0f172a', borderRight: '1px solid #1e293b',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 0', gap: 4, flexShrink: 0,
    }}>
      <div style={{ color: '#38bdf8', fontSize: 18, marginBottom: 8 }}>⬡</div>
      <button style={btnStyle(view === 'list')} onClick={() => onViewChange('list')} title="Programs">⊞</button>
      <button style={btnStyle(view === 'graph')} onClick={() => onViewChange('graph')} title="Graph">◎</button>
      <div style={{ flex: 1 }} />
      <button style={btnStyle(false)} onClick={onSettingsOpen} title="Settings">⚙</button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Nav/IconNav.jsx
git commit -m "feat(ui): add IconNav component"
```

---

### Task 7: Restructure `App.jsx` with `view` state

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Sidebar/Sidebar.jsx` (width only)

- [ ] **Step 1: Replace `client/src/App.jsx`**

```jsx
import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'
import IconNav from './components/Nav/IconNav.jsx'
import ProgramGrid from './components/Programs/ProgramGrid.jsx'
import ProgramDetail from './components/Panel/ProgramDetail.jsx'
import SettingsDrawer from './components/Settings/SettingsDrawer.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useAppSSE } from './hooks/useAppSSE.js'
import { cancelApplication } from './api/applications.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, onNodesChange } = usePrograms()
  const [view, setView] = useState('list')
  const [selectedProgramId, setSelectedProgramId] = useState(null)
  const [panelRefreshTrigger, setPanelRefreshTrigger] = useState(0)
  const [batchAppId, setBatchAppId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedAppId, setSelectedAppId] = useState(null)
  const [focusNodeId, setFocusNodeId] = useState(null)
  const [stepProgress, setStepProgress] = useState(new Map())

  useAppSSE(batchAppId, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'analyzing') markAnalyzing(data.programId)
      if (data.stage === 'step') {
        setStepProgress(prev => new Map(prev).set(data.programId, { step: data.step, total: data.total }))
      }
    }
    if (event === 'done' || event === 'failed' || event === 'cancelled') {
      setBatchAppId(null)
      setStepProgress(new Map())
      setPanelRefreshTrigger(t => t + 1)
      refresh()
    }
  })

  const handleBatchStarted = useCallback(async (appId) => {
    setBatchAppId(appId)
    setSelectedAppId(appId)
    await refresh()
  }, [refresh])

  const handleBatchCancel = useCallback(async () => {
    if (!batchAppId) return
    try { await cancelApplication(batchAppId) } catch (err) { console.error('Batch cancel failed', err) }
  }, [batchAppId])

  const handleDeleted = useCallback(async (programId) => {
    if (selectedProgramId === programId) { setSelectedProgramId(null); setView('list') }
    await refresh()
  }, [selectedProgramId, refresh])

  const handleDeleteApp = useCallback(async (appId) => {
    if (selectedAppId === appId) setSelectedAppId(null)
    if (batchAppId === appId) setBatchAppId(null)
    setSelectedProgramId(null)
    setView('list')
    await refresh()
  }, [selectedAppId, batchAppId, refresh])

  const handleFileClick = useCallback((programId) => {
    setFocusNodeId(programId)
    setSelectedProgramId(programId)
    setView('program')
  }, [])

  const handleProgramClick = useCallback((programId) => {
    setSelectedProgramId(programId)
    setView('program')
  }, [])

  const displayNodes = selectedAppId
    ? (() => {
        const appNodes = nodes.filter(n => n.data.applicationId === selectedAppId)
        const appNodeIds = new Set(appNodes.map(n => n.id))
        const phantomIds = new Set()
        edges.forEach(e => {
          const inApp = appNodeIds.has(e.source) || appNodeIds.has(e.target)
          if (!inApp) return
          const otherId = appNodeIds.has(e.source) ? e.target : e.source
          const other = nodes.find(n => n.id === otherId)
          if (other?.data.isPhantom) phantomIds.add(otherId)
        })
        return [...appNodes, ...nodes.filter(n => phantomIds.has(n.id))]
      })()
    : []

  const displayEdges = selectedAppId
    ? (() => {
        const ids = new Set(displayNodes.map(n => n.id))
        return edges.filter(e => ids.has(e.source) && ids.has(e.target))
      })()
    : []

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', display: 'flex' }}>
      <IconNav view={view} onViewChange={setView} onSettingsOpen={() => setSettingsOpen(true)} />

      <Sidebar
        nodes={nodes}
        selectedAppId={selectedAppId}
        onSelectApp={(id) => { setSelectedAppId(id); setView('list') }}
        onBack={() => setSelectedAppId(null)}
        onFileClick={handleFileClick}
        stepProgress={stepProgress}
        batchAppId={batchAppId}
        onBatchCancel={handleBatchCancel}
        onBatchStarted={handleBatchStarted}
        onDeleteApp={handleDeleteApp}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {view === 'graph' && (
          <ProgramGraph
            nodes={displayNodes}
            edges={displayEdges}
            onNodeClick={(node) => { if (!node.data.isPhantom) handleProgramClick(node.id) }}
            onNodesChange={onNodesChange}
            focusNodeId={focusNodeId}
          />
        )}
        {view === 'list' && (
          <ProgramGrid
            nodes={nodes}
            selectedAppId={selectedAppId}
            stepProgress={stepProgress}
            onProgramClick={handleProgramClick}
          />
        )}
        {view === 'program' && selectedProgramId && (
          <ProgramDetail
            programId={selectedProgramId}
            stepProgress={stepProgress}
            refreshTrigger={panelRefreshTrigger}
            onClose={() => setView('list')}
            onNavigate={(id) => { setSelectedProgramId(id); setView('program') }}
            onDeleted={handleDeleted}
          />
        )}
        {view === 'program' && !selectedProgramId && (
          <div style={{ color: '#475569', padding: 40 }}>Select a program from the list.</div>
        )}
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Reduce Sidebar width in `client/src/components/Sidebar/Sidebar.jsx`**

Find line 377 (`width: 200`) and change to `width: 160`.

- [ ] **Step 3: Start dev server and check for console errors**

```bash
cd client && npm run dev
```

Open http://localhost:5173. Expected: icon sidebar (44px) + left panel (160px) + main area. No console errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx client/src/components/Sidebar/Sidebar.jsx
git commit -m "feat(ui): restructure App with view state and IconNav"
```

---

### Task 8: Create `ProgramGrid.jsx`

**Files:**
- Create: `client/src/components/Programs/ProgramGrid.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useState } from 'react'

const STATUS_COLOR = {
  analyzed:  '#4ade80',
  analyzing: '#60a5fa',
  failed:    '#f87171',
  pending:   '#475569',
}

function flagCount(flags) {
  return Object.keys(flags ?? {}).length
}

function ProgramCard({ node, stepData, onClick }) {
  const { name, status, fileType, entryPointCount, flags } = node.data
  const fc = flagCount(flags)
  const borderColor = fc > 0 ? '#f59e0b' : (STATUS_COLOR[status] ?? '#475569')

  return (
    <div
      onClick={() => onClick(node.id)}
      style={{
        background: '#0f172a', borderRadius: 8, padding: '12px 14px',
        border: `1px solid ${borderColor}33`,
        borderTop: `2px solid ${borderColor}`,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 13, fontFamily: 'monospace' }}>{name}</span>
        <span style={{ fontSize: 10, color: '#475569', background: '#1e293b', borderRadius: 3, padding: '1px 5px' }}>
          {fileType === 'c' ? '.c' : '.cbl'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ color: STATUS_COLOR[status] ?? '#475569', fontSize: 10 }}>
          {status === 'analyzed' ? '✓' : status === 'analyzing' ? '▶' : status === 'failed' ? '✗' : '○'} {status}
        </span>
        {entryPointCount > 0 && (
          <span style={{ color: '#64748b', fontSize: 10 }}>{entryPointCount} modes</span>
        )}
        {fc > 0 && (
          <span style={{ color: '#f59e0b', fontSize: 10, marginLeft: 'auto' }}>⚠ {fc}</span>
        )}
      </div>

      {stepData && (
        <div style={{ marginTop: 6 }}>
          <div style={{ height: 3, background: '#1e293b', borderRadius: 2 }}>
            <div style={{
              height: '100%', borderRadius: 2, background: '#60a5fa',
              width: `${Math.round((stepData.step / stepData.total) * 100)}%`,
              transition: 'width 0.3s',
            }} />
          </div>
          <div style={{ color: '#475569', fontSize: 9, marginTop: 2 }}>
            Step {stepData.step} of {stepData.total}
          </div>
        </div>
      )}
    </div>
  )
}

const FILTERS = ['all', 'flagged', 'analyzed', 'failed']

export default function ProgramGrid({ nodes, selectedAppId, stepProgress, onProgramClick }) {
  const [filter, setFilter] = useState('all')

  if (!selectedAppId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: '#334155', fontSize: 14 }}>Select a project to view programs.</p>
      </div>
    )
  }

  const appNodes = nodes.filter(n => n.data.applicationId === selectedAppId && !n.data.isPhantom)

  const filtered = appNodes.filter(n => {
    if (filter === 'all') return true
    if (filter === 'flagged') return flagCount(n.data.flags) > 0
    if (filter === 'analyzed') return n.data.status === 'analyzed'
    if (filter === 'failed') return n.data.status === 'failed'
    return true
  })

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '16px 20px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexShrink: 0 }}>
        <h2 style={{ color: '#e2e8f0', margin: 0, fontSize: 16, fontWeight: 700 }}>Programs</h2>
        <span style={{ color: '#475569', fontSize: 12 }}>{appNodes.length} files</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background: filter === f ? '#334155' : 'transparent',
                border: `1px solid ${filter === f ? '#475569' : '#1e293b'}`,
                color: filter === f ? '#e2e8f0' : '#64748b',
                borderRadius: 5, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
              }}
            >
              {f === 'flagged' ? '⚠ Flagged' : f === 'analyzed' ? '✓ Done' : f === 'failed' ? '✗ Failed' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <p style={{ color: '#334155', fontSize: 13 }}>No programs match this filter.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {filtered.map(node => (
              <ProgramCard
                key={node.id}
                node={node}
                stepData={stepProgress.get(node.id)}
                onClick={onProgramClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Select a project — grid of program cards should appear with status colors and filter buttons.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Programs/ProgramGrid.jsx
git commit -m "feat(ui): add ProgramGrid card view"
```

---

### Task 9: Create `ProgramDetail.jsx`

**Files:**
- Create: `client/src/components/Panel/ProgramDetail.jsx`

Full-page detail view replacing the overlay `DetailPanel`. Adds Reanalyze button and passes `onFlagsChange` down to `LogicTab`.

- [ ] **Step 1: Create the file**

```jsx
import { useState, useEffect } from 'react'
import { fetchProgram, deleteProgram, triggerReanalyze } from '../../api/programs.js'
import OverviewTab from './OverviewTab.jsx'
import LogicTab from './LogicTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'
import DataTab from './DataTab.jsx'

const TABS = ['Overview', 'Logic', 'Data', 'Connections']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

function ProgressUI({ step, total }) {
  const pct = Math.round((step / total) * 100)
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Analyzing…</div>
      <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#60a5fa', borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Step {step} of {total} ({pct}%)</div>
    </div>
  )
}

export default function ProgramDetail({ programId, onClose, onNavigate, onDeleted, stepProgress = new Map(), refreshTrigger = 0 }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!programId) return
    setProgram(null)
    setTab('Overview')
    setError(null)
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId])

  useEffect(() => {
    if (!programId || refreshTrigger === 0) return
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId, refreshTrigger])

  async function handleDelete() {
    if (!programId || deleting) return
    if (!window.confirm('Delete this program and all related data?')) return
    setDeleting(true)
    setError(null)
    try {
      await deleteProgram(programId)
      onDeleted?.(programId)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  async function handleReanalyze() {
    if (!programId || reanalyzing) return
    setReanalyzing(true)
    setError(null)
    try {
      await triggerReanalyze(programId)
    } catch (err) {
      setError(err.message)
    } finally {
      setReanalyzing(false)
    }
  }

  function handleFlagsChange(updatedFlags) {
    setProgram(prev => prev ? { ...prev, analysis: { ...prev.analysis, flags: updatedFlags } } : prev)
  }

  const stepData = stepProgress.get(programId)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
      <div style={{ padding: '12px 20px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 14, padding: '4px 8px' }}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0', fontFamily: 'monospace' }}>{program?.name || '…'}</div>
          {program && <div style={{ fontSize: 11, color: STATUS_COLOR[program.status], marginTop: 1 }}>● {program.status}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleReanalyze}
            disabled={reanalyzing || program?.status === 'analyzing'}
            style={{
              background: '#1e3a5f', border: '1px solid #2563eb', color: '#93c5fd',
              borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
              opacity: reanalyzing || program?.status === 'analyzing' ? 0.5 : 1,
            }}
          >
            {reanalyzing ? 'Starting…' : '↻ Reanalyze'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || program?.status === 'analyzing'}
            style={{
              background: '#7f1d1d', border: '1px solid #991b1b', color: '#fecaca',
              borderRadius: 6, padding: '6px 10px', fontSize: 11, cursor: 'pointer',
              opacity: deleting || program?.status === 'analyzing' ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', background: '#1e293b', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '9px 20px', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #60a5fa' : '2px solid transparent',
            color: tab === t ? '#60a5fa' : '#475569', fontSize: 12, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}
        {stepData && <ProgressUI step={stepData.step} total={stepData.total} />}
        {!program ? (
          <p style={{ color: '#64748b' }}>Loading…</p>
        ) : (
          <>
            {tab === 'Overview'    && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic'       && <LogicTab analysis={program.analysis} programId={programId} onFlagsChange={handleFlagsChange} />}
            {tab === 'Data'        && <DataTab analysis={program.analysis} />}
            {tab === 'Connections' && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Click a program card — full-page detail with Back button, tabs, and Reanalyze button.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Panel/ProgramDetail.jsx
git commit -m "feat(ui): add ProgramDetail full-page component"
```

---

### Task 10: Update `LogicTab.jsx` — dbOperations + flag button

**Files:**
- Modify: `client/src/components/Panel/LogicTab.jsx`

- [ ] **Step 1: Replace `client/src/components/Panel/LogicTab.jsx`**

```jsx
import { useState } from 'react'
import { patchFlags } from '../../api/programs.js'

const sectionStyle = { marginBottom: 20 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 8 }
const cardStyle = { background: '#0f172a', borderRadius: 6, padding: '12px 14px', marginBottom: 8 }
const tagStyle = { display: 'inline-block', background: '#1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '2px 7px', fontSize: 11 }
const subLabelStyle = { color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 8 }
const FLAG_COLORS = { warning: '#f59e0b', deprecated: '#f87171' }
const FLAG_LABELS = { warning: '⚠ Warning', deprecated: '🗑 Deprecated' }

function opColor(op = '') {
  const hasRead  = /SELECT|READ|SGE|RDN/.test(op)
  const hasWrite = /INSERT|UPDATE|DELETE|UPD|DEL|INL|WRITE|WRT/.test(op)
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

function DbOpRow({ op }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', fontSize: 11 }}>
      <span style={{ color: '#e2e8f0', fontFamily: 'monospace', minWidth: 90 }}>{op.table}</span>
      <span style={{ color: opColor(op.operation), fontFamily: 'monospace', minWidth: 65 }}>{op.operation}</span>
      {op.keyFields?.length > 0 && (
        <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>key: {op.keyFields.join(', ')}</span>
      )}
      {op.notFoundAction && op.notFoundAction !== 'n/a' && (
        <span style={{ color: '#f59e0b', marginLeft: 'auto', fontSize: 10 }}>→ {op.notFoundAction}</span>
      )}
    </div>
  )
}

const dropdownItemStyle = {
  display: 'block', width: '100%', background: 'none', border: 'none',
  color: '#e2e8f0', padding: '7px 12px', textAlign: 'left', cursor: 'pointer', fontSize: 12,
}

function FlagButton({ condition, currentFlag, programId, onFlagsChange }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function setFlag(flag) {
    setSaving(true)
    setOpen(false)
    try {
      const updated = await patchFlags(programId, condition, flag)
      onFlagsChange?.(updated)
    } catch (e) {
      console.error('Flag update failed', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'relative', marginLeft: 'auto' }}>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={saving}
        style={{
          background: currentFlag ? `${FLAG_COLORS[currentFlag]}22` : '#1e293b',
          border: `1px solid ${currentFlag ? FLAG_COLORS[currentFlag] : '#334155'}`,
          color: currentFlag ? FLAG_COLORS[currentFlag] : '#64748b',
          borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer',
        }}
      >
        {saving ? '…' : currentFlag ? FLAG_LABELS[currentFlag] : '⚑ Flag'}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '110%', background: '#1e293b',
          border: '1px solid #334155', borderRadius: 6, zIndex: 20, minWidth: 130,
          boxShadow: '0 4px 12px #00000066',
        }}>
          <button onClick={() => setFlag('warning')} style={dropdownItemStyle}>⚠ Warning</button>
          <button onClick={() => setFlag('deprecated')} style={dropdownItemStyle}>🗑 Deprecated</button>
          {currentFlag && (
            <button onClick={() => setFlag(null)} style={{ ...dropdownItemStyle, color: '#64748b' }}>✕ Clear flag</button>
          )}
        </div>
      )}
    </div>
  )
}

export default function LogicTab({ analysis, programId, onFlagsChange }) {
  const entryPoints  = analysis?.entry_points  ?? []
  const errorCatalog = analysis?.error_catalog  ?? []
  const preDispatch  = analysis?.pre_dispatch   ?? []
  const flags        = analysis?.flags          ?? {}

  if (!preDispatch.length && !entryPoints.length && !errorCatalog.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No business logic extracted yet.</p>
  }

  return (
    <div>
      {preDispatch.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Pre-Dispatch (runs before every mode)</label>
          <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preDispatch.map((name, i) => (
              <span key={i} style={{ background: '#172554', color: '#93c5fd', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {entryPoints.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Entry Points</label>
          {entryPoints.map((ep, i) => {
            const epFlag = flags[ep.condition]
            return (
              <div key={i} style={{ ...cardStyle, borderLeft: epFlag ? `3px solid ${FLAG_COLORS[epFlag]}` : '3px solid transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={tagStyle}>{ep.condition}</div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{ep.businessName}</div>
                  <FlagButton condition={ep.condition} currentFlag={epFlag} programId={programId} onFlagsChange={onFlagsChange} />
                </div>

                {ep.steps?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={subLabelStyle}>Steps</div>
                    {ep.steps.map((s, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                        <span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>{j + 1}.</span>
                        <span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>
                      </div>
                    ))}
                  </div>
                )}

                {ep.dbOperations?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={subLabelStyle}>DB Operations</div>
                    <div style={{ background: '#0a1628', borderRadius: 4, padding: '6px 8px' }}>
                      {ep.dbOperations.map((op, j) => <DbOpRow key={j} op={op} />)}
                    </div>
                  </div>
                )}

                {ep.sideEffects?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={subLabelStyle}>Side Effects</div>
                    {ep.sideEffects.map((s, j) => (
                      <div key={j} style={{ color: '#fbbf24', fontSize: 11, marginBottom: 2 }}>⚡ {s}</div>
                    ))}
                  </div>
                )}

                {ep.returns && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={subLabelStyle}>Returns</div>
                    <div style={{ color: '#4ade80', fontSize: 12 }}>✓ {ep.returns}</div>
                  </div>
                )}

                {ep.errors?.length > 0 && (
                  <div>
                    <div style={subLabelStyle}>Errors</div>
                    {ep.errors.map((e, j) => (
                      <div key={j} style={{ color: '#f87171', fontSize: 11, marginBottom: 2 }}>✗ {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {errorCatalog.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Error Catalog</label>
          {errorCatalog.map((e, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{e.code}</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 4 }}>{e.businessMeaning}</div>
              {e.systemAction && <div style={{ color: '#94a3b8', fontSize: 11 }}>→ {e.systemAction}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify in browser**

Open a program with analyzed entry points → Logic tab shows DB operations per entry point, flag button on each.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Panel/LogicTab.jsx
git commit -m "feat(ui): add dbOperations and flag button to LogicTab"
```

---

### Task 11: Update `DataTab.jsx` — per-mode section

**Files:**
- Modify: `client/src/components/Panel/DataTab.jsx`

- [ ] **Step 1: Add per-mode section**

In `DataTab.jsx`, add a new section between the existing `dbTables` block and the `fileOps` block. Insert after the closing `</div>` of the `{dbTables.length > 0 && ...}` block:

```jsx
{(() => {
  const entryPoints = (analysis?.entry_points ?? []).filter(ep => ep.dbOperations?.length > 0)
  if (!entryPoints.length) return null
  return (
    <div>
      <label style={labelStyle}>Per-Mode Operations</label>
      {entryPoints.map((ep, i) => (
        <div key={i} style={rowStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ background: '#1e3a5f', color: '#93c5fd', borderRadius: 3, padding: '1px 6px', fontSize: 10, fontFamily: 'monospace' }}>
              {ep.condition}
            </span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>{ep.businessName}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ep.dbOperations.map((op, j) => (
              <span key={j} style={{
                background: '#0f172a', border: '1px solid #1e293b',
                borderRadius: 3, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace',
                color: opColor(op.operation),
              }}>
                {op.table} {op.operation}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})()}
```

- [ ] **Step 2: Verify in browser**

Data tab shows Per-Mode Operations section when entry points have dbOperations.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Panel/DataTab.jsx
git commit -m "feat(ui): add per-mode DB operations to DataTab"
```

---

### Task 12: Final smoke test and cleanup

**Files:**
- No new files

- [ ] **Step 1: Verify DetailPanel is no longer imported**

```bash
grep -r "DetailPanel" client/src/
```

Expected: no results.

- [ ] **Step 2: Run all server tests**

```bash
cd server && npm test
```

Expected: all tests pass.

- [ ] **Step 3: Full UI smoke test**

With dev server running (http://localhost:5173):

1. Select a project → program cards grid with status colors ✓
2. Click ⊞ icon → stays on list ✓
3. Click ◎ icon → ReactFlow graph appears ✓
4. Click ⚙ icon → SettingsDrawer opens ✓
5. Click a program card → ProgramDetail opens full-page ✓
6. Click Back → returns to card grid ✓
7. Logic tab → entry points show DB operations (if analyzed) ✓
8. Click ⚑ Flag on entry point → dropdown with Warning / Deprecated ✓
9. Select Warning → entry point gets amber left border ✓
10. Reload page → flag still shown (persisted via API) ✓
11. File list in sidebar → clicking file opens ProgramDetail ✓
12. Graph node click → opens ProgramDetail ✓

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete UI redesign — icon nav, program cards, Logic tab with DB ops and flags"
```

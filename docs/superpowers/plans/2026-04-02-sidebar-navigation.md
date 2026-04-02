# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left sidebar with two views — a projects list and a per-project file list — that lets the user navigate applications, track analysis progress per file, and click a file to focus the graph on its node.

**Architecture:** A new `Sidebar.jsx` component manages its own view state (projects vs files). It fetches the applications list, derives file data from the `nodes` prop (which gains `applicationId`), and calls App.jsx callbacks. `ProgramGraph` gains a `focusNodeId` prop handled by an inner `FocusHandler` component using `useReactFlow`. App.jsx integrates the sidebar, removes the floating upload buttons and batch badge, and filters nodes/edges by selected application.

**Tech Stack:** React 18, ReactFlow (`useReactFlow`, `setCenter`), existing SSE hooks, existing API layer.

---

## File Map

**Create:**
- `client/src/components/Sidebar/Sidebar.jsx` — two-view sidebar: projects list + project file list, upload buttons, batch Stop

**Modify:**
- `client/src/api/applications.js` — add `fetchApplications()`
- `client/src/hooks/usePrograms.js` — add `applicationId` to node `data` in `buildNodes()`
- `client/src/components/Graph/ProgramGraph.jsx` — add `focusNodeId` prop + inner `FocusHandler`
- `client/src/App.jsx` — integrate Sidebar, filter nodes/edges by selectedAppId, add stepProgress tracking, remove floating buttons and batch badge

---

## Task 1: Add `fetchApplications()` to the API client

**Files:**
- Modify: `client/src/api/applications.js`

- [ ] **Step 1: Add `fetchApplications` function**

Open `client/src/api/applications.js` and add this function after the existing `cancelApplication`:

```js
export async function fetchApplications() {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch applications')
  return res.json()
}
```

The server already returns `[{ id, name, status, programCount, created_at, updated_at }]` from `GET /api/applications`.

- [ ] **Step 2: Commit**

```bash
git add client/src/api/applications.js
git commit -m "feat: add fetchApplications API method"
```

---

## Task 2: Add `applicationId` to node data in `usePrograms`

**Files:**
- Modify: `client/src/hooks/usePrograms.js`

The `buildNodes` function currently builds node data as `{ name, status, isPhantom }`. We need to add `applicationId` so the Sidebar can filter nodes by application.

- [ ] **Step 1: Update `buildNodes` to include `applicationId`**

In `client/src/hooks/usePrograms.js`, replace the `buildNodes` function:

```js
function buildNodes(programs) {
  return programs.map(p => ({
    id: p.id,
    type: 'programNode',
    position: { x: 0, y: 0 },
    data: { name: p.name, status: p.status, isPhantom: p.status === 'pending', applicationId: p.application_id ?? null },
  }))
}
```

The server returns `application_id` (snake_case) in each program object from `GET /api/programs`. Programs not belonging to any application will have `application_id: null`.

- [ ] **Step 2: Verify tests still pass**

```bash
cd server && npx vitest run 2>&1 | tail -5
```

Expected: 83 tests pass (no server tests affected, this is a client change).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/usePrograms.js
git commit -m "feat: include applicationId in node data"
```

---

## Task 3: Add `focusNodeId` prop to ProgramGraph

**Files:**
- Modify: `client/src/components/Graph/ProgramGraph.jsx`

`useReactFlow()` must be called inside the ReactFlow context (a child of `<ReactFlow>`). We create an inner `FocusHandler` component that renders nothing but runs the focus effect.

- [ ] **Step 1: Replace `ProgramGraph.jsx` with**

```jsx
import { useEffect } from 'react'
import ReactFlow, { Background, Controls, MiniMap, Panel, useReactFlow } from 'reactflow'
import 'reactflow/dist/style.css'
import ProgramNode from './ProgramNode.jsx'

const nodeTypes = { programNode: ProgramNode }

const LEGEND = [
  { color: '#4ade80', label: 'Analyzed', dashed: false },
  { color: '#60a5fa', label: 'Analyzing', dashed: false },
  { color: '#f87171', label: 'Failed', dashed: false },
  { color: '#475569', label: 'Pending', dashed: true },
]

const NODE_WIDTH = 160
const NODE_HEIGHT = 40

function FocusHandler({ focusNodeId, nodes }) {
  const { setCenter } = useReactFlow()
  useEffect(() => {
    if (!focusNodeId) return
    const node = nodes.find(n => n.id === focusNodeId)
    if (!node) return
    setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2,
      { zoom: 1.5, duration: 500 }
    )
  }, [focusNodeId])
  return null
}

export default function ProgramGraph({ nodes, edges, onNodeClick, onNodesChange, focusNodeId }) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onNodeClick(node)}
      onNodesChange={onNodesChange}
      fitView
    >
      <FocusHandler focusNodeId={focusNodeId} nodes={nodes} />
      <Panel position="top-right">
        <div style={{
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
      </Panel>
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

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Graph/ProgramGraph.jsx
git commit -m "feat: focusNodeId prop in ProgramGraph pans to node via FocusHandler"
```

---

## Task 4: Create `Sidebar.jsx`

**Files:**
- Create: `client/src/components/Sidebar/Sidebar.jsx`

The sidebar has two views controlled by `selectedAppId` (prop from App.jsx):
- `selectedAppId === null` → projects list view
- `selectedAppId !== null` → project files view

It fetches applications on mount and when `batchAppId` changes to `null` (batch finished). File list is derived from the `nodes` prop (already filtered or full list — Sidebar filters internally by `selectedAppId`).

- [ ] **Step 1: Create `client/src/components/Sidebar/Sidebar.jsx`**

```jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchApplications, cancelApplication } from '../../api/applications.js'
import { uploadFile } from '../../api/programs.js'
import ConfirmationModal from '../Upload/ConfirmationModal.jsx'

const STATUS_ORDER = { analyzing: 0, analyzed: 1, pending: 2, failed: 3 }

function statusIcon(status) {
  if (status === 'analyzing') return { icon: '▶', color: '#60a5fa' }
  if (status === 'analyzed')  return { icon: '✓', color: '#4ade80' }
  if (status === 'failed')    return { icon: '✗', color: '#f87171' }
  return { icon: '○', color: '#475569' }
}

function appStatusColor(status) {
  if (status === 'analyzing') return '#fbbf24'
  if (status === 'analyzed')  return '#4ade80'
  if (status === 'failed')    return '#f87171'
  return '#475569'
}

// ── Projects list view ──────────────────────────────────────────────────────

function ProjectsList({ applications, nodes, onSelectApp, onUploadFolder, onUploadFile }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>Проекти</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {applications.length === 0 && (
          <div style={{ color: '#475569', fontSize: 12, padding: '12px 8px' }}>
            Немає проектів. Завантажте папку щоб почати.
          </div>
        )}
        {applications.map(app => {
          const appNodes = nodes.filter(n => n.data.applicationId === app.id)
          const analyzedCount = appNodes.filter(n => n.data.status === 'analyzed').length
          const total = app.programCount ?? appNodes.length
          const progressPct = total > 0 ? (analyzedCount / total) * 100 : 0

          return (
            <div
              key={app.id}
              onClick={() => onSelectApp(app.id)}
              style={{
                padding: '9px 10px', borderRadius: 6,
                border: '1px solid transparent',
                marginBottom: 4, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 500 }}>{app.name}</div>
              <div style={{ color: appStatusColor(app.status), fontSize: 10, marginTop: 2 }}>
                {app.status === 'analyzing' ? `● analyzing ${analyzedCount} / ${total}` :
                 app.status === 'analyzed'  ? `✓ analyzed ${total} / ${total}` :
                 app.status === 'failed'    ? `✗ failed` :
                 `○ pending 0 / ${total}`}
              </div>
              {app.status === 'analyzing' && (
                <div style={{ background: '#0f172a', borderRadius: 2, height: 3, marginTop: 5 }}>
                  <div style={{ background: '#fbbf24', height: '100%', width: `${progressPct}%`, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '10px 8px', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          onClick={onUploadFolder}
          style={{ background: '#2563eb', border: 'none', borderRadius: 6, color: 'white', padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          + Upload Folder
        </button>
        <button
          onClick={onUploadFile}
          style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', padding: '8px', fontSize: 12, cursor: 'pointer' }}
        >
          + Upload File
        </button>
      </div>
    </div>
  )
}

// ── Project files view ──────────────────────────────────────────────────────

function ProjectFiles({ app, nodes, stepProgress, batchAppId, onBack, onFileClick, onBatchCancel, onAddFiles }) {
  const appNodes = nodes
    .filter(n => n.data.applicationId === app.id)
    .slice()
    .sort((a, b) => {
      const oa = STATUS_ORDER[a.data.status] ?? 4
      const ob = STATUS_ORDER[b.data.status] ?? 4
      if (oa !== ob) return oa - ob
      return a.data.name.localeCompare(b.data.name)
    })

  const analyzedCount = appNodes.filter(n => n.data.status === 'analyzed').length
  const total = appNodes.length
  const progressPct = total > 0 ? (analyzedCount / total) * 100 : 0
  const isThisBatchRunning = batchAppId === app.id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</div>
          <div style={{ color: appStatusColor(app.status), fontSize: 10, marginTop: 1 }}>{app.status}</div>
        </div>
        {isThisBatchRunning && (
          <button
            onClick={onBatchCancel}
            style={{ background: '#451a03', border: '1px solid #7c2d12', color: '#fed7aa', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
          >
            Stop
          </button>
        )}
      </div>

      <div style={{ padding: '8px 12px 4px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ background: '#0f172a', borderRadius: 2, height: 4 }}>
          <div style={{ background: '#2563eb', height: '100%', width: `${progressPct}%`, borderRadius: 2, transition: 'width 0.5s' }} />
        </div>
        <div style={{ color: '#475569', fontSize: 10, marginTop: 3 }}>{analyzedCount} з {total} готово</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {appNodes.map(node => {
          const { icon, color } = statusIcon(node.data.status)
          const step = stepProgress.get(node.id)
          const isAnalyzing = node.data.status === 'analyzing'
          return (
            <div
              key={node.id}
              onClick={() => onFileClick(node.id)}
              style={{
                padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                background: isAnalyzing ? '#1e3a5f22' : 'transparent',
                border: isAnalyzing ? '1px solid #2563eb33' : '1px solid transparent',
              }}
              onMouseEnter={e => { if (!isAnalyzing) e.currentTarget.style.background = '#1e293b' }}
              onMouseLeave={e => { if (!isAnalyzing) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color, fontSize: 10, flexShrink: 0 }}>{icon}</span>
                <span style={{ color: isAnalyzing ? '#e2e8f0' : '#94a3b8', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.data.name}.cbl
                </span>
              </div>
              {isAnalyzing && step && (
                <div style={{ color: '#60a5fa', fontSize: 9, marginLeft: 16, marginTop: 1 }}>
                  Step {step.step} of {step.total}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '8px', borderTop: '1px solid #334155' }}>
        <button
          onClick={onAddFiles}
          style={{ background: '#334155', border: 'none', borderRadius: 5, color: '#94a3b8', padding: '7px', width: '100%', fontSize: 11, cursor: 'pointer' }}
        >
          + Додати файли
        </button>
      </div>
    </div>
  )
}

// ── Main Sidebar component ──────────────────────────────────────────────────

export default function Sidebar({
  nodes,
  selectedAppId,
  onSelectApp,
  onBack,
  onFileClick,
  stepProgress,
  batchAppId,
  onBatchCancel,
  onUploaded,
  onBatchStarted,
}) {
  const [applications, setApplications] = useState([])
  const [folderFiles, setFolderFiles] = useState(null)
  const [defaultFolderName, setDefaultFolderName] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const folderRef = useRef(null)

  const loadApps = useCallback(async () => {
    try {
      const apps = await fetchApplications()
      setApplications(apps)
    } catch (err) {
      console.error('Failed to load applications', err)
    }
  }, [])

  useEffect(() => { loadApps() }, [loadApps])

  // Refresh apps list when batch finishes (batchAppId goes from set → null)
  const prevBatchAppId = useRef(batchAppId)
  useEffect(() => {
    if (prevBatchAppId.current !== null && batchAppId === null) loadApps()
    prevBatchAppId.current = batchAppId
  }, [batchAppId, loadApps])

  async function handleSingleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const applicationId = selectedAppId ?? null
      const program = await uploadFile(file, applicationId)
      onUploaded(program)
      loadApps()
    } catch (err) {
      console.error('Upload failed', err)
    } finally {
      setUploading(false)
      fileRef.current.value = ''
    }
  }

  function handleFolderSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.name.match(/\.(cbl|cob)$/i))
    if (files.length === 0) return
    const folderName = files[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultFolderName(folderName.toUpperCase())
    setFolderFiles(files)
    folderRef.current.value = ''
  }

  const selectedApp = applications.find(a => a.id === selectedAppId) ?? null

  return (
    <div style={{ width: 200, background: '#1e293b', borderRight: '1px solid #334155', height: '100%', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <input ref={fileRef} type="file" accept=".cbl,.cob" style={{ display: 'none' }} onChange={handleSingleFile} />
      <input ref={folderRef} type="file" webkitdirectory="" style={{ display: 'none' }} onChange={handleFolderSelect} />

      {selectedAppId === null || selectedApp === null ? (
        <ProjectsList
          applications={applications}
          nodes={nodes}
          onSelectApp={onSelectApp}
          onUploadFolder={() => folderRef.current.click()}
          onUploadFile={() => fileRef.current.click()}
        />
      ) : (
        <ProjectFiles
          app={selectedApp}
          nodes={nodes}
          stepProgress={stepProgress}
          batchAppId={batchAppId}
          onBack={onBack}
          onFileClick={onFileClick}
          onBatchCancel={onBatchCancel}
          onAddFiles={() => fileRef.current.click()}
        />
      )}

      {folderFiles && (
        <ConfirmationModal
          files={folderFiles}
          defaultName={defaultFolderName}
          onClose={() => setFolderFiles(null)}
          onStarted={(appId) => {
            setFolderFiles(null)
            onBatchStarted(appId)
            loadApps()
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Sidebar/Sidebar.jsx
git commit -m "feat: Sidebar component with projects list and project files views"
```

---

## Task 5: Wire Sidebar into App.jsx

**Files:**
- Modify: `client/src/App.jsx`

This task replaces the floating upload buttons, the batch badge, and wires up all the new Sidebar props. It also adds `selectedAppId`, `focusNodeId`, and `stepProgress` state.

- [ ] **Step 1: Replace `client/src/App.jsx` with**

```jsx
import { useState, useCallback, useRef } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'
import DetailPanel from './components/Panel/DetailPanel.jsx'
import SettingsDrawer from './components/Settings/SettingsDrawer.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useSSE } from './hooks/useSSE.js'
import { useAppSSE } from './hooks/useAppSSE.js'
import { cancelAnalysis } from './api/programs.js'
import { cancelApplication } from './api/applications.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed, onNodesChange } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [progressEvents, setProgressEvents] = useState([])
  const [progressForId, setProgressForId] = useState(null)
  const [panelRefreshTrigger, setPanelRefreshTrigger] = useState(0)
  const [batchAppId, setBatchAppId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedAppId, setSelectedAppId] = useState(null)
  const [focusNodeId, setFocusNodeId] = useState(null)
  const [stepProgress, setStepProgress] = useState(new Map())

  // Single-file SSE
  useSSE(analyzingId, (event, data) => {
    if (event === 'progress') setProgressEvents(prev => [...prev, data])
    if (event === 'done') {
      markAnalyzed(analyzingId)
      setAnalyzingId(null)
      setProgressForId(null)
      setProgressEvents([])
      setPanelRefreshTrigger(t => t + 1)
      refresh()
    }
    if (event === 'failed') {
      setAnalyzingId(null)
      refresh()
    }
    if (event === 'cancelled') {
      setAnalyzingId(null)
      setProgressForId(null)
      setProgressEvents([])
      refresh()
    }
  })

  // Batch SSE
  useAppSSE(batchAppId, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'analyzing') markAnalyzing(data.programId)
      if (data.stage === 'step') {
        setStepProgress(prev => new Map(prev).set(data.programId, { step: data.step, total: data.total }))
      }
    }
    if (event === 'done') {
      setBatchAppId(null)
      setStepProgress(new Map())
      refresh()
    }
    if (event === 'failed') {
      setBatchAppId(null)
      setStepProgress(new Map())
      refresh()
    }
    if (event === 'cancelled') {
      setBatchAppId(null)
      setStepProgress(new Map())
      refresh()
    }
  })

  const handleUploaded = useCallback(async (program) => {
    setAnalyzingId(program.id)
    setProgressForId(program.id)
    setProgressEvents([])
    await refresh()
    markAnalyzing(program.id)
  }, [markAnalyzing, refresh])

  const handleBatchStarted = useCallback(async (appId) => {
    setBatchAppId(appId)
    await refresh()
  }, [refresh])

  const handleCancel = useCallback(async () => {
    if (!analyzingId) return
    try { await cancelAnalysis(analyzingId) } catch (err) { console.error('Cancel failed', err) }
  }, [analyzingId])

  const handleBatchCancel = useCallback(async () => {
    if (!batchAppId) return
    try { await cancelApplication(batchAppId) } catch (err) { console.error('Batch cancel failed', err) }
  }, [batchAppId])

  const handleDeleted = useCallback(async (programId) => {
    if (selectedId === programId) setSelectedId(null)
    if (analyzingId === programId) setAnalyzingId(null)
    if (progressForId === programId) {
      setProgressForId(null)
      setProgressEvents([])
    }
    await refresh()
  }, [selectedId, analyzingId, progressForId, refresh])

  const handleFileClick = useCallback((programId) => {
    setFocusNodeId(programId)
    setSelectedId(programId)
  }, [])

  // Filtered nodes and edges for selected application
  const displayNodes = selectedAppId
    ? nodes.filter(n => n.data.applicationId === selectedAppId)
    : nodes

  const displayEdges = selectedAppId
    ? (() => {
        const ids = new Set(displayNodes.map(n => n.id))
        return edges.filter(e => ids.has(e.source) && ids.has(e.target))
      })()
    : edges

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', display: 'flex' }}>
      <Sidebar
        nodes={nodes}
        selectedAppId={selectedAppId}
        onSelectApp={setSelectedAppId}
        onBack={() => setSelectedAppId(null)}
        onFileClick={handleFileClick}
        stepProgress={stepProgress}
        batchAppId={batchAppId}
        onBatchCancel={handleBatchCancel}
        onUploaded={handleUploaded}
        onBatchStarted={handleBatchStarted}
      />

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <ProgramGraph
          nodes={displayNodes}
          edges={displayEdges}
          onNodeClick={(node) => { if (!node.data.isPhantom) setSelectedId(node.id) }}
          onNodesChange={onNodesChange}
          focusNodeId={focusNodeId}
        />

        <button
          onClick={() => setSettingsOpen(true)}
          style={{
            position: 'absolute', top: 16, right: 16, zIndex: 10,
            background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
            color: '#94a3b8', fontSize: 18, width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Settings"
        >
          ⚙
        </button>

        <DetailPanel
          programId={selectedId}
          progressForId={progressForId}
          progressEvents={progressEvents}
          refreshTrigger={panelRefreshTrigger}
          onClose={() => setSelectedId(null)}
          onNavigate={(id) => setSelectedId(id)}
          onDeleted={handleDeleted}
          onCancel={handleCancel}
        />
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Run server tests to confirm nothing broke**

```bash
cd server && npx vitest run 2>&1 | tail -5
```

Expected: `83 passed`

- [ ] **Step 3: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: integrate Sidebar, filter graph by application, step progress tracking"
```

---

## Task 6: Manual smoke test

- [ ] **Step 1: Start server and client**

Terminal 1:
```bash
cd server && npm run dev
```
Expected: `Server running on http://localhost:3001`

Terminal 2:
```bash
cd client && npm run dev
```
Expected: `Local: http://localhost:5173`

- [ ] **Step 2: Verify sidebar renders**

Open `http://localhost:5173`. Verify:
- Left sidebar appears (200px wide, dark background)
- "Проекти" header is visible
- "+ Upload Folder" and "+ Upload File" buttons at the bottom
- If any applications exist, they appear in the list with status

- [ ] **Step 3: Verify project navigation**

If applications exist in the DB, click one in the sidebar. Verify:
- View switches to files list
- ← back arrow appears
- Files list shows program names with status icons
- Graph shows only programs from that application
- Clicking ← returns to projects list and graph shows all programs again

- [ ] **Step 4: Verify file click focuses graph**

In the files view, click a file that has a corresponding node in the graph. Verify:
- Graph smoothly pans/zooms to that node (1.5× zoom, 500ms animation)
- DetailPanel opens on the right showing that program

- [ ] **Step 5: Verify batch progress in sidebar**

Upload a folder. Verify:
- `ConfirmationModal` appears (click Start Analysis)
- Sidebar switches to the new application's files view (or navigate there)
- Analyzing files appear at the top of the list highlighted in blue
- "Step X of Y" subtitle appears under analyzing files
- Progress bar at the top advances as files complete

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: smoke test fixes for sidebar navigation"
```

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
    setSelectedAppId(appId)
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

  const handleDeleteApp = useCallback(async (appId) => {
    if (selectedAppId === appId) setSelectedAppId(null)
    if (batchAppId === appId) setBatchAppId(null)
    setSelectedId(null)
    await refresh()
  }, [selectedAppId, batchAppId, refresh])

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
        onDeleteApp={handleDeleteApp}
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

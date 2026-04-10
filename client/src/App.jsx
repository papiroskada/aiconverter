import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import Sidebar from './components/Sidebar/Sidebar.jsx'
import DetailPanel from './components/Panel/DetailPanel.jsx'
import SettingsDrawer from './components/Settings/SettingsDrawer.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useAppSSE } from './hooks/useAppSSE.js'
import { cancelApplication } from './api/applications.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, onNodesChange } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [panelRefreshTrigger, setPanelRefreshTrigger] = useState(0)
  const [batchAppId, setBatchAppId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [selectedAppId, setSelectedAppId] = useState(null)
  const [focusNodeId, setFocusNodeId] = useState(null)
  const [stepProgress, setStepProgress] = useState(new Map())

  // Batch SSE
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
    if (selectedId === programId) setSelectedId(null)
    await refresh()
  }, [selectedId, refresh])

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
    ? (() => {
        const appNodes = nodes.filter(n => n.data.applicationId === selectedAppId)
        const appNodeIds = new Set(appNodes.map(n => n.id))
        // include phantoms connected to this application's nodes
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
      <Sidebar
        nodes={nodes}
        selectedAppId={selectedAppId}
        onSelectApp={setSelectedAppId}
        onBack={() => setSelectedAppId(null)}
        onFileClick={handleFileClick}
        stepProgress={stepProgress}
        batchAppId={batchAppId}
        onBatchCancel={handleBatchCancel}
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
          stepProgress={stepProgress}
          refreshTrigger={panelRefreshTrigger}
          onClose={() => setSelectedId(null)}
          onNavigate={(id) => setSelectedId(id)}
          onDeleted={handleDeleted}
        />
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import UploadControls from './components/Upload/UploadControls.jsx'
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

  // Single-file SSE (existing)
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

  // Batch/application SSE
  useAppSSE(batchAppId, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'analyzing') markAnalyzing(data.programId)
    }
    if (event === 'done') {
      setBatchAppId(null)
      refresh()
    }
    if (event === 'failed') {
      setBatchAppId(null)
      refresh()
    }
    if (event === 'cancelled') {
      setBatchAppId(null)
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

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', position: 'relative' }}>
      <ProgramGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => { if (!node.data.isPhantom) setSelectedId(node.id) }}
        onNodesChange={onNodesChange}
      />

      {/* Settings gear icon */}
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

      {batchAppId && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 10,
        }}>
          <span style={{ color: '#60a5fa', fontSize: 12 }}>⟳ Batch analyzing…</span>
          <button
            onClick={handleBatchCancel}
            style={{
              background: '#451a03', border: '1px solid #7c2d12', color: '#fed7aa',
              borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
            }}
          >
            Stop
          </button>
        </div>
      )}

      <UploadControls onUploaded={handleUploaded} onBatchStarted={handleBatchStarted} />

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

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

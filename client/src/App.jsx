import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import UploadButton from './components/Upload/UploadButton.jsx'
import DetailPanel from './components/Panel/DetailPanel.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useSSE } from './hooks/useSSE.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed, onNodesChange } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [progressEvents, setProgressEvents] = useState([])
  const [progressForId, setProgressForId] = useState(null)
  const [panelRefreshTrigger, setPanelRefreshTrigger] = useState(0)

  useSSE(analyzingId, (event, data) => {
    if (event === 'progress') {
      setProgressEvents(prev => [...prev, data])
    }
    if (event === 'done') {
      markAnalyzed(analyzingId)
      setAnalyzingId(null)
      setProgressForId(null)  // clear — progress UI disappears after success
      setProgressEvents([])
      setPanelRefreshTrigger(t => t + 1)
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
      <UploadButton onUploaded={handleUploaded} />
      <DetailPanel
        programId={selectedId}
        progressForId={progressForId}
        progressEvents={progressEvents}
        refreshTrigger={panelRefreshTrigger}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
        onDeleted={handleDeleted}
      />
    </div>
  )
}

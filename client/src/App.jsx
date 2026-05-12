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
  const [appsRefreshTrigger, setAppsRefreshTrigger] = useState(0)

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

  const handleAnalyzing = useCallback((programId) => {
    markAnalyzing(programId)
    refresh()
  }, [markAnalyzing, refresh])

  const handleReanalyzed = useCallback(async () => {
    setPanelRefreshTrigger(t => t + 1)
    setAppsRefreshTrigger(t => t + 1)
    await refresh()
  }, [refresh])

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
        appsRefreshTrigger={appsRefreshTrigger}
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
            onAnalyzing={handleAnalyzing}
            onReanalyzed={handleReanalyzed}
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

import { useState, useEffect, useRef } from 'react'
import { fetchProgram, deleteProgram, triggerReanalyze } from '../../api/programs.js'
import { useSSE } from '../../hooks/useSSE.js'
import OverviewTab from './OverviewTab.jsx'
import LogicTab from './LogicTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'
import DataTab from './DataTab.jsx'
import CodeTab from './CodeTab.jsx'

const TABS = ['Overview', 'Logic', 'Data', 'Connections', 'Code']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

const EXPORT_ITEM_STYLE = {
  display: 'block', width: '100%', background: 'none', border: 'none',
  color: '#e2e8f0', padding: '8px 14px', textAlign: 'left',
  cursor: 'pointer', fontSize: 12,
}

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

export default function ProgramDetail({ programId, onClose, onNavigate, onDeleted, onAnalyzing, onReanalyzed, stepProgress = new Map(), refreshTrigger = 0 }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [sseActive, setSseActive] = useState(false)
  const [localStepData, setLocalStepData] = useState(null)
  const exportRef = useRef(null)
  const doneRef = useRef(false)
  const onReanalyzedRef = useRef(onReanalyzed)
  useEffect(() => { onReanalyzedRef.current = onReanalyzed })

  useSSE(sseActive ? programId : null, (event, data) => {
    if (event === 'progress' && data.stage === 'step') {
      setLocalStepData({ step: data.step, total: data.total })
    }
    if (event === 'done' || event === 'failed') {
      if (doneRef.current) return
      doneRef.current = true
      setSseActive(false)
      setLocalStepData(null)
      setReanalyzing(false)
      fetchProgram(programId).then(setProgram).catch(console.error)
      onReanalyzedRef.current?.()
    }
  })

  // Polling fallback: re-fetch every 8s in case the SSE `done` event is missed
  useEffect(() => {
    if (!sseActive || !programId) return
    doneRef.current = false
    const id = setInterval(async () => {
      if (doneRef.current) return
      try {
        const updated = await fetchProgram(programId)
        if (updated.status !== 'analyzing') {
          doneRef.current = true
          setSseActive(false)
          setLocalStepData(null)
          setReanalyzing(false)
          setProgram(updated)
          onReanalyzedRef.current?.()
        }
      } catch { /* ignore */ }
    }, 8000)
    return () => clearInterval(id)
  }, [sseActive, programId])

  useEffect(() => {
    if (!programId) return
    setProgram(null)
    setTab('Overview')
    setError(null)
    setSseActive(false)
    setLocalStepData(null)
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId])

  useEffect(() => {
    if (!programId || refreshTrigger === 0) return
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId, refreshTrigger])

  useEffect(() => {
    if (!exportOpen) return
    function handleClick(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportOpen])

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
      setProgram(prev => prev ? { ...prev, status: 'analyzing' } : prev)
      setSseActive(true)
      onAnalyzing?.(programId)
    } catch (err) {
      setError(err.message)
      setReanalyzing(false)
    }
  }

  function handleFlagsChange(updatedFlags) {
    setProgram(prev => prev ? { ...prev, analysis: { ...prev.analysis, flags: updatedFlags } } : prev)
  }

  function handleExport(format) {
    setExportOpen(false)
    const url = `/api/programs/${programId}/export?format=${format}`
    const a = document.createElement('a')
    a.href = url
    a.download = format === 'openapi' ? `${program.name}-openapi.json` : `${program.name}.md`
    a.click()
  }

  const stepData = stepProgress.get(programId) ?? localStepData
  const isCodeTab = tab === 'Code'

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
          <div ref={exportRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setExportOpen(o => !o)}
              disabled={!program?.analysis}
              style={{
                background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
                borderRadius: 6, padding: '6px 12px', fontSize: 11, cursor: 'pointer',
                opacity: !program?.analysis ? 0.4 : 1,
              }}
            >
              Export ▾
            </button>
            {exportOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 4px)',
                background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
                zIndex: 30, minWidth: 150, boxShadow: '0 4px 12px #00000066', overflow: 'hidden',
              }}>
                <button onClick={() => handleExport('markdown')} style={EXPORT_ITEM_STYLE}>
                  Markdown doc
                </button>
                <button onClick={() => handleExport('openapi')} style={EXPORT_ITEM_STYLE}>
                  OpenAPI JSON
                </button>
              </div>
            )}
          </div>
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

      <div style={{ flex: 1, overflowY: isCodeTab ? 'hidden' : 'auto', padding: isCodeTab ? '20px 24px 16px' : '20px 24px', display: 'flex', flexDirection: 'column' }}>
        {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 12, flexShrink: 0 }}>{error}</div>}
        {stepData && <ProgressUI step={stepData.step} total={stepData.total} />}
        {!program ? (
          <p style={{ color: '#64748b' }}>Loading…</p>
        ) : (
          <>
            {tab === 'Overview'    && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic'       && <LogicTab analysis={program.analysis} programId={programId} onFlagsChange={handleFlagsChange} />}
            {tab === 'Data'        && <DataTab analysis={program.analysis} />}
            {tab === 'Connections' && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />}
            {tab === 'Code'        && (
              <CodeTab
                programId={programId}
                programName={program.name}
                applicationId={program.application_id}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { fetchProgram, deleteProgram } from '../../api/programs.js'
import OverviewTab from './OverviewTab.jsx'
import LogicTab from './LogicTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'
import DataTab from './DataTab.jsx'

const TABS = ['Overview', 'Logic', 'Connections', 'Data']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

function ProgressUI({ step, total }) {
  const pct = Math.round((step / total) * 100)
  return (
    <div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Analyzing…</div>
      <div style={{ height: 4, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#60a5fa', borderRadius: 2, transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Step {step} of {total} ({pct}%)</div>
    </div>
  )
}

export default function DetailPanel({ programId, onClose, onNavigate, onDeleted, stepProgress = new Map(), refreshTrigger = 0 }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [width, setWidth] = useState(() => parseInt(localStorage.getItem('panelWidth') || '340'))

  useEffect(() => {
    if (!programId) return
    setProgram(null)
    setTab('Overview')
    setDeleteError(null)
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId])

  useEffect(() => {
    if (!programId || refreshTrigger === 0) return
    fetchProgram(programId).then(setProgram).catch(console.error)
  }, [programId, refreshTrigger])

  function startResize(e) {
    e.preventDefault()
    const onMove = (e) => {
      const newWidth = Math.min(600, Math.max(280, window.innerWidth - e.clientX))
      setWidth(newWidth)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setWidth(w => { localStorage.setItem('panelWidth', String(w)); return w })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function handleDelete() {
    if (!programId || deleting) return
    const confirmed = window.confirm('Delete this program and all related data?')
    if (!confirmed) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProgram(programId)
      onDeleted?.(programId)
    } catch (err) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  if (!programId) return null

  const stepData = stepProgress.get(programId)
  const isAnalyzing = !!stepData

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width, height: '100%',
      background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column',
      zIndex: 10, overflowY: 'hidden',
    }}>
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        style={{ position: 'absolute', left: 0, top: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 11 }}
      />

      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{program?.name || '…'}</div>
          {program && <div style={{ fontSize: 11, color: STATUS_COLOR[program.status], marginTop: 2 }}>● {program.status}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={handleDelete}
            disabled={deleting || program?.status === 'analyzing'}
            title={program?.status === 'analyzing' ? 'Cannot delete while analyzing' : 'Delete program'}
            style={{
              background: '#7f1d1d',
              border: '1px solid #991b1b',
              color: '#fecaca',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 11,
              cursor: deleting || program?.status === 'analyzing' ? 'not-allowed' : 'pointer',
              opacity: deleting || program?.status === 'analyzing' ? 0.6 : 1,
            }}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
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
        {deleteError && (
          <div style={{ color: '#f87171', fontSize: 12, marginBottom: 10 }}>{deleteError}</div>
        )}
        {isAnalyzing && (
          <div style={{ marginBottom: 16 }}>
            <ProgressUI step={stepData.step} total={stepData.total} />
          </div>
        )}
        {!program ? <p style={{ color: '#64748b' }}>Loading…</p> : (
          <>
            {tab === 'Overview'     && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic'        && <LogicTab analysis={program.analysis} />}
            {tab === 'Connections'  && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />}
            {tab === 'Data'         && <DataTab analysis={program.analysis} />}
          </>
        )}
      </div>
    </div>
  )
}

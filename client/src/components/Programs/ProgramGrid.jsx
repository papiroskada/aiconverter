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

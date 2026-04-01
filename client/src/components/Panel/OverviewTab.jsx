import { useState, useEffect, useRef } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false

export default function OverviewTab({ analysis }) {
  const [fullscreen, setFullscreen] = useState(false)
  const inlineRef = useRef(null)
  const fullscreenRef = useRef(null)
  const renderIdRef = useRef(0)

  useEffect(() => {
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark' })
      mermaidInitialized = true
    }
  }, [])

  useEffect(() => {
    const target = fullscreen ? fullscreenRef.current : inlineRef.current
    if (!analysis?.diagram || !target) return
    const id = `mermaid-overview-${++renderIdRef.current}`
    mermaid.render(id, analysis.diagram)
      .then(({ svg }) => { if (target) target.innerHTML = svg })
      .catch(() => { if (target) target.innerHTML = '<p style="color:#f87171;margin:0">Failed to render diagram</p>' })
  }, [analysis?.diagram, fullscreen])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  if (!analysis) return <p style={{ color: '#64748b' }}>No analysis yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {analysis.description && (
        <section>
          <label style={labelStyle}>Description</label>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{analysis.description}</p>
        </section>
      )}

      {analysis.call_parameters?.length > 0 && (
        <section>
          <label style={labelStyle}>Call Parameters</label>
          {analysis.call_parameters.map((p, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{p.type}</span>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>
            </div>
          ))}
        </section>
      )}

      {analysis.external_calls?.length > 0 && (
        <section>
          <label style={labelStyle}>External Calls</label>
          {analysis.external_calls.map((c, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#60a5fa' }}>{c.program} ({c.using})</span>
            </div>
          ))}
        </section>
      )}

      {analysis.db_tables?.length > 0 && (
        <section>
          <label style={labelStyle}>DB Tables</label>
          {analysis.db_tables.map((t, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e2e8f0' }}>{t.table}</span>
                <span style={{ fontSize: 11, color: '#f59e0b' }}>{t.operation}</span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 11, margin: '2px 0 0' }}>
                {t.fields?.join(', ')}
              </p>
            </div>
          ))}
        </section>
      )}

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Diagram</label>
          {analysis.diagram && (
            <button
              onClick={() => setFullscreen(true)}
              title="Fullscreen"
              style={fullscreenBtnStyle}
            >
              ⛶
            </button>
          )}
        </div>
        {analysis.diagram ? (
          <div
            ref={inlineRef}
            style={{ background: '#0f172a', borderRadius: 6, padding: 8, overflowX: 'auto' }}
          />
        ) : (
          <p style={{ color: '#64748b', margin: 0 }}>Diagram not available.</p>
        )}
      </section>

      {fullscreen && (
        <div
          data-testid="fullscreen-overlay"
          onClick={() => setFullscreen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            ref={fullscreenRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1e293b',
              borderRadius: 8,
              padding: 24,
              maxWidth: '90vw',
              maxHeight: '90vh',
              overflow: 'auto',
            }}
          />
        </div>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const fullscreenBtnStyle = { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, padding: '0 4px' }

function renderNotFoundSection(nfa) {
  if (!nfa || nfa === 'n/a') return null
  let color = '#f59e0b'
  let text
  if (typeof nfa === 'string') {
    text = `→ ${nfa}`
  } else if (nfa.type === 'error') {
    color = '#f87171'
    text = `→ error ${nfa.code}`
  } else if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    text = `→ defaults${fields ? ` (${fields})` : ''}${nfa.logError ? ' ⚡log' : ''}`
  } else if (nfa.type === 'continue') {
    color = '#64748b'
    text = '→ continue'
  } else if (nfa.type === 'skip') {
    return null
  } else {
    return null
  }
  return (
    <>
      <div style={{ color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2, marginTop: 6 }}>Not Found</div>
      <p style={{ color, fontSize: 11, margin: 0 }}>{text}</p>
    </>
  )
}

function opColor(op = '') {
  const hasRead  = /READ|SELECT|SGE|RDN/.test(op)
  const hasWrite = /WRITE|INSERT|UPDATE|DELETE|INL|UPD|DEL/.test(op)
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const subLabelStyle = { color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2, marginTop: 6 }

export default function DataTab({ analysis }) {
  const dbTables = analysis?.db_tables ?? []
  const fileOps  = analysis?.file_ops  ?? []
  const model    = analysis?.analysis_model
  const twoStep  = analysis?.analysis_two_step

  if (!dbTables.length && !fileOps.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No database tables or file operations found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {dbTables.length > 0 && (
        <div>
          <label style={labelStyle}>Database Tables ({dbTables.length})</label>
          {dbTables.map((t, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{t.table}</span>
                <span style={{ fontSize: 11, color: opColor(t.operation), fontFamily: 'monospace' }}>{t.operation}</span>
              </div>

              {t.fields?.length > 0 && (
                <>
                  <div style={subLabelStyle}>Fields</div>
                  <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>{t.fields.join(', ')}</p>
                </>
              )}

              {t.keyFields?.length > 0 && (
                <>
                  <div style={subLabelStyle}>Key (WHERE)</div>
                  <p style={{ color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', margin: 0 }}>{t.keyFields.join(', ')}</p>
                </>
              )}

              {renderNotFoundSection(t.notFoundAction)}
            </div>
          ))}
        </div>
      )}

      {(() => {
        const entryPoints = (analysis?.entry_points ?? []).filter(ep => ep.dbOperations?.length > 0)
        if (!entryPoints.length) return null
        return (
          <div>
            <label style={labelStyle}>Per-Mode Operations</label>
            {entryPoints.map((ep, i) => (
              <div key={i} style={rowStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ background: '#1e3a5f', color: '#93c5fd', borderRadius: 3, padding: '1px 6px', fontSize: 10, fontFamily: 'monospace' }}>
                    {ep.condition}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{ep.businessName}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {ep.dbOperations.map((op, j) => (
                    <span key={j} style={{
                      background: '#0f172a', border: '1px solid #1e293b',
                      borderRadius: 3, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace',
                      color: opColor(op.operation),
                    }}>
                      {op.table} {op.operation}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {fileOps.length > 0 && (
        <div>
          <label style={labelStyle}>File I/O</label>
          {fileOps.map((f, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{f.file}</span>
                <span style={{ fontSize: 11, color: opColor((f.operations ?? []).join(' ')) }}>
                  {(f.operations ?? []).join(', ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {(model || twoStep != null) && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {model && (
            <span style={{ color: '#334155', fontSize: 10, fontFamily: 'monospace' }}>{model}</span>
          )}
          {twoStep != null && (
            <span style={{ color: '#334155', fontSize: 10 }}>two-step: {twoStep ? 'yes' : 'no'}</span>
          )}
        </div>
      )}

    </div>
  )
}

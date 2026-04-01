export default function ConnectionsTab({ edges, programId, onNavigate, analysis }) {
  const incoming = edges.filter(e => e.to_program_id === programId)
  const outgoing = edges.filter(e => e.from_program_id === programId)
  const externalCalls = analysis?.external_calls ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>Called by ({incoming.length})</label>
        {incoming.length === 0 ? <p style={emptyStyle}>None</p> : incoming.map((e, i) => (
          <div key={i} style={rowStyle} onClick={() => onNavigate(e.from_program_id)} className="clickable">
            <span style={{ color: '#60a5fa', cursor: 'pointer' }}>{e.from_program_name}</span>
          </div>
        ))}
      </section>

      <section>
        <label style={labelStyle}>Calls ({outgoing.length})</label>
        {outgoing.length === 0 ? <p style={emptyStyle}>None</p> : outgoing.map((e, i) => {
          const isPending = e.to_program_status === 'pending'
          const isUnknown = !e.to_program_id
          const clickable = !isPending && !isUnknown
          return (
            <div
              key={i}
              style={rowStyle}
              onClick={() => clickable && onNavigate(e.to_program_id)}
            >
              <span style={{ color: clickable ? '#60a5fa' : '#64748b', cursor: clickable ? 'pointer' : 'default' }}>
                {e.to_program_name}
              </span>
              {isPending && <span style={badgeStyle}>not analyzed</span>}
              {isUnknown && <span style={badgeStyle}>not uploaded</span>}
            </div>
          )
        })}
      </section>

      {externalCalls.length > 0 && (
        <section>
          <label style={labelStyle}>External Calls ({externalCalls.length})</label>
          {externalCalls.map((c, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>
                {c.program}{c.using ? ` (${c.using})` : ''}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const emptyStyle = { color: '#475569', fontSize: 12, margin: 0 }
const badgeStyle = { fontSize: 10, color: '#475569', marginLeft: 8 }

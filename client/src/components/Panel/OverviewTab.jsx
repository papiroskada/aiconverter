const DIRECTION_BADGE = {
  in:    { label: 'in',    color: '#4ade80' },
  out:   { label: 'out',   color: '#f87171' },
  inout: { label: 'inout', color: '#fbbf24' },
}

function ParamRow({ p }) {
  const badge = DIRECTION_BADGE[p.direction]
  return (
    <div style={rowStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
          {badge && (
            <span style={{ fontSize: 10, color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 3, padding: '1px 5px', lineHeight: 1.4 }}>
              {badge.label}
            </span>
          )}
        </div>
        <span style={{ color: '#475569', fontSize: 11 }}>{p.type}</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{p.cobolName}</div>
      {p.description && <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>}
    </div>
  )
}

export default function OverviewTab({ analysis }) {
  if (!analysis) return <p style={{ color: '#64748b' }}>No analysis yet.</p>

  const inputParams  = tryParse(analysis.input_contract)
  const outputParams = tryParse(analysis.output_contract)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {analysis.business_purpose && (
        <section>
          <label style={labelStyle}>Business Purpose</label>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{analysis.business_purpose}</p>
        </section>
      )}

      {inputParams.length > 0 && (
        <section>
          <label style={labelStyle}>Input Parameters</label>
          {inputParams.map((p, i) => <ParamRow key={i} p={p} />)}
        </section>
      )}

      {outputParams.length > 0 && (
        <section>
          <label style={labelStyle}>Output Parameters</label>
          {outputParams.map((p, i) => <ParamRow key={i} p={p} />)}
        </section>
      )}
    </div>
  )
}

function tryParse(str) {
  try { return JSON.parse(str) ?? [] } catch { return [] }
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }

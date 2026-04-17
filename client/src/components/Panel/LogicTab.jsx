const sectionStyle = { marginBottom: 20 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 8 }
const cardStyle = { background: '#0f172a', borderRadius: 6, padding: '10px 12px', marginBottom: 8 }
const tagStyle = { display: 'inline-block', background: '#1e3a5f', color: '#93c5fd', borderRadius: 4, padding: '2px 7px', fontSize: 11, marginBottom: 6 }

export default function LogicTab({ analysis }) {
  const entryPoints  = analysis?.entry_points  ?? []
  const errorCatalog = analysis?.error_catalog  ?? []
  const preDispatch  = analysis?.pre_dispatch   ?? []

  if (!preDispatch.length && !entryPoints.length && !errorCatalog.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No business logic extracted yet.</p>
  }

  return (
    <div>
      {preDispatch.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Pre-Dispatch (runs before every mode)</label>
          <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preDispatch.map((name, i) => (
              <span key={i} style={{ background: '#172554', color: '#93c5fd', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {entryPoints.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Entry Points</label>
          {entryPoints.map((ep, i) => (
            <div key={i} style={cardStyle}>
              <div style={tagStyle}>{ep.condition}</div>
              <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{ep.businessName}</div>

              {ep.steps?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Steps</div>
                  {ep.steps.map((s, j) => (
                    <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
                      <span style={{ color: '#475569', fontSize: 11, flexShrink: 0 }}>{j + 1}.</span>
                      <span style={{ color: '#cbd5e1', fontSize: 12 }}>{s}</span>
                    </div>
                  ))}
                </div>
              )}

              {ep.sideEffects?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Side Effects</div>
                  {ep.sideEffects.map((s, j) => (
                    <div key={j} style={{ color: '#fbbf24', fontSize: 11, marginBottom: 2 }}>⚡ {s}</div>
                  ))}
                </div>
              )}

              {ep.returns && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Returns</div>
                  <div style={{ color: '#4ade80', fontSize: 12 }}>✓ {ep.returns}</div>
                </div>
              )}

              {ep.errors?.length > 0 && (
                <div>
                  <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Errors</div>
                  {ep.errors.map((e, j) => (
                    <div key={j} style={{ color: '#f87171', fontSize: 11, marginBottom: 2 }}>✗ {e}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {errorCatalog.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Error Catalog</label>
          {errorCatalog.map((e, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ color: '#f87171', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{e.code}</div>
              <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 4 }}>{e.businessMeaning}</div>
              {e.systemAction && (
                <div style={{ color: '#94a3b8', fontSize: 11 }}>→ {e.systemAction}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

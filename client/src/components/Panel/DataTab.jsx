function opColor(op = '') {
  const hasRead = op.includes('READ')
  const hasWrite = op.includes('WRITE') || op.includes('DELETE')
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

const rowStyle = {
  background: '#0f172a',
  borderRadius: 6,
  padding: '8px 10px',
  marginBottom: 4,
}

export default function DataTab({ analysis }) {
  if (!analysis?.db_tables?.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No database tables found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {analysis.db_tables.map((t, i) => (
        <div key={i} style={rowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{t.table}</span>
            <span style={{ fontSize: 11, color: `var(--op-color)`, '--op-color': opColor(t.operation) }}>{t.operation}</span>
          </div>
          {t.fields?.length > 0 && (
            <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>
              {t.fields.join(', ')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

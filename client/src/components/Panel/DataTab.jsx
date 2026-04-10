function opColor(op = '') {
  const hasRead  = op.includes('READ') || op.includes('SELECT')
  const hasWrite = op.includes('WRITE') || op.includes('INSERT') || op.includes('UPDATE') || op.includes('DELETE')
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
  const dbTables = analysis?.db_tables ?? []
  const fileOps = analysis?.file_ops ?? []

  if (!dbTables.length && !fileOps.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No database tables or file operations found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {dbTables.length > 0 && (
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Database Tables</div>
          {dbTables.map((t, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{t.table}</span>
                <span style={{ fontSize: 11, color: opColor(t.operation) }}>{t.operation}</span>
              </div>
              {t.fields?.length > 0 && (
                <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>
                  {t.fields.join(', ')}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {fileOps.length > 0 && (
        <div>
          <div style={{ color: '#64748b', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>File I/O</div>
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
    </div>
  )
}

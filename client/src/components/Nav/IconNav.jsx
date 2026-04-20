const btnStyle = (active) => ({
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 6, cursor: 'pointer', fontSize: 16, border: 'none',
  background: active ? '#1e40af' : 'none',
  color: active ? '#fff' : '#475569',
})

export default function IconNav({ view, onViewChange, onSettingsOpen }) {
  return (
    <div style={{
      width: 44, background: '#0f172a', borderRight: '1px solid #1e293b',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 0', gap: 4, flexShrink: 0,
    }}>
      <div style={{ color: '#38bdf8', fontSize: 18, marginBottom: 8 }}>⬡</div>
      <button style={btnStyle(view === 'list')} onClick={() => onViewChange('list')} title="Programs">⊞</button>
      <button style={btnStyle(view === 'graph')} onClick={() => onViewChange('graph')} title="Graph">◎</button>
      <div style={{ flex: 1 }} />
      <button style={btnStyle(false)} onClick={onSettingsOpen} title="Settings">⚙</button>
    </div>
  )
}

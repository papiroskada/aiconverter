import { Handle, Position } from 'reactflow'

const STATUS_STYLES = {
  analyzed: { borderColor: '#4ade80', background: '#166534' },
  analyzing: { borderColor: '#60a5fa', background: '#1e3a5f', animation: 'pulse 1.5s infinite' },
  pending: { borderColor: '#475569', background: '#1e293b' },
  failed: { borderColor: '#f87171', background: '#450a0a' },
}

export default function ProgramNode({ data }) {
  const style = STATUS_STYLES[data.status] || STATUS_STYLES.pending
  return (
    <>
      <div
        style={{
          padding: '8px 14px',
          borderRadius: 8,
          border: `2px ${data.isPhantom ? 'dashed' : 'solid'} ${style.borderColor}`,
          background: style.background,
          color: '#e2e8f0',
          fontSize: 13,
          fontWeight: 600,
          minWidth: 90,
          textAlign: 'center',
          animation: style.animation,
        }}
        className={`status-${data.status} ${data.isPhantom ? 'phantom' : ''}`}
      >
        <Handle type="target" position={Position.Top} />
        {data.name}
        <Handle type="source" position={Position.Bottom} />
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }`}</style>
    </>
  )
}

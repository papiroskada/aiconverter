import { useEffect } from 'react'
import ReactFlow, { Background, Controls, MiniMap, Panel, useReactFlow } from 'reactflow'
import 'reactflow/dist/style.css'
import ProgramNode from './ProgramNode.jsx'

const nodeTypes = { programNode: ProgramNode }

const LEGEND = [
  { color: '#4ade80', label: 'Analyzed', dashed: false },
  { color: '#60a5fa', label: 'Analyzing', dashed: false },
  { color: '#f87171', label: 'Failed', dashed: false },
  { color: '#475569', label: 'Pending', dashed: true },
]

const NODE_WIDTH = 160
const NODE_HEIGHT = 40

function FocusHandler({ focusNodeId, nodes }) {
  const { setCenter } = useReactFlow()
  useEffect(() => {
    if (!focusNodeId) return
    const node = nodes.find(n => n.id === focusNodeId)
    if (!node) return
    setCenter(
      node.position.x + NODE_WIDTH / 2,
      node.position.y + NODE_HEIGHT / 2,
      { zoom: 1.5, duration: 500 }
    )
  }, [focusNodeId])
  return null
}

export default function ProgramGraph({ nodes, edges, onNodeClick, onNodesChange, focusNodeId }) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onNodeClick(node)}
      onNodesChange={onNodesChange}
      fitView
    >
      <FocusHandler focusNodeId={focusNodeId} nodes={nodes} />
      <Panel position="top-right">
        <div style={{
          background: 'rgba(15,23,42,0.85)', borderRadius: 8, padding: '8px 12px',
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          {LEGEND.map(({ color, label, dashed }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
              <div style={{
                width: 16, height: 16, borderRadius: 3,
                border: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
                background: 'transparent',
              }} />
              {label}
            </div>
          ))}
        </div>
      </Panel>
      <Background color="#1e293b" />
      <Controls />
      <MiniMap nodeColor={n => {
        const s = n.data?.status
        if (s === 'analyzed') return '#4ade80'
        if (s === 'analyzing') return '#60a5fa'
        if (s === 'failed') return '#f87171'
        return '#475569'
      }} />
    </ReactFlow>
  )
}

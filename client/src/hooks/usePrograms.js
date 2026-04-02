import { useState, useEffect, useCallback } from 'react'
import { applyNodeChanges } from 'reactflow'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import { fetchGraph } from '../api/programs.js'

const NODE_WIDTH = 160
const NODE_HEIGHT = 40

function applyDagreLayout(nodes, edges) {
  const g = new graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 })

  nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach(e => {
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      g.setEdge(e.source, e.target)
    }
  })

  dagreLayout(g)

  return nodes.map(n => {
    const pos = g.node(n.id)
    return {
      ...n,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    }
  })
}

function buildNodes(programs) {
  return programs.map(p => ({
    id: p.id,
    type: 'programNode',
    position: { x: 0, y: 0 },
    data: { name: p.name, status: p.status, isPhantom: p.status === 'pending', applicationId: p.application_id ?? null },
  }))
}

function buildEdges(rawEdges, programs) {
  const nameToId = new Map(programs.map(p => [p.name, p.id]))
  const seen = new Set()

  return rawEdges
    .map((e, i) => ({
      id: `e-${i}`,
      source: e.from,
      target: e.to || nameToId.get(e.to_name) || null,
    }))
    .filter(e => {
      if (!e.source || !e.target) return false
      const key = [e.source, e.target].sort().join('|')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function usePrograms() {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { programs, edges: rawEdges } = await fetchGraph()
    const newNodes = buildNodes(programs)
    const newEdges = buildEdges(rawEdges, programs)
    const layoutedNodes = applyDagreLayout(newNodes, newEdges)

    setNodes(prev => {
      const posMap = new Map(prev.map(n => [n.id, n.position]))
      return layoutedNodes.map(n => ({
        ...n,
        position: posMap.get(n.id) || n.position,
      }))
    })
    setEdges(newEdges)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const markAnalyzing = useCallback((programId) => {
    setNodes(prev => prev.map(n =>
      n.id === programId ? { ...n, data: { ...n.data, status: 'analyzing' } } : n
    ))
  }, [])

  const markAnalyzed = useCallback((programId) => {
    setNodes(prev => prev.map(n =>
      n.id === programId ? { ...n, data: { ...n.data, status: 'analyzed' } } : n
    ))
  }, [])

  const onNodesChange = useCallback((changes) => {
    setNodes(prev => applyNodeChanges(changes, prev))
  }, [])

  return { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed, onNodesChange }
}

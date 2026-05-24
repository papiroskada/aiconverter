import { useState, useMemo } from 'react'
import { usePrograms } from '@/hooks/usePrograms.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ProgramGraph from '@/components/Graph/ProgramGraph.jsx'

export default function GraphPage() {
  const { nodes, edges, loading, onNodesChange } = usePrograms()
  const [appFilter, setAppFilter] = useState('all')

  const apps = useMemo(() => {
    const seen = new Map()
    for (const n of nodes) {
      const id = n.data.applicationId
      if (id && !seen.has(id)) seen.set(id, n.data.applicationName ?? id)
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [nodes])

  const displayNodes = appFilter === 'all'
    ? nodes
    : nodes.filter(n => n.data.applicationId === appFilter || n.data.isPhantom)

  const displayEdges = useMemo(() => {
    const ids = new Set(displayNodes.map(n => n.id))
    return edges.filter(e => ids.has(e.source) && ids.has(e.target))
  }, [displayNodes, edges])

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>

  return (
    <div className="flex flex-col h-full">
      {apps.length > 1 && (
        <div className="px-4 py-2 border-b border-border shrink-0 flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Project</span>
          <Select value={appFilter} onValueChange={setAppFilter}>
            <SelectTrigger className="h-8 w-52 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {apps.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex-1">
        <ProgramGraph
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          focusNodeId={null}
          onNodeClick={() => {}}
        />
      </div>
    </div>
  )
}

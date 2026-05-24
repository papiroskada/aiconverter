import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

function ProgramLink({ name, id, status, onClick }) {
  const clickable = !!id && status !== 'pending'
  return (
    <div
      className={`flex items-center justify-between bg-muted/30 rounded-md px-3 py-2 ${clickable ? 'cursor-pointer hover:bg-muted/60 transition-colors' : ''}`}
      onClick={() => clickable && onClick?.(id)}
    >
      <span className={`font-mono text-sm ${clickable ? 'text-blue-400' : 'text-muted-foreground'}`}>{name}</span>
      {!id && <Badge variant="outline" className="text-xs">not uploaded</Badge>}
      {id && status === 'pending' && <Badge variant="outline" className="text-xs">not analyzed</Badge>}
    </div>
  )
}

export default function ConnectionsTab({ edges, programId, analysis, onNavigate }) {
  const incoming = edges.filter(e => e.to_program_id === programId)
  const outgoing  = edges.filter(e => e.from_program_id === programId)
  const deps = analysis?.external_dependencies ?? []

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Called by ({incoming.length})
        </p>
        {incoming.length === 0
          ? <p className="text-sm text-muted-foreground">None</p>
          : incoming.map((e, i) => (
              <ProgramLink key={i} name={e.from_program_name} id={e.from_program_id} status={e.from_program_status} onClick={onNavigate} />
            ))
        }
      </section>

      <Separator />

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Calls ({outgoing.length})
        </p>
        {outgoing.length === 0
          ? <p className="text-sm text-muted-foreground">None</p>
          : outgoing.map((e, i) => (
              <ProgramLink key={i} name={e.to_program_name} id={e.to_program_id} status={e.to_program_status} onClick={onNavigate} />
            ))
        }
      </section>

      {deps.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              External Dependencies ({deps.length})
            </p>
            <div className="space-y-2">
              {deps.map((d, i) => (
                <div key={i} className="bg-muted/30 rounded-md px-3 py-2.5 space-y-1">
                  <span className="font-mono font-semibold text-sm text-blue-400">{d.program}</span>
                  {d.purpose   && <p className="text-sm text-muted-foreground">{d.purpose}</p>}
                  {d.dataIn    && <p className="text-xs text-muted-foreground">→ in: {d.dataIn}</p>}
                  {d.dataOut   && <p className="text-xs text-muted-foreground">← out: {d.dataOut}</p>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

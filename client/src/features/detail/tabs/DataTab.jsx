import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

function opVariant(op = '') {
  const hasRead  = /READ|SELECT|SGE|RDN/.test(op)
  const hasWrite = /WRITE|INSERT|UPDATE|DELETE|INL|UPD|DEL/.test(op)
  if (hasRead && hasWrite) return 'outline'   // amber tint via className
  if (hasRead) return 'default'
  return 'destructive'
}

function opClass(op = '') {
  const hasRead  = /READ|SELECT|SGE|RDN/.test(op)
  const hasWrite = /WRITE|INSERT|UPDATE|DELETE|INL|UPD|DEL/.test(op)
  if (hasRead && hasWrite) return 'text-amber-400 border-amber-400/40'
  return ''
}

function NotFoundNote({ nfa }) {
  if (!nfa || nfa === 'n/a') return null
  if (nfa.type === 'skip') return null
  if (typeof nfa === 'string') return <span className="text-xs text-amber-400">→ {nfa}</span>
  if (nfa.type === 'error') return <span className="text-xs text-red-400">→ error {nfa.code}</span>
  if (nfa.type === 'defaults') {
    const fields = nfa.fields ? Object.entries(nfa.fields).map(([k,v]) => `${k}=${v}`).join(', ') : ''
    return <span className="text-xs text-amber-400">→ defaults{fields ? ` (${fields})` : ''}{nfa.logError ? ' ⚡log' : ''}</span>
  }
  if (nfa.type === 'continue') return <span className="text-xs text-muted-foreground">→ continue</span>
  return null
}

function TableCard({ t }) {
  return (
    <div className="bg-muted/30 rounded-md px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono font-semibold text-sm">{t.table}</span>
        <Badge variant={opVariant(t.operation)} className={`text-xs font-mono ${opClass(t.operation)}`}>
          {t.operation}
        </Badge>
      </div>
      {t.fields?.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Fields</p>
          <p className="text-xs text-muted-foreground font-mono">{t.fields.join(', ')}</p>
        </div>
      )}
      {t.keyFields?.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Key (WHERE)</p>
          <p className="text-xs text-blue-400 font-mono">{t.keyFields.join(', ')}</p>
        </div>
      )}
      <NotFoundNote nfa={t.notFoundAction} />
    </div>
  )
}

export default function DataTab({ analysis }) {
  const dbTables  = analysis?.db_tables ?? []
  const fileOps   = analysis?.file_ops  ?? []
  const entryPts  = (analysis?.entry_points ?? []).filter(ep => ep.dbOperations?.length > 0)

  if (!dbTables.length && !fileOps.length) {
    return <p className="text-sm text-muted-foreground">No database tables or file operations found.</p>
  }

  return (
    <div className="space-y-5">
      {dbTables.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Database Tables ({dbTables.length})
          </p>
          <div className="space-y-2">
            {dbTables.map((t, i) => <TableCard key={i} t={t} />)}
          </div>
        </section>
      )}

      {entryPts.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Per-Mode Operations</p>
            <div className="space-y-2">
              {entryPts.map((ep, i) => (
                <div key={i} className="bg-muted/30 rounded-md px-3 py-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{ep.condition}</Badge>
                    {ep.businessName && <span className="text-sm text-muted-foreground">{ep.businessName}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ep.dbOperations.map((op, j) => (
                      <span key={j} className={`text-xs font-mono px-1.5 py-0.5 rounded border border-border bg-background ${
                        /READ|SELECT/.test(op.operation) ? 'text-green-500' :
                        /INSERT|UPDATE|DELETE/.test(op.operation) ? 'text-red-400' : 'text-amber-400'
                      }`}>
                        {op.table} {op.operation}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {fileOps.length > 0 && (
        <>
          <Separator />
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">File I/O</p>
            <div className="space-y-1.5">
              {fileOps.map((f, i) => (
                <div key={i} className="bg-muted/30 rounded-md px-3 py-2 flex items-center justify-between">
                  <span className="font-mono text-sm">{f.file}</span>
                  <span className="text-xs text-muted-foreground">{(f.operations ?? []).join(', ')}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

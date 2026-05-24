import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

const DIRECTION_VARIANT = { in: 'default', out: 'destructive', inout: 'outline' }

function ParamRow({ p }) {
  return (
    <div className="bg-muted/30 rounded-md px-3 py-2.5 space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-sm">{p.name}</span>
          {p.direction && (
            <Badge variant={DIRECTION_VARIANT[p.direction] ?? 'outline'} className="text-xs px-1.5 py-0">
              {p.direction}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground font-mono">{p.type}</span>
      </div>
      {p.cobolName && <p className="text-xs text-muted-foreground font-mono">{p.cobolName}</p>}
      {p.description && <p className="text-xs text-muted-foreground mt-1">{p.description}</p>}
    </div>
  )
}

function tryParse(str) {
  try { return JSON.parse(str) ?? [] } catch { return [] }
}

export default function OverviewTab({ analysis }) {
  if (!analysis) return <p className="text-sm text-muted-foreground">No analysis yet.</p>

  const inputParams  = tryParse(analysis.input_contract)
  const outputParams = tryParse(analysis.output_contract)

  return (
    <div className="space-y-5">
      {analysis.business_purpose && (
        <section className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Business Purpose</p>
          <p className="text-sm leading-relaxed">{analysis.business_purpose}</p>
        </section>
      )}

      {(inputParams.length > 0 || outputParams.length > 0) && <Separator />}

      {inputParams.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Input Parameters</p>
          <div className="space-y-1.5">
            {inputParams.map((p, i) => <ParamRow key={i} p={p} />)}
          </div>
        </section>
      )}

      {outputParams.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Output Parameters</p>
          <div className="space-y-1.5">
            {outputParams.map((p, i) => <ParamRow key={i} p={p} />)}
          </div>
        </section>
      )}

      {!analysis.business_purpose && inputParams.length === 0 && outputParams.length === 0 && (
        <p className="text-sm text-muted-foreground">Analysis data not available yet.</p>
      )}
    </div>
  )
}

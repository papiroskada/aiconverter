import { useState } from 'react'
import { patchFlags, patchEntryPoints } from '@/api/programs.js'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// ── Helpers ─────────────────────────────────────────────────────────────────

function stepIcon(text = '') {
  if (/SELECT|INSERT|UPDATE|DELETE|READ|SGE|RDN|UPD|DEL|INL/i.test(text)) return { icon: '⬡', cls: 'text-blue-400' }
  if (/if not found|not found|returns? error|error \d{4}|return.*\d{4}/i.test(text)) return { icon: '⤷', cls: 'text-amber-400' }
  if (/validates?|checks?|ensures?|verifies?|is (not )?spaces?|is (not )?zero/i.test(text)) return { icon: '✓', cls: 'text-green-500' }
  return { icon: '·', cls: 'text-muted-foreground' }
}

function opColor(op = '') {
  const hasRead  = /SELECT|READ|SGE|RDN/.test(op)
  const hasWrite = /INSERT|UPDATE|DELETE|UPD|DEL|INL|WRITE|WRT/.test(op)
  if (hasRead && hasWrite) return 'text-amber-400'
  if (hasRead) return 'text-green-500'
  return 'text-red-400'
}

function EnrichedStep({ text, catalog }) {
  if (!catalog?.size) return <span>{text}</span>
  const parts = text.split(/(\berror\s+\d+|\breturns?\s+\d{4}|\b\d{4}\b)/gi)
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/\d{4,}/)
        if (match) {
          const entry = catalog.get(match[0])
          if (entry) return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <span className="bg-red-950 text-red-400 rounded px-1 font-mono text-xs cursor-help border-b border-dashed border-red-400">{part}</span>
              </TooltipTrigger>
              <TooltipContent>{entry.businessMeaning ?? entry.description ?? part}</TooltipContent>
            </Tooltip>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}

// ── Flag config ──────────────────────────────────────────────────────────────

const FLAG_CONFIG = {
  approved:   { icon: '✓', label: 'Approved',   cls: 'text-green-400 border-green-400/30 bg-green-950/40' },
  warning:    { icon: '⚠', label: 'Warning',    cls: 'text-amber-400 border-amber-400/30 bg-amber-950/40' },
  deprecated: { icon: '✕', label: 'Deprecated', cls: 'text-red-400 border-red-400/30 bg-red-950/40' },
}

// Compact pill showing one user's flag
function UserFlagPill({ name, flag, isCurrentUser }) {
  const cfg = FLAG_CONFIG[flag]
  if (!cfg) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border font-medium
          ${cfg.cls} ${isCurrentUser ? 'ring-1 ring-offset-1 ring-offset-background ring-current' : ''}`}>
          <span>{cfg.icon}</span>
          <span className="max-w-[80px] truncate">{isCurrentUser ? 'You' : name}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{isCurrentUser ? `You: ${cfg.label}` : `${name}: ${cfg.label}`}</TooltipContent>
    </Tooltip>
  )
}

// Summary pills for the card header (compact counts)
function FlagSummary({ flags }) {
  if (!flags?.length) return null
  const counts = flags.reduce((acc, { flag }) => {
    acc[flag] = (acc[flag] ?? 0) + 1
    return acc
  }, {})
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {Object.entries(counts).map(([flag, count]) => {
        const cfg = FLAG_CONFIG[flag]
        return cfg ? (
          <span key={flag} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border ${cfg.cls}`}>
            {cfg.icon} {count}
          </span>
        ) : null
      })}
    </div>
  )
}

// Dropdown for current user's own flag
function MyFlagSelect({ value, onChange, disabled }) {
  return (
    <Select value={value ?? 'none'} onValueChange={v => onChange(v === 'none' ? null : v)} disabled={disabled}>
      <SelectTrigger className="h-7 w-36 text-xs shrink-0">
        <SelectValue placeholder="Your review" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none"><span className="text-muted-foreground">No review</span></SelectItem>
        <SelectItem value="approved"><span className="text-green-400">✓ Approved</span></SelectItem>
        <SelectItem value="warning"><span className="text-amber-400">⚠ Warning</span></SelectItem>
        <SelectItem value="deprecated"><span className="text-red-400">✕ Deprecated</span></SelectItem>
      </SelectContent>
    </Select>
  )
}

// ── Entry point card ─────────────────────────────────────────────────────────

function EntryPointCard({ ep, conditionFlags, catalog, canEdit, currentUserId, onFlagChange, onNameChange }) {
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(ep.businessName ?? '')
  const [savingFlag, setSavingFlag] = useState(false)

  const myFlag = conditionFlags?.find(f => f.userId === currentUserId)?.flag ?? null
  const otherFlags = conditionFlags?.filter(f => f.userId !== currentUserId) ?? []

  async function handleFlagChange(newFlag) {
    setSavingFlag(true)
    try { await onFlagChange(ep.condition, newFlag) }
    finally { setSavingFlag(false) }
  }

  async function handleNameBlur() {
    setEditingName(false)
    if (nameValue !== ep.businessName) onNameChange(ep.condition, nameValue)
  }

  return (
    <div className="bg-muted/30 rounded-lg p-3.5 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs">{ep.condition}</Badge>
            <FlagSummary flags={conditionFlags} />
          </div>
          {canEdit && editingName ? (
            <Input
              value={nameValue}
              onChange={e => setNameValue(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNameBlur()
                if (e.key === 'Escape') { setEditingName(false); setNameValue(ep.businessName ?? '') }
              }}
              className="h-6 text-sm font-medium w-full"
              autoFocus
            />
          ) : (
            <p
              className={`text-sm font-medium ${canEdit ? 'cursor-text hover:text-primary transition-colors' : ''}`}
              onClick={() => canEdit && setEditingName(true)}
            >
              {ep.businessName ?? <span className="text-muted-foreground italic">Unnamed</span>}
            </p>
          )}
        </div>

        {/* Current user's review */}
        <MyFlagSelect value={myFlag} onChange={handleFlagChange} disabled={savingFlag} />
      </div>

      {/* Team review row — other users' flags */}
      {otherFlags.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Team:</span>
          {otherFlags.map(({ userId, name, flag }) => (
            <UserFlagPill key={userId} name={name} flag={flag} isCurrentUser={false} />
          ))}
        </div>
      )}

      {/* DB operations */}
      {ep.dbOperations?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">DB Operations</p>
          <div className="flex flex-wrap gap-1.5">
            {ep.dbOperations.map((op, i) => (
              <span key={i} className={`text-xs font-mono px-1.5 py-0.5 bg-background rounded border border-border ${opColor(op.operation)}`}>
                {op.table} {op.operation}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Steps */}
      {ep.steps?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Steps</p>
          <ol className="space-y-0.5">
            {ep.steps.map((step, i) => {
              const text = typeof step === 'string' ? step : step.description ?? ''
              const { icon, cls } = stepIcon(text)
              return (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className={`font-mono text-xs shrink-0 ${cls}`}>{icon}</span>
                  <span className="text-muted-foreground leading-snug">
                    <EnrichedStep text={text} catalog={catalog} />
                  </span>
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {/* Errors */}
      {ep.errors?.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-widest">Errors</p>
          <div className="space-y-0.5">
            {ep.errors.map((err, i) => (
              <p key={i} className="text-xs text-red-400 font-mono">{typeof err === 'string' ? err : err.code}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function LogicTab({ analysis, programId, canEdit, userFlags = {}, currentUserId, onUserFlagsUpdate, onAnalysisUpdate }) {
  if (!analysis) return <p className="text-sm text-muted-foreground">No analysis yet.</p>

  const entryPoints = analysis.entry_points ?? []
  const errorCatalog = analysis.error_catalog ?? []
  const catalog = new Map(errorCatalog.map(e => [String(e.code), e]))

  async function handleFlagChange(condition, flag) {
    const updated = await patchFlags(programId, condition, flag)
    onUserFlagsUpdate(updated)
  }

  async function handleNameChange(condition, businessName) {
    const updated = analysis.entry_points.map(ep =>
      ep.condition === condition ? { ...ep, businessName } : ep
    )
    await patchEntryPoints(programId, updated)
    onAnalysisUpdate({ ...analysis, entry_points: updated })
  }

  if (entryPoints.length === 0) {
    return <p className="text-sm text-muted-foreground">No entry points found.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
        Entry Points ({entryPoints.length})
      </p>

      {entryPoints.map((ep, i) => (
        <EntryPointCard
          key={ep.condition ?? i}
          ep={ep}
          conditionFlags={userFlags?.[ep.condition] ?? []}
          catalog={catalog}
          canEdit={canEdit}
          currentUserId={currentUserId}
          onFlagChange={handleFlagChange}
          onNameChange={handleNameChange}
        />
      ))}

      {errorCatalog.length > 0 && (
        <>
          <Separator />
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">
            Error Catalog ({errorCatalog.length})
          </p>
          <div className="space-y-1.5">
            {errorCatalog.map((e, i) => (
              <div key={i} className="flex items-baseline gap-3 text-sm">
                <span className="font-mono text-red-400 text-xs w-12 shrink-0">{e.code}</span>
                <span className="text-muted-foreground">{e.businessMeaning ?? e.description}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

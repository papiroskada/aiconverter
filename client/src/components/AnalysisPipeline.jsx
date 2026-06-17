import { useState, useEffect, useRef } from 'react'
import { Check, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const MIN_STAGE_MS = 15000

// Ensures each stage is visible for at least MIN_STAGE_MS before transitioning.
// Queues rapid transitions and plays them sequentially.
function useMinStageDuration(activeStage) {
  const [displayed, setDisplayed] = useState(activeStage)
  const prevRef    = useRef(activeStage)
  const queueRef   = useRef([])
  const timerRef   = useRef(null)
  const startRef   = useRef(null)

  useEffect(() => {
    if (activeStage === prevRef.current) return
    prevRef.current = activeStage

    const q = queueRef.current
    if (q.length === 0 || q[q.length - 1] !== activeStage) q.push(activeStage)
    if (timerRef.current !== null) return

    const elapsed = startRef.current != null ? Date.now() - startRef.current : MIN_STAGE_MS
    const wait    = Math.max(0, MIN_STAGE_MS - elapsed)

    function flush() {
      timerRef.current = null
      if (q.length === 0) return
      const next = q.shift()
      setDisplayed(next)
      startRef.current = Date.now()
      if (q.length > 0) timerRef.current = setTimeout(flush, MIN_STAGE_MS)
    }

    timerRef.current = setTimeout(flush, wait)
  }, [activeStage])

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return displayed
}

const STAGES = [
  { id: 'parsing',    label: 'Parsing',              hint: 'Extracting COBOL structure' },
  { id: 'structural', label: 'Structural Analysis',  hint: 'Linking calls & dependencies' },
  { id: 'ai',        label: 'AI Analysis',           hint: 'Understanding business logic' },
]

function stageIndex(id) {
  return STAGES.findIndex(s => s.id === id)
}

export function AnalysisPipeline({ activeStage, aiStep, message, failed }) {
  const displayed = useMinStageDuration(activeStage)
  const activeIdx = displayed ? stageIndex(displayed) : 0

  return (
    <div className="space-y-3 py-1">
      {STAGES.map((stage, i) => {
        const isDone   = i < activeIdx
        const isActive = i === activeIdx && !failed
        const isFailed = i === activeIdx && failed
        const isPending = !isDone && !isActive && !isFailed

        return (
          <div key={stage.id} className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0 w-5 h-5 flex items-center justify-center">
              {isDone && (
                <div className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-500" strokeWidth={2.5} />
                </div>
              )}
              {isActive && (
                <div className="w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center">
                  <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                </div>
              )}
              {isFailed && (
                <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center">
                  <AlertCircle className="w-3 h-3 text-red-500" />
                </div>
              )}
              {isPending && (
                <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 pt-0.5">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-sm',
                  isDone   && 'text-muted-foreground',
                  isActive && 'font-medium text-foreground',
                  isFailed && 'font-medium text-destructive',
                  isPending && 'text-muted-foreground/40',
                )}>
                  {stage.label}
                </span>
                {isActive && stage.id === 'ai' && aiStep != null && (
                  <span className="text-xs text-muted-foreground">
                    {aiStep.step}/{aiStep.total}
                  </span>
                )}
              </div>
              {isActive && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {message ?? stage.hint}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function MiniPipeline({ activeStage, failed }) {
  const displayed = useMinStageDuration(activeStage)
  const activeIdx = displayed ? stageIndex(displayed) : 0

  return (
    <div className="flex items-center gap-1 mt-1.5">
      {STAGES.map((stage, i) => {
        const isDone   = i < activeIdx
        const isActive = i === activeIdx && !failed
        const isFailed = i === activeIdx && failed

        return (
          <div key={stage.id} className="flex items-center gap-1">
            <div
              title={stage.label}
              className={cn(
                'w-1.5 h-1.5 rounded-full transition-colors',
                isDone   && 'bg-green-500',
                isActive && 'bg-blue-400 animate-pulse',
                isFailed && 'bg-red-500',
                !isDone && !isActive && !isFailed && 'bg-border',
              )}
            />
            {i < STAGES.length - 1 && (
              <div className={cn('w-4 h-px', isDone ? 'bg-green-500/40' : 'bg-border')} />
            )}
          </div>
        )
      })}
      <span className="text-xs text-muted-foreground ml-1.5">
        {failed
          ? STAGES[Math.min(activeIdx, STAGES.length - 1)]?.label
          : STAGES[Math.min(activeIdx, STAGES.length - 1)]?.label}
      </span>
    </div>
  )
}

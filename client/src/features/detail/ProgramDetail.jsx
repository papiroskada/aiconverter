import { useState, useEffect, useRef } from 'react'
import { RotateCcw, Trash2, Download, MoreHorizontal, Loader2 } from 'lucide-react'
import { fetchProgram, deleteProgram, triggerReanalyze } from '@/api/programs.js'
import { useSSE } from '@/hooks/useSSE.js'
import { useAuth } from '@/auth/AuthContext.jsx'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnalysisPipeline } from '@/components/AnalysisPipeline.jsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import OverviewTab from './tabs/OverviewTab.jsx'
import LogicTab from './tabs/LogicTab.jsx'
import DataTab from './tabs/DataTab.jsx'
import ConnectionsTab from './tabs/ConnectionsTab.jsx'
import CodeTab from './tabs/CodeTab.jsx'

const STATUS_CONFIG = {
  analyzed:  { label: 'Analyzed',  dot: 'bg-green-500',              badge: 'default' },
  analyzing: { label: 'Analyzing', dot: 'bg-blue-400 animate-pulse', badge: 'secondary' },
  failed:    { label: 'Failed',    dot: 'bg-red-500',                badge: 'destructive' },
  pending:   { label: 'Pending',   dot: 'bg-slate-500',              badge: 'outline' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <Badge variant={cfg.badge} className="gap-1.5 text-xs font-normal">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </Badge>
  )
}

export default function ProgramDetail({ programId, applicationId, stepProgress = new Map(), onClose, onDeleted, onReanalyzed }) {
  const { role, user } = useAuth()
  const canEdit = role !== 'viewer'
  const [program, setProgram] = useState(null)
  const [loading, setLoading] = useState(true)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [sseActive, setSseActive] = useState(false)
  const [localStage, setLocalStage] = useState(null)
  const [localAiStep, setLocalAiStep] = useState(null)
  const [localMessage, setLocalMessage] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const doneRef = useRef(false)
  const stageRef = useRef(null)
  const onReanalyzedRef = useRef(onReanalyzed)
  useEffect(() => { onReanalyzedRef.current = onReanalyzed }, [onReanalyzed])

  const [userFlags, setUserFlags] = useState({})

  useEffect(() => {
    setLoading(true)
    setProgram(null)
    doneRef.current = false
    stageRef.current = null
    setLocalStage(null)
    setLocalAiStep(null)
    setLocalMessage(null)
    fetchProgram(programId).then(p => {
      setProgram(p)
      setUserFlags(p?.userFlags ?? {})
      if (p?.status === 'analyzing') {
        setSseActive(true)
      }
    }).finally(() => setLoading(false))
  }, [programId])

  const STAGE_PRIORITY = { parsing: 0, structural: 1, ai: 2 }

  useSSE(sseActive ? programId : null, (event, data) => {
    if (event === 'progress') {
      if (data.stage === 'analysis') {
        if ((STAGE_PRIORITY[stageRef.current] ?? -1) < STAGE_PRIORITY.structural) {
          stageRef.current = 'structural'
          setLocalStage('structural')
          setLocalMessage(null)
        }
      } else if (data.stage === 'step') {
        stageRef.current = 'ai'
        setLocalStage('ai')
        setLocalAiStep({ step: data.step, total: data.total })
      }
      if (data.message) setLocalMessage(data.message)
    }
    if (event === 'done' || event === 'failed' || event === 'cancelled') {
      if (doneRef.current) return
      doneRef.current = true
      stageRef.current = null
      setSseActive(false)
      setLocalStage(null)
      setLocalAiStep(null)
      setLocalMessage(null)
      setReanalyzing(false)
      fetchProgram(programId).then(p => { setProgram(p); setUserFlags(p?.userFlags ?? {}) })
      onReanalyzedRef.current?.()
    }
  })

  async function handleReanalyze() {
    doneRef.current = false
    stageRef.current = 'parsing'
    setReanalyzing(true)
    setSseActive(true)
    setLocalStage('parsing')
    setLocalAiStep(null)
    setLocalMessage(null)
    await triggerReanalyze(programId)
  }

  async function handleDelete() {
    setDeleting(true)
    try { await deleteProgram(programId); onDeleted?.(programId) }
    finally { setDeleting(false) }
  }

  const isAnalyzing = program?.status === 'analyzing' || reanalyzing
  const sp = stepProgress.get(programId)
  const effectiveStage = localStage ?? sp?.stage ?? (isAnalyzing ? 'parsing' : null)
  const effectiveAiStep = localAiStep ?? (sp?.step != null ? { step: sp.step, total: sp.total } : null)
  const effectiveMessage = localMessage ?? sp?.message ?? null

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (!program) return null

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-border shrink-0 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono font-bold text-lg leading-tight truncate">{program.name}</h2>
            <div className="flex items-center gap-2 mt-1.5">
              <StatusBadge status={program.status} />
              {program.file_type && <span className="text-xs text-muted-foreground uppercase">{program.file_type}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canEdit && (
              <Button variant="outline" size="sm" onClick={handleReanalyze} disabled={isAnalyzing}>
                {reanalyzing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />}
                Re-analyze
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => window.open(`/api/programs/${programId}/export?format=markdown`, '_blank')}>
                  <Download className="mr-2 h-4 w-4" />Export Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open(`/api/programs/${programId}/export?format=openapi`, '_blank')}>
                  <Download className="mr-2 h-4 w-4" />Export OpenAPI
                </DropdownMenuItem>
                {canEdit && <><DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" />Delete program
                  </DropdownMenuItem></>}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {isAnalyzing && (
          <AnalysisPipeline
            activeStage={effectiveStage}
            aiStep={effectiveAiStep}
            message={effectiveMessage}
            failed={false}
          />
        )}
      </div>

      <Tabs defaultValue="overview" className="flex flex-1 flex-col min-h-0">
        <div className="overflow-x-auto scrollbar-none shrink-0 border-b border-border">
          <TabsList className="my-1 justify-start h-9 bg-transparent rounded-none p-0 gap-0 w-auto">
            {['overview','logic','data','connections','code'].map(tab => (
              <TabsTrigger key={tab} value={tab} className="capitalize rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none h-9 px-4 text-sm">
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-subtle">
          <TabsContent value="overview" className="p-5 mt-0"><OverviewTab analysis={program.analysis} /></TabsContent>
          <TabsContent value="logic" className="p-5 mt-0">
            <LogicTab
              analysis={program.analysis}
              programId={programId}
              canEdit={canEdit}
              userFlags={userFlags}
              currentUserId={user?.id}
              onUserFlagsUpdate={setUserFlags}
              onAnalysisUpdate={updated => setProgram(prev => ({ ...prev, analysis: updated }))}
            />
          </TabsContent>
          <TabsContent value="data" className="p-5 mt-0"><DataTab analysis={program.analysis} /></TabsContent>
          <TabsContent value="connections" className="p-5 mt-0">
            <ConnectionsTab edges={program.edges ?? []} programId={programId} analysis={program.analysis} />
          </TabsContent>
          <TabsContent value="code" className="p-5 mt-0">
            <CodeTab programId={programId} programName={program.name} applicationId={applicationId} canEdit={canEdit} />
          </TabsContent>
        </div>
      </Tabs>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete program?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete "{program.name}" and all its analysis data.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

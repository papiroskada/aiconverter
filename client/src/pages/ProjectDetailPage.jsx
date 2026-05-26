import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Play, Zap, Trash2, RotateCcw, Upload, MoreHorizontal,
  ChevronLeft, Loader2, X, Download
} from 'lucide-react'
import { fetchApplication, startApplicationAnalysis, cancelApplication, deleteApplication } from '@/api/applications.js'
import { deleteProgram, triggerReanalyze, generateProjectFiles } from '@/api/programs.js'
import { useAuth } from '@/auth/AuthContext.jsx'
import { useAppSSE } from '@/hooks/useAppSSE.js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import UploadDialog from '@/features/programs/UploadDialog.jsx'
import ProgramDetail from '@/features/detail/ProgramDetail.jsx'
import { MiniPipeline } from '@/components/AnalysisPipeline.jsx'

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

function flagCount(flags) {
  return Object.values(flags ?? {}).filter(Boolean).length
}

function DeleteDialog({ open, onOpenChange, title, description, onConfirm }) {
  const [loading, setLoading] = useState(false)
  async function handleConfirm() {
    setLoading(true)
    try { await onConfirm() } finally { setLoading(false) }
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export default function ProjectDetailPage() {
  const { appId } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const canEdit = role !== 'viewer'

  const [app, setApp] = useState(null)
  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [batchProgress, setBatchProgress] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteAppOpen, setDeleteAppOpen] = useState(false)
  const [deleteProgramTarget, setDeleteProgramTarget] = useState(null)
  const [selectedProgramId, setSelectedProgramId] = useState(null)
  const [stepProgress, setStepProgress] = useState(new Map())
  const [programErrors, setProgramErrors] = useState(new Map())
  const [zipping, setZipping] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchApplication(appId)
      setApp(data)
      setPrograms(data.programs ?? [])
      setProgramErrors(new Map())
    } catch {
      navigate('/projects', { replace: true })
    } finally {
      setLoading(false)
    }
  }, [appId, navigate])

  useEffect(() => { load() }, [load])

  useAppSSE(analyzing ? appId : null, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'parsing') {
        setStepProgress(prev => {
          const m = new Map(prev)
          m.set(data.programId, { ...(m.get(data.programId) ?? {}), stage: 'structural', message: data.message ?? null })
          return m
        })
      }
      if (data.stage === 'analysis') {
        setStepProgress(prev => {
          const m = new Map(prev)
          m.set(data.programId, { ...(m.get(data.programId) ?? {}), message: data.message ?? null })
          return m
        })
      }
      if (data.stage === 'step') {
        setStepProgress(prev => {
          const m = new Map(prev)
          m.set(data.programId, { ...(m.get(data.programId) ?? {}), stage: 'ai', step: data.step, total: data.total })
          return m
        })
      }
      if (data.stage === 'done') {
        setPrograms(prev => prev.map(p => p.id === data.programId ? { ...p, status: 'analyzed' } : p))
        setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
        setStepProgress(prev => { const m = new Map(prev); m.delete(data.programId); return m })
      }
      if (data.stage === 'failed') {
        setPrograms(prev => prev.map(p => p.id === data.programId ? { ...p, status: 'failed' } : p))
        setBatchProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
        setStepProgress(prev => { const m = new Map(prev); m.delete(data.programId); return m })
      }
    }
    if ((event === 'failed') && data.programId) {
      setProgramErrors(prev => new Map(prev).set(data.programId, data.error || 'Analysis failed'))
    }
    if (event === 'done' || event === 'failed' || event === 'cancelled') {
      setAnalyzing(false)
      setBatchProgress(null)
      setStepProgress(new Map())
      load()
    }
  })

  // Poll for status updates when programs uploaded individually (no app-level SSE in that flow)
  useEffect(() => {
    if (analyzing) return
    if (!programs.some(p => p.status === 'analyzing')) return
    const timer = setTimeout(load, 4000)
    return () => clearTimeout(timer)
  }, [programs, analyzing, load])

  async function handleAnalyzeAll(mode) {
    const pending = programs.filter(p => p.status !== 'analyzed').length
    setAnalyzing(true)
    setBatchProgress({ done: 0, total: pending })
    await startApplicationAnalysis(appId, mode)
  }

  async function handleCancel() {
    await cancelApplication(appId)
    setAnalyzing(false)
    setBatchProgress(null)
  }

  async function handleDeleteApp() {
    await deleteApplication(appId)
    navigate('/projects', { replace: true })
  }

  async function handleDeleteProgram(program) {
    await deleteProgram(program.id)
    setPrograms(prev => prev.filter(p => p.id !== program.id))
    if (selectedProgramId === program.id) setSelectedProgramId(null)
    setDeleteProgramTarget(null)
  }

  async function handleReanalyze(program) {
    setPrograms(prev => prev.map(p => p.id === program.id ? { ...p, status: 'analyzing' } : p))
    await triggerReanalyze(program.id)
  }

  async function handleDownloadZip() {
    setZipping(true)
    try {
      const { files, warnings } = await generateProjectFiles(appId)
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (const f of files) zip.file(f.path, f.content)
      if (warnings?.length) zip.file('WARNINGS.txt', warnings.join('\n'))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${app?.name ?? 'project'}.zip`; a.click()
      URL.revokeObjectURL(url)
    } finally {
      setZipping(false)
    }
  }

  const filtered = programs.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const batchPct = batchProgress
    ? Math.round((batchProgress.done / Math.max(batchProgress.total, 1)) * 100)
    : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border space-y-3 shrink-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" asChild className="shrink-0 -ml-2">
              <Link to="/projects"><ChevronLeft size={16} className="mr-1" />Projects</Link>
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono font-semibold truncate">{app?.name}</span>
            <Badge variant="outline" className="text-xs shrink-0">{programs.length} programs</Badge>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />Upload
              </Button>

              {!analyzing ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm">
                      <Play className="mr-2 h-4 w-4" />Analyze All
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleAnalyzeAll('sequential')}>
                      Sequential
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleAnalyzeAll('parallel')}>
                      <Zap className="mr-2 h-3 w-3" />Parallel (faster)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button size="sm" variant="outline" onClick={handleCancel}>
                  <X className="mr-2 h-4 w-4" />Cancel
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9" disabled={zipping}>
                    {zipping
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <MoreHorizontal className="h-4 w-4" />
                    }
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleDownloadZip}>
                    <Download className="mr-2 h-4 w-4" />Download project .zip
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteAppOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Delete project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {analyzing && batchProgress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Analyzing… {batchProgress.done} / {batchProgress.total} programs</span>
              <span>{batchPct}%</span>
            </div>
            <Progress value={batchPct} className="h-1.5" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <Input
            placeholder="Search programs…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 w-48 text-sm"
          />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="analyzed">Analyzed</SelectItem>
              <SelectItem value="analyzing">Analyzing</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Entry points</TableHead>
              <TableHead>Flags</TableHead>
              {canEdit && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={canEdit ? 5 : 4} className="text-center text-muted-foreground py-16">
                  {programs.length === 0
                    ? 'No programs yet. Upload some COBOL files to get started.'
                    : 'No programs match the current filter.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map(program => {
              const sp = stepProgress.get(program.id)
              const fc = flagCount(program.flags)
              const errMsg = programErrors.get(program.id)
              return (
                <TableRow
                  key={program.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedProgramId(program.id)}
                >
                  <TableCell className="font-mono font-medium">{program.name}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <StatusBadge status={program.status} />
                      {program.status === 'analyzing' && (
                        <MiniPipeline
                          activeStage={sp?.stage ?? 'parsing'}
                          failed={false}
                        />
                      )}
                      {sp?.message && (
                        <p className="text-xs text-muted-foreground max-w-[220px] truncate">{sp.message}</p>
                      )}
                      {program.status === 'failed' && errMsg && (
                        <p className="text-xs text-destructive max-w-[220px] truncate" title={errMsg}>{errMsg}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {program.entry_point_count > 0 ? program.entry_point_count : '—'}
                  </TableCell>
                  <TableCell>
                    {fc > 0 && (
                      <Badge variant="outline" className="text-xs gap-1 text-amber-400 border-amber-400/30">
                        ⚠ {fc}
                      </Badge>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell onClick={e => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleReanalyze(program)}>
                            <RotateCcw className="mr-2 h-4 w-4" />Re-analyze
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteProgramTarget(program)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Program detail sheet */}
      <Sheet open={!!selectedProgramId} onOpenChange={open => { if (!open) setSelectedProgramId(null) }}>
        <SheetContent className="w-full sm:max-w-2xl p-0 overflow-hidden" side="right" showCloseButton={false}>
          {selectedProgramId && (
            <ProgramDetail
              programId={selectedProgramId}
              applicationId={appId}
              stepProgress={stepProgress}
              onClose={() => setSelectedProgramId(null)}
              onDeleted={id => {
                setPrograms(prev => prev.filter(p => p.id !== id))
                setSelectedProgramId(null)
              }}
              onReanalyzed={load}
            />
          )}
        </SheetContent>
      </Sheet>

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        applicationId={appId}
        onUploaded={load}
      />

      <DeleteDialog
        open={deleteAppOpen}
        onOpenChange={setDeleteAppOpen}
        title="Delete project?"
        description={`This will permanently delete "${app?.name}" and all its programs. This cannot be undone.`}
        onConfirm={handleDeleteApp}
      />

      <DeleteDialog
        open={!!deleteProgramTarget}
        onOpenChange={open => { if (!open) setDeleteProgramTarget(null) }}
        title="Delete program?"
        description={`This will permanently delete "${deleteProgramTarget?.name}".`}
        onConfirm={() => handleDeleteProgram(deleteProgramTarget)}
      />
    </div>
  )
}

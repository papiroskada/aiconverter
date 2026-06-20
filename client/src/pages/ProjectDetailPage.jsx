import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  Play, Zap, Trash2, RotateCcw, Upload, MoreHorizontal,
  ChevronLeft, Loader2, X, Download, Users, CheckCircle2, FlaskConical, Copy
} from 'lucide-react'
import { fetchApplication, startApplicationAnalysis, cancelApplication, deleteApplication, fetchApplicationMembers, addApplicationMember, removeApplicationMember } from '@/api/applications.js'
import { deleteProgram, triggerReanalyze, generateProjectFiles, generateTests } from '@/api/programs.js'
import { useAuth } from '@/auth/AuthContext.jsx'
import { useAppSSE } from '@/hooks/useAppSSE.js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import UploadDialog from '@/features/programs/UploadDialog.jsx'
import ProgramDetail from '@/features/detail/ProgramDetail.jsx'

import AppCodeTab from '@/features/code/AppCodeTab.jsx'

const FLAG_CONFIG = {
  approved:   { icon: '✓', cls: 'text-green-400 border-green-400/30 bg-green-950/40' },
  warning:    { icon: '⚠', cls: 'text-amber-400 border-amber-400/30 bg-amber-950/40' },
  deprecated: { icon: '✕', cls: 'text-red-400   border-red-400/30   bg-red-950/40'   },
}

function StatusChip({ status }) {
  if (status === 'analyzed') {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs font-normal px-2 py-0.5 border-green-500/40 bg-green-950/40 text-green-400">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500" />
        Analyzed
      </Badge>
    )
  }
  if (status === 'analyzing') {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs font-normal px-2 py-0.5 border-blue-500/40 bg-blue-950/40 text-blue-400">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-blue-400 animate-pulse" />
        Parsing
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge variant="outline" className="gap-1.5 text-xs font-normal px-2 py-0.5 border-red-500/40 bg-red-950/40 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-red-500" />
        Failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1.5 text-xs font-normal px-2 py-0.5 border-border text-muted-foreground/50">
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/30" />
      Pending
    </Badge>
  )
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
  const [view, setView] = useState('programs')
  const [shareOpen, setShareOpen] = useState(false)
  const [members, setMembers] = useState([])
  const [shareEmail, setShareEmail] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState('')

  const isOwner = app?.is_owner === true || app?.is_owner === 't'

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

  useEffect(() => {
    if (shareOpen) {
      fetchApplicationMembers(appId).then(setMembers).catch(() => {})
    }
  }, [shareOpen, appId])

  const STAGE_PRIORITY = { parsing: 0, structural: 1, ai: 2 }

  useAppSSE(analyzing ? appId : null, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'parsing') {
        setStepProgress(prev => {
          const m = new Map(prev)
          const existing = m.get(data.programId) ?? {}
          if ((STAGE_PRIORITY[existing.stage] ?? -1) >= STAGE_PRIORITY.parsing) return prev
          m.set(data.programId, { ...existing, stage: 'parsing', message: data.message ?? null })
          return m
        })
      }
      if (data.stage === 'analysis') {
        setStepProgress(prev => {
          const m = new Map(prev)
          const existing = m.get(data.programId) ?? {}
          if ((STAGE_PRIORITY[existing.stage] ?? -1) >= STAGE_PRIORITY.structural) return prev
          m.set(data.programId, { ...existing, stage: 'structural', message: data.message ?? null })
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
    if (event === 'failed' && data.programId) {
      setProgramErrors(prev => new Map(prev).set(data.programId, data.error || 'Analysis failed'))
    }
    // Only reset batch state on batch-level events (applicationId present).
    // Per-program done/failed/cancelled events also have programId — those are handled above.
    if ((event === 'done' || event === 'failed' || event === 'cancelled') && !data.programId) {
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

  const [generatingTests, setGeneratingTests] = useState(null)
  const [testDialog, setTestDialog] = useState(null)

  async function handleGenerateTests(program) {
    setGeneratingTests(program.id)
    try {
      const result = await generateTests(program.id)
      setTestDialog({ programName: result.programName, testFile: result.testFile })
    } finally {
      setGeneratingTests(null)
    }
  }

  async function handleDownloadZip() {
    setZipping(true)
    try {
      const { files, warnings } = await generateProjectFiles(appId, { includeTests: true })
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
              
                <Link to="/projects"><div className="flex flex-row items-center"><ChevronLeft size={16} className="mr-1" />Projects </div></Link>
               
            </Button>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono font-semibold truncate">{app?.name}</span>
            <Badge variant="outline" className="text-xs shrink-0">{programs.length} programs</Badge>
          </div>

          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              {isOwner && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  <Users className="mr-2 h-4 w-4" />Share
                </Button>
              )}
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
                  {isOwner && <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setDeleteAppOpen(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />Delete project
                    </DropdownMenuItem>
                  </>}
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
      </div>

      {/* View tabs */}
      <div className="border-b border-border shrink-0 overflow-x-auto">
        <div className="flex items-center gap-0 px-6 min-w-fit">
        {['programs', 'code'].map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`capitalize text-sm px-4 py-2.5 border-b-2 transition-colors ${
              view === v
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {v === 'programs' ? 'Programs' : 'Code'}
          </button>
        ))}
        </div>
      </div>

      {/* Search + filter (programs view only) */}
      {view === 'programs' && (
        <div className="px-6 py-2.5 border-b border-border shrink-0 flex items-center gap-3">
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
      )}

      {/* Code tab */}
      {view === 'code' && (
        <div className="flex-1 overflow-hidden">
          <AppCodeTab programs={programs} applicationId={appId} canEdit={canEdit} />
        </div>
      )}


      {/* Programs table */}
      {view === 'programs' && <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Code Generated</TableHead>
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
                      <StatusChip status={program.status} />
                     
                      {sp?.message && (
                        <p className="text-xs text-muted-foreground max-w-[220px] truncate">{sp.message}</p>
                      )}
                      {program.status === 'failed' && errMsg && (
                        <p className="text-xs text-destructive max-w-[220px] truncate" title={errMsg}>{errMsg}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={e => e.stopPropagation()}>
                    {program.code_generated
                      ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="gap-1.5 text-xs font-normal border-green-500/40 bg-green-950/40 text-green-400">
                            <CheckCircle2 className="w-3 h-3" />
                            Generated
                          </Badge>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground shrink-0"
                              title="Generate tests"
                              disabled={generatingTests === program.id}
                              onClick={() => handleGenerateTests(program)}
                            >
                              {generatingTests === program.id
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <FlaskConical className="h-3 w-3" />
                              }
                            </Button>
                          )}
                        </div>
                      )
                      : <span className="text-muted-foreground/40 text-sm">—</span>
                    }
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(program.flags ?? []).map((f, i) => {
                        const cfg = FLAG_CONFIG[f.flag]
                        if (!cfg) return null
                        return (
                          <Badge key={i} variant="outline" className={`text-xs gap-1 ${cfg.cls}`}>
                            {cfg.icon} {f.userName}
                          </Badge>
                        )
                      })}
                    </div>
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

      }

      {/* Program detail sheet */}
      <Sheet open={!!selectedProgramId} onOpenChange={open => { if (!open) setSelectedProgramId(null) }}>
        <SheetContent
          className="p-0 overflow-hidden data-[side=right]:w-[min(56rem,92vw)] data-[side=right]:sm:max-w-none"
          side="right"
          showCloseButton={false}
        >
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

      <Dialog open={!!testDialog} onOpenChange={open => { if (!open) setTestDialog(null) }}>
        <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-3xl max-h-[85vh]">
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
            <DialogTitle className="font-mono text-sm">
              {testDialog?.programName}.test.ts
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <pre className="text-xs font-mono leading-relaxed p-5 whitespace-pre-wrap break-words">
              {testDialog?.testFile}
            </pre>
          </div>
          <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(testDialog?.testFile ?? '')}
            >
              <Copy className="mr-2 h-3.5 w-3.5" />Copy
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob([testDialog.testFile], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${testDialog.programName}.test.ts`
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download className="mr-2 h-3.5 w-3.5" />Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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

      <Dialog open={shareOpen} onOpenChange={open => { setShareOpen(open); if (!open) { setShareEmail(''); setShareError('') } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share "{app?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <form
              onSubmit={async e => {
                e.preventDefault()
                setShareLoading(true); setShareError('')
                try {
                  const updated = await addApplicationMember(appId, shareEmail)
                  setMembers(updated)
                  setShareEmail('')
                } catch (err) { setShareError(err.message) }
                finally { setShareLoading(false) }
              }}
              className="flex gap-2"
            >
              <Input
                placeholder="colleague@company.com"
                type="email"
                value={shareEmail}
                onChange={e => setShareEmail(e.target.value)}
                className="flex-1 h-8 text-sm"
                required
              />
              <Button type="submit" size="sm" disabled={shareLoading || !shareEmail.trim()}>
                {shareLoading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Invite
              </Button>
            </form>
            {shareError && <p className="text-xs text-destructive">{shareError}</p>}
            {members.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Members with access</p>
                {members.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        try {
                          const updated = await removeApplicationMember(appId, m.id)
                          setMembers(updated)
                        } catch {}
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No members yet. Invite someone by email.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

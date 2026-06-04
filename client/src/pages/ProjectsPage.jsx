import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, Loader2, Users } from 'lucide-react'
import { fetchApplications, createApplication } from '@/api/applications.js'
import { useAuth } from '@/auth/AuthContext.jsx'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

function appStatus(app) {
  if (app.status === 'analyzing') return 'analyzing'
  if (!app.programCount || app.programCount === 0) return 'empty'
  return app.status ?? 'pending'
}

const STATUS_CONFIG = {
  analyzed:  { label: 'Analyzed',  variant: 'default',     dot: 'bg-green-500' },
  analyzing: { label: 'Analyzing', variant: 'secondary',   dot: 'bg-blue-400 animate-pulse' },
  failed:    { label: 'Failed',    variant: 'destructive',  dot: 'bg-red-500' },
  pending:   { label: 'Pending',   variant: 'outline',      dot: 'bg-slate-500' },
  empty:     { label: 'Empty',     variant: 'outline',      dot: 'bg-slate-600' },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  return (
    <Badge variant={cfg.variant} className="gap-1.5 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </Badge>
  )
}

function NewProjectDialog({ open, onOpenChange, onCreate }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function handleOpenChange(val) {
    if (!val) { setName(''); setError('') }
    onOpenChange(val)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim().toUpperCase()
    if (!trimmed) return
    setLoading(true)
    setError('')
    try {
      await onCreate(trimmed)
      handleOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="proj-name">Project name</Label>
            <Input
              id="proj-name"
              placeholder="ACCT-SYS"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">Will be converted to uppercase.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProjectCard({ app, onClick }) {
  const status = appStatus(app)
  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="font-mono text-base leading-tight">{app.name}</CardTitle>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FolderOpen size={14} />
          <span>
            {app.programCount === 0
              ? 'No programs'
              : `${app.programCount} program${app.programCount !== 1 ? 's' : ''}`}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Created {new Date(app.created_at).toLocaleDateString()}
        </p>
        {!app.isOwner && app.ownerName && (
          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
            <Users size={11} />
            <span>Shared by {app.ownerName}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function ProjectsPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const canEdit = role !== 'viewer'

  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await fetchApplications()
      setApps(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(name) {
    await createApplication(name)
    await load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Loading projects…</span>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Each project groups COBOL programs for batch analysis and code generation.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <FolderOpen size={40} className="text-muted-foreground/40" />
          <p className="text-muted-foreground">No projects yet.</p>
          {canEdit && (
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first project
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {apps.map(app => (
            <ProjectCard
              key={app.id}
              app={app}
              onClick={() => navigate(`/projects/${app.id}`)}
            />
          ))}
        </div>
      )}

      <NewProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={handleCreate}
      />
    </div>
  )
}

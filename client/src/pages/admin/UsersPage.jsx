import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, MoreHorizontal } from 'lucide-react'
import { fetchUsers, createUser, updateUser, fetchTokenStats } from '@/api/users.js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'

const ROLE_VARIANT = { admin: 'destructive', developer: 'default', viewer: 'secondary' }

function TokenStatsTab() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchTokenStats().then(setStats).catch(err => setError(err.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
  if (error) return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  if (!stats) return null

  const totalAll = stats.totalIn + stats.totalOut
  const fmtCost = n => `$${n.toFixed(4)}`

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total tokens in', value: stats.totalIn.toLocaleString() },
          { label: 'Total tokens out', value: stats.totalOut.toLocaleString() },
          { label: 'Total tokens used', value: totalAll.toLocaleString() },
          { label: 'Estimated cost', value: fmtCost(stats.totalCost ?? 0) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-mono font-semibold mt-1">{value}</p>
          </div>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Tokens in</TableHead>
            <TableHead className="text-right">Tokens out</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Est. cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.users.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No usage data yet.</TableCell></TableRow>
          )}
          {stats.users.map(u => (
            <TableRow key={u.id}>
              <TableCell>
                <div>
                  <p className="font-medium text-sm">{u.name}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{u.tokens_in.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-sm">{u.tokens_out.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-sm font-medium">{u.total.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-sm text-muted-foreground">{fmtCost(u.cost ?? 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function CreateUserDialog({ open, onOpenChange, onCreate }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'developer', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function reset() { setForm({ email: '', name: '', role: 'developer', password: '' }); setError('') }

  function handleOpenChange(val) { if (!val) reset(); onOpenChange(val) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try { await onCreate(form); handleOpenChange(false) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const set = k => v => setForm(f => ({ ...f, [k]: v }))
  const setEv = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Create User</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <div className="space-y-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" value={form.email} onChange={setEv('email')} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={form.name} onChange={setEv('name')} required />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={form.role} onValueChange={set('role')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="developer">Developer</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-pass">Temporary password</Label>
            <Input id="u-pass" type="password" value={form.password} onChange={setEv('password')} required minLength={8} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersPage() {
  const [view, setView] = useState('users')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    try { setUsers(await fetchUsers()) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCreate(data) {
    await createUser(data)
    await load()
  }

  async function handleRoleChange(user, role) {
    await updateUser(user.id, { role })
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, role } : u))
  }

  async function handleToggleActive(user) {
    const is_active = !user.is_active
    await updateUser(user.id, { is_active })
    setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active } : u))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  )

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage who has access to AI Converter.</p>
        </div>
        {view === 'users' && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Create User
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {['users', 'stats'].map(tab => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
              ${view === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {tab === 'users' ? 'Users' : 'Token Stats'}
          </button>
        ))}
      </div>

      {view === 'stats' ? <TokenStatsTab /> : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">No users yet.</TableCell></TableRow>
              )}
              {users.map(user => (
                <TableRow key={user.id} className={!user.is_active ? 'opacity-50' : ''}>
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_VARIANT[user.role] ?? 'outline'} className="capitalize">{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? 'outline' : 'secondary'} className="text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${user.is_active ? 'bg-green-500' : 'bg-slate-500'}`} />
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleRoleChange(user, 'developer')} disabled={user.role === 'developer'}>
                          Set Developer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(user, 'viewer')} disabled={user.role === 'viewer'}>
                          Set Viewer
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRoleChange(user, 'admin')} disabled={user.role === 'admin'}>
                          Set Admin
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleToggleActive(user)}>
                          {user.is_active ? 'Deactivate' : 'Reactivate'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
        </>
      )}
    </div>
  )
}

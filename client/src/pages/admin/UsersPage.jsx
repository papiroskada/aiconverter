import { useState, useEffect, useCallback } from 'react'
import { Plus, Loader2, MoreHorizontal } from 'lucide-react'
import { fetchUsers, createUser, updateUser } from '@/api/users.js'
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
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />Create User
        </Button>
      </div>

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
    </div>
  )
}

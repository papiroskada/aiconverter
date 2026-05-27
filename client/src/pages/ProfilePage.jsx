import { useState } from 'react'
import { useAuth } from '@/auth/AuthContext.jsx'
import { updateMe, changePassword } from '@/api/auth.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

const ROLE_VARIANT = { admin: 'destructive', developer: 'default', viewer: 'secondary' }

export default function ProfilePage() {
  const { user, updateUser } = useAuth()

  const [name, setName] = useState(user?.name ?? '')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameError, setNameError] = useState('')
  const [nameDone, setNameDone] = useState(false)

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' })
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState('')
  const [pwDone, setPwDone] = useState(false)

  async function handleSaveName(e) {
    e.preventDefault()
    setNameLoading(true); setNameError(''); setNameDone(false)
    try {
      const updated = await updateMe({ name })
      updateUser({ name: updated.name })
      setNameDone(true)
    } catch (err) { setNameError(err.message) }
    finally { setNameLoading(false) }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    if (passwords.next !== passwords.confirm) { setPwError('New passwords do not match'); return }
    setPwLoading(true); setPwError(''); setPwDone(false)
    try {
      await changePassword(passwords.current, passwords.next)
      setPasswords({ current: '', next: '', confirm: '' })
      setPwDone(true)
    } catch (err) { setPwError(err.message) }
    finally { setPwLoading(false) }
  }

  return (
    <div className="p-6 max-w-lg mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account information.</p>
      </div>

      {/* Profile info */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium">Account info</h2>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={user?.email ?? ''} disabled className="text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <Label>Role</Label>
          <div><Badge variant={ROLE_VARIANT[user?.role] ?? 'outline'} className="capitalize">{user?.role}</Badge></div>
        </div>
        <form onSubmit={handleSaveName} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="p-name">Display name</Label>
            <Input id="p-name" value={name} onChange={e => { setName(e.target.value); setNameDone(false) }} required />
          </div>
          {nameError && <Alert variant="destructive"><AlertDescription>{nameError}</AlertDescription></Alert>}
          {nameDone && <p className="text-sm text-green-500">Name updated.</p>}
          <Button type="submit" size="sm" disabled={nameLoading || name === user?.name}>
            {nameLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save name
          </Button>
        </form>
      </div>

      <Separator />

      {/* Change password */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium">Change password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="p-cur">Current password</Label>
            <Input id="p-cur" type="password" value={passwords.current} onChange={e => setPasswords(p => ({ ...p, current: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-new">New password</Label>
            <Input id="p-new" type="password" value={passwords.next} onChange={e => setPasswords(p => ({ ...p, next: e.target.value }))} required minLength={8} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-conf">Confirm new password</Label>
            <Input id="p-conf" type="password" value={passwords.confirm} onChange={e => setPasswords(p => ({ ...p, confirm: e.target.value }))} required />
          </div>
          {pwError && <Alert variant="destructive"><AlertDescription>{pwError}</AlertDescription></Alert>}
          {pwDone && <p className="text-sm text-green-500">Password changed successfully.</p>}
          <Button type="submit" size="sm" disabled={pwLoading}>
            {pwLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Change password
          </Button>
        </form>
      </div>
    </div>
  )
}

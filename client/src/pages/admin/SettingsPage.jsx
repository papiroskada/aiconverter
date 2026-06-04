import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiFetch, apiJson } from '@/api/client.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

const CLAUDE_INTERFACE_MODELS = [
  'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
]
const OPENAI_INTERFACE_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
const OPENAI_RULES_MODELS     = ['gpt-4o-mini', 'gpt-4o']
const CLAUDE_RULES_MODELS     = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6']

function MaskedInput({ id, value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  // Server returns masked keys with •  — show as plain text so user sees "sk-ant-••••1234"
  // When the user types a new key (no •) keep it hidden behind password dots
  const isServerMasked = value?.includes('•')
  const inputType = isServerMasked || show ? 'text' : 'password'
  return (
    <div className="relative">
      <Input
        id={id}
        type={inputType}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-sm"
      />
      {!isServerMasked && (
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch('/api/settings')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load settings (${r.status})`)
        return r.json()
      })
      .then(setSettings)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const set = key => val => setSettings(s => ({ ...s, [key]: val }))
  const setEv = key => e => setSettings(s => ({ ...s, [key]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      // Strip masked key values (contain •) — they haven't changed, sending them would corrupt the real key
      const payload = { ...settings }
      if (payload.claude_api_key?.includes('•')) delete payload.claude_api_key
      if (payload.openai_api_key?.includes('•')) delete payload.openai_api_key

      const res = await apiJson('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Server error ${res.status}`)
      }
      toast.success('Settings saved')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
    </div>
  )

  const provider = settings?.ai_provider ?? 'claude'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure AI providers for analysis and code generation.</p>
      </div>

      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Provider selector */}
        <Card>
          <CardHeader><CardTitle className="text-base">AI Provider</CardTitle></CardHeader>
          <CardContent>
            <RadioGroup value={provider} onValueChange={set('ai_provider')} className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="claude" id="p-claude" />
                <Label htmlFor="p-claude" className="cursor-pointer">Claude (Anthropic)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="openai" id="p-openai" />
                <Label htmlFor="p-openai" className="cursor-pointer">OpenAI</Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Claude settings */}
        <Card className={provider !== 'claude' ? 'opacity-50 pointer-events-none' : ''}>
          <CardHeader><CardTitle className="text-base">Claude</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="claude-key">API Key</Label>
              <MaskedInput
                id="claude-key"
                value={settings?.claude_api_key ?? ''}
                onChange={set('claude_api_key')}
                placeholder="sk-ant-api03-…"
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Interface model</Label>
                <Select value={settings?.claude_model_interface ?? ''} onValueChange={set('claude_model_interface')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLAUDE_INTERFACE_MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rules model</Label>
                <Select value={settings?.claude_model_rules ?? ''} onValueChange={set('claude_model_rules')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLAUDE_RULES_MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* OpenAI settings */}
        <Card className={provider !== 'openai' ? 'opacity-50 pointer-events-none' : ''}>
          <CardHeader><CardTitle className="text-base">OpenAI</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oai-key">API Key</Label>
              <MaskedInput
                id="oai-key"
                value={settings?.openai_api_key ?? ''}
                onChange={set('openai_api_key')}
                placeholder="sk-…"
              />
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Interface model</Label>
                <Select value={settings?.openai_model_interface ?? ''} onValueChange={set('openai_model_interface')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPENAI_INTERFACE_MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Rules model</Label>
                <Select value={settings?.openai_model_rules ?? ''} onValueChange={set('openai_model_rules')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OPENAI_RULES_MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Code conventions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Code conventions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code-db-read">DB read pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{table}'}</code> <code>{'{key}'}</code> <code>{'{value}'}</code> <code>{'{resultVar}'}</code> <code>{'{cols}'}</code></p>
              <Textarea
                id="code-db-read"
                rows={2}
                value={settings?.code_db_read ?? ''}
                onChange={setEv('code_db_read')}
                className="font-mono text-sm"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-db-write">DB write pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{table}'}</code> <code>{'{cols}'}</code> <code>{'{key}'}</code> <code>{'{$params}'}</code> <code>{'{values}'}</code></p>
              <Textarea
                id="code-db-write"
                rows={2}
                value={settings?.code_db_write ?? ''}
                onChange={setEv('code_db_write')}
                className="font-mono text-sm"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-error-convention">Error handling pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{code}'}</code> <code>{'{field}'}</code> <code>{'{rtnStsField}'}</code></p>
              <Textarea
                id="code-error-convention"
                rows={2}
                value={settings?.code_error_convention ?? ''}
                onChange={setEv('code_error_convention')}
                className="font-mono text-sm"
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label htmlFor="code-external-call">External call pattern</Label>
              <p className="text-xs text-muted-foreground">Placeholders: <code>{'{name}'}</code></p>
              <Textarea
                id="code-external-call"
                rows={2}
                value={settings?.code_external_call ?? ''}
                onChange={setEv('code_external_call')}
                className="font-mono text-sm"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save settings
          </Button>
        </div>
      </form>
    </div>
  )
}

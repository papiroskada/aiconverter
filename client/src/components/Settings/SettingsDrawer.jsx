import { useState, useEffect } from 'react'
import { fetchSettings, saveSettings } from '../../api/settings.js'

const inputStyle = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle = { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }

export default function SettingsDrawer({ open, onClose }) {
  const [claudeKey, setClaudeKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [claudeEditing, setClaudeEditing] = useState(false)
  const [openaiEditing, setOpenaiEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    fetchSettings().then(s => {
      setClaudeKey(s.claude_api_key ?? '')
      setOpenaiKey(s.openai_api_key ?? '')
    })
  }, [open])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const fields = {}
      if (claudeEditing) fields.claude_api_key = claudeKey
      if (openaiEditing) fields.openai_api_key = openaiKey
      await saveSettings(fields)
      setClaudeEditing(false)
      setOpenaiEditing(false)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 320, height: '100vh',
      background: '#1e293b', borderLeft: '1px solid #334155',
      padding: 24, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>Settings</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <div>
        <label style={labelStyle}>Anthropic API Key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            type={claudeEditing ? 'text' : 'password'}
            value={claudeKey}
            onChange={e => setClaudeKey(e.target.value)}
            readOnly={!claudeEditing}
            placeholder="sk-ant-..."
          />
          <button
            onClick={() => setClaudeEditing(e => !e)}
            style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12 }}
          >
            {claudeEditing ? 'Lock' : 'Edit'}
          </button>
        </div>
      </div>

      <div>
        <label style={labelStyle}>OpenAI API Key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            type={openaiEditing ? 'text' : 'password'}
            value={openaiKey}
            onChange={e => setOpenaiKey(e.target.value)}
            readOnly={!openaiEditing}
            placeholder="sk-..."
          />
          <button
            onClick={() => setOpenaiEditing(e => !e)}
            style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12 }}
          >
            {openaiEditing ? 'Lock' : 'Edit'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      <button
        onClick={handleSave}
        disabled={saving || (!claudeEditing && !openaiEditing)}
        style={{
          background: '#2563eb', color: 'white', border: 'none', borderRadius: 8,
          padding: '10px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
          opacity: (saving || (!claudeEditing && !openaiEditing)) ? 0.5 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { fetchSettings, saveSettings } from '../../api/settings.js'

const inputStyle = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '6px 10px', fontSize: 13,
  width: '100%', boxSizing: 'border-box',
}
const textareaStyle = {
  ...inputStyle, resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5,
}
const labelStyle = { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }
const hintStyle  = { color: '#475569', fontSize: 11, marginTop: 3 }
const sectionLabelStyle = {
  color: '#64748b', fontSize: 10, fontWeight: 700, letterSpacing: 1,
  textTransform: 'uppercase', display: 'block', marginBottom: 10,
}

const CODE_GEN_FIELDS = [
  {
    key: 'code_db_read',
    label: 'DB Read pattern',
    hint: "e.g. await prisma.{table}.findFirst({ where: { {key}: {value} } })",
    rows: 2,
  },
  {
    key: 'code_db_write',
    label: 'DB Write pattern',
    hint: "e.g. await prisma.{table}.create({ data }) / await prisma.{table}.update({ where: { {key} }, data })",
    rows: 2,
  },
  {
    key: 'code_error_convention',
    label: 'Error convention',
    hint: "e.g. return { error: {code}, field: '{field}' }  or  throw new AppError({code})",
    rows: 1,
  },
  {
    key: 'code_external_call',
    label: 'External call pattern',
    hint: "e.g. await callProgram('{name}', input)  or  await services['{name}'](input)",
    rows: 1,
  },
]

export default function SettingsDrawer({ open, onClose }) {
  const [claudeKey, setClaudeKey]     = useState('')
  const [openaiKey, setOpenaiKey]     = useState('')
  const [claudeEditing, setClaudeEditing] = useState(false)
  const [openaiEditing, setOpenaiEditing] = useState(false)

  const [codeGen, setCodeGen]         = useState({})
  const [codeGenDirty, setCodeGenDirty] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!open) return
    fetchSettings().then(s => {
      setClaudeKey(s.claude_api_key ?? '')
      setOpenaiKey(s.openai_api_key ?? '')
      setCodeGen({
        code_db_read:           s.code_db_read           ?? "await db.select('{table}', { {key}: {value} })",
        code_db_write:          s.code_db_write          ?? "await db.insert('{table}', data) / await db.update('{table}', data, { {key} })",
        code_error_convention:  s.code_error_convention  ?? "return { error: {code}, field: '{field}' }",
        code_external_call:     s.code_external_call     ?? "await callProgram('{name}', input)",
        code_language:          s.code_language          ?? 'typescript',
        code_source_mode:       s.code_source_mode       ?? 'with_source',
      })
      setCodeGenDirty(false)
    })
  }, [open])

  function updateCodeGen(key, value) {
    setCodeGen(prev => ({ ...prev, [key]: value }))
    setCodeGenDirty(true)
  }

  const anyDirty = claudeEditing || openaiEditing || codeGenDirty

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const fields = {}
      if (claudeEditing) fields.claude_api_key = claudeKey
      if (openaiEditing) fields.openai_api_key = openaiKey
      if (codeGenDirty) Object.assign(fields, codeGen)
      await saveSettings(fields)
      setClaudeEditing(false)
      setOpenaiEditing(false)
      setCodeGenDirty(false)
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
      position: 'fixed', top: 0, right: 0, width: 360, height: '100vh',
      background: '#1e293b', borderLeft: '1px solid #334155',
      padding: 24, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 20,
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>Settings</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      {/* API Keys */}
      <div>
        <span style={sectionLabelStyle}>API Keys</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12, flexShrink: 0 }}
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
                style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12, flexShrink: 0 }}
              >
                {openaiEditing ? 'Lock' : 'Edit'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Code Generation */}
      <div>
        <span style={sectionLabelStyle}>Code Generation</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          <div>
            <label style={labelStyle}>Language</label>
            <select
              value={codeGen.code_language ?? 'typescript'}
              onChange={e => updateCodeGen('code_language', e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="typescript">TypeScript</option>
              <option value="javascript">JavaScript</option>
            </select>
          </div>

          <div>
            <label style={labelStyle}>Source mode</label>
            <select
              value={codeGen.code_source_mode ?? 'with_source'}
              onChange={e => updateCodeGen('code_source_mode', e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="with_source">Business logic + COBOL source</option>
              <option value="logic_only">Business logic only</option>
            </select>
            <p style={hintStyle}>Logic only — proves intermediate layer is sufficient without raw COBOL</p>
          </div>

          {CODE_GEN_FIELDS.map(({ key, label, hint, rows }) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <textarea
                value={codeGen[key] ?? ''}
                onChange={e => updateCodeGen(key, e.target.value)}
                rows={rows}
                style={textareaStyle}
              />
              <p style={hintStyle}>{hint}</p>
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      <button
        onClick={handleSave}
        disabled={saving || !anyDirty}
        style={{
          background: '#2563eb', color: 'white', border: 'none', borderRadius: 8,
          padding: '10px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
          opacity: (saving || !anyDirty) ? 0.5 : 1,
          position: 'sticky', bottom: 0,
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

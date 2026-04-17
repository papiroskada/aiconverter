import { useState } from 'react'
import { createApplication, startApplicationAnalysis } from '../../api/applications.js'
import { uploadFile } from '../../api/programs.js'
import { saveSettings } from '../../api/settings.js'

const CLAUDE_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']
const OPENAI_MODELS_FULL = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
const OPENAI_MODELS_LITE = ['gpt-4o-mini', 'gpt-4o']

const inputStyle = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const labelStyle = { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }
const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 12 }

export default function ConfirmationModal({ files, companionMap = new Map(), defaultName, onClose, onStarted }) {
  const [appName, setAppName] = useState(defaultName)
  const [provider, setProvider] = useState('claude')
  const [modelInterface, setModelInterface] = useState('claude-sonnet-4-6')
  const [modelRules, setModelRules] = useState('claude-haiku-4-5-20251001')
  const [modelDiagram, setModelDiagram] = useState('claude-haiku-4-5-20251001')
  const [mode, setMode] = useState('sequential')
  const [phase, setPhase] = useState('confirm') // 'confirm' | 'progress'
  const [progress, setProgress] = useState({}) // programId → status
  const [applicationId, setApplicationId] = useState(null)
  const [uploadStatus, setUploadStatus] = useState('') // status text during upload phase
  const [error, setError] = useState(null)

  function handleProviderChange(p) {
    setProvider(p)
    if (p === 'claude') {
      setModelInterface('claude-sonnet-4-6')
      setModelRules('claude-haiku-4-5-20251001')
      setModelDiagram('claude-haiku-4-5-20251001')
    } else {
      setModelInterface('gpt-4o')
      setModelRules('gpt-4o-mini')
      setModelDiagram('gpt-4o-mini')
    }
  }

  async function handleStart() {
    setError(null)
    setPhase('progress')

    try {
      // 1. Save settings
      const settingsFields = provider === 'claude'
        ? { ai_provider: 'claude', claude_model_interface: modelInterface, claude_model_rules: modelRules, claude_model_diagram: modelDiagram }
        : { ai_provider: 'openai', openai_model_interface: modelInterface, openai_model_rules: modelRules, openai_model_diagram: modelDiagram }
      await saveSettings(settingsFields)

      // 2. Create application
      const app = await createApplication(appName)
      setApplicationId(app.id)

      // 3. Upload files sequentially
      const initialProgress = {}
      for (const f of files) initialProgress[f.name] = 'pending'
      setProgress(initialProgress)

      for (const file of files) {
        setUploadStatus(`Uploading ${file.name}…`)
        const stem = file.name.replace(/\.(cbl|cob|c)$/i, '')
        const companion = companionMap.get(stem) ?? null
        await uploadFile(file, app.id, companion)
        setProgress(prev => ({ ...prev, [file.name]: 'uploaded' }))
      }
      setUploadStatus('')

      // 4. Trigger analysis
      await startApplicationAnalysis(app.id, mode)

      // 5. Notify parent to subscribe to SSE
      onStarted(app.id)
    } catch (err) {
      setError(err.message)
      setPhase('confirm')
    }
  }

  const modelOptions = provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_FULL

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: 28, width: 480,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden',
      }}>
        {phase === 'confirm' ? (
          <>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>New Application</div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Application Name</label>
              <input style={inputStyle} value={appName} onChange={e => setAppName(e.target.value)} />
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>{files.length} files found</label>
              <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {files.map(f => (
                  <span key={f.name} style={{ color: '#64748b', fontSize: 12 }}>{f.name}</span>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #334155', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>Analysis Settings</span>

              <div>
                <label style={labelStyle}>Provider</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['claude', 'openai'].map(p => (
                    <label key={p} style={{ color: '#e2e8f0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => handleProviderChange(p)} />
                      {p === 'claude' ? 'Claude' : 'OpenAI'}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  ['Interface', modelInterface, setModelInterface, modelOptions],
                  ['Rules', modelRules, setModelRules, provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_LITE],
                  ['Diagram', modelDiagram, setModelDiagram, provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_LITE],
                ].map(([label, value, setter, options]) => (
                  <div key={label}>
                    <label style={labelStyle}>{label}</label>
                    <select style={selectStyle} value={value} onChange={e => setter(e.target.value)}>
                      {options.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div>
                <label style={labelStyle}>Mode</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['sequential', 'parallel'].map(m => (
                    <label key={m} style={{ color: '#e2e8f0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                      {m === 'parallel' && <span style={{ color: '#64748b', fontSize: 11 }}>(faster, ~3x cost)</span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={!appName.trim()}
                style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14, opacity: !appName.trim() ? 0.5 : 1 }}
              >
                Start Analysis
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>{appName}</div>
            {uploadStatus && <div style={{ color: '#64748b', fontSize: 12 }}>{uploadStatus}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
              {files.map(f => {
                const status = progress[f.name] ?? 'pending'
                const bar = status === 'analyzed' ? '████████████' : status === 'analyzing' ? '██░░░░░░░░░░' : status === 'uploaded' ? '░░░░░░░░░░░░' : '░░░░░░░░░░░░'
                const color = status === 'analyzed' ? '#22c55e' : status === 'analyzing' ? '#3b82f6' : status === 'failed' ? '#ef4444' : '#64748b'
                return (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: '#e2e8f0', fontSize: 12, width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ color, fontSize: 11, fontFamily: 'monospace' }}>{bar}</span>
                    <span style={{ color, fontSize: 11 }}>{status}</span>
                  </div>
                )
              })}
            </div>
            <button onClick={onClose} style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-end' }}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}

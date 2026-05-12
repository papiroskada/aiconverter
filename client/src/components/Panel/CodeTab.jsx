import { useState } from 'react'
import { generateFullProgram, generateProjectFiles } from '../../api/programs.js'

const BTN = {
  base: {
    borderRadius: 6, padding: '6px 14px', fontSize: 11,
    cursor: 'pointer', border: '1px solid',
  },
  primary: {
    background: '#1e3a5f', borderColor: '#2563eb', color: '#93c5fd',
  },
  muted: {
    background: '#1e293b', borderColor: '#334155', color: '#94a3b8',
  },
  active: {
    background: '#1e293b', borderColor: '#60a5fa', color: '#60a5fa',
  },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
}

function btn(variant, extra = {}) {
  return { ...BTN.base, ...BTN[variant], ...extra }
}

function downloadBlob(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function CodeTab({ programId, programName, applicationId }) {
  const [status, setStatus]           = useState('idle')
  const [code, setCode]               = useState('')
  const [tests, setTests]             = useState('')
  const [language, setLanguage]       = useState('typescript')
  const [notes, setNotes]             = useState('')
  const [error, setError]             = useState('')
  const [includeTests, setIncludeTests] = useState(false)
  const [activeTab, setActiveTab]     = useState('code')
  const [zipping, setZipping]         = useState(false)

  async function handleGenerate() {
    setStatus('generating')
    setError('')
    setTests('')
    setActiveTab('code')
    try {
      const result = await generateFullProgram(programId, { includeTests })
      setCode(result.code ?? '')
      setLanguage(result.language ?? 'typescript')
      setNotes(result.notes ?? '')
      if (result.tests) setTests(result.tests)
      setStatus('done')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function handleDownloadFile() {
    const ext = language === 'typescript' ? 'ts' : 'js'
    downloadBlob(code, `${programName}.${ext}`)
  }

  function handleDownloadTests() {
    const ext = language === 'typescript' ? 'ts' : 'js'
    downloadBlob(tests, `${programName}.test.${ext}`)
  }

  async function handleDownloadZip() {
    setZipping(true)
    try {
      const { files, warnings } = await generateProjectFiles(applicationId, { includeTests })
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (const f of files) zip.file(f.path, f.content)
      if (warnings?.length) zip.file('WARNINGS.txt', warnings.join('\n'))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'project.zip'; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setZipping(false)
    }
  }

  const ext = language === 'typescript' ? 'ts' : 'js'
  const hasTests = status === 'done' && !!tests

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {status === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16 }}>
          <div style={{ color: '#475569', fontSize: 13, marginBottom: 4 }}>
            Generate JavaScript/TypeScript module from COBOL analysis
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#94a3b8', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={includeTests}
              onChange={e => setIncludeTests(e.target.checked)}
              style={{ accentColor: '#60a5fa', cursor: 'pointer' }}
            />
            Include Vitest unit tests
          </label>
          <button onClick={handleGenerate} style={btn('primary', { padding: '8px 20px', fontSize: 12 })}>
            Generate module
          </button>
        </div>
      )}

      {status === 'generating' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10 }}>
          <div style={{ width: 14, height: 14, border: '2px solid #334155', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ color: '#60a5fa', fontSize: 13 }}>Generating{includeTests ? ' code + tests' : ''}…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 }}>
          <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>
          <button onClick={handleGenerate} style={btn('primary')}>Retry</button>
        </div>
      )}

      {status === 'done' && (
        <>
          {hasTests && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0, borderBottom: '1px solid #1e293b', paddingBottom: 8, marginBottom: 8 }}>
              <button
                onClick={() => setActiveTab('code')}
                style={btn(activeTab === 'code' ? 'active' : 'muted', { borderRadius: '4px 4px 0 0' })}
              >
                {programName}.{ext}
              </button>
              <button
                onClick={() => setActiveTab('tests')}
                style={btn(activeTab === 'tests' ? 'active' : 'muted', { borderRadius: '4px 4px 0 0' })}
              >
                {programName}.test.{ext}
              </button>
            </div>
          )}

          <pre style={{
            flex: 1, overflowY: 'auto', margin: 0,
            background: '#020817', borderRadius: 6, padding: 16,
            fontSize: 11.5, lineHeight: 1.6, color: '#e2e8f0',
            fontFamily: 'monospace', whiteSpace: 'pre', overflowX: 'auto',
          }}>
            <code>{activeTab === 'tests' ? tests : code}</code>
          </pre>

          {notes && activeTab === 'code' && (
            <div style={{ padding: '10px 0 4px', color: '#94a3b8', fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>Notes:</span> {Array.isArray(notes) ? notes.join(' · ') : notes}
            </div>
          )}

          <div style={{
            flexShrink: 0, borderTop: '1px solid #1e293b',
            paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            <button onClick={handleDownloadFile} style={btn('primary')}>
              ↓ {programName}.{ext}
            </button>
            {hasTests && (
              <button onClick={handleDownloadTests} style={btn('primary')}>
                ↓ {programName}.test.{ext}
              </button>
            )}
            {applicationId && (
              <button
                onClick={handleDownloadZip}
                disabled={zipping}
                style={btn('muted', zipping ? BTN.disabled : {})}
              >
                {zipping ? 'Generating project…' : '↓ Download project .zip'}
              </button>
            )}
            <button onClick={() => setStatus('idle')} style={btn('muted', { marginLeft: 'auto' })}>
              Regenerate
            </button>
          </div>
        </>
      )}
    </div>
  )
}

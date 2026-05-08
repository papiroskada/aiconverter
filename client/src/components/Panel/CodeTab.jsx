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
  const [status, setStatus] = useState('idle')
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('typescript')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [zipping, setZipping] = useState(false)

  async function handleGenerate() {
    setStatus('generating')
    setError('')
    try {
      const result = await generateFullProgram(programId)
      setCode(result.code ?? '')
      setLanguage(result.language ?? 'typescript')
      setNotes(result.notes ?? '')
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

  async function handleDownloadZip() {
    setZipping(true)
    try {
      const { files, warnings } = await generateProjectFiles(applicationId)
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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

      {status === 'idle' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12 }}>
          <div style={{ color: '#475569', fontSize: 13, marginBottom: 4 }}>
            Generate JavaScript/TypeScript module from COBOL analysis
          </div>
          <button onClick={handleGenerate} style={btn('primary', { padding: '8px 20px', fontSize: 12 })}>
            Generate module
          </button>
        </div>
      )}

      {status === 'generating' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10 }}>
          <div style={{ width: 14, height: 14, border: '2px solid #334155', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ color: '#60a5fa', fontSize: 13 }}>Generating…</span>
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
          <pre style={{
            flex: 1, overflowY: 'auto', margin: 0,
            background: '#020817', borderRadius: 6, padding: 16,
            fontSize: 11.5, lineHeight: 1.6, color: '#e2e8f0',
            fontFamily: 'monospace', whiteSpace: 'pre', overflowX: 'auto',
          }}>
            <code>{code}</code>
          </pre>

          {notes && (
            <div style={{ padding: '10px 0 4px', color: '#94a3b8', fontSize: 11 }}>
              <span style={{ fontWeight: 600 }}>Notes:</span> {notes}
            </div>
          )}

          <div style={{
            flexShrink: 0, borderTop: '1px solid #1e293b',
            paddingTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap',
          }}>
            <button onClick={handleDownloadFile} style={btn('primary')}>
              ↓ Download .{ext}
            </button>
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

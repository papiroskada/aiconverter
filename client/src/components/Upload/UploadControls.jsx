import { useRef, useState } from 'react'
import { uploadFile } from '../../api/programs.js'
import ConfirmationModal from './ConfirmationModal.jsx'

const btnBase = {
  color: 'white', border: 'none', borderRadius: 8,
  padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

export default function UploadControls({ onUploaded, onBatchStarted }) {
  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [folderFiles, setFolderFiles] = useState(null)
  const [defaultName, setDefaultName] = useState('')

  async function handleSingleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const program = await uploadFile(file)
      onUploaded(program)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      fileRef.current.value = ''
    }
  }

  function handleFolderSelect(e) {
    const all = Array.from(e.target.files)
    folderRef.current.value = ''

    const cobolFiles = all.filter(f => f.name.match(/\.(cbl|cob)$/i))
    const cFiles     = all.filter(f => f.name.match(/\.c$/i))
    const uFiles     = all.filter(f => f.name.match(/\.u$/i))

    // Every .c must have a matching .u (same stem)
    const uStems = new Set(uFiles.map(f => f.name.replace(/\.u$/i, '')))
    const unpaired = cFiles.filter(f => !uStems.has(f.name.replace(/\.c$/i, '')))
    if (unpaired.length > 0) {
      setError(`Missing .u file for: ${unpaired.map(f => f.name).join(', ')}`)
      return
    }

    // Program files only (no .u — they are companions, not programs)
    const programFiles = [...cobolFiles, ...cFiles]
    if (programFiles.length === 0) return

    setError(null)
    const folderName = all[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultName(folderName.toUpperCase())
    setFolderFiles(programFiles)
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <input ref={fileRef} type="file" accept=".cbl,.cob" style={{ display: 'none' }} onChange={handleSingleFile} />
      <input ref={folderRef} type="file" webkitdirectory="" accept=".cbl,.cob,.c,.u" style={{ display: 'none' }} onChange={handleFolderSelect} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => fileRef.current.click()}
          disabled={uploading}
          style={{ ...btnBase, background: '#334155', opacity: uploading ? 0.7 : 1 }}
        >
          {uploading ? 'Uploading…' : '+ Upload File'}
        </button>
        <button
          onClick={() => folderRef.current.click()}
          style={{ ...btnBase, background: '#2563eb' }}
        >
          + Upload Folder
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      {folderFiles && (
        <ConfirmationModal
          files={folderFiles}
          defaultName={defaultName}
          onClose={() => setFolderFiles(null)}
          onStarted={(appId) => {
            setFolderFiles(null)
            onBatchStarted(appId)
          }}
        />
      )}
    </div>
  )
}

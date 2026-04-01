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
    const files = Array.from(e.target.files).filter(f =>
      f.name.match(/\.(cbl|cob)$/i)
    )
    if (files.length === 0) return
    // Derive folder name from webkitRelativePath
    const folderName = files[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultName(folderName.toUpperCase())
    setFolderFiles(files)
    folderRef.current.value = ''
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <input ref={fileRef} type="file" accept=".cbl,.cob" style={{ display: 'none' }} onChange={handleSingleFile} />
      <input ref={folderRef} type="file" webkitdirectory="" style={{ display: 'none' }} onChange={handleFolderSelect} />

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

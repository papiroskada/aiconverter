import { useRef, useState } from 'react'
import ConfirmationModal from './ConfirmationModal.jsx'

const btnBase = {
  color: 'white', border: 'none', borderRadius: 8,
  padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

function validateAndGroup(allFiles) {
  const cobolFiles = allFiles.filter(f => f.name.match(/\.(cbl|cob)$/i))
  const cFiles     = allFiles.filter(f => f.name.match(/\.c$/i))
  const uFiles     = allFiles.filter(f => f.name.match(/\.u$/i))

  // Every .c must have a .u and vice versa
  const uStems = new Set(uFiles.map(f => f.name.replace(/\.u$/i, '')))
  const cStems = new Set(cFiles.map(f => f.name.replace(/\.c$/i, '')))

  const cWithoutU = cFiles.filter(f => !uStems.has(f.name.replace(/\.c$/i, '')))
  const uWithoutC = uFiles.filter(f => !cStems.has(f.name.replace(/\.u$/i, '')))

  if (cWithoutU.length > 0)
    return { error: `Missing .u file for: ${cWithoutU.map(f => f.name).join(', ')}` }
  if (uWithoutC.length > 0)
    return { error: `Missing .c file for: ${uWithoutC.map(f => f.name).join(', ')}` }

  // Program files only (.u are companions, not programs)
  const programFiles = [...cobolFiles, ...cFiles]
  if (programFiles.length === 0)
    return { error: 'No supported files found (.cbl, .cob, .c)' }

  return { programFiles }
}

export default function UploadControls({ onBatchStarted }) {
  const fileRef   = useRef(null)
  const folderRef = useRef(null)
  const [error, setError]             = useState(null)
  const [folderFiles, setFolderFiles] = useState(null)
  const [defaultName, setDefaultName] = useState('')

  function handleFilesSelect(e) {
    const all = Array.from(e.target.files)
    fileRef.current.value = ''
    if (all.length === 0) return

    const { programFiles, error: err } = validateAndGroup(all)
    if (err) { setError(err); return }

    setError(null)
    // No folder path available — user will type the app name
    setDefaultName('')
    setFolderFiles(programFiles)
  }

  function handleFolderSelect(e) {
    const all = Array.from(e.target.files)
    folderRef.current.value = ''
    if (all.length === 0) return

    const { programFiles, error: err } = validateAndGroup(all)
    if (err) { setError(err); return }

    setError(null)
    const folderName = all[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultName(folderName.toUpperCase())
    setFolderFiles(programFiles)
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".cbl,.cob,.c,.u"
        style={{ display: 'none' }}
        onChange={handleFilesSelect}
      />
      <input
        ref={folderRef}
        type="file"
        webkitdirectory=""
        accept=".cbl,.cob,.c,.u"
        style={{ display: 'none' }}
        onChange={handleFolderSelect}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => fileRef.current.click()}
          style={{ ...btnBase, background: '#334155' }}
        >
          + Upload Files
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

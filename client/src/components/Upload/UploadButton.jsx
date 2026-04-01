import { useRef, useState } from 'react'
import { uploadFile } from '../../api/programs.js'

export default function UploadButton({ onUploaded }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleChange(e) {
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
      inputRef.current.value = ''
    }
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".cbl,.cob"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <button
        onClick={() => inputRef.current.click()}
        disabled={uploading}
        style={{
          background: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '10px 20px',
          fontSize: 14,
          fontWeight: 600,
          cursor: uploading ? 'not-allowed' : 'pointer',
          opacity: uploading ? 0.7 : 1,
        }}
      >
        {uploading ? 'Uploading…' : '+ Upload COBOL'}
      </button>
      {error && (
        <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, textAlign: 'right' }}>{error}</div>
      )}
    </div>
  )
}

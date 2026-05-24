import { useState, useRef } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { uploadFile } from '@/api/programs.js'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

// Validate and group files (preserved from original Sidebar logic)
function validateAndGroup(allFiles) {
  const cobolFiles = allFiles.filter(f => f.name.match(/\.(cbl|cob)$/i))
  const cFiles     = allFiles.filter(f => f.name.match(/\.c$/i))
  const uFiles     = allFiles.filter(f => f.name.match(/\.u$/i))
  const sFiles     = allFiles.filter(f => f.name.match(/\.s$/i))

  const uStems = new Set(uFiles.map(f => f.name.replace(/\.u$/i, '')))
  const cStems = new Set(cFiles.map(f => f.name.replace(/\.c$/i, '')))

  const cWithoutU = cFiles.filter(f => !uStems.has(f.name.replace(/\.c$/i, '')))
  const uWithoutC = uFiles.filter(f => !cStems.has(f.name.replace(/\.u$/i, '')))

  if (cWithoutU.length > 0)
    return { error: `Missing .u file for: ${cWithoutU.map(f => f.name).join(', ')}` }
  if (uWithoutC.length > 0)
    return { error: `Missing .c file for: ${uWithoutC.map(f => f.name).join(', ')}` }

  const programFiles = [...cobolFiles, ...cFiles]
  if (programFiles.length === 0)
    return { error: 'No supported files found (.cbl, .cob, .c)' }

  const companionMap = new Map()
  for (const f of uFiles) companionMap.set(f.name.replace(/\.u$/i, ''), f)
  for (const f of sFiles) {
    const stem = f.name.replace(/\.s$/i, '')
    if (!companionMap.has(stem)) companionMap.set(stem, f)
  }

  return { programFiles, companionMap }
}

export default function UploadDialog({ open, onOpenChange, applicationId, onUploaded }) {
  const [dragging, setDragging] = useState(false)
  const [files, setFiles] = useState([])
  const [validationError, setValidationError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const inputRef = useRef(null)

  function handleOpenChange(val) {
    if (!val) { setFiles([]); setValidationError(''); setUploadError('') }
    onOpenChange(val)
  }

  function handleFiles(rawFiles) {
    const all = Array.from(rawFiles)
    const result = validateAndGroup(all)
    if (result.error) {
      setValidationError(result.error)
      setFiles([])
    } else {
      setValidationError('')
      setFiles(all)
    }
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  async function handleUpload() {
    if (!files.length) return
    const { programFiles, companionMap } = validateAndGroup(files)
    if (!programFiles) return

    setUploading(true)
    setUploadError('')
    try {
      for (const f of programFiles) {
        const stem = f.name.replace(/\.(cbl|cob|c)$/i, '')
        const companion = companionMap?.get(stem) ?? null
        await uploadFile(f, applicationId, companion)
      }
      handleOpenChange(false)
      onUploaded?.()
    } catch (err) {
      setUploadError(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Programs</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
          >
            <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drop files here or <span className="text-primary underline">browse</span>
            </p>
            <p className="text-xs text-muted-foreground mt-1">.cbl · .cob · .c · .u · .s</p>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              multiple
              accept=".cbl,.cob,.c,.u,.s"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {files.map(f => (
                <div key={f.name} className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span className="font-mono">{f.name}</span>
                  <span>{(f.size / 1024).toFixed(1)} KB</span>
                </div>
              ))}
            </div>
          )}

          {validationError && (
            <Alert variant="destructive">
              <AlertDescription>{validationError}</AlertDescription>
            </Alert>
          )}
          {uploadError && (
            <Alert variant="destructive">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button onClick={handleUpload} disabled={!files.length || uploading || !!validationError}>
            {uploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload {files.length > 0 && `(${files.filter(f => f.name.match(/\.(cbl|cob|c)$/i)).length} program${files.filter(f => f.name.match(/\.(cbl|cob|c)$/i)).length !== 1 ? 's' : ''})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

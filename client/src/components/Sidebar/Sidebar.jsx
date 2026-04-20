import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchApplications, createApplication, deleteApplication, startApplicationAnalysis } from '../../api/applications.js'
import { uploadFile } from '../../api/programs.js'
import ConfirmationModal from '../Upload/ConfirmationModal.jsx'

const STATUS_ORDER = { analyzing: 0, analyzed: 1, pending: 2, failed: 3 }

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

  // Build companion maps: stem → file
  const companionMap = new Map()
  for (const f of uFiles) companionMap.set(f.name.replace(/\.u$/i, ''), f)
  for (const f of sFiles) {
    const stem = f.name.replace(/\.s$/i, '')
    if (!companionMap.has(stem)) companionMap.set(stem, f)
  }

  return { programFiles, companionMap }
}

function statusIcon(status) {
  if (status === 'analyzing') return { icon: '▶', color: '#60a5fa' }
  if (status === 'analyzed')  return { icon: '✓', color: '#4ade80' }
  if (status === 'failed')    return { icon: '✗', color: '#f87171' }
  return { icon: '○', color: '#475569' }
}

function appStatusColor(status) {
  if (status === 'analyzing') return '#fbbf24'
  if (status === 'analyzed')  return '#4ade80'
  if (status === 'failed')    return '#f87171'
  return '#475569'
}

// ── Projects list view ──────────────────────────────────────────────────────

function ProjectsList({ applications, nodes, onSelectApp, onUploadFolder, onCreateProject }) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const inputRef = useRef(null)

  function startCreate() {
    setCreating(true)
    setNewName('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  async function submitCreate(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    await onCreateProject(name)
    setCreating(false)
    setNewName('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid #334155' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>Projects</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {applications.length === 0 && (
          <div style={{ color: '#475569', fontSize: 12, padding: '12px 8px' }}>
            No projects yet. Upload a folder or create a project to get started.
          </div>
        )}
        {applications.map(app => {
          const appNodes = nodes.filter(n => n.data.applicationId === app.id)
          const analyzedCount = appNodes.filter(n => n.data.status === 'analyzed').length
          const total = app.programCount ?? appNodes.length
          const progressPct = total > 0 ? (analyzedCount / total) * 100 : 0

          return (
            <div
              key={app.id}
              onClick={() => onSelectApp(app.id)}
              style={{
                padding: '9px 10px', borderRadius: 6,
                border: '1px solid transparent',
                marginBottom: 4, cursor: 'pointer',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 500 }}>{app.name}</div>
              <div style={{ color: appStatusColor(app.status), fontSize: 10, marginTop: 2 }}>
                {app.status === 'analyzing' ? `● analyzing ${analyzedCount} / ${total}` :
                 app.status === 'analyzed'  ? `✓ analyzed ${total} / ${total}` :
                 app.status === 'failed'    ? `✗ failed` :
                 `○ pending 0 / ${total}`}
              </div>
              {app.status === 'analyzing' && (
                <div style={{ background: '#0f172a', borderRadius: 2, height: 3, marginTop: 5 }}>
                  <div style={{ background: '#fbbf24', height: '100%', width: `${progressPct}%`, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '10px 8px', borderTop: '1px solid #334155', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {creating ? (
          <form onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              ref={inputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Project name"
              style={{
                background: '#0f172a', border: '1px solid #475569', borderRadius: 6,
                color: '#e2e8f0', padding: '6px 8px', fontSize: 12, outline: 'none',
              }}
              onKeyDown={e => { if (e.key === 'Escape') setCreating(false) }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="submit"
                disabled={!newName.trim()}
                style={{ flex: 1, background: '#2563eb', border: 'none', borderRadius: 6, color: 'white', padding: '7px', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: newName.trim() ? 1 : 0.5 }}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                style={{ flex: 1, background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', padding: '7px', fontSize: 12, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <button
              onClick={onUploadFolder}
              style={{ background: '#2563eb', border: 'none', borderRadius: 6, color: 'white', padding: '8px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              + Upload Folder
            </button>
            <button
              onClick={startCreate}
              style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', padding: '8px', fontSize: 12, cursor: 'pointer' }}
            >
              + New Project
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Project files view ──────────────────────────────────────────────────────

function ProjectFiles({ app, nodes, stepProgress, batchAppId, onBack, onFileClick, onBatchCancel, onDeleteApp, onAddFiles }) {
  const appNodes = nodes
    .filter(n => n.data.applicationId === app.id)
    .slice()
    .sort((a, b) => {
      const oa = STATUS_ORDER[a.data.status] ?? 4
      const ob = STATUS_ORDER[b.data.status] ?? 4
      if (oa !== ob) return oa - ob
      return a.data.name.localeCompare(b.data.name)
    })

  const analyzedCount = appNodes.filter(n => n.data.status === 'analyzed').length
  const total = appNodes.length
  const progressPct = total > 0 ? (analyzedCount / total) * 100 : 0
  const isThisBatchRunning = batchAppId === app.id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onBack}
          style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}
        >
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.name}</div>
          <div style={{ color: appStatusColor(app.status), fontSize: 10, marginTop: 1 }}>{app.status}</div>
        </div>
        {isThisBatchRunning && (
          <button
            onClick={onBatchCancel}
            style={{ background: '#451a03', border: '1px solid #7c2d12', color: '#fed7aa', borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', flexShrink: 0 }}
          >
            Stop
          </button>
        )}
        {!isThisBatchRunning && (
          <button
            onClick={onDeleteApp}
            title="Delete project and all files"
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={e => e.currentTarget.style.color = '#475569'}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ padding: '8px 12px 4px', borderBottom: '1px solid #1e293b' }}>
        <div style={{ background: '#0f172a', borderRadius: 2, height: 4 }}>
          <div style={{ background: '#2563eb', height: '100%', width: `${progressPct}%`, borderRadius: 2, transition: 'width 0.5s' }} />
        </div>
        <div style={{ color: '#475569', fontSize: 10, marginTop: 3 }}>{analyzedCount} of {total} done</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {appNodes.length === 0 && (
          <div style={{ color: '#475569', fontSize: 11, padding: '12px 8px' }}>
            No files yet. Add files to start analysis.
          </div>
        )}
        {appNodes.map(node => {
          const { icon, color } = statusIcon(node.data.status)
          const step = stepProgress.get(node.id)
          const isAnalyzing = node.data.status === 'analyzing'
          return (
            <div
              key={node.id}
              onClick={() => onFileClick(node.id)}
              style={{
                padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                background: isAnalyzing ? '#1e3a5f22' : 'transparent',
                border: isAnalyzing ? '1px solid #2563eb33' : '1px solid transparent',
              }}
              onMouseEnter={e => { if (!isAnalyzing) e.currentTarget.style.background = '#1e293b' }}
              onMouseLeave={e => { if (!isAnalyzing) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color, fontSize: 10, flexShrink: 0 }}>{icon}</span>
                <span style={{ color: isAnalyzing ? '#e2e8f0' : '#94a3b8', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {node.data.name}.cbl
                </span>
              </div>
              {isAnalyzing && step && (
                <div style={{ color: '#60a5fa', fontSize: 9, marginLeft: 16, marginTop: 1 }}>
                  Step {step.step} of {step.total}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ padding: '8px', borderTop: '1px solid #334155' }}>
        <button
          onClick={onAddFiles}
          style={{ background: '#334155', border: 'none', borderRadius: 5, color: '#94a3b8', padding: '7px', width: '100%', fontSize: 11, cursor: 'pointer' }}
        >
          + Add Files
        </button>
      </div>
    </div>
  )
}

// ── Main Sidebar component ──────────────────────────────────────────────────

export default function Sidebar({
  nodes,
  selectedAppId,
  onSelectApp,
  onBack,
  onFileClick,
  stepProgress,
  batchAppId,
  onBatchCancel,
  onBatchStarted,
  onDeleteApp,
}) {
  const [applications, setApplications] = useState([])
  const [folderFiles, setFolderFiles] = useState(null)
  const [allFiles, setAllFiles] = useState([])
  const [companionMap, setCompanionMap] = useState(new Map())
  const [defaultFolderName, setDefaultFolderName] = useState('')
  const [uploadError, setUploadError] = useState(null)
  const fileRef = useRef(null)
  const folderRef = useRef(null)

  const loadApps = useCallback(async () => {
    try {
      const apps = await fetchApplications()
      setApplications(apps)
    } catch (err) {
      console.error('Failed to load applications', err)
    }
  }, [])

  useEffect(() => { loadApps() }, [loadApps])

  // Refresh apps list when batch finishes (batchAppId goes from set → null)
  const prevBatchAppId = useRef(batchAppId)
  useEffect(() => {
    if (prevBatchAppId.current !== null && batchAppId === null) loadApps()
    prevBatchAppId.current = batchAppId
  }, [batchAppId, loadApps])

  async function handleFilesSelect(e) {
    const all = Array.from(e.target.files)
    fileRef.current.value = ''
    if (all.length === 0) return

    const { programFiles, companionMap, error } = validateAndGroup(all)
    if (error) { setUploadError(error); return }

    setUploadError(null)
    try {
      for (const file of programFiles) {
        const stem = file.name.replace(/\.(cbl|cob|c)$/i, '')
        const companion = companionMap?.get(stem) ?? null
        await uploadFile(file, selectedAppId, companion)
      }
      await startApplicationAnalysis(selectedAppId, 'sequential')
      onBatchStarted(selectedAppId)
      loadApps()
    } catch (err) {
      setUploadError(err.message)
    }
  }

  function handleFolderSelect(e) {
    const all = Array.from(e.target.files)
    folderRef.current.value = ''
    if (all.length === 0) return

    const { programFiles, companionMap, error } = validateAndGroup(all)
    if (error) { setUploadError(error); return }

    setUploadError(null)
    const folderName = all[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultFolderName(folderName.toUpperCase())
    setFolderFiles(programFiles)
    setAllFiles(all)
    setCompanionMap(companionMap ?? new Map())
  }

  async function handleCreateProject(name) {
    try {
      const app = await createApplication(name.toUpperCase())
      await loadApps()
      onSelectApp(app.id)
    } catch (err) {
      console.error('Failed to create project', err)
    }
  }

  const selectedApp = applications.find(a => a.id === selectedAppId) ?? null

  return (
    <div style={{ width: 160, background: '#1e293b', borderRight: '1px solid #334155', height: '100%', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <input ref={fileRef} type="file" multiple accept=".cbl,.cob,.c,.u,.s" style={{ display: 'none' }} onChange={handleFilesSelect} />
      <input ref={folderRef} type="file" webkitdirectory="" accept=".cbl,.cob,.c,.u,.s" style={{ display: 'none' }} onChange={handleFolderSelect} />
      {uploadError && (
        <div style={{ position: 'absolute', bottom: 48, left: 8, right: 8, background: '#450a0a', border: '1px solid #f87171', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#fca5a5', zIndex: 20 }}
          onClick={() => setUploadError(null)}>
          {uploadError}
        </div>
      )}

      {selectedAppId === null || selectedApp === null ? (
        <ProjectsList
          applications={applications}
          nodes={nodes}
          onSelectApp={onSelectApp}
          onUploadFolder={() => folderRef.current.click()}
          onCreateProject={handleCreateProject}
        />
      ) : (
        <ProjectFiles
          app={selectedApp}
          nodes={nodes}
          stepProgress={stepProgress}
          batchAppId={batchAppId}
          onBack={onBack}
          onFileClick={onFileClick}
          onBatchCancel={onBatchCancel}
          onDeleteApp={async () => {
            if (!window.confirm(`Delete "${selectedApp.name}" and all its files?`)) return
            try {
              await deleteApplication(selectedApp.id)
              onDeleteApp(selectedApp.id)
              loadApps()
            } catch (err) {
              console.error('Delete failed', err)
            }
          }}
          onAddFiles={() => fileRef.current.click()}
        />
      )}

      {folderFiles && (
        <ConfirmationModal
          files={folderFiles}
          companionMap={companionMap}
          defaultName={defaultFolderName}
          onClose={() => { setFolderFiles(null); setAllFiles([]); setCompanionMap(new Map()) }}
          onStarted={(appId) => {
            setFolderFiles(null)
            setAllFiles([])
            setCompanionMap(new Map())
            onBatchStarted(appId)
            loadApps()
          }}
        />
      )}
    </div>
  )
}

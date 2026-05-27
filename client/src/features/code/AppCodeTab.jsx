import { useState, useEffect, useRef } from 'react'
import { Download, Loader2, RefreshCw, Zap, Eye } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { generateFullProgram, getGeneratedCode, generateProjectFiles, previewProgramGeneration } from '@/api/programs.js'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function AppCodeTab({ programs, applicationId, canEdit }) {
  const analyzed = programs.filter(p => p.status === 'analyzed')

  const [selectedId, setSelectedId]         = useState(null)
  const [cache, setCache]                   = useState(new Map()) // id → {generated_code, …}
  const [loadingIds, setLoadingIds]         = useState(new Set())
  const [previewingIds, setPreviewingIds]   = useState(new Set())
  const [generatingIds, setGeneratingIds]   = useState(new Set())
  const [previewMap, setPreviewMap]         = useState(new Map()) // id → preview result
  const [batchConfirm, setBatchConfirm]     = useState(null)     // {totalCost, totalTokens, count}
  const [activeFile, setActiveFile]         = useState('code')
  const [error, setError]                   = useState('')
  const [zipping, setZipping]               = useState(false)

  const fetchedRef = useRef(new Set())

  // ── Load cached generated code on mount ──────────────────────────────────
  useEffect(() => {
    const toFetch = analyzed.filter(p => !fetchedRef.current.has(p.id))
    if (!toFetch.length) return

    toFetch.forEach(p => fetchedRef.current.add(p.id))
    setLoadingIds(prev => new Set([...prev, ...toFetch.map(p => p.id)]))

    Promise.all(
      toFetch.map(p =>
        getGeneratedCode(p.id)
          .then(data => ({ id: p.id, data: data ?? null }))
          .catch(() => ({ id: p.id, data: null }))
      )
    ).then(results => {
      setCache(prev => {
        const m = new Map(prev)
        results.forEach(({ id, data }) => m.set(id, data))
        return m
      })
      setLoadingIds(prev => {
        const s = new Set(prev)
        results.forEach(({ id }) => s.delete(id))
        return s
      })
      setSelectedId(cur => {
        if (cur) return cur
        const withCode = results.find(r => r.data?.generated_code)
        return withCode?.id ?? toFetch[0]?.id ?? null
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzed.map(p => p.id).join(',')])

  // ── Step 1: preview single program ───────────────────────────────────────
  async function handlePreview(programId) {
    setPreviewingIds(prev => new Set([...prev, programId]))
    setError('')
    try {
      const result = await previewProgramGeneration(programId)
      setPreviewMap(prev => new Map(prev).set(programId, result))
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewingIds(prev => { const s = new Set(prev); s.delete(programId); return s })
    }
  }

  function cancelPreview(programId) {
    setPreviewMap(prev => { const m = new Map(prev); m.delete(programId); return m })
  }

  // ── Step 2: generate single program (only after preview confirmed) ────────
  async function handleGenerate(programId) {
    setGeneratingIds(prev => new Set([...prev, programId]))
    setError('')
    try {
      const result = await generateFullProgram(programId, { includeTests: false })
      setCache(prev => new Map(prev).set(programId, {
        generated_code:     result.code     ?? '',
        generated_tests:    result.tests    ?? '',
        generated_language: result.language ?? 'typescript',
        generated_notes:    Array.isArray(result.notes) ? result.notes.join(' · ') : (result.notes ?? ''),
      }))
    } catch (err) {
      setError(err.message)
    } finally {
      setGeneratingIds(prev => { const s = new Set(prev); s.delete(programId); return s })
      setPreviewMap(prev => { const m = new Map(prev); m.delete(programId); return m })
    }
  }

  // ── Batch: preview all un-generated programs, then confirm total cost ─────
  async function handlePreviewAll() {
    setError('')
    setBatchConfirm(null)
    const toPreview = analyzed.filter(
      p => !cache.get(p.id)?.generated_code && !previewMap.has(p.id)
    )
    if (!toPreview.length) return

    setPreviewingIds(prev => new Set([...prev, ...toPreview.map(p => p.id)]))

    const settled = await Promise.allSettled(
      toPreview.map(p =>
        previewProgramGeneration(p.id).then(r => ({ id: p.id, r }))
      )
    )

    setPreviewingIds(prev => {
      const s = new Set(prev)
      toPreview.forEach(p => s.delete(p.id))
      return s
    })

    const newPreviews = new Map()
    let totalCost = 0, totalTokens = 0, firstError = null

    settled.forEach(s => {
      if (s.status === 'fulfilled') {
        const { id, r } = s.value
        newPreviews.set(id, r)
        totalCost   += r.estimatedCostUsd    ?? 0
        totalTokens += r.estimatedTotalTokens ?? 0
      } else {
        firstError ??= s.reason?.message ?? 'Preview failed'
      }
    })

    if (firstError) setError(firstError)
    if (newPreviews.size) {
      setPreviewMap(prev => new Map([...prev, ...newPreviews]))
      setBatchConfirm({ totalCost, totalTokens, count: newPreviews.size })
    }
  }

  async function handleConfirmBatch() {
    setBatchConfirm(null)
    const toGenerate = analyzed.filter(p => previewMap.has(p.id))
    for (const p of toGenerate) {
      await handleGenerate(p.id)
    }
  }

  function cancelBatch() {
    setBatchConfirm(null)
    const toClear = analyzed.filter(p => previewMap.has(p.id) && !cache.get(p.id)?.generated_code)
    setPreviewMap(prev => {
      const m = new Map(prev)
      toClear.forEach(p => m.delete(p.id))
      return m
    })
  }

  // ── Download zip ──────────────────────────────────────────────────────────
  async function handleDownloadZip() {
    setZipping(true); setError('')
    try {
      const { files, warnings } = await generateProjectFiles(applicationId, { includeTests: false })
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      files.forEach(f => zip.file(f.path, f.content))
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

  // ── Derived state ─────────────────────────────────────────────────────────
  const selectedProgram  = analyzed.find(p => p.id === selectedId)
  const selectedCache    = selectedId ? cache.get(selectedId) : undefined
  const hasCode          = !!selectedCache?.generated_code
  const ext              = selectedCache?.generated_language === 'typescript' ? 'ts' : 'js'
  const displayCode      = activeFile === 'tests'
    ? (selectedCache?.generated_tests ?? '')
    : (selectedCache?.generated_code ?? '')

  const generatedCount   = analyzed.filter(p => cache.get(p.id)?.generated_code).length
  const ungeneratedCount = analyzed.filter(p => !cache.get(p.id)?.generated_code).length
  const isPreviewingAny  = previewingIds.size > 0
  const isGeneratingAny  = generatingIds.size > 0
  const allLoading       = loadingIds.size > 0 && cache.size === 0

  const isPreviewing = previewingIds.has(selectedId)
  const isGenerating = generatingIds.has(selectedId)
  const hasPreview   = !isGenerating && previewMap.has(selectedId)

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar ───────────────────────────────────────────────────── */}
      <div className="w-60 border-r border-border flex flex-col shrink-0">

        {/* Actions */}
        <div className="p-3 border-b border-border space-y-2">
          {error && (
            <Alert variant="destructive" className="p-2">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          {canEdit && (
            <Button
              size="sm"
              className="w-full"
              onClick={handlePreviewAll}
              disabled={isPreviewingAny || isGeneratingAny || ungeneratedCount === 0}
            >
              {isPreviewingAny
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Building skeletons…</>
                : isGeneratingAny
                  ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Generating…</>
                  : <><Eye className="mr-2 h-3.5 w-3.5" />Preview all</>
              }
            </Button>
          )}

          <Button
            size="sm" variant="outline" className="w-full"
            onClick={handleDownloadZip}
            disabled={zipping || generatedCount === 0}
          >
            {zipping
              ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Zipping…</>
              : <><Download className="mr-2 h-3.5 w-3.5" />Download .zip</>
            }
          </Button>

          <p className="text-xs text-muted-foreground">
            {allLoading ? 'Loading…' : `${generatedCount} / ${analyzed.length} generated`}
          </p>
        </div>

        {/* Batch confirm banner ── appears after "Preview all" */}
        {batchConfirm && (
          <div className="p-3 border-b border-amber-500/30 bg-amber-500/10 space-y-2">
            <p className="text-xs font-medium">{batchConfirm.count} program{batchConfirm.count !== 1 ? 's' : ''} ready</p>
            <p className="text-xs text-muted-foreground">
              ~{batchConfirm.totalTokens?.toLocaleString()} tokens ·{' '}
              <span className="font-semibold text-foreground">${batchConfirm.totalCost?.toFixed(4)}</span> total
            </p>
            <div className="flex gap-1">
              <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleConfirmBatch}>
                <Zap className="mr-1 h-3 w-3" />Run AI
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelBatch}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Program list */}
        <div className="flex-1 overflow-y-auto">
          {analyzed.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4">No analyzed programs yet.</p>
          ) : (
            analyzed.map(p => {
              const isLoading = loadingIds.has(p.id)
              const isPrev    = previewingIds.has(p.id)
              const isGen     = generatingIds.has(p.id)
              const hasPrev   = previewMap.has(p.id) && !isGen
              const done      = !!cache.get(p.id)?.generated_code
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setActiveFile('code') }}
                  className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center gap-2 transition-colors hover:bg-muted/40 ${selectedId === p.id ? 'bg-muted' : ''}`}
                >
                  {(isLoading || isPrev || isGen)
                    ? <Loader2 className="w-1.5 h-1.5 shrink-0 animate-spin text-muted-foreground" />
                    : <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${done ? 'bg-green-500' : hasPrev ? 'bg-amber-400' : 'bg-border'}`} />
                  }
                  <span className="truncate">{p.name}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {!selectedProgram ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a program from the list
          </div>

        ) : loadingIds.has(selectedId) ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>

        ) : isPreviewing ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Building skeleton…</span>
          </div>

        ) : isGenerating ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">
              Filling {previewMap.get(selectedId)?.holeCount ?? ''} hole{(previewMap.get(selectedId)?.holeCount ?? 0) !== 1 ? 's' : ''} with AI…
            </span>
          </div>

        ) : hasPreview ? (
          <PreviewPanel
            preview={previewMap.get(selectedId)}
            programName={selectedProgram.name}
            onConfirm={() => handleGenerate(selectedId)}
            onCancel={() => cancelPreview(selectedId)}
          />

        ) : !hasCode ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-sm text-muted-foreground">
              No code generated yet for <span className="font-mono">{selectedProgram.name}</span>
            </p>
            {canEdit && (
              <Button onClick={() => handlePreview(selectedId)}>
                <Eye className="mr-2 h-4 w-4" />Preview cost &amp; skeleton
              </Button>
            )}
          </div>

        ) : (
          <div className="flex flex-col h-full">

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 gap-3">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveFile('code')}
                  className={`text-xs font-mono px-2 py-1 rounded transition-colors ${activeFile === 'code' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {selectedProgram.name}.{ext}
                </button>
                {selectedCache?.generated_tests && (
                  <button
                    onClick={() => setActiveFile('tests')}
                    className={`text-xs font-mono px-2 py-1 rounded transition-colors ${activeFile === 'tests' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {selectedProgram.name}.test.{ext}
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => downloadText(
                    displayCode,
                    activeFile === 'tests'
                      ? `${selectedProgram.name}.test.${ext}`
                      : `${selectedProgram.name}.${ext}`
                  )}
                >
                  <Download className="mr-1.5 h-3 w-3" />Download
                </Button>
                {canEdit && (
                  <Button
                    size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => handlePreview(selectedId)}
                    disabled={previewingIds.has(selectedId)}
                  >
                    <RefreshCw className="mr-1.5 h-3 w-3" />Regenerate
                  </Button>
                )}
              </div>
            </div>

            {/* Notes */}
            {selectedCache?.generated_notes && activeFile === 'code' && (
              <div className="px-4 py-2 border-b border-border shrink-0">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Notes: </span>{selectedCache.generated_notes}
                </p>
              </div>
            )}

            {/* Code */}
            <div className="flex-1 overflow-auto">
              <SyntaxHighlighter
                language={selectedCache?.generated_language === 'typescript' ? 'typescript' : 'javascript'}
                style={oneDark}
                customStyle={{ margin: 0, borderRadius: 0, fontSize: '11.5px', lineHeight: 1.6, minHeight: '100%' }}
                showLineNumbers
              >
                {displayCode}
              </SyntaxHighlighter>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── PreviewPanel ─────────────────────────────────────────────────────────────
function PreviewPanel({ preview, programName, onConfirm, onCancel }) {
  const { skeleton, holeCount, estimatedTotalTokens, estimatedCostUsd, hasIR } = preview ?? {}
  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* Cost banner */}
      <div className="px-4 py-3 border-b border-border shrink-0 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Cost estimate</p>
          <p className="text-xs text-muted-foreground">
            {hasIR
              ? <>{holeCount} AI hole{holeCount !== 1 ? 's' : ''} · ~{estimatedTotalTokens?.toLocaleString()} tokens · <span className="font-semibold text-foreground">${estimatedCostUsd?.toFixed(4)}</span></>
              : <>Full-context mode · ~{estimatedTotalTokens?.toLocaleString()} tokens · <span className="font-semibold text-foreground">${estimatedCostUsd?.toFixed(4)}</span></>
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={onConfirm}>
            <Zap className="mr-1.5 h-3.5 w-3.5" />Run AI
          </Button>
        </div>
      </div>

      {/* Skeleton preview — only when IR is available */}
      {skeleton ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <p className="px-4 py-1.5 text-xs text-muted-foreground font-mono border-b border-border shrink-0">
            {programName}.ts — skeleton preview
          </p>
          <div className="flex-1 overflow-auto">
            <SyntaxHighlighter
              language="typescript"
              style={oneDark}
              customStyle={{ margin: 0, borderRadius: 0, fontSize: '11.5px', lineHeight: 1.6, minHeight: '100%' }}
              showLineNumbers
            >
              {skeleton}
            </SyntaxHighlighter>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground text-center max-w-xs leading-relaxed">
            No skeleton available for this program.<br />
            The AI will process the full COBOL source in one pass (full-context mode).
          </p>
        </div>
      )}
    </div>
  )
}

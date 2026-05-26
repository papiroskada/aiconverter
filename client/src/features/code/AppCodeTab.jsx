import { useState, useEffect, useRef } from 'react'
import { Download, Loader2, Play, RefreshCw } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { generateFullProgram, getGeneratedCode, generateProjectFiles } from '@/api/programs.js'
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

  const [selectedId, setSelectedId]       = useState(null)
  const [cache, setCache]                 = useState(new Map()) // id → {generated_code, generated_tests, generated_language, generated_notes} | null
  const [loadingIds, setLoadingIds]       = useState(new Set())
  const [generatingIds, setGeneratingIds] = useState(new Set())
  const [activeFile, setActiveFile]       = useState('code')
  const [error, setError]                 = useState('')
  const [zipping, setZipping]             = useState(false)

  // Track which IDs we've already fetched so we don't re-fetch on every programs update
  const fetchedRef = useRef(new Set())

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
      // Auto-select: first with code, fallback to first program
      setSelectedId(cur => {
        if (cur) return cur
        const withCode = results.find(r => r.data?.generated_code)
        return withCode?.id ?? toFetch[0]?.id ?? null
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzed.map(p => p.id).join(',')])

  async function handleGenerate(programId) {
    setGeneratingIds(prev => new Set([...prev, programId]))
    setError('')
    try {
      const result = await generateFullProgram(programId, { includeTests: false })
      const entry = {
        generated_code:     result.code ?? '',
        generated_tests:    result.tests ?? '',
        generated_language: result.language ?? 'typescript',
        generated_notes:    Array.isArray(result.notes) ? result.notes.join(' · ') : (result.notes ?? ''),
      }
      setCache(prev => new Map(prev).set(programId, entry))
    } catch (err) {
      setError(err.message)
    } finally {
      setGeneratingIds(prev => { const s = new Set(prev); s.delete(programId); return s })
    }
  }

  async function handleGenerateAll() {
    setError('')
    for (const p of analyzed) {
      if (cache.get(p.id)?.generated_code) continue
      await handleGenerate(p.id)
    }
  }

  async function handleDownloadZip() {
    setZipping(true)
    setError('')
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

  const selectedProgram = analyzed.find(p => p.id === selectedId)
  const selectedCache   = selectedId ? cache.get(selectedId) : undefined
  const hasCode         = !!selectedCache?.generated_code
  const ext             = selectedCache?.generated_language === 'typescript' ? 'ts' : 'js'
  const displayCode     = activeFile === 'tests'
    ? (selectedCache?.generated_tests ?? '')
    : (selectedCache?.generated_code ?? '')

  const generatedCount  = analyzed.filter(p => cache.get(p.id)?.generated_code).length
  const isGeneratingAny = generatingIds.size > 0
  const allLoading      = loadingIds.size > 0 && cache.size === 0

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left sidebar ─────────────────────────── */}
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
              onClick={handleGenerateAll}
              disabled={isGeneratingAny || analyzed.length === 0}
            >
              {isGeneratingAny
                ? <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Generating…</>
                : <><Play className="mr-2 h-3.5 w-3.5" />Generate all</>
              }
            </Button>
          )}

          <Button
            size="sm"
            variant="outline"
            className="w-full"
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

        {/* Program list */}
        <div className="flex-1 overflow-y-auto">
          {analyzed.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4">No analyzed programs yet.</p>
          ) : (
            analyzed.map(p => {
              const c          = cache.get(p.id)
              const isLoading  = loadingIds.has(p.id)
              const isGen      = generatingIds.has(p.id)
              const done       = !!c?.generated_code
              return (
                <button
                  key={p.id}
                  onClick={() => { setSelectedId(p.id); setActiveFile('code') }}
                  className={`w-full text-left px-3 py-2 text-xs font-mono flex items-center gap-2 transition-colors hover:bg-muted/40 ${selectedId === p.id ? 'bg-muted' : ''}`}
                >
                  {(isLoading || isGen)
                    ? <Loader2 className="w-1.5 h-1.5 shrink-0 animate-spin text-muted-foreground" />
                    : <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${done ? 'bg-green-500' : 'bg-border'}`} />
                  }
                  <span className="truncate">{p.name}</span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: code viewer ───────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {!selectedProgram ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            Select a program from the list
          </div>

        ) : loadingIds.has(selectedId) ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>

        ) : generatingIds.has(selectedId) ? (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Generating TypeScript…</span>
          </div>

        ) : !hasCode ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <p className="text-sm text-muted-foreground">
              No code generated yet for <span className="font-mono">{selectedProgram.name}</span>
            </p>
            {canEdit && (
              <Button onClick={() => handleGenerate(selectedId)}>
                <Play className="mr-2 h-4 w-4" />Generate TypeScript
              </Button>
            )}
          </div>

        ) : (
          <div className="flex flex-col h-full">

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0 gap-3">
              {/* File tabs */}
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

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
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
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => handleGenerate(selectedId)}
                    disabled={generatingIds.has(selectedId)}
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

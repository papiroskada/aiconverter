import { useState, useEffect } from 'react'
import { Download, Loader2, RefreshCw, Zap } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { generateFullProgram, getGeneratedCode, generateProjectFiles, previewProgramGeneration } from '@/api/programs.js'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'

function ConfidenceBadge({ confidence }) {
  const { score, mechanicalPct, holeCount, flaggedForReview = [] } = confidence
  const criticals = flaggedForReview.filter(f => f.severity === 'critical').length
  const warnings  = flaggedForReview.filter(f => f.severity === 'warning').length
  const color = score >= 80 ? 'text-green-500' : score >= 60 ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted-foreground">
      <span className={`font-semibold ${color}`}>{score}% confidence</span>
      {mechanicalPct != null && <span>{mechanicalPct}% mechanical</span>}
      {holeCount > 0 && <span>{holeCount} AI hole{holeCount !== 1 ? 's' : ''}</span>}
      {criticals > 0 && <span className="text-red-400">{criticals} critical</span>}
      {warnings  > 0 && <span className="text-amber-400">{warnings} warning{warnings !== 1 ? 's' : ''}</span>}
    </div>
  )
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function CodeTab({ programId, programName, applicationId, canEdit }) {
  const [status, setStatus]         = useState('idle')
  const [code, setCode]             = useState('')
  const [tests, setTests]           = useState('')
  const [language, setLanguage]     = useState('typescript')
  const [notes, setNotes]           = useState('')
  const [error, setError]           = useState('')
  const [verification, setVerification] = useState(null)
  const [includeTests, setIncludeTests] = useState(false)
  const [activeFile, setActiveFile] = useState('code')
  const [zipping, setZipping]       = useState(false)
  const [preview, setPreview]       = useState(null)

  useEffect(() => {
    getGeneratedCode(programId).then(cached => {
      if (!cached) return
      setCode(cached.generated_code ?? '')
      setTests(cached.generated_tests ?? '')
      setLanguage(cached.generated_language ?? 'typescript')
      setNotes(cached.generated_notes ?? '')
      if (cached.generated_code) setStatus('done')
    }).catch(() => {})
  }, [programId])

  async function handlePreview() {
    setStatus('previewing'); setError('')
    try {
      const result = await previewProgramGeneration(programId)
      setPreview(result)
      setLanguage(result.language ?? 'typescript')
      setStatus('preview')
    } catch (err) {
      setError(err.message); setStatus('error')
    }
  }

  async function handleGenerate() {
    setStatus('generating'); setError(''); setTests(''); setVerification(null); setActiveFile('code')
    try {
      const result = await generateFullProgram(programId, { includeTests })
      setCode(result.code ?? '')
      setLanguage(result.language ?? 'typescript')
      setNotes(Array.isArray(result.notes) ? result.notes.join(' · ') : (result.notes ?? ''))
      if (result.tests) setTests(result.tests)
      if (result.verificationReport) setVerification(result.verificationReport)
      setStatus('done')
    } catch (err) {
      setError(err.message); setStatus('error')
    }
  }

  async function handleDownloadZip() {
    setZipping(true)
    try {
      const { files, warnings } = await generateProjectFiles(applicationId, { includeTests: false })
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      for (const f of files) zip.file(f.path, f.content)
      if (warnings?.length) zip.file('WARNINGS.txt', warnings.join('\n'))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'project.zip'; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message)
    } finally {
      setZipping(false)
    }
  }

  const ext = language === 'typescript' ? 'ts' : 'js'
  const hasTests = status === 'done' && !!tests

  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          Generate a TypeScript/JavaScript module from the COBOL analysis.
        </p>
        {canEdit && <Button onClick={handlePreview}>Preview cost &amp; skeleton</Button>}
        {!canEdit && <p className="text-xs text-muted-foreground">Code generation requires developer role.</p>}
      </div>
    )
  }

  if (status === 'previewing') {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Building skeleton…</span>
      </div>
    )
  }

  if (status === 'preview') {
    const { skeleton, holeCount, estimatedTotalTokens, estimatedCostUsd, hasIR } = preview ?? {}
    const ext = language === 'typescript' ? 'ts' : 'js'
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
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
            <div className="flex items-center gap-2">
              <Checkbox id="inc-tests-prev" checked={includeTests} onCheckedChange={setIncludeTests} />
              <Label htmlFor="inc-tests-prev" className="text-sm cursor-pointer">Include tests</Label>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setStatus('idle'); setPreview(null) }}>Cancel</Button>
            <Button size="sm" onClick={handleGenerate}>
              <Zap className="mr-1.5 h-3.5 w-3.5" />Run AI
            </Button>
          </div>
        </div>

        {skeleton && (
          <>
            <p className="text-xs text-muted-foreground font-mono">{programName}.{ext} — skeleton preview</p>
            <div className="rounded-md overflow-hidden border border-border text-xs max-h-[55vh] overflow-y-auto">
              <SyntaxHighlighter
                language="typescript"
                style={oneDark}
                customStyle={{ margin: 0, borderRadius: 0, fontSize: '11.5px', lineHeight: 1.6, background: 'transparent' }}
                showLineNumbers
              >
                {skeleton}
              </SyntaxHighlighter>
            </div>
          </>
        )}
      </div>
    )
  }

  if (status === 'generating') {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Filling {preview?.holeCount ?? ''} hole{(preview?.holeCount ?? 0) !== 1 ? 's' : ''} with AI…</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="space-y-4 py-8">
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        {canEdit && <Button onClick={handlePreview} variant="outline">Retry</Button>}
      </div>
    )
  }

  // status === 'done'
  const displayCode = activeFile === 'tests' ? tests : code
  const filename    = activeFile === 'tests' ? `${programName}.test.${ext}` : `${programName}.${ext}`

  return (
    <div className="space-y-3">
      {/* File tabs */}
      {hasTests ? (
        <Tabs value={activeFile} onValueChange={setActiveFile}>
          <TabsList className="h-8">
            <TabsTrigger value="code" className="text-xs h-7">{programName}.{ext}</TabsTrigger>
            <TabsTrigger value="tests" className="text-xs h-7">{programName}.test.{ext}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : (
        <p className="text-xs text-muted-foreground font-mono">{programName}.{ext}</p>
      )}

      {/* Code viewer */}
      <div className="rounded-md overflow-hidden border border-border text-xs max-h-[55vh] overflow-y-auto">
        <SyntaxHighlighter
          language={language === 'typescript' ? 'typescript' : 'javascript'}
          style={oneDark}
          customStyle={{ margin: 0, borderRadius: 0, fontSize: '11.5px', lineHeight: 1.6, background: 'transparent' }}
          showLineNumbers
        >
          {displayCode}
        </SyntaxHighlighter>
      </div>

      {/* Confidence */}
      {verification?.confidence && activeFile === 'code' && (
        <ConfidenceBadge confidence={verification.confidence} />
      )}

      {/* Notes */}
      {notes && activeFile === 'code' && (
        <p className="text-xs text-muted-foreground"><span className="font-medium">Notes:</span> {notes}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={() => downloadText(displayCode, filename)}>
          <Download className="mr-2 h-3.5 w-3.5" />{filename}
        </Button>
        {applicationId && (
          <Button size="sm" variant="outline" onClick={handleDownloadZip} disabled={zipping}>
            {zipping ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
            project.zip
          </Button>
        )}
        {canEdit && (
          <Button size="sm" variant="ghost" onClick={() => { setStatus('idle'); setPreview(null); setVerification(null) }} className="ml-auto">
            <RefreshCw className="mr-2 h-3.5 w-3.5" />Regenerate
          </Button>
        )}
      </div>
    </div>
  )
}

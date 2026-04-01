# Progress Tracking & Backend Logging — Design Spec

**Date:** 2026-03-24
**Status:** Draft

---

## Overview

Add detailed analysis progress tracking to the COBOL converter: structured colored console logging on the backend and a real-time progress bar + log feed in the Detail Panel on the frontend.

---

## Goals

- Show users exactly what stage file processing is at (parsing, metadata, each chunk, synthesis)
- Surface chunk-level errors (e.g. AI token limit exceeded) without stopping the overall analysis
- Add structured, colored backend console logs for development/debugging
- No new dependencies (use `picocolors` already in project)

## Non-Goals

- WebSocket-based log streaming (SSE is sufficient)
- Persistent log storage in the database
- Log levels/filtering (no verbose/debug/info distinction in v1)

---

## Architecture

### Backend: Logger Module

New file: `server/src/logger.js`

A stateless utility that wraps `picocolors` to produce timestamped, colored console output.

**Output format:**
```
[12:34:01] [ARERCD] ▶ Parsing COBOL file...
[12:34:01] [ARERCD] ✓ Parsed 47 chunks (230ms)
[12:34:01] [ARERCD] ▶ Analyzing metadata...
[12:34:02] [ARERCD] ✓ Metadata done (980ms)
[12:34:02] [ARERCD] ▶ Chunk 1/47: WORKING-STORAGE...
[12:34:04] [ARERCD] ✓ Chunk 1/47 done (1840ms)
[12:34:07] [ARERCD] ✗ Chunk 3/47 failed: context length exceeded (2000ms)
[12:34:12] [ARERCD] ✓ Analysis complete (42s total)
```

**Color scheme:**
- Timestamp: grey
- Program name in brackets: cyan
- `▶` (start): yellow
- `✓` (success): green
- `✗` (error): red

**API:**
```js
logger.start(programName, message)                   // ▶ yellow, no duration
logger.done(programName, message, durationMs)        // ✓ green
logger.error(programName, message, durationMs)       // ✗ red
```

`durationMs` is optional on `done` and `error` — logger renders it as `(Xms)` when present, omits it when absent.

### Backend: New SSE Event `progress`

The `progress` event is emitted alongside console logs from the orchestrator. Frontend listens to it for UI updates.

**Shape:**
```json
{
  "stage": "parsing" | "metadata" | "chunk" | "synthesis" | "failed",
  "message": "string",
  "chunkIndex": 3,
  "total": 47,
  "durationMs": 1840
}
```

`chunkIndex` and `total` are only present when `stage === "chunk"`. `durationMs` is present on completion/failure events, absent on "starting" events.

> Note: `stage: "done"` is not used in `progress` events — the existing `done` SSE event already signals completion to the frontend.

### Backend: `runAnalysis` signature change

`programName` must be added to the `runAnalysis` parameter object so the orchestrator can log under the correct program name:

```js
// Before
runAnalysis({ cobolText, chunks, provider, emit })

// After
runAnalysis({ cobolText, chunks, provider, emit, programName })
```

Both call sites in `analysisService.js` (`uploadAndStartAnalysis` and `reanalyze`) already have `programName` available and must pass it through.

### Backend: `logAndEmit` helper in orchestrator

A local helper inside `orchestrator.js` that calls `logger.*` and `emit('progress', ...)` together:

```js
function logAndEmit(emit, programName, type, data) {
  logger[type](programName, data.message, data.durationMs)
  emit('progress', data)
}
```

**Emit points:**

| Location | stage | type | message example |
|----------|-------|------|-----------------|
| `analysisService` — before `parseCobol` | `parsing` | `start` | `Parsing COBOL file...` |
| `analysisService` — after `insertChunks` | `parsing` | `done` | `Parsed N chunks` |
| `orchestrator` — before metadata AI call | `metadata` | `start` | `Analyzing metadata...` |
| `orchestrator` — after metadata AI call | `metadata` | `done` | `Metadata done` |
| `orchestrator` — before each chunk | `chunk` | `start` | `Chunk 1/47: MAIN-LOGIC...` |
| `orchestrator` — after each chunk success | `chunk` | `done` | `Chunk 1/47 done` |
| `orchestrator` — after each chunk failure | `chunk` | `error` | `Chunk 1/47 failed: <error>` |
| `orchestrator` — before synthesis | `synthesis` | `start` | `Synthesizing summary...` |
| `orchestrator` — after synthesis | `synthesis` | `done` | `Synthesis done` |
| `analysisService` — catch block | `failed` | `error` | `Analysis failed: <error>` |

Note: parsing events are emitted from `analysisService.js` (before/after the `parseCobol` + `insertChunks` calls), while metadata/chunk/synthesis events come from `orchestrator.js`.

### Backend: `reanalyze` path

`reanalyze()` calls `runAnalysisInBackground` with `retryChunks` (from `getRetryableChunks`) — only pending/failed chunks, not all chunks. Progress events fire identically to the initial analysis path. The `total` value in `progress` events reflects the number of retryable chunks (e.g. `5` if 5 chunks failed), not the original total. This is acceptable behavior for v1.

### Backend: chunk error reporting

`chunk_failed` SSE events (emitted by orchestrator line 16) remain backend-only — they are persisted to the DB via `markChunkFailed` but are **not** added to the frontend listener list. The frontend receives chunk error information exclusively through the `progress` event with `stage: "chunk"` and an error message. This avoids duplicating error handling logic on the client side.

---

## Frontend

### `App.jsx` changes

1. **Remove the existing progress toast** (`{progress && <div>...</div>}`) — it is superseded by the Detail Panel progress UI.
2. **Remove `progress` state** (`useState(null)`) and the `setProgress(...)` calls.
3. **Accumulate `progress` events** into a new state array `progressEvents`, and track `progressForId` separately from `analyzingId`. `progressForId` persists after failure so DetailPanel can still show the error log; `analyzingId` is cleared on both `done` and `failed` (it only controls the SSE connection).

```js
const [progressEvents, setProgressEvents] = useState([])
const [progressForId, setProgressForId] = useState(null)

useSSE(analyzingId, (event, data) => {
  if (event === 'progress') {
    setProgressEvents(prev => [...prev, data])
  }
  if (event === 'done') {
    markAnalyzed(analyzingId)
    setAnalyzingId(null)
    setProgressForId(null)  // clear — progress UI disappears after success
    setProgressEvents([])
    refresh()
  }
  if (event === 'failed') {
    setAnalyzingId(null)
    // Do NOT clear progressForId or progressEvents — DetailPanel shows the final error log
    refresh()
  }
})
```

4. Update `handleUploaded` — remove the `setProgress(...)` call (state no longer exists) and initialize both new state variables:

```js
const handleUploaded = useCallback(async (program) => {
  setAnalyzingId(program.id)
  setProgressForId(program.id)
  setProgressEvents([])   // clear stale events from any previous run
  await refresh()
  markAnalyzing(program.id)
}, [markAnalyzing, refresh])
```

5. Pass `progressForId` and `progressEvents` to DetailPanel:
```jsx
<DetailPanel
  programId={selectedId}
  progressForId={progressForId}
  progressEvents={progressEvents}
  onClose={() => setSelectedId(null)}
  onNavigate={(id) => setSelectedId(id)}
/>
```

This approach reuses the existing SSE connection in App.jsx — no second EventSource is opened.

**Known limitation:** The very first `progress` event (parsing start) may occasionally be dropped if the `EventSource` connection opens after the server has already emitted it. This is an inherent SSE race and is acceptable in v1 — the log feed will simply start from the second event. Do not add reconnection/buffering logic to fix this.

### `useSSE.js`

Add `progress` to the list of listened event types:
```js
;['chunk_done', 'metadata', 'done', 'failed', 'progress'].forEach(...)
```

### `DetailPanel.jsx` changes

**New props:** `progressForId`, `progressEvents`

**When to show progress UI:** `programId === progressForId && progressEvents.length > 0`.

`progressForId` is separate from `analyzingId` — it persists after failure (while `analyzingId` is cleared), keeping the error log visible.

**Progress bar:** Derived from the latest `chunk`-stage event in `progressEvents`. Shows `chunkIndex / total` percent when chunk events are present; shows an indeterminate pulsing bar with the latest event message otherwise.

**Log feed:** A scrollable `<div>` built from all `progressEvents`. Each entry maps to an icon based on the event payload:
- message includes 'failed' or `stage === 'failed'` → `✗` red
- `durationMs` present → `✓` green
- otherwise → `▶` grey

Auto-scroll to bottom: use a `ref` on the log container and call `ref.current.scrollTop = ref.current.scrollHeight` inside a `useEffect` that depends on `progressEvents.length`.

**Late-join behavior:** If the user opens the Detail Panel mid-analysis, `progressEvents` already contains all accumulated events since upload started (they live in `App.jsx` state). The log feed shows the full history from the beginning.

**After analysis ends:**
- `done` event: `progressForId` becomes `null` in App.jsx → `programId === progressForId` is false → progress UI disappears, normal tabs shown.
- `failed` event: `analyzingId` becomes `null` but `progressForId` and `progressEvents` are NOT cleared → progress UI remains visible with the final red error entry. Tabs are still accessible.

---

## Error Handling

- **Chunk-level errors** (e.g. token limit, AI timeout): logged as `✗` in log feed, analysis continues for remaining chunks. Error message comes from the `progress` event with `stage: "chunk"`.
- **Fatal errors** (e.g. file read failure, DB error): catch block in `analysisService.js` emits `progress` with `stage: "failed"` before the existing `failed` SSE event fires. Log feed shows final red entry.

---

## Files Changed

| File | Change |
|------|--------|
| `server/src/logger.js` | New — colored console logger |
| `server/src/ai/orchestrator.js` | Add `programName` param, add `logAndEmit` calls |
| `server/src/services/analysisService.js` | Pass `programName` to `runAnalysis`, add parsing log+emit, add failed log+emit |
| `client/src/hooks/useSSE.js` | Add `progress` to listened events |
| `client/src/App.jsx` | Remove toast, accumulate `progressEvents`, pass to DetailPanel |
| `client/src/components/Panel/DetailPanel.jsx` | Add progress bar + log feed UI |

---

## Testing

- Logger: manual visual check (colors, format) — no unit tests needed for a thin formatting wrapper
- Orchestrator: existing unit tests cover analysis flow; add assertions that `emit` is called with `progress` events at each step, and that `programName` is included in orchestrator params
- DetailPanel: add test that progress bar and log entries render when `programId === analyzingId` and `progressEvents` is non-empty

# Block Diagram Tab & Phantom Nodes — Design Spec

**Date:** 2026-03-24
**Status:** Draft

---

## Overview

Two features:
1. **Block Diagram Tab** — a new "Diagram" tab in the Detail Panel renders an AI-generated Mermaid flowchart of the program's business logic. Generated once during analysis (after synthesis), stored in the DB.
2. **Phantom Nodes** — programs referenced in external calls but not yet uploaded are already created as `status=pending` DB records by the existing `graphService`. This feature surfaces them visually: dashed node style on the graph, non-clickable, and proper labeling in the Connections tab.

---

## Goals

- Show business logic visually as a flowchart without reading long text
- Make it clear which programs are referenced but not yet analyzed
- Change the app font to Inter (sans-serif, rounded, readable on dark backgrounds)

## Non-Goals

- Multiple diagram types / diagram regeneration on demand
- Diagram editing or export
- Uploading a specific file for a phantom program from the Detail Panel (v1: drag-drop upload is sufficient)

---

## Architecture

### Backend: Block Diagram

#### DB schema

New column in `program_analysis`:
```sql
ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS diagram TEXT;
```
Added to `schema.sql` after the existing CREATE TABLE (safe to re-run on existing databases).

#### New prompt: `DIAGRAM_PROMPT`

Added to `server/src/ai/prompts.js`:
```js
export const DIAGRAM_PROMPT = (summary) => `
You are analyzing a COBOL business application.
Based on the following program summary, create a Mermaid flowchart of the business logic flow.

Rules:
- Use flowchart TD syntax
- Maximum 15 nodes
- Show business events and decisions only — no COBOL variable names, no technical internals
- Use plain business language (e.g. "Validate Customer" not "PERFORM VALIDATE-CUST-PARA")
- Return ONLY the Mermaid code — no explanation, no markdown fences

PROGRAM SUMMARY:
${summary}
`
```

#### Provider method: `generateDiagram(summary)`

Added to `BaseProvider` (abstract), `ClaudeProvider`, and `OpenAIProvider`.

- Returns a plain string (raw Mermaid code) — **not JSON**.
- **Must NOT reuse the existing `#callClaude` / `#callOpenAI` private helpers** — those unconditionally call `JSON.parse()` on the response, which will throw on Mermaid text. `OpenAIProvider` also passes `response_format: { type: 'json_object' }` which forces JSON output.
- Each provider implements `generateDiagram` with its own raw-text API call (no `response_format`, no JSON parse).
- If the AI call fails: catch and return `null` (diagram stays null in DB, analysis is not interrupted).

#### `orchestrator.js` changes

After synthesis, add a diagram generation step:
```js
// Step 4: generate diagram
const td = Date.now()
logAndEmit(emit, programName, 'start', { stage: 'diagram', message: 'Generating diagram...' })
let diagram = null
try {
  diagram = await provider.generateDiagram(summary)
  logAndEmit(emit, programName, 'done', { stage: 'diagram', message: 'Diagram done', durationMs: Date.now() - td })
} catch (err) {
  logAndEmit(emit, programName, 'error', { stage: 'diagram', message: `Diagram failed: ${err.message}`, durationMs: Date.now() - td })
}

return { metadata, chunkResults, summary, diagram }
```

#### `analysisService.js` changes

Update the import line to include `updateDiagram`:
```js
import { upsertAnalysis, updateDescription, updateDiagram } from '../models/programAnalysis.js'
```

Update the destructuring of `runAnalysis` return value to include `diagram`, then save it:
```js
// Change existing destructuring:
const { metadata, chunkResults, summary, diagram } = await runAnalysis(...)

// After updateDescription:
if (diagram != null) await updateDiagram(programId, diagram)
```

Skipping `updateDiagram` when `diagram` is `null` preserves any previously saved diagram on re-analysis. If no diagram was ever saved, the column stays null.

#### `programAnalysis.js` changes

New function:
```js
export async function updateDiagram(program_id, diagram) {
  await pool.query(
    'UPDATE program_analysis SET diagram = $1, updated_at = NOW() WHERE program_id = $2',
    [diagram, program_id]
  )
}
```

The existing `GET /api/programs/:id` response already includes the full `analysis` row — `diagram` field appears automatically once the column exists.

---

### Backend: Phantom Nodes

The backend is **already complete**:
- `graphService.updateGraphAfterAnalysis` creates `pending` program records for unknown external call targets
- `upsertEdge` stores `to_program_id` (set, not null) immediately
- `uploadAndStartAnalysis` → `findProgramByName` → finds the existing pending record and updates it
- `backfillEdgesForNewProgram` → `backfillPhantomEdges` updates any older null edges

One small change needed: `getEdgesForProgram` must also return the status of the target program so the frontend can distinguish pending targets:

```sql
-- Add to existing SELECT in getEdgesForProgram:
tp.status AS to_program_status
```

---

## Frontend

### Font

Add Inter to `client/index.html` via Google Fonts CDN, set globally in CSS:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
```
```css
/* in index.css or inline style on #root */
font-family: 'Inter', system-ui, sans-serif;
```

### Block Diagram Tab

**New dependency:** `mermaid` (npm package, ~600KB, client-side rendering)

**`DetailPanel.jsx`:**
- Add `'Diagram'` to `TABS` array: `const TABS = ['Overview', 'Logic Blocks', 'Connections', 'Diagram']`
- Import `DiagramTab`: `import DiagramTab from './DiagramTab.jsx'`
- Add render line inside the content block alongside existing tab conditionals:
  ```jsx
  {tab === 'Diagram' && <DiagramTab analysis={program.analysis} />}
  ```

**New file: `DiagramTab.jsx`**

```jsx
import { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

let mermaidInitialized = false

export default function DiagramTab({ analysis }) {
  const ref = useRef(null)
  const renderIdRef = useRef(0)

  useEffect(() => {
    if (!mermaidInitialized) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark' })
      mermaidInitialized = true
    }
  }, [])

  useEffect(() => {
    if (!analysis?.diagram || !ref.current) return
    // Use a unique ID per render to avoid Mermaid's duplicate-ID error
    const id = `mermaid-diagram-${++renderIdRef.current}`
    mermaid.render(id, analysis.diagram).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg
    }).catch(() => {
      if (ref.current) ref.current.innerHTML = '<p style="color:#f87171">Failed to render diagram</p>'
    })
  }, [analysis?.diagram])

  if (!analysis) return <p style={{ color: '#64748b' }}>Loading…</p>
  if (!analysis.diagram) return <p style={{ color: '#64748b' }}>Diagram not available.</p>

  return <div ref={ref} style={{ overflowX: 'auto' }} />
}
```

**SSE progress:** `useSSE.js` already listens to all events. The new `diagram` stage events work automatically — `progressEvents` will include them and display in the Detail Panel log feed.

### Phantom Nodes

**`usePrograms.js:buildNodes`**

Change `isPhantom: false` → `isPhantom: p.status === 'pending'` for real nodes:
```js
data: { name: p.name, status: p.status, isPhantom: p.status === 'pending' }
```

The frontend-only phantom nodes from `edges.filter(e => !e.to)` remain as fallback (system calls or edge race conditions), they already have `isPhantom: true`.

**`App.jsx:onNodeClick`**

Prevent opening Detail Panel for phantom nodes:
```jsx
onNodeClick={(node) => { if (!node.data.isPhantom) setSelectedId(node.id) }}
```

**`ConnectionsTab.jsx`**

Use `to_program_status` (now returned by the API) to show "(not analyzed)" label and prevent navigation for pending targets:
```jsx
// In "Calls" section:
const isPending = e.to_program_status === 'pending'
const isUnknown = !e.to_program_id  // old-style: truly not uploaded
onClick={() => !isPending && !isUnknown && onNavigate(e.to_program_id)}
// badge: show "not analyzed" when isPending, "not uploaded" when isUnknown
{isPending && <span style={pendingBadgeStyle}>not analyzed</span>}
{isUnknown && <span style={pendingBadgeStyle}>not uploaded</span>}
```

**`ProgramGraph.jsx` — legend**

Small legend in the bottom-left corner (absolute positioned, doesn't interfere with ReactFlow controls):
```jsx
const LEGEND = [
  { color: '#4ade80', label: 'Analyzed' },
  { color: '#60a5fa', label: 'Analyzing' },
  { color: '#f87171', label: 'Failed' },
  { color: '#475569', label: 'Pending', dashed: true },
]
```

---

## Error Handling

- **Diagram AI failure:** caught in orchestrator, logs `✗ Diagram failed`, emits `progress` error event, stores `null` in DB. Analysis completes normally. DiagramTab shows "Diagram not available."
- **Mermaid render failure:** caught in DiagramTab useEffect, shows red error message inline.
- **Phantom node click:** prevented in `onNodeClick` — no panel opens, no error.

---

## Files Changed

| File | Change |
|------|--------|
| `server/src/db/schema.sql` | Add `ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS diagram TEXT` |
| `server/src/ai/prompts.js` | Add `DIAGRAM_PROMPT` |
| `server/src/ai/providers/base.js` | Add abstract `generateDiagram` |
| `server/src/ai/providers/claude.js` | Implement `generateDiagram` |
| `server/src/ai/providers/openai.js` | Implement `generateDiagram` |
| `server/src/ai/orchestrator.js` | Add diagram generation step after synthesis |
| `server/src/models/programAnalysis.js` | Add `updateDiagram` function |
| `server/src/services/analysisService.js` | Call `updateDiagram` after `updateDescription` |
| `server/src/models/programEdges.js` | Add `tp.status AS to_program_status` to `getEdgesForProgram` query |
| `client/index.html` | Add Inter Google Font link |
| `client/src/main.jsx` or `index.css` | Set `font-family: 'Inter'` globally |
| `client/package.json` | Add `mermaid` dependency |
| `client/src/components/Panel/DetailPanel.jsx` | Add `'Diagram'` tab |
| `client/src/components/Panel/DiagramTab.jsx` | New — Mermaid rendering component |
| `client/src/components/Panel/ConnectionsTab.jsx` | Use `to_program_status` for pending badge/nav guard |
| `client/src/hooks/usePrograms.js` | Set `isPhantom: p.status === 'pending'` for pending programs |
| `client/src/App.jsx` | Guard `onNodeClick` for phantom nodes |
| `client/src/components/Graph/ProgramGraph.jsx` | Add legend |

---

## Testing

- **DiagramTab:** unit test — renders SVG when `analysis.diagram` is present, shows "not available" message when null
- **Phantom nodes:** unit test — `isPhantom: true` nodes in ProgramNode render with `border-style: dashed`; click handler in App doesn't call `setSelectedId` for phantom nodes
- **ConnectionsTab:** unit test — edges with `to_program_status === 'pending'` show the badge and do not trigger `onNavigate` on click
- **Orchestrator:** add assertion that `emit` is called with `stage: 'diagram'` progress events, and that `diagram` is in the return value
- **`generateDiagram` failure:** orchestrator test confirms diagram failure does not throw — `diagram: null` is returned, analysis completes

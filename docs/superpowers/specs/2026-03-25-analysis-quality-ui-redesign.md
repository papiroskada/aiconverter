# Analysis Quality & UI Redesign — Design Spec

**Date:** 2026-03-25
**Status:** Draft

---

## Overview

Three related improvements:

1. **Better analysis data** — fix chunk prompts to distinguish external CALL from internal PERFORM, restrict DB ops to EXEC SQL only, aggregate external_calls and db_tables from all chunks into program_analysis.
2. **Tab restructure** — remove Logic Blocks tab, move diagram into Overview, add Data tab for DB tables, split Connections into graph-edges + external-calls sections.
3. **Resizable panel** — drag the left edge of the Detail Panel to resize it.

---

## Goals

- External calls list is accurate and complete (all CALL statements, not just from the header)
- DB tables list contains only real SQL tables, not hallucinated names
- Description is short and factual (2-3 sentences)
- UI shows exactly what a developer needs to rewrite the program in JS
- Panel width is adjustable and remembered across sessions

## Non-Goals

- Re-running analysis on existing programs automatically (user triggers re-analysis manually)
- Editing analysis data in the UI
- Exporting analysis to file

---

## Architecture

### Backend

#### Prompt changes

**`CHUNK_PROMPT`** — two targeted fixes:

`calls` — only `CALL 'literal' USING parameter` statements, never `PERFORM`:
```json
"calls": [{ "program": "c_writelnkarea", "using": "PGM-NM" }]
```
Instruction added to prompt: "Include ONLY external CALL statements (`CALL 'name' USING ...`). Do NOT include PERFORM statements — those are internal paragraph calls, not external programs."

`db_ops` — only from `EXEC SQL ... END-EXEC` blocks:
```json
"db_ops": [{ "table": "TABLE-NAME", "operation": "READ|WRITE|READ/WRITE|DELETE", "fields": ["FIELD"] }]
```
Instruction added: "Extract ONLY from `EXEC SQL ... END-EXEC` blocks. Do NOT infer table names from variable names or context."

**`SYNTHESIS_PROMPT`** — add `description` to the return schema:
```
Also return a "description" field: 2-3 factual sentences, no filler phrases
("This program...", "The purpose of..."). State what the program receives,
what it does, and what it calls or queries.
```
Return schema changes from `{ "summary": "..." }` to:
```json
{ "summary": "...", "description": "..." }
```
No changes needed in `ClaudeProvider` or `OpenAIProvider` — `synthesize()` is a passthrough that returns the parsed JSON directly, so it automatically returns both fields once the prompt changes.

Note: `METADATA_PROMPT` is unchanged — it still runs on the first 100 lines and populates `call_parameters`. Its `external_calls` and `db_tables` are written first by `upsertAnalysis`, then overwritten by the aggregation step. This transient inconsistency (old shape briefly in DB) is acceptable — the aggregation step always runs immediately after analysis completes.

#### Aggregation in `orchestrator.js`

After all chunks are analyzed (Step 2), before synthesis (Step 3), aggregate deterministically in code:

```js
// Aggregate external calls — deduplicate by program name
const callMap = new Map()
for (const { analysis } of chunkResults) {
  for (const c of (analysis?.calls ?? [])) {
    if (c?.program && !callMap.has(c.program)) callMap.set(c.program, c)
  }
}
const external_calls = [...callMap.values()]

// Aggregate DB tables — merge fields and ops by table name
const tableMap = new Map()
for (const { analysis } of chunkResults) {
  for (const op of (analysis?.db_ops ?? [])) {
    if (!op?.table || op.table === 'unknown') continue
    if (!tableMap.has(op.table)) tableMap.set(op.table, { table: op.table, operations: new Set(), fields: new Set() })
    const entry = tableMap.get(op.table)
    entry.operations.add(op.operation)
    for (const f of (op.fields ?? [])) entry.fields.add(f)
  }
}
const db_tables = [...tableMap.values()].map(e => ({
  table: e.table,
  operation: [...e.operations].join('/'),
  fields: [...e.fields],
}))
```

Return value expanded:
```js
return { metadata, chunkResults, summary, description, diagram, external_calls, db_tables }
```

#### `analysisService.js` changes

Destructure new fields and save them. Design: `updateDescription` is called with the factual `description` (replaces old call with `summary`). A new `updateAnalysisFields` saves the aggregated arrays. The `reanalyze` path calls `runAnalysisInBackground` unchanged — it inherits the new return value automatically.

```js
const { metadata, chunkResults, summary, description, diagram, external_calls, db_tables } = await runAnalysis(...)

// Save synthesis description (replaces old: updateDescription(programId, summary))
await updateDescription(programId, description ?? summary)

// Save aggregated arrays
await updateAnalysisFields(programId, { external_calls, db_tables })

// Save diagram (unchanged)
if (diagram != null) await updateDiagram(programId, diagram)
```

`updateDescription` import and call signature are unchanged — it still writes to the `description` column, just now receives the factual short text instead of the long summary. `summary` is only used locally for diagram generation.

Also update `analysisService.js` to pass `external_calls` (aggregated, shape `{ program, using }`) to `updateGraphAfterAnalysis` instead of `metadata.external_calls` (old shape `{ program_name, context, is_system_call }`):

```js
// Change existing call:
await updateGraphAfterAnalysis(programId, external_calls)
// was: await updateGraphAfterAnalysis(programId, metadata.external_calls)
```

#### `programAnalysis.js` changes

New function `updateAnalysisFields`:
```js
export async function updateAnalysisFields(program_id, { external_calls, db_tables }) {
  await pool.query(
    `UPDATE program_analysis
     SET external_calls = $1, db_tables = $2, updated_at = NOW()
     WHERE program_id = $3`,
    [JSON.stringify(external_calls), JSON.stringify(db_tables), program_id]
  )
}
```

#### `graphService.js` changes

`updateGraphAfterAnalysis` currently reads `call.program_name` and skips `call.is_system_call`. After the schema change the shape is `{ program, using }` — no `is_system_call` field:

```js
// Before:
if (call.is_system_call) continue
const name = call.program_name

// After:
const name = call.program
if (!name) continue
```

The `is_system_call` filter is removed — all CALL statements are now treated as potential graph nodes. System utility calls (like `c_writelnkarea`) will create phantom nodes, which is correct behavior: they appear on the graph as pending nodes until uploaded.

---

### Frontend

#### Tab structure

```js
const TABS = ['Overview', 'Connections', 'Data']
```

Remove: `Logic Blocks` tab, `Diagram` tab.

#### `OverviewTab.jsx`

Sections (top to bottom):
1. **Description** — `analysis.description` text
2. **Call Parameters** — existing rendering (unchanged)
3. **Diagram** — mermaid rendering moved here from `DiagramTab.jsx`, with a fullscreen button

State added to `OverviewTab`:
```js
const [fullscreen, setFullscreen] = useState(false)
const inlineRef = useRef(null)
const fullscreenRef = useRef(null)
const renderIdRef = useRef(0)
```

Mermaid initialization (same `mermaidInitialized` flag from `DiagramTab`) and render logic move here. The diagram is rendered into whichever ref is currently active. A `useEffect` on `[analysis?.diagram, fullscreen]` handles both cases: render inline when not fullscreen, re-render into the fullscreen container when `fullscreen` becomes true (mermaid requires an explicit `render()` call — toggling state alone does not re-render):

```js
useEffect(() => {
  const target = fullscreen ? fullscreenRef.current : inlineRef.current
  if (!analysis?.diagram || !target) return
  const id = `mermaid-diagram-${++renderIdRef.current}`
  mermaid.render(id, analysis.diagram)
    .then(({ svg }) => { if (target) target.innerHTML = svg })
    .catch(() => { if (target) target.innerHTML = '<p style="color:#f87171;margin:0">Failed to render diagram</p>' })
}, [analysis?.diagram, fullscreen])
```

Escape key closes fullscreen:
```js
useEffect(() => {
  if (!fullscreen) return
  const onKey = (e) => { if (e.key === 'Escape') setFullscreen(false) }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}, [fullscreen])
```

Diagram section JSX:
```jsx
<div style={{ position: 'relative' }}>
  <button onClick={() => setFullscreen(true)} style={fullscreenBtnStyle} title="Fullscreen">⛶</button>
  <div ref={inlineRef} style={{ overflowX: 'auto' }} />
</div>
{fullscreen && (
  <div onClick={() => setFullscreen(false)} style={overlayStyle}>
    <div ref={fullscreenRef} onClick={e => e.stopPropagation()} style={fullscreenContainerStyle} />
  </div>
)}
```

`overlayStyle`: fixed, full viewport, dark semi-transparent background, z-index above ReactFlow (z-index: 100).
`fullscreenContainerStyle`: white background (or dark), max 90vw × 90vh, overflow auto, border-radius.

#### `ConnectionsTab.jsx`

Prop added: `analysis` (passed from DetailPanel as `program.analysis`).

Updated render call in `DetailPanel.jsx`:
```jsx
<ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} analysis={program.analysis} />
```

Two sections:

**Programs** (existing — unchanged):
- Calls / Called By edges from `program.edges`
- Phantom logic ("not analyzed" / "not uploaded" badges) unchanged

**External Calls** (new, shown below Programs):
- Source: `analysis?.external_calls`
- Hidden entirely if `external_calls` is null or empty
- Format per entry: `c_writelnkarea (PGM-NM)` — program name bold, parameter in parentheses, monospace font, no navigation
- Label: "EXTERNAL CALLS" section header (same uppercase label style as other sections)

#### `DataTab.jsx` (new file)

```jsx
export default function DataTab({ analysis }) {
  if (!analysis?.db_tables?.length) return <p style={{ color: '#64748b' }}>No database tables found.</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {analysis.db_tables.map((t, i) => (
        <div key={i} style={rowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{t.table}</span>
            <span style={{ fontSize: 11, color: opColor(t.operation) }}>{t.operation}</span>
          </div>
          {t.fields?.length > 0 && (
            <p style={{ color: '#94a3b8', fontSize: 11, margin: '4px 0 0' }}>{t.fields.join(', ')}</p>
          )}
        </div>
      ))}
    </div>
  )
}
```

`opColor(op)` — uses `.includes()` to handle compound operation strings produced by the aggregation join:
- contains `WRITE` or `DELETE` AND `READ` → `#f59e0b` (amber, mixed)
- contains only `READ` → `#4ade80` (green)
- contains `WRITE` or `DELETE` (no READ) → `#f87171` (red)

```js
function opColor(op = '') {
  const hasRead = op.includes('READ')
  const hasWrite = op.includes('WRITE') || op.includes('DELETE')
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}
```

#### Resizable panel

State in `DetailPanel`:
```js
const [width, setWidth] = useState(() => parseInt(localStorage.getItem('panelWidth') || '340'))
```

Drag handle — a 6px-wide div on the left edge of the panel:
```jsx
<div
  onMouseDown={startResize}
  style={{ position: 'absolute', left: 0, top: 0, width: 6, height: '100%', cursor: 'col-resize', zIndex: 1 }}
/>
```

Resize handler:
```js
function startResize(e) {
  e.preventDefault()
  const onMove = (e) => {
    const newWidth = Math.min(600, Math.max(280, window.innerWidth - e.clientX))
    setWidth(newWidth)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    setWidth(w => { localStorage.setItem('panelWidth', String(w)); return w })
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
```

Panel outer div uses `width` state instead of hardcoded `340`.

#### Files removed

- `client/src/components/Panel/DiagramTab.jsx` — deleted (logic moves to OverviewTab)
- `client/src/components/Panel/LogicBlocksTab.jsx` — deleted

---

## Error Handling

- Aggregation is pure JS — cannot throw
- If `synthesis` returns no `description`, `description ?? summary` falls back to the long summary text
- Fullscreen overlay: Escape key closes it (keydown listener cleaned up on close)
- Panel resize: clamped to [280, 600], no layout breakage possible
- Mermaid render failure: shows inline red error message (same as current DiagramTab behavior)

---

## Files Changed

| File | Change |
|------|--------|
| `server/src/ai/prompts.js` | Fix `CHUNK_PROMPT` calls/db_ops instructions; add `description` to `SYNTHESIS_PROMPT` |
| `server/src/ai/orchestrator.js` | Add aggregation step; expand return value with `description`, `external_calls`, `db_tables` |
| `server/src/models/programAnalysis.js` | Add `updateAnalysisFields` function |
| `server/src/services/analysisService.js` | Destructure and save `description`, `external_calls`, `db_tables`; pass new `external_calls` to `updateGraphAfterAnalysis` |
| `server/src/services/graphService.js` | `updateGraphAfterAnalysis` reads `call.program` instead of `call.program_name`; removes `is_system_call` filter |
| `client/src/components/Panel/DetailPanel.jsx` | Update TABS; add Data tab render; pass `analysis` to ConnectionsTab; add resize handle and width state |
| `client/src/components/Panel/OverviewTab.jsx` | Add diagram rendering with fullscreen |
| `client/src/components/Panel/ConnectionsTab.jsx` | Add `analysis` prop; add External Calls section |
| `client/src/components/Panel/DataTab.jsx` | New file |
| `client/src/components/Panel/LogicBlocksTab.jsx` | Deleted |
| `client/src/components/Panel/DiagramTab.jsx` | Deleted |

---

## Testing

- **Aggregation:** unit test — orchestrator deduplicates calls by `program` name; merges fields across chunks for the same table name; skips entries where `program` is missing or `table` is `'unknown'`
- **`graphService`:** unit test — `updateGraphAfterAnalysis` creates phantom node using `call.program`; does not skip any call based on `is_system_call`
- **DataTab:** renders table list; `opColor` returns correct color for READ, WRITE, READ/WRITE, READ/DELETE compound strings; shows "No database tables found" when empty
- **OverviewTab:** renders diagram inline; fullscreen overlay opens on button click; closes on outside click; closes on Escape; diagram re-renders into fullscreen container when overlay opens
- **Resizable panel:** width clamped to [280, 600]; width persisted to localStorage on mouseup; restored from localStorage on mount
- **ConnectionsTab External Calls:** renders `program (using)` format; section hidden when `external_calls` is empty or null

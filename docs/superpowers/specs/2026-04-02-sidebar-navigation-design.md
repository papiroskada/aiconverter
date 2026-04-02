# Sidebar Navigation Design

**Goal:** Add a left sidebar that lets the user navigate between applications, see file-level analysis progress, and click a file to focus the graph on that node.

**Architecture:** A new `Sidebar` component replaces the floating upload buttons and batch badge. It has two views — projects list and project files — managed by local state. App.jsx passes down nodes, batch step progress, and a callback for "file clicked". ProgramGraph accepts a `focusNodeId` prop and pans/zooms to that node.

**Tech Stack:** React 18, ReactFlow (`useReactFlow`), existing SSE hooks, existing API layer.

---

## Layout

```
┌──────────────────────────────────────────────────────┐
│ [200px sidebar] │ [graph — full remaining width]  [⚙] │
│                 │                                      │
│  Projects list  │   ReactFlow graph                    │
│  or             │   (filtered to selected app)         │
│  Project files  │                                      │
│                 │              [DetailPanel — right]   │
└──────────────────────────────────────────────────────┘
```

The sidebar is always visible (not collapsible in this version). The DetailPanel continues to slide in from the right when a graph node is clicked.

---

## Sidebar — View 1: Projects list

Shown by default. Displays all applications fetched from `GET /api/applications`.

**Header:** "Проекти" label + small "+ New" text button (creates application via modal or inline input — not in this spec, placeholder only).

**Each project row:**
- Application name (uppercase)
- Status indicator:
  - `analyzing` → amber dot + "analyzing X / Y" + thin progress bar
  - `analyzed` → green checkmark + "analyzed X / X"
  - `pending` → gray circle + "pending 0 / Y"
  - `failed` → red dot + "failed"
- Clicking a row → switches to View 2 for that application

**Footer:** `+ Upload Folder` (primary blue button) and `+ Upload File` (secondary gray button). These replace the current floating bottom-right buttons.

**Data source:** `fetchApplications()` called on mount and after batch completes. Program counts come from the existing `program_count` field returned by the server.

---

## Sidebar — View 2: Project files

Shown after clicking a project. Displays the files belonging to that application.

**Header:**
- ← back arrow → returns to View 1
- Application name + status text
- `Stop` button (amber, only visible when `status === 'analyzing'`)

**Progress bar:** thin bar + "X з Y готово" label, calculated from nodes.

**File list:** sorted — analyzing first, then analyzed, then pending/failed, alphabetical within each group.

Each file row:
- Status icon: `▶` blue (analyzing), `✓` green (analyzed), `○` gray (pending), `✗` red (failed)
- File name (e.g. `PROC001.cbl` — derived from program name + `.cbl`)
- If analyzing: subtitle "Step X of Y" pulled from step-progress prop
- Highlighted background for files currently being analyzed
- Clicking a row → calls `onFileClick(programId)` → graph focuses on that node

**Footer:** `+ Додати файли` button (uploads to this application).

**Data source:** `nodes` prop filtered by `applicationId`. No separate fetch needed.

---

## Graph changes

**Filter by selected application:** When a project is open (View 2), App.jsx passes only nodes belonging to that application to ProgramGraph. When in View 1 (no app selected), all nodes are shown.

**Focus node on file click:** ProgramGraph accepts a new `focusNodeId` prop. When it changes (and is non-null), the component uses `useReactFlow().fitBounds` to pan and zoom to that node with padding. The focused node gets a blue highlight ring (temporary, cleared after 2 seconds or on next click).

---

## Data flow

**`usePrograms` hook** — adds `applicationId` to each node's `data` object (currently missing).

**`fetchApplications()`** — new export in `client/src/api/applications.js`, calls `GET /api/applications`.

**Step progress** — App.jsx maintains `Map<programId, {step, total}>` updated from batch SSE `progress` events where `stage === 'step'`. Passed to Sidebar as `stepProgress` prop.

**`selectedAppId`** — state in App.jsx, set by Sidebar callbacks `onSelectApp` / `onBack`. Controls which nodes are passed to ProgramGraph.

**`focusNodeId`** — state in App.jsx, set by Sidebar's `onFileClick(programId)`. Passed to ProgramGraph.

---

## Files

**Create:**
- `client/src/components/Sidebar/Sidebar.jsx`

**Modify:**
- `client/src/api/applications.js` — add `fetchApplications()`
- `client/src/hooks/usePrograms.js` — add `applicationId` to node data
- `client/src/components/Graph/ProgramGraph.jsx` — add `focusNodeId` prop + focus effect
- `client/src/App.jsx` — integrate Sidebar, manage `selectedAppId`, `focusNodeId`, `stepProgress`

**Remove:**
- Floating upload buttons and batch badge from App.jsx (moved into Sidebar)

---

## Out of scope

- Collapsible sidebar
- Creating a new application from the sidebar (the "+ New" button is a placeholder)
- Cross-application edges in the filtered graph view
- Drag-to-reorder files

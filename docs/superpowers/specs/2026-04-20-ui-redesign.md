# UI Redesign — Program List + Improved Logic View

**Date:** 2026-04-20
**Status:** Approved

## Goal

Replace the current graph-centric layout with a program-list-centric layout. The primary use case is reviewing AI-generated analysis of COBOL programs before feeding it to AI for JS code generation. The user needs to quickly read and verify: entry points, business logic steps, DB operations per mode, and flag anything uncertain.

## Current State

- **Sidebar (200px):** Projects list → Project files (two-level navigation)
- **Center (main):** ReactFlow dependency graph — always visible, always the focus
- **DetailPanel:** Right overlay (280–600px, resizable) with 4 tabs: Overview / Logic / Connections / Data
- **Logic tab:** Pre-dispatch names, entry points (steps, sideEffects, returns, errors), error catalog — but no DB ops per entry point, no flagging

## New Layout

### Shell

```
┌──────┬──────────────┬────────────────────────────────────┐
│ Icon │  Left panel  │         Main content               │
│ side │  (160px)     │                                    │
│ bar  │  Projects →  │  [view=list]    → program cards    │
│(44px)│  Files list  │  [view=graph]   → ReactFlow graph  │
│      │              │  [view=program] → program detail   │
└──────┴──────────────┴────────────────────────────────────┘
```

### Icon Sidebar (`IconNav.jsx` — new)

Three icons, vertically stacked:
- ⊞ **Projects** (`view=list`) — active by default
- ◎ **Graph** (`view=graph`) — shows the ReactFlow dependency graph
- ⚙ **Settings** — opens existing SettingsDrawer

Active icon gets a filled background. No labels.

### Left Panel (160px, unchanged logic)

Same `ProjectsList` and `ProjectFiles` components. Minor width reduction from 200px → 160px. Clicking a file sets `selectedProgramId` and `view=program`.

### Main Content — Program Cards (`ProgramGrid.jsx` — new)

Shown when `view=list` and a project is selected. Grid of cards, 3 columns on wide screens.

**Each card shows:**
- Top color bar by status: blue=analyzing, green=analyzed, amber=has flags, gray=pending/failed
- Program name + file type badge (.cbl / .c)
- Count of entry points and DB tables
- Flag indicator if any entry point is flagged (⚠ N)
- Progress bar if analyzing

**Filter bar above grid:** All / ⚠ Flagged / ✓ Reviewed / ✗ Failed

Clicking a card sets `view=program`, `selectedProgramId=id`.

### Main Content — Program Detail (`ProgramDetail.jsx` — replaces DetailPanel)

Full-width, not an overlay. Header shows program name, status, Reanalyze button, Delete button.

Same four tabs: **Overview / Logic / Data / Connections**

#### Logic Tab (main changes)

Each entry point rendered as a card with all information grouped together:

```
┌─────────────────────────────────────────────────────┐
│  [FUNC='INS']  Create Record              [⚑ ▾]    │
├─────────────────────────────────────────────────────┤
│  PARAMS   acno (in), date (in) → status (out)       │
├─────────────────────────────────────────────────────┤
│  STEPS                                              │
│  1. Validate account exists in arcus                │
│  2. Insert new record into arfil                    │
│  3. Update balance counter in arcus                 │
├─────────────────────────────────────────────────────┤
│  DB OPERATIONS                                      │
│  arcus  SELECT   key: acno       → error 1500       │
│  arfil  INSERT                   → n/a              │
│  arcus  UPDATE   key: acno       → n/a              │
├─────────────────────────────────────────────────────┤
│  ERRORS  ✗ 1500 (ARCUS-ACNO): account not found    │
└─────────────────────────────────────────────────────┘
```

**DB Operations** renders `ep.dbOperations` (new field added to AI prompts). Each row shows: table name, operation colored by type (green=SELECT, red=INSERT/UPDATE/DELETE, amber=mixed), key fields, notFoundAction.

**Flag button `[⚑ ▾]`** per entry point — dropdown:
- ⚠ Warning — uncertain / likely wrong
- 🗑 Deprecated — no longer needed
- Clear flag

Flagged entry points show a colored banner at the top of their card (amber for warning, red for deprecated).

**Pre-dispatch** section at the top of Logic tab (unchanged): paragraph names that run before every mode.

**Error catalog** section at the bottom (unchanged).

#### Data Tab (minor addition)

Existing `db_tables` (program-level) stays. New section "Per-Mode Operations" appears if any entry point has `dbOperations` — shows a compact table: mode → tables touched.

#### Overview and Connections tabs

No changes.

## Flag Persistence

### DB

New JSONB column on `program_analysis`:

```sql
ALTER TABLE program_analysis ADD COLUMN flags JSONB NOT NULL DEFAULT '{}';
```

Structure: `{ "<entry-point-condition>": "warning" | "deprecated" }` — keyed by `ep.condition`.

### API

```
PATCH /api/programs/:id/flags
Body: { "condition": "FUNC='INS'", "flag": "warning" | "deprecated" | null }
```

Returns updated flags object. Merge-patch semantics: `null` removes the key.

## AI Prompt Changes (already done)

`dbOperations` field added to `entryPoints` in all four prompts (COBOL one-step, COBOL two-step detail, C one-step, C two-step detail). Each entry point now returns:

```json
"dbOperations": [
  { "table": "arcus", "operation": "SELECT", "keyFields": ["acno"], "notFoundAction": "error 1500" }
]
```

## What Is Not Changing

- All upload logic (folder upload, single file, companion files .s/.u)
- SSE batch progress streaming
- Batch concurrency (3 parallel)
- Cancel batch functionality
- ReactFlow graph (moves to `view=graph`, otherwise untouched)
- OverviewTab component
- ConnectionsTab component
- All server-side analysis logic
- `program_chunks`, `program_edges`, all existing DB tables

## File Map

| File | Change |
|---|---|
| `client/src/App.jsx` | Add `view` + `selectedProgramId` state; render IconNav + ProgramGrid/ProgramDetail |
| `client/src/components/Nav/IconNav.jsx` | New — icon sidebar |
| `client/src/components/Programs/ProgramGrid.jsx` | New — card grid |
| `client/src/components/Panel/ProgramDetail.jsx` | New — replaces DetailPanel |
| `client/src/components/Panel/LogicTab.jsx` | Add dbOperations + flag button per entry point |
| `client/src/components/Panel/DataTab.jsx` | Add per-mode section |
| `client/src/api/programs.js` | Add `patchFlags(id, condition, flag)` |
| `server/src/routes/programs.js` | Add `PATCH /:id/flags` route |
| `server/src/models/programAnalysis.js` | Add `updateFlag(id, condition, flag)` |
| `server/src/db/schema.sql` | Add `flags JSONB NOT NULL DEFAULT '{}'` to `program_analysis` table |

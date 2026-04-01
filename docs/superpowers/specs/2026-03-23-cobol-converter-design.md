# COBOL to JavaScript Converter — Design Spec

**Date:** 2026-03-23
**Status:** Draft

---

## Overview

A web application that helps teams migrate large COBOL systems to JavaScript by first generating structured, AI-powered documentation of each COBOL program. The tool extracts business logic, call parameters (LINKAGE SECTION items passed via CALL...USING), external program calls, and database usage — storing everything in a format optimized for future AI-driven JS code generation.

The primary interface is an interactive graph where nodes represent COBOL programs and edges represent call relationships between them.

---

## Goals

- Upload COBOL files and analyze them via AI (Claude or OpenAI)
- Extract and store: business logic (chunked), call parameters, external calls, DB tables/fields
- Visualize the program dependency graph with analysis status per node
- Store data in a structured format suitable for future AI-based JS codegen
- Start simple (single user, no auth), designed to support team usage and roles later

---

## Non-Goals (v1)

- User authentication and roles (designed for, not implemented)
- JS code generation (future phase)
- Background job queue (BullMQ — future scaling path)
- Approval workflows for logic diagrams

---

## Architecture

```
┌─────────────────────────────────────┐
│         React Frontend              │
│  File upload · Graph · Detail panel │
│  SSE progress streaming             │
└────────────────┬────────────────────┘
                 │ REST API + SSE
┌────────────────▼────────────────────┐
│         Node.js / Express           │
│  COBOL Pre-parser                   │
│  AI Orchestrator (Claude / OpenAI)  │
│  Graph Service                      │
│  Data Service                       │
└────────────────┬────────────────────┘
                 │ SQL
┌────────────────▼────────────────────┐
│           PostgreSQL                │
│  programs · program_analysis        │
│  program_chunks · program_edges     │
└─────────────────────────────────────┘
                 │ HTTP (streaming)
┌────────────────▼────────────────────┐
│      External AI Providers          │
│  Anthropic Claude API               │
│  OpenAI API                         │
└─────────────────────────────────────┘
```

---

## Data Model

### `programs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| name | TEXT | COBOL program name (e.g. `ARERCD`) |
| status | ENUM | `pending` \| `analyzing` \| `analyzed` \| `failed` |
| file_path | TEXT | Path to stored COBOL file, null for phantom nodes |
| analyzed_at | TIMESTAMP | When analysis completed |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | Updated on any status change |

### `program_analysis`
One-to-one with `programs`. Top-level extracted metadata.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | |
| program_id | UUID | FK → programs |
| description | TEXT | AI-generated overall summary |
| call_parameters | JSONB | `[{name, type, description, future_endpoint}]` — LINKAGE SECTION items passed via CALL...USING |
| external_calls | JSONB | `[{program_name, context, is_system_call}]` |
| db_tables | JSONB | `[{table, operation, fields}]` |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | Updated on re-analysis |

### `program_chunks`
One-to-many with `programs`. Each chunk is a paragraph or sub-paragraph from PROCEDURE DIVISION, or a section of DATA DIVISION.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | |
| program_id | UUID | FK → programs |
| chunk_type | ENUM | `data_summary` \| `paragraph` \| `sub_paragraph` |
| chunk_name | TEXT | COBOL paragraph name (e.g. `MAIN-LOGIC`) |
| start_line | INT | |
| end_line | INT | |
| cobol_text | TEXT | Raw COBOL for this chunk |
| analysis | JSONB | `{description, flow_steps, variables_used, calls, db_ops}` |
| token_estimate | INT | Approximate token count |
| order_index | INT | Ordering for codegen |
| status | ENUM | `pending` \| `done` \| `failed` |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | Updated when status changes (useful for retry debugging) |

**`analysis` JSONB structure:**
```json
{
  "description": "Initializes customer balance table",
  "flow_steps": ["Read customer record", "Check balance", "Write to output"],
  "variables_used": ["WS-CUSTOMER-ID", "WS-BALANCE"],
  "calls": ["ARCUST"],
  "db_ops": [{"table": "ARQAR1", "operation": "READ", "fields": ["CUSTOMER-ID"]}]
}
```

### `program_edges`
Graph edges between programs.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | |
| from_program_id | UUID | FK → programs |
| to_program_name | TEXT | Target program name (may not exist yet) |
| to_program_id | UUID | FK → programs, nullable (set when target is uploaded) |
| context | TEXT | Where/why this call happens |
| created_at | TIMESTAMP | |

> `to_program_name` is stored as text to handle programs that have been mentioned but not yet uploaded. When the target is later uploaded, `to_program_id` is populated.

**Unique constraint:** `UNIQUE (from_program_id, to_program_name)`. Phase 3 uses upsert (`INSERT ... ON CONFLICT DO NOTHING`) to handle programs that call the same external program in multiple paragraphs.

---

## Analysis Pipeline

### Phase 1 — COBOL Pre-parser (no AI)

Runs immediately after upload, before any AI calls:

1. Identify division boundaries (IDENTIFICATION, ENVIRONMENT, DATA, PROCEDURE)
2. **DATA DIVISION chunking:** DATA DIVISION has no paragraph structure. It is split by its sections (WORKING-STORAGE SECTION, FILE SECTION, LINKAGE SECTION). Each section becomes one `data_summary` chunk. If a section exceeds 300 lines, it is further split into fixed-size windows of 300 lines with 20-line overlap. `chunk_name` is set to the section name (e.g. `WORKING-STORAGE`); for windows within a section: `WORKING-STORAGE [2]`, `WORKING-STORAGE [3]`, etc.
3. Extract all paragraph names and their line ranges from PROCEDURE DIVISION
4. Split any paragraph exceeding 300 lines into sub-chunks with 20-line overlap. Sub-chunk `chunk_name` format: `PARAGRAPH-NAME [N]` (e.g. `MAIN-LOGIC [2]`). The column is never null.
5. Estimate token count per chunk using character count ÷ 4 (standard GPT/Claude approximation)
6. Persist all `program_chunks` records with `status = pending`

### Phase 2 — AI Analysis (streamed via SSE)

**Upload → SSE handshake:** `POST /api/programs/upload` runs the pre-parser synchronously and returns `{ id, status: "analyzing" }`, then starts AI calls immediately in the background. The client opens the SSE connection to `/api/programs/:id/stream` using the returned `id`. Any client connecting mid-analysis receives the current state by reading `program_chunks` statuses from the DB — no event buffering required. The SSE stream sends `{ event: "chunk_done", chunkId, index, total }` events and closes with `{ event: "done" }` or `{ event: "failed" }`. A late-joining client that connects after `done` simply receives no events and polls `GET /api/programs/:id` for final state.

Sequential AI calls, progress streamed to frontend:

| Step | Input | Output |
|------|-------|--------|
| 1. Metadata | IDENTIFICATION + DATA DIVISION headers | call_parameters, external_calls, db_tables, description |
| 2…N. Chunks | Each `program_chunk` (≤300 lines) | chunk.analysis (flow_steps, variables, calls, db_ops) |
| Final. Synthesis | All chunk descriptions concatenated | Overall program summary |

**Partial failure and resume:** Each chunk is analyzed independently and its `status` set to `done` or `failed` immediately. If the process is interrupted, already-`done` chunks are skipped on retry. `POST /api/programs/:id/analyze` triggers analysis of all `pending` or `failed` chunks only, enabling partial resume without re-processing completed work. If `programs.status` is already `analyzing` when this endpoint is called, the server returns `409 Conflict` to prevent duplicate concurrent runs.

**Synthesis step output:** After all chunks complete, the final synthesis call receives all chunk `description` fields concatenated. Its output schema:
```json
{ "summary": "string" }
```
The result overwrites `program_analysis.description` and triggers `program_analysis.updated_at`.

**AI Provider abstraction:**
```
AIProvider (interface)
  ├── ClaudeProvider
  └── OpenAIProvider
```
Provider is selected via environment config (`AI_PROVIDER=claude|openai`). Both providers receive identical structured prompts and return identical response schemas.

### Phase 3 — Graph Update

After analysis completes:
1. Set `programs.status = analyzed`
2. For each external call found:
   - If a program with that name already exists → upsert edge with `to_program_id` populated
   - If not → create `programs` record with `status = pending` + edge with only `to_program_name`
3. **Phantom edge backfill:** When any program is uploaded (regardless of analysis state), run `UPDATE program_edges SET to_program_id = $newId WHERE to_program_name = $name AND to_program_id IS NULL`. This resolves all previously-created phantom edges pointing to this program.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/programs/upload` | Upload COBOL file, run pre-parser, return `{ id, status }` |
| POST | `/api/programs/:id/analyze` | (Re-)trigger analysis for pending/failed chunks |
| GET | `/api/programs` | Graph data — returns `{ programs: [...], edges: [...] }` |
| GET | `/api/programs/:id` | Program detail (analysis, chunks, edges) |
| GET | `/api/programs/:id/stream` | SSE stream for analysis progress events |
| GET | `/api/programs/:id/chunks` | All chunks for a program |

**`GET /api/programs` response shape:**
```json
{
  "programs": [
    { "id": "uuid", "name": "ARERCD", "status": "analyzed" }
  ],
  "edges": [
    { "from": "uuid", "to": "uuid|null", "to_name": "ARCUST" }
  ]
}
```
Phantom edges (where `to_program_id IS NULL`) are included with `"to": null` so the graph can render a grey node by `to_name`. No pagination in v1 (hundreds of nodes is within React Flow's capacity). Pagination added in v2 if needed.

---

## Frontend

### Graph View (main screen)

- Library: **React Flow**
- Full-screen canvas with zoom/pan
- Node colors:
  - Green (`#4ade80` border) = `analyzed`
  - Blue animated ring = `analyzing` (in progress)
  - Grey (`#475569` border, dashed) = `pending` — file not yet uploaded, only referenced
  - Grey (`#475569` border, solid) = `pending` — uploaded but not yet analyzed
- Upload button always visible (bottom-right)
- Click node → opens detail panel (slides in from right)

### Detail Panel

Slides in from the right, does not resize the graph.

**Tab 1 — Overview**
- Program name + status badge
- Description
- Call Parameters table (name, type, description, future JS endpoint)
- External Calls list — analyzed programs are clickable links (graph focuses on them), pending ones show grey badge
- DB Tables list (table name, operations, fields)

**Tab 2 — Logic Blocks**
- List of all `program_chunks`
- Each expandable: shows `flow_steps` as ordered list
- Shows which variables and external calls are involved

**Tab 3 — Connections**
- Incoming: programs that call this one
- Outgoing: programs this one calls
- Each entry is clickable → graph focuses on that node

### Analysis Progress

While a program is being analyzed:
- Node shows animated ring
- Detail panel (if open) shows a progress bar: `Analyzing chunk 3 of 12…`
- Uses SSE connection to `/api/programs/:id/stream`

---

## Chunking Strategy

**Why paragraph-level is not always enough:**
Example file `arercd.cbl` is 13,088 lines (1.1MB). DATA DIVISION alone spans ~4,300 lines. A single paragraph can be 200–500 lines.

**Strategy:**
1. Pre-parser identifies natural COBOL boundaries (sections and paragraphs)
2. DATA DIVISION split by section (WORKING-STORAGE, FILE, LINKAGE); sections > 300 lines get fixed windows
3. Any PROCEDURE paragraph > 300 lines is split into sub-chunks with 20-line overlap
4. Sub-chunk naming convention: `PARAGRAPH-NAME [N]` — `chunk_name` is never null
5. Token estimate = `character_count / 4`
6. Each chunk gets its own analysis record; failed chunks can be retried independently
7. For future JS codegen: one chunk → one JS function. Context window is always bounded.

---

## File Storage

v1: uploaded COBOL files stored on local disk under `./uploads/<program_id>.cbl`. `programs.file_path` stores the absolute path.

v2 (team deployment): replace local disk with S3-compatible object storage. `file_path` becomes an object key. No schema change required.

---

## AI Response Schema

Both Claude and OpenAI providers must return structured JSON matching these schemas. Use JSON mode (OpenAI) or tool-use/structured output (Claude) to enforce this.

**Metadata extraction response:**
```json
{
  "description": "string",
  "call_parameters": [
    { "name": "string", "type": "string", "description": "string", "future_endpoint": "string|null" }
  ],
  "external_calls": [
    { "program_name": "string", "context": "string", "is_system_call": "boolean" }
  ],
  "db_tables": [
    { "table": "string", "operation": "READ|WRITE|READ/WRITE", "fields": ["string"] }
  ]
}
```

**Chunk analysis response:**
```json
{
  "description": "string",
  "flow_steps": ["string"],
  "variables_used": ["string"],
  "calls": ["string"],
  "db_ops": [
    { "table": "string", "operation": "READ|WRITE|READ/WRITE", "fields": ["string"] }
  ]
}
```

---

## Scalability Path

The system is designed to migrate from synchronous SSE processing to background jobs without changing the API or frontend:

1. **v1 (current):** `analyzeProgram()` runs synchronously, streams via SSE
2. **v2 (scaling):** `analyzeProgram()` enqueues a BullMQ job, worker runs the same logic, WebSocket replaces SSE for status

Database schema and API contracts remain unchanged between v1 and v2.

---

## Future Phases

- **Auth & Roles:** User accounts, role-based permissions (e.g. "Analyst" can upload, "Lead" can approve logic diagrams)
- **JS Code Generation:** Feed `program_analysis` + `program_chunks` into AI to generate JS modules
- **Approval Workflow:** Team members review and approve AI-generated logic before codegen
- **Bulk Upload:** Upload multiple COBOL files at once, prioritize analysis order

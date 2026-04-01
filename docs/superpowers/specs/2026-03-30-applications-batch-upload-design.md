# Applications & Batch Upload — Design Spec
_2026-03-30_

## Goal

Replace single-file manual upload with a folder-based batch workflow. Group programs into **applications**, configure analysis settings per run, and expose a CLI for automation. Lay the DB foundation for future DB-schema aggregation (Step 3).

## Scope

- `applications` entity grouping programs
- `settings` table for persistent API keys and model defaults
- Folder picker UI → confirmation screen → batch analysis
- Parallel and sequential analysis modes (concurrency limit 3 for parallel)
- Settings drawer for API key management
- CLI `scan.js` for directory-based batch upload

Out of scope: cost estimation (Step 2), DB schema aggregation (Step 3), multi-user support.

---

## Database

Full schema reset — existing records will be dropped and recreated.

```sql
CREATE TYPE program_status AS ENUM ('pending', 'analyzing', 'analyzed', 'failed');
CREATE TYPE chunk_type AS ENUM ('data_summary', 'paragraph', 'sub_paragraph');
CREATE TYPE chunk_status AS ENUM ('pending', 'done', 'failed');

CREATE TABLE applications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'analyzing' | 'analyzed' | 'failed'
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE programs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  status         program_status NOT NULL DEFAULT 'pending',
  file_path      TEXT,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  analyzed_at    TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
  id                     INT PRIMARY KEY DEFAULT 1,
  ai_provider            TEXT NOT NULL DEFAULT 'claude',
  claude_api_key         TEXT,
  openai_api_key         TEXT,
  claude_model_interface TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  claude_model_rules     TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  claude_model_diagram   TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  openai_model_interface TEXT NOT NULL DEFAULT 'gpt-4o',
  openai_model_rules     TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  openai_model_diagram   TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ... program_analysis, program_chunks, program_edges unchanged
```

`settings` always has `id = 1` (upsert). Future multi-user: replace `id INT` with `user_id UUID`.

---

## Backend

### `GET /api/settings`
Returns current settings. API keys are masked: returns `"sk-ant-••••1234"` (prefix up to first `-`, then bullets, then last 4 chars). If key is null, returns `null`.

### `PUT /api/settings`
Accepts any subset of settings fields. Upserts the single row.

### `POST /api/applications`
Body: `{ name: string }`
Creates application record, returns `{ id, name, status }`.

### `GET /api/applications`
Returns list of applications with `{ id, name, status, programCount }`.

### `GET /api/applications/:id`
Returns application details + array of its programs with status.

### `POST /api/applications/:id/analyze`
Body: `{ mode: 'sequential' | 'parallel' }`
Triggers batch analysis for all programs in the application that are not yet `analyzed`.
- `sequential`: awaits each `runAnalysisInBackground` in order
- `parallel`: runs all via `Promise.allSettled` with concurrency limit of 3

Analysis uses settings from the `settings` table (provider + models), which the client has already updated before calling this endpoint.

### `POST /api/programs/upload` (updated)
Accepts optional `application_id` field in multipart form. Behaviour unchanged for single-file upload.

### SSE: application-level stream
`GET /api/applications/:id/stream`
Emits per-file progress events so the UI can update each row:
```json
{ "programId": "...", "programName": "FILE001", "stage": "analyzing", "message": "..." }
{ "programId": "...", "programName": "FILE001", "event": "done" }
```

---

## CLI (`cli/scan.js`)

```
node cli/scan.js --dir /path/to/cobol --name "My App" [--mode sequential|parallel] [--api-url http://localhost:3001]
```

Flow:
1. Reads `--dir`, collects all `.cbl` / `.cob` files
2. `POST /api/applications` to create application
3. Uploads each file via `POST /api/programs/upload` with `application_id`
4. `POST /api/applications/:id/analyze` with chosen mode
5. Polls `GET /api/applications/:id` and prints per-file status until all done

Does not require API keys to be set via CLI flags — reads from the DB settings (already configured via UI).

---

## Frontend

### New components

**`UploadControls`** (replaces `UploadButton`)
Two buttons fixed bottom-right:
- `+ Upload File` — existing single-file behaviour
- `+ Upload Folder` — triggers `<input webkitdirectory>`

**`ConfirmationModal`**
Opens after folder selection. Sections:
1. **Application name** — text input, defaults to folder name
2. **File list** — scrollable list of found `.cbl`/`.cob` files with count
3. **Analysis Settings**
   - Provider toggle: Claude / OpenAI
   - Model selectors per task (Interface, Rules, Diagram) — dropdowns filtered by selected provider
   - Analysis mode: Sequential / Parallel
4. **Actions** — Cancel / Start Analysis

On "Start Analysis":
- `PUT /api/settings` with chosen provider + models
- `POST /api/applications` with name
- Upload all files sequentially (upload ≠ analysis; uploads are always sequential to avoid overwhelming multer)
- `POST /api/applications/:id/analyze` with chosen mode
- Modal transitions to progress view

**Progress view** (replaces modal content after start):
```
FILE001  ████████████  analyzed
FILE002  ██░░░░░░░░░░  analyzing…
FILE003  ░░░░░░░░░░░░  pending
```
Each row updates in real-time via application-level SSE.

**`SettingsDrawer`**
Gear icon ⚙ fixed top-right. Shows:
- Anthropic API Key field (masked, Edit button to reveal/change)
- OpenAI API Key field (masked, Edit button)
- Save button → `PUT /api/settings`

### State changes in `App.jsx`
- Add `applications` state alongside existing `programs`/`edges`
- `useSSE` extended (or a new `useAppSSE`) to subscribe to application-level stream
- After batch completes, call `refresh()` to reload the graph

---

## Key Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Settings storage | DB single row | Clean path to multi-user later |
| API keys in DB | Plaintext, masked in API | Acceptable for single-user internal tool; add encryption when multi-user |
| Parallel concurrency limit | 3 | Avoids API rate limits without being too slow |
| Upload order in batch | Always sequential | Simplifies multer, analysis mode controls AI concurrency |
| CLI API keys source | DB (set via UI) | Single source of truth |
| Model selectors in settings drawer | Not included | Models are per-run choice, not global setting |

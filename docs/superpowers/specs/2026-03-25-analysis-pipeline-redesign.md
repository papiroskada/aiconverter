# Analysis Pipeline Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-chunk AI analysis pipeline with a deterministic extraction + single-AI-call design that is 16x cheaper, eliminates JSON truncation errors, and produces richer structured output for JS rewrite documentation.

**Architecture:** Deterministic regex extraction handles all structural data (paragraphs, LINKAGE, CALL, EXEC SQL, files, constructs). One AI call receives only the compact extracted data and returns a full interface spec including per-section purposes, input/output contract, and flow narrative. A second AI call generates the Mermaid diagram. No per-chunk AI calls.

**Tech Stack:** Node.js, PostgreSQL, OpenAI gpt-4o / Anthropic Claude (existing providers)

---

## Background

### Current approach and its problems

The current pipeline parses COBOL into chunks of up to 300 lines and sends each chunk to the AI individually:
- 71 chunks for a typical file × ~2 048 tokens each ≈ **145 000 tokens per file**
- `DATA_PROMPT` asks AI to describe every field in a WORKING-STORAGE section → response easily exceeds the `max_tokens` output limit → **JSON truncation errors**
- WORKING-STORAGE analysis produces low-value output (field-by-field PIC descriptions) that is mostly COBOL-specific noise

### Reference: old `aiconverter` project approach

The `aiconverter` project at `/Users/dariasidenko/aiconverter` uses a different strategy for large files:
- Extract structural information deterministically (regex / string matching) — no AI
- Send only the compact extracted data to a single AI call
- DATA DIVISION is passed as a reference to conversion, not analyzed separately

### Improvements over the old approach

The old `aiconverter` does not handle:
- **Call graph edges** — `CALL` statements extracted but not used to build a program dependency graph
- **Database operations** — `EXEC SQL ... END-EXEC` blocks not parsed

This redesign adds both, deterministically.

---

## Detailed Design

### Phase 1: Deterministic Extraction (no AI, free)

The parser produces the following from the raw COBOL source:

**Paragraphs with snippets**
Each paragraph in the PROCEDURE DIVISION is recorded with its name and its first 5 lines of body text. The snippet is computed in-memory during orchestration and passed to the AI — it is **not stored** in the DB (no new column needed in `program_chunks`). The full `cobol_text` remains stored as before.

**LINKAGE section**
Raw text of the LINKAGE SECTION, sliced deterministically. This defines the program's input/output contract.

**CALL statements**
Regex: `CALL\s+['"]([^'"]+)['"]\s*(?:USING\s+(\S+?))?(?:\s|$)`
Captures both `CALL 'PROG' USING PARAM` and bare `CALL 'PROG'` (no USING clause).
Trailing commas or punctuation are stripped from the captured `using` value.
Produces: `[{ program: "C_BEGCOM", using: "WBCR-VARS" }]` or `[{ program: "SYS-UTIL", using: null }]`
Feeds directly into `graphService` for call graph edges (unchanged).

**EXEC SQL blocks**
The COBOL source is first normalised using the same `parseLine()` / `stripSequenceNumber()` logic already in `cobolParser.js` to strip fixed-format sequence numbers before applying regex.
Then: find every `EXEC SQL ... END-EXEC` block (multi-line, case-insensitive), extract the first DML keyword (SELECT / INSERT / UPDATE / DELETE) and the table name from the FROM / INTO / UPDATE clause.
Produces: `[{ table: "USER_TABLE", operation: "SELECT", fields: ["USR_ID", "USR_NM"] }]`
If no EXEC SQL blocks exist, returns `[]`. This result is passed to the AI as input context only — it does not bypass the AI output (see Phase 3 storage note).

**SELECT statements (file I/O)**
Regex: `SELECT\s+(\S+)\s+ASSIGN`
Produces file names for file I/O declarations.

**Constructs**
Keyword presence scan (PERFORM, IF, EVALUATE, CALL, COMPUTE, GO TO, ALTER, etc.) — same as old project.

### Phase 2: Single AI Call — `INTERFACE_PROMPT`

**Input** (compact, structured text, ~5 000 tokens):
```
LINKAGE SECTION:
<raw linkage text>

PARAGRAPHS:
[MAIN-LOGIC-START]
  INITIALIZE WGET-USR-INFO
  CALL 'c_curpid' USING WGET-PID-INFO
...

[GET-USER-INFO]
  MOVE LPEI-LNG-CD TO PEI-LNG-CD
...

CALL STATEMENTS:
  CALL 'c_curpid' USING WGET-PID-INFO
  CALL 'c_gpluid' USING WGET-USR-USR-ID
...

FILE I/O:
  USR-FILE (SELECT ASSIGN)

DATABASE OPERATIONS (from EXEC SQL):
  USER_TABLE: SELECT [USR_ID, USR_NM]

CONSTRUCTS: PERFORM, IF, CALL, READ, WRITE
```

**Output** (one JSON object, ~3 000 tokens):
```json
{
  "programType": "subroutine",
  "description": "2-3 factual sentences about what the program does",
  "flow_narrative": "Step-by-step from entry to exit in plain English, 5-8 sentences",
  "parameters": [
    { "name": "userInfo", "cobolName": "WGET-USR-INFO", "type": "object", "direction": "inout" }
  ],
  "fileIO": [
    { "file": "USR-FILE", "operations": ["OPEN", "READ", "WRITE", "CLOSE"] }
  ],
  "externalCalls": [
    { "program": "c_curpid", "using": "WGET-PID-INFO" }
  ],
  "dbTables": [
    { "table": "USER_TABLE", "operation": "SELECT", "fields": ["USR_ID", "USR_NM"] }
  ],
  "sections": [
    { "name": "MAIN-LOGIC-START", "purpose": "Initialises user data, fetches process ID and user ID from system programs" },
    { "name": "GET-USER-INFO", "purpose": "Reads user record from USR file and populates output structure" }
  ]
}
```

**Key fields:**
- `direction: "in" | "out" | "inout"` — directly maps to JS function parameter style
- `sections[].purpose` — one sentence per paragraph, replaces per-chunk AI calls
- `dbTables` — AI confirms and enriches the regex-extracted SQL data
- `flow_narrative` — full execution narrative for documentation and JS rewrite context

### Phase 3: Store Results

After the interface spec AI call:

1. **Create / update the `program_analysis` row** via `upsertAnalysis()` (called first, as now), passing `description` from the interface spec and empty arrays for `external_calls` / `db_tables`. This ensures the row exists before subsequent updates.
2. **Update analysis fields** via `updateAnalysisFields()`: write `external_calls`, `db_tables` (AI output — the regex extraction is input context only; AI output is stored as-is), `file_ops`, `input_contract` (parameters with direction, JSON), `output_contract` (out/inout parameters only, JSON), `flow_narrative`.
3. **Update each `program_chunk`** record: match `chunk_name` to `sections[].name` from the AI response; call `updateChunkPurpose(id, purpose)` for each match. Unmatched chunks are left as-is (no error).
4. **Update call graph** via `graphService.updateGraphAfterAnalysis` using `external_calls` — the orchestrator maps the AI's camelCase `externalCalls` field to snake_case `external_calls` before passing to storage and graph functions. Same interface as now.

### Phase 4: Diagram (unchanged)

Separate AI call using `flow_narrative` (the 5-8 sentence execution narrative) as input to `DIAGRAM_PROMPT` — this produces a richer diagram than the short `description`. Same call structure as current.

---

## Data Model Changes

### `program_analysis` table

No new columns needed — all required columns were added in the previous sprint (`input_contract`, `output_contract`, `flow_narrative`, `file_ops`). The `call_parameters` column is superseded by `input_contract` but kept for backward compatibility (not populated going forward).

### `program_chunks` table

`analysis` JSONB column already exists. New shape: `{ "purpose": "one sentence" }` — replaces previous `{ description, business_rules, calls, file_ops, db_ops }` shape.

---

## Files to Change

| File | Change |
|---|---|
| `src/parser/cobolParser.js` | Add `extractLinkage()`, `extractExecSql()`, `extractCalls()`, `extractConstructs()`. Parser returns these alongside chunks. Each paragraph chunk includes a `snippet` field (first 5 lines). |
| `src/ai/prompts.js` | Remove `CHUNK_PROMPT`, `DATA_PROMPT`, `SYNTHESIS_PROMPT`, `METADATA_PROMPT`. Add `INTERFACE_PROMPT`. Keep `DIAGRAM_PROMPT`. |
| `src/ai/providers/base.js` | Remove `extractMetadata()`, `analyzeChunk()`, `analyzeData()`, `synthesize()`. Add `extractInterface()`. Keep `generateDiagram()`. |
| `src/ai/providers/openai.js` | Same method changes as base. |
| `src/ai/providers/claude.js` | Same method changes as base. |
| `src/ai/orchestrator.js` | Replace full pipeline: deterministic extraction → `extractInterface()` → store section purposes to chunks → diagram. |
| `src/models/programAnalysis.js` | Update `updateAnalysisFields()` to write `input_contract`, `output_contract`, `flow_narrative`, `file_ops`. |
| `src/models/programChunks.js` | Add `updateChunkPurpose(id, purpose)` — sets `analysis = '{"purpose": <purpose>}'::jsonb` for the given chunk id. Remove `getRetryableChunks()`. |
| `src/services/analysisService.js` | Update `runAnalysisInBackground()` to use new orchestrator output shape. Remove `updateChunkAnalysis`, `markChunkFailed` calls (no per-chunk AI). Keep `insertChunks`. |

---

## What Does Not Change

- `graphService.js` — receives `externalCalls` array and builds edges. Same interface.
- `cobolParser.js` chunking logic — paragraphs and `data_summary` chunks are still created and stored as before. New extraction functions (`extractLinkage`, `extractExecSql`, `extractCalls`, `extractConstructs`) are added to the same file; chunk creation logic is untouched. No new DB columns for chunks.
- `DetailPanel` UI — reads from the same DB columns. No frontend changes needed.
- `program_edges`, `programs` tables — unchanged.
- `upsertAnalysis()` — still called at the start of the pipeline to create the row.

## Reanalyze Flow

The existing `reanalyze()` function in `analysisService.js` currently calls `getRetryableChunks(programId)` and passes the result to `runAnalysisInBackground()`. **This is incompatible with the new design** — the new orchestrator does not accept a chunk list; it takes the full COBOL source text.

`reanalyze()` must be updated to:
1. Set program status to `analyzing`
2. Read the COBOL file from disk (unchanged)
3. Call `runAnalysisInBackground(programId, program.name, cobolText, sseEmitters)` — same signature as the normal upload flow, no chunk argument

`getRetryableChunks()` in `programChunks.js` is no longer called anywhere and can be removed.

---

## Token Cost Comparison

| | Current | New |
|---|---|---|
| Calls per file | 71 + 1 synthesis + 1 diagram | 1 interface + 1 diagram |
| Input tokens (typical) | ~145 000 | ~5 000 |
| Input tokens (upper bound) | ~145 000 | ~20 000 (200 paragraphs + large LINKAGE) |
| Output tokens | ~145 000 (often truncated) | ~3 000 |
| Truncation errors | Yes (WORKING-STORAGE) | No |
| Quality | Per-chunk noise + vague synthesis | Structured interface spec |

Token estimates for the new approach assume a typical file (50–70 paragraphs, short LINKAGE section). Programs with 200+ paragraphs or a multi-hundred-line LINKAGE section will use more tokens but remain well within model context limits (128k).

---

## Error Handling

- If `INTERFACE_PROMPT` returns invalid JSON → log error, mark program as `failed`, emit `failed` SSE event (same as current)
- If EXEC SQL regex extracts no tables → `dbTables` passed as `[]` to AI; AI may still infer from context
- If a section name from AI response does not match any chunk name → skip (no chunk updated); log warning
- Diagram failure is non-fatal (same as current)

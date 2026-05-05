# Analysis Quality: Structured `notFoundAction` and Prompt Improvements

**Date:** 2026-05-05  
**Goal:** Improve AI analysis quality so that `dbOperations[].notFoundAction` is machine-readable (for code generation) and steps are precise enough to implement from without reading the COBOL.

---

## Problem

The current `notFoundAction` field in `dbOperations` is a free-text string:

```json
{ "table": "exrcdv", "notFoundAction": "error 1508" }
{ "table": "exricf", "notFoundAction": "Initialize ICF record" }
```

This is ambiguous for code generation: "error 1508" does not tell us whether to stop execution or continue after logging. "Initialize ICF record" does not specify which fields get which values. The AI had no schema constraint — it invented its own format.

Additional problems:
- Steps lack specificity: field names and conditions are sometimes vague
- AI adds hallucinated error codes (e.g. `9999`) not present in the COBOL source

---

## Design

### 1. `notFoundAction` Schema

`notFoundAction` becomes a structured object. Four types:

```json
{ "type": "error", "code": 1508 }
```
Execution stops, error code is returned.

```json
{ "type": "defaults", "fields": { "EXIRO-INSYNC-ACTV": 0, "EXIRO-UPD-AUTH-REQD": 1 }, "logError": true }
```
Sets specific output fields to specified values and continues. `logError: true` when the COBOL also logs/calls an error paragraph before continuing.

```json
{ "type": "continue" }
```
Execution continues normally — record absence is acceptable business logic.

```json
{ "type": "skip" }
```
The DB operation is skipped entirely (conditional execution that doesn't run).

**DB migration:** `dbOperations` is already JSONB — no column migration needed. Old string values are invalidated by deleting existing analyses (see Migration section).

---

### 2. Prompt Changes

Three rules added/updated in `BUSINESS_ANALYSIS_PROMPT` and `ANALYZE_ENTRY_POINT_PROMPT` (and their C equivalents):

**Rule 1 — `notFoundAction` structure (new rule):**
```
- dbOperations[].notFoundAction: required structured object — determine by reading the COBOL paragraph:
  { "type": "error", "code": N }                                          — COBOL sets error output and stops
  { "type": "defaults", "fields": { "FIELD-NAME": value }, "logError": bool } — COBOL sets specific fields and continues
  { "type": "continue" }                                                  — COBOL falls through, absence is acceptable
  { "type": "skip" }                                                      — operation is conditionally skipped
  Read the actual paragraph to determine which applies — do not guess from the error catalog.
```

**Rule 2 — Steps precision (strengthen existing rule):**
```
- each step that reads a DB table must reference the notFoundAction behavior inline:
  e.g. "SELECT exrcdv WHERE CDV-MACADDR = EXIRI-MACADDR;
        if not found: set EXIRO-INSYNC-ACTV=0, EXIRO-UPD-AUTH-REQD=1 and continue (log error)"
  not: "Read CDV record"
```

**Rule 3 — Anti-hallucination for error catalog (new rule):**
```
- errorCatalog: include ONLY error codes explicitly set in the COBOL source
  (MOVE <literal-number> TO output-status-field or equivalent).
  Never include generic codes like 9999 unless they appear literally in the COBOL.
```

---

### 3. Migration

Existing `program_analysis` rows are **deleted**, not migrated. Old string `notFoundAction` values cannot be reliably parsed into typed objects. After deploying the new prompts, all programs are re-analyzed via the existing "Re-analyze" button. Programs with no value (only 2 analyzed currently) — low migration cost.

---

### 4. UI — LogicTab `DbOpRow`

`notFoundAction` rendering updates from string to typed display:

| type | display |
|------|---------|
| `error` | `→ error 1508` in red |
| `defaults` | `→ defaults (FIELD=0)` in yellow + `⚡log` if logError |
| `continue` | `→ continue` in grey |
| `skip` | *(nothing shown)* |

---

## Scope

**In scope:**
- `notFoundAction` structured object in prompt + UI render
- Steps precision rule (prompt only)
- Anti-hallucination rule for error catalog (prompt only)
- Delete existing analyses, re-analyze after deploy

**Out of scope:**
- Structured step objects (kept as enriched strings — Variant A)
- UI editing of analysis fields
- Table Catalog feature
- Code generation improvements

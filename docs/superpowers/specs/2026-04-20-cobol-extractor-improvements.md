# COBOL Extractor Improvements — Parser Split + Key Field Extraction

**Date:** 2026-04-20
**Status:** Approved

## Goal

Fix two root-cause problems that cause AI to invent table names and produce vague analysis:

1. `extractTuxTables` silently returns `[]` for programs that use the `COMMON-FUNC` pattern (e.g. EXYVLL) because the current regex only handles `MOVE "RD" TO PREFIX-FUNC`.
2. Neither TUX nor EXEC SQL extractor captures key fields (WHERE clause fields), so the AI receives `exreur: READ` with no context and fills in the blanks with invented names.

Additionally, split `cobolParser.js` into two focused files before it grows further.

## File Split

### `server/src/parser/cobolParser.js` — structure only

Keeps everything related to chunking and structural extraction:
- `preprocessCobol` — strip sequence numbers, remove comments, truncate at `OPEN-REC.`, collapse blanks
- `parseCobol` — split source into `data_summary` / `paragraph` / `sub_paragraph` chunks
- `extractLinkageVars`, `extractWorkingStorage` — DATA DIVISION variable extraction
- `extractEvaluateDispatch` — EVALUATE dispatch block
- `extractPerformGraph`, `resolveTransitive` — PERFORM dependency graph
- `detectFixedFormat`, `stripSequenceNumber` — format utilities (used internally + by extractor)

### `server/src/parser/cobolExtractor.js` — data extraction (new file)

All extraction that produces structured data for the AI context:
- `extractTuxTables` — tables + operations + key fields (TUX middleware)
- `extractExecSql` — tables + operations + key fields (EXEC SQL)
- `extractCalls` — CALL statements
- `extractErrorEntries` — error seq numbers + data elements
- `extractConstructs` — list of COBOL constructs used

`orchestrator.js` imports from both files. Existing tests for extractor functions move to a new test file `server/tests/parser/cobolExtractor.test.js`.

## TUX Extractor Fix (`extractTuxTables`)

### Current problem

The function correctly builds a `prefixMap` from TABNAM declarations (the split-line regex already works). It then fails to detect operations because it only looks for:

```
MOVE "RD" TO EXREUR-FUNC
```

EXYVLL and similar programs instead use a shared `COMMON-FUNC` intermediate — the regex matches 0 times and returns `[]`.

### New operation detection: paragraph naming convention

After building `prefixMap`, scan all paragraph names in `performGraph` for the pattern `{VERB}-{PREFIX}` where PREFIX is a key in `prefixMap`:

| Paragraph name pattern | Operation |
|---|---|
| `READ-EUR`, `VLD-EUR`, `READ-EUR-REC` | READ |
| `START-GE-KEY1-EUR`, `READ-NEXT-EUR` | READ |
| `INSERT-EUR`, `INS-EUR` | INSERT |
| `UPDATE-EUR`, `UPD-EUR` | UPDATE |
| `DELETE-EUR`, `DEL-EUR` | DELETE |
| `OPEN-EUR`, `CLOSE-EUR` | skip (infrastructure) |

Algorithm:
1. For each paragraph name in `performGraph`, extract the prefix (last hyphen-separated token or second token).
2. Check if prefix matches a key in `prefixMap`.
3. Map verb prefix to operation type.
4. Keep existing `MOVE "OP" TO PREFIX-FUNC` detection as fallback (for programs where it works).
5. Deduplicate: same table may appear from both strategies; merge operations.

### Key field extraction

For each PERFORM that references a table (detected by paragraph name), scan the **preceding lines in the same paragraph** for MOVE statements of the form:

```cobol
MOVE <value> TO <PREFIX>-<FIELDNAME>
```

Where `<PREFIX>` matches a prefix in `prefixMap`. These fields are the key being set before the call.

Example — from EXYVLL before `PERFORM VLD-EUR`:
```cobol
MOVE VLLRI-EXEC-LGN-ID  TO  EUR-EXEC-LGN-ID.
PERFORM VLD-EUR THRU VLD-EUR-EXIT.
```
→ `exreur: READ, keyFields: [eur_exec_lgn_id]`

Scan up to 15 lines before each PERFORM. Exclude fields that match `*-FUNC`, `*-TABNAM`, `*-CURSOR`, `*-KEYNUM`, `*-LOCK`, `*-STATUS`, `*-DATA` (infrastructure fields, not key fields).

### Return shape (unchanged interface)

```js
[{ table: 'exreur', operation: 'READ', keyFields: ['eur_exec_lgn_id'] }]
```

The `keyFields` array is new; callers that don't use it are unaffected.

## EXEC SQL Extractor Fix (`extractExecSql`)

### Current state

Extracts table name + operation only. Fields array is always `[]`.

### Additions

From the full EXEC SQL block text:
- **keyFields**: parse the WHERE clause — extract field names on the left side of conditions (`WHERE field = :var` or `WHERE field = ?`). Strip host variable prefix (`:` or `?`).
- **fields** (SELECT only): extract column names between SELECT and FROM. If `SELECT *` or `SELECT 1`, leave `fields: []`.
- Keep `fields: []` default for INSERT/UPDATE/DELETE (too variable to parse reliably).

Example:
```sql
EXEC SQL
  SELECT EUR-ENBL-FLG
  INTO :EUR-ENBL-FLG
  FROM EXREUR
  WHERE EUR-EXEC-LGN-ID = :EUR-EXEC-LGN-ID
END-EXEC
```
→ `{ table: 'EXREUR', operation: 'SELECT', fields: ['EUR-ENBL-FLG'], keyFields: ['EUR-EXEC-LGN-ID'] }`

### Return shape (unchanged interface)

```js
[{ table: 'EXREUR', operation: 'SELECT', fields: ['EUR-ENBL-FLG'], keyFields: ['EUR-EXEC-LGN-ID'] }]
```

## Context Format Change (`orchestrator.js`)

`buildStructural` formats TUX and EXEC SQL tables in the context string. Add key fields when present:

**Before:**
```
DATABASE OPERATIONS (TUX MIDDLEWARE):
  exreur: READ
  extcns: READ
```

**After:**
```
DATABASE OPERATIONS (TUX MIDDLEWARE):
  exreur: READ  key: eur_exec_lgn_id
  extcns: READ  key: cns_exec_lgn_id, cns_env_nm, cns_env_cl
  exrpda: READ  key: pda_exec_lgn_id, pda_prd_id
```

No schema changes. The improvement flows automatically to all AI analysis.

## Prompt Guardrail (`prompts.js`)

Add one rule to both `BUSINESS_ANALYSIS_PROMPT` and `ANALYZE_ENTRY_POINT_PROMPT` in the `dbTables` and `dbOperations` rule sections:

> `table: use the EXACT name from DATABASE OPERATIONS sections above — never invent, generalize, or translate to English; if you see a table access in paragraph code that is not listed in DATABASE OPERATIONS, write the COBOL prefix as-is (e.g. "eur-unknown") rather than guessing`

## What Is Not Changing

- `parseCobol`, `preprocessCobol` — no changes to chunking or preprocessing logic
- `program_analysis` DB schema — `db_tables.keyFields` already exists in the AI output schema
- C parser (`cParser.js`, `cOrchestrator.js`) — untouched
- Test count for existing passing tests — all must continue to pass

## Files Changed

| File | Change |
|---|---|
| `server/src/parser/cobolParser.js` | Remove extractor functions (moved out) |
| `server/src/parser/cobolExtractor.js` | New file — all extractor functions |
| `server/src/ai/orchestrator.js` | Update imports; update `buildStructural` to show key fields |
| `server/src/ai/prompts.js` | Add table-name guardrail rule |
| `server/tests/parser/cobolExtractor.test.js` | New test file for extractor functions |
| `server/tests/parser/cobolParser.test.js` | Remove tests for moved functions |

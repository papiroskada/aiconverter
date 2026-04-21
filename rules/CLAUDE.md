# Invex CAPI Project — Claude Code Instructions

## Project Overview

This is the **Invex ivx4.5** COBOL-to-C/Node.js API conversion project. We convert
COBOL programs and Netron frames into modern API functions (currently C shared objects,
with Node.js planned).

## Critical Files

- **`CAPI_RULES.md`** — Master rules document. Read this FIRST before
  generating any code or spec. Every rule must be followed exactly.
- **`*_english.md`** — Spec files describing business logic for each API/frame.
  These are language-neutral (Rule 24) and drive code generation.
- **`*.cbl`** — Original COBOL source programs (read-only reference).
- **`*.s`** — Netron source listing files that show which frames a COBOL program
  uses. **Always check the `.s` file** to verify frame usage before mapping
  COBOL paragraphs to C functions (Rule 22h).
- **`*.c`** — Generated C API implementations.
- **`*.h`** — Generated C header files (public structs and function prototypes).

### Directory Structure

- **`frames/`** — Netron frame source files (`*.f`) and their specs
  (`*_english.md`). Each frame with runtime logic becomes a **separate `.c`
  file** (e.g., `incrdm.c`, `mxbgudbw.c`). These are compiled independently
  and called by programs via `extern` declarations (Rule 23d).
- **`frames/inlineframes/`** — Specs (`*_english.md`) for inline frames.
  Inline frames are implemented as **static functions inside the calling
  program's `.c` file** (not as separate `.c` files). In COBOL, the Netron
  generator injects inline frame logic directly into the program's `.cbl`.
  In C, the equivalent is a `static` function within the program's `.c` file.

## Workflow

**Required inputs:** `programname.cbl` (COBOL source) and `programname.s`
(Netron frame listing). Both must be present before creating specs or code.

**Output sequence:** Given a `.cbl` and `.s` file, produce these deliverables
in order:

1. **Check the `.s` file first.** Scan `programname.s` to identify all frames
   used by the program. This determines which C frame functions can be called
   and which logic must be implemented inline (Rule 22h).
2. **Create summary spec** (`programname_english.md`):
   - Program purpose, endpoint table (one per process mode — Rule 27)
   - Shared pre-dispatch logic overview
   - Per-endpoint request parameters and logic summary
   - Input/output field tables, string constants, table references, dependencies
   - Suitable for understanding what the program does and planning work
3. **Create detailed spec** (`programname_detailed_english.md`):
   - Trace COBOL from the top — BUSINESS-LOGIC through every PERFORM
   - Step-by-step algorithm for every function, every conditional, every
     string operation, every SQL query with exact columns/WHERE/ORDER BY
   - Exact table read keys, exact field mappings, exact error codes
   - Exact frame call parameters verified against the `.s` file
   - **Self-sufficient** — code in any language can be generated from this
     file alone, without reading the `.cbl` or `.s` file (Rule 22i)
4. **Generate code from the detailed spec** (NOT from the COBOL):
   - Read `programname_detailed_english.md` as the PRIMARY input
   - Do NOT read the `.cbl` file during code generation — the detailed spec
     must contain everything needed
   - One `.c` file + one `.h` file per program (Rule 27)
   - All process modes as entry points in the same file
   - Shared helpers are static, entry points are public

5. **Create implementation spec** (`programname_impl.md`) — when requested:
   - Created AFTER the C code is working
   - Derived from the working C code, NOT from COBOL
   - Language-neutral pseudocode, exact SQL, complete field mappings
   - Can generate working code in ANY language (C, Node.js, Python)
   - No C-specific syntax, no COBOL references (Rule 22i step 4)

**IMPORTANT: Steps must be sequential, not parallel.** The detailed spec
(step 3) must be complete before code generation (step 4) begins. Never
launch spec creation and code generation as parallel tasks — the code
must be generated from the spec, not from the COBOL directly.

## Key Conventions

### Specs (`*_english.md`)
- Describe **business logic only** — no language-specific details (Rule 24)
- No memory management instructions ("delete the row", "free the object")
- No C-specific types or function names in the logic description
- SQL examples use `SELECT 1 ... LIMIT 1` for existence checks, not `count(*)` (Rule 25)
- Usable to generate code in any target language without modification

### C Code (`*.c`)
- All rules in `CAPI_RULES.md` apply strictly
- **Stack first, pool for returns** (Rule 26): use fixed-size stack buffers for
  local/temp variables; use pool (`invasprintf`) only for strings returned to
  callers or long-lived data. Pool is freed automatically on API unload.
- cJSON from DB reads — always `cJSON_Delete` (only heap objects needing cleanup)
- `invSqlEscapeQuote` for all SQL values — never use `'%s'`
- `pvt` prefix for all private functions
- Single public entry point per file

### Netron Frames (`*.f` → `*.c`)
- Each frame becomes a standalone C function (Rule 23)
- Input work area → function parameters
- Output work area → return values / output pointers
- External service calls (SYCALPGM) → direct C function calls
- Use `extern` declarations in calling files

### PostgreSQL
- **Never use `count(*)` for existence checks** — use `SELECT 1 ... LIMIT 1` (Rule 25)
- Use `count(*)` only when you genuinely need the row count
- `EXISTS` subqueries should use `SELECT 1`, not `SELECT *`

## Common Patterns

### Access Validation
Customer access validation is handled by `arcusacsValidateAccess()` in `arcusacs.c`.
Callers use an `extern` declaration and call it directly — do not inline the logic.

### Second-Structure Reads (ARRCUS2, CRD2, etc.)
These are second working-storage buffers for the same table, not different tables.
In C, use the same `_rec` name with a separate cJSON pointer (Rule 22f).

### Fallback Reads
COBOL often tries one key value, then falls back to another (e.g., address type "O"
then "L"). Preserve this pattern in the spec and implementation.

## Do Not

- Do not generate code without reading `CAPI_RULES.md` first
- Do not add language-specific cleanup to spec files
- Do not use `count(*)` for existence checks
- Do not guess COBOL string constants — verify the exact MOVE statement
- Do not assume table names from field prefixes — verify SYTABLEW declarations
- Do not inline access validation — call `arcusacsValidateAccess`
- Do not create duplicate utility functions — check if one already exists

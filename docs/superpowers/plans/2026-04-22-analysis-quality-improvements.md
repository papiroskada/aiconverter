# Analysis Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI-generated analysis output precise enough that a rewrite engineer can implement from it without reading the original COBOL.

**Architecture:** Two independent changes: (1) prompt rules gain field-level specificity so steps describe actual field names and values; (2) `mapResult` in the COBOL orchestrator derives `input_contract`/`output_contract` from parsed `linkageVars` (which carry real PIC types) instead of AI-guessed `spec.parameters`.

**Tech Stack:** Vitest, Node.js ESM, `server/src/ai/orchestrator.js`, `server/src/ai/prompts.js`

---

## File Map

| File | Change |
|---|---|
| `server/src/ai/prompts.js` | Update `steps` rule in both BUSINESS_ANALYSIS_PROMPT and ANALYZE_ENTRY_POINT_PROMPT |
| `server/src/ai/orchestrator.js` | Add `picToType`/`cobolToCamel` helpers, update `mapResult` signature to accept `linkageVars`, pass it from `runAnalysis` |
| `server/tests/ai/orchestrator.test.js` | Update contract test + add PIC-type derivation test |

---

### Task 1: More precise `steps` rule in prompts

**Files:**
- Modify: `server/src/ai/prompts.js`

The current `steps` rule says "describe WHAT HAPPENS FOR THE BUSINESS, not code mechanics". This produces vague descriptions like "validates user access" that cannot be implemented without the source. We need to require field names, values, and conditions so that steps read like: "Reads EXREUR using key EUR-EXEC-LGN-ID = input login; if not found, returns error 1500 (missing EUR record)."

- [ ] **Step 1: Verify tests still pass before touching anything**

```bash
cd server && npm test
```
Expected: 187 tests pass.

- [ ] **Step 2: Update the `steps` rule in BUSINESS_ANALYSIS_PROMPT**

In `server/src/ai/prompts.js`, find the `entryPoints[].steps` rule (around line 71) and replace:

```
- entryPoints[].steps: include PRE-DISPATCH PARAGRAPHS logic first (validation, access checks, initial setup) — these run before every mode; then mode-specific steps; describe WHAT HAPPENS FOR THE BUSINESS, not code mechanics
```

with:

```
- entryPoints[].steps: include PRE-DISPATCH PARAGRAPHS logic first (validation, access checks, initial setup) — these run before every mode; then mode-specific steps; each step must name the specific fields, values, and conditions involved so a developer can implement it without reading the COBOL — e.g. "Reads EXREUR with key EUR-EXEC-LGN-ID; if not found, returns error 1500" not "validates user access"; include actual error codes, field names, and conditional branches
```

- [ ] **Step 3: Update the same rule in ANALYZE_ENTRY_POINT_PROMPT**

In `server/src/ai/prompts.js`, find the `steps` rule inside `ANALYZE_ENTRY_POINT_PROMPT` (around line 109) and replace:

```
- steps: start with PRE-DISPATCH PARAGRAPHS logic (validation, access, setup listed in context) — these run before this operation too; then describe the operation-specific WHAT HAPPENS FOR THE BUSINESS, not code mechanics
```

with:

```
- steps: start with PRE-DISPATCH PARAGRAPHS logic (validation, access, setup listed in context) — these run before this operation too; then describe the operation-specific logic; each step must name the specific fields, values, and conditions involved so a developer can implement it without reading the COBOL — e.g. "Reads EXREUR with key EUR-EXEC-LGN-ID; if not found, returns error 1500" not "validates user access"; include actual error codes, field names, and conditional branches
```

- [ ] **Step 4: Update the same rule in C_BUSINESS_ANALYSIS_PROMPT**

In `server/src/ai/prompts.js`, find the `steps` rule inside `C_BUSINESS_ANALYSIS_PROMPT` (around line 186) and replace:

```
- entryPoints[].steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init — listed in context), then mode-specific steps; describe WHAT HAPPENS FOR THE BUSINESS
```

with:

```
- entryPoints[].steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init — listed in context), then mode-specific steps; each step must name the specific fields, values, and conditions involved — e.g. "Reads exreur with key eur_exec_lgn_id; if not found, returns error 1500" not "validates user"; include actual error codes, field names, and conditional branches
```

- [ ] **Step 5: Update the same rule in C_ANALYZE_ENTRY_POINT_PROMPT**

In `server/src/ai/prompts.js`, find the `steps` rule inside `C_ANALYZE_ENTRY_POINT_PROMPT` (around line 222) and replace:

```
- steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init from context) — these run before this operation; then operation-specific WHAT HAPPENS FOR THE BUSINESS
```

with:

```
- steps: start with PRE-DISPATCH FUNCTIONS logic (validation, init from context) — these run before this operation; then operation-specific logic; each step must name the specific fields, values, and conditions involved — e.g. "Reads exreur with key eur_exec_lgn_id; if not found, returns error 1500"; include actual error codes, field names, and conditional branches
```

- [ ] **Step 6: Run tests**

```bash
cd server && npm test
```
Expected: 187 tests pass (prompt changes don't affect unit tests).

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/prompts.js
git commit -m "feat(prompts): require field-level specificity in steps descriptions"
```

---

### Task 2: PIC-based parameter contracts in orchestrator

**Files:**
- Modify: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

Currently `mapResult` builds `input_contract`/`output_contract` from AI-generated `spec.parameters`. The AI guesses PIC types and directions. The parser already extracts these precisely from the LINKAGE SECTION (level, name, pic, direction). We should use parsed data as the authoritative source for types and direction, and only keep AI-generated `description` from spec.parameters.

- [ ] **Step 1: Write the failing test**

In `server/tests/ai/orchestrator.test.js`, find the `'splits parameters into input_contract and output_contract'` test (around line 91) and replace it:

```js
it('derives contract types from parsed PIC, not AI spec', async () => {
  const provider = makeProvider()
  const cobolText = [
    'DATA DIVISION.',
    'LINKAGE SECTION.',
    ' 01 CPSRI-PART-ID PIC X(8).',
    ' 01 CPSRO-RTN-STS PIC 9(4).',
    ' 01 CPSRI-COUNT    PIC S9(7).',
    ' 01 CPSRI-GROUP.',
    '    05 CPSRI-SUB PIC X(3).',
    'PROCEDURE DIVISION.',
  ].join('\n')
  const result = await runAnalysis({ cobolText, chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  const input  = JSON.parse(result.input_contract)
  const output = JSON.parse(result.output_contract)

  // input must not contain direction:out fields
  expect(input.every(p => p.direction !== 'out')).toBe(true)
  // output must not contain direction:in fields
  expect(output.every(p => p.direction !== 'in')).toBe(true)

  // types are derived from PIC
  const partId = input.find(p => p.cobolName === 'CPSRI-PART-ID')
  expect(partId.type).toBe('string')   // PIC X(8) → string

  const rtnSts = output.find(p => p.cobolName === 'CPSRO-RTN-STS')
  expect(rtnSts.type).toBe('number')   // PIC 9(4) → number

  const count = input.find(p => p.cobolName === 'CPSRI-COUNT')
  expect(count.type).toBe('number')    // PIC S9(7) → number

  const group = input.find(p => p.cobolName === 'CPSRI-GROUP')
  expect(group.type).toBe('object')    // no PIC → object
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd server && npm test -- tests/ai/orchestrator.test.js
```
Expected: FAIL — current implementation uses AI spec types not PIC types. The `partId.type` assertion fails because AI returns type `'object'` for `WGET-USR-INFO`.

- [ ] **Step 3: Add picToType and cobolToCamel helpers in orchestrator.js**

In `server/src/ai/orchestrator.js`, add after `function estimateTokens(text) { ... }` (around line 15):

```js
function picToType(pic) {
  if (!pic) return 'object'
  if (/^X/i.test(pic)) return 'string'
  if (/^[S9]/i.test(pic)) return 'number'
  return 'string'
}

function cobolToCamel(name) {
  return name.toLowerCase().replace(/-+(.)/g, (_, c) => c.toUpperCase())
}
```

- [ ] **Step 4: Update mapResult signature and implementation**

In `server/src/ai/orchestrator.js`, replace the entire `mapResult` function:

```js
function mapResult(spec, linkageVars, preDispatch = [], twoStep = false) {
  const descMap = new Map((spec.parameters ?? []).map(p => [p.cobolName?.toUpperCase(), p.description ?? '']))

  const contracts = linkageVars.map(v => ({
    name: cobolToCamel(v.name),
    cobolName: v.name,
    type: picToType(v.pic),
    direction: v.direction ?? 'inout',
    description: descMap.get(v.name) ?? '',
  }))

  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(contracts.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(contracts.filter(p => p.direction !== 'in')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations })),
    pre_dispatch:      preDispatch,
    analysis_two_step: twoStep,
  }
}
```

- [ ] **Step 5: Update both callsites of mapResult in runAnalysis**

In `server/src/ai/orchestrator.js`, find the two existing `mapResult` calls and update them to pass `linkageVars`:

```js
// small-file path (around line 175):
return mapResult(spec, linkageVars, preDispatchNames, false)

// large-file two-step path (around line 220):
return mapResult(spec, linkageVars, preDispatchNames, true)
```

- [ ] **Step 6: Run tests**

```bash
cd server && npm test -- tests/ai/orchestrator.test.js
```
Expected: all 24 orchestrator tests pass including the new PIC-type test.

- [ ] **Step 7: Run full test suite**

```bash
cd server && npm test
```
Expected: all 187+ tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/ai/orchestrator.js server/tests/ai/orchestrator.test.js
git commit -m "feat(orchestrator): derive parameter contracts from parsed PIC types"
```

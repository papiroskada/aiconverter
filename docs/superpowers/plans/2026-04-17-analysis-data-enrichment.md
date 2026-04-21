# Analysis Data Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store richer analysis data — `paragraphNames` in entry_points, structured `db_tables` with key fields and not-found actions, pre-dispatch paragraph list, and analysis metadata (model + two-step flag) — and display it all in the frontend.

**Architecture:** Four DB columns added to `program_analysis`; AI prompts updated to return richer `db_tables`; orchestrators stop stripping `paragraphNames` and return `pre_dispatch` + `analysis_two_step`; service layer tags `analysis_model` from settings; frontend DataTab and LogicTab updated to render all new fields. No new tables — all changes extend existing JSONB columns or add TEXT/BOOL columns.

**Tech Stack:** Node.js/Express, PostgreSQL (JSONB), React 18, Vitest, `npm test` inside `server/`.

---

## File Map

| File | Change |
|------|--------|
| `server/src/db/schema.sql` | Add `pre_dispatch`, `analysis_model`, `analysis_two_step` columns |
| `server/src/models/programAnalysis.js` | `upsertBusinessAnalysis` accepts 3 new fields |
| `server/src/ai/prompts.js` | `db_tables` schema gains `keyFields` + `notFoundAction`; rule added |
| `server/src/ai/orchestrator.js` | `mapResult` keeps `paragraphNames`; `runAnalysis` returns `pre_dispatch` + `analysis_two_step` |
| `server/src/ai/cOrchestrator.js` | Same two changes as orchestrator |
| `server/src/services/analysisService.js` | Passes `analysis_model` (from settings) to `upsertBusinessAnalysis` |
| `server/tests/ai/orchestrator.test.js` | 4 new assertions; update `mapResult` expectations |
| `server/tests/ai/cOrchestrator.test.js` | 3 new assertions |
| `client/src/components/Panel/DataTab.jsx` | Richer table rows (keyFields, notFoundAction, metadata footer) |
| `client/src/components/Panel/LogicTab.jsx` | Pre-dispatch section above entry points |

---

## Task 1: DB Migration

**Files:**
- Modify: `server/src/db/schema.sql`

- [ ] **Step 1: Append migration to `schema.sql`**

Add at the very end of `server/src/db/schema.sql`:

```sql
-- Analysis data enrichment: pre-dispatch list, model metadata, two-step flag
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS pre_dispatch       JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS analysis_model     TEXT,
  ADD COLUMN IF NOT EXISTS analysis_two_step  BOOLEAN;
```

- [ ] **Step 2: Run migration**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm run migrate
```

Expected: `Migration complete`

- [ ] **Step 3: Verify columns**

```bash
psql postgresql://postgres:postgres@localhost:5432/cobol_converter -c "\d program_analysis" 2>&1 | grep -E "pre_dispatch|analysis_model|analysis_two_step"
```

Expected: three rows listing the new columns.

- [ ] **Step 4: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add server/src/db/schema.sql
git commit -m "feat(db): add pre_dispatch, analysis_model, analysis_two_step to program_analysis"
```

---

## Task 2: Update `programAnalysis.js` Model

**Files:**
- Modify: `server/src/models/programAnalysis.js`

- [ ] **Step 1: Replace `upsertBusinessAnalysis`**

```js
export async function upsertBusinessAnalysis(program_id, {
  business_purpose, input_contract, output_contract,
  entry_points, error_catalog, external_dependencies,
  db_tables, file_ops,
  pre_dispatch = [], analysis_model = null, analysis_two_step = null,
}) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis
       (program_id, business_purpose, input_contract, output_contract,
        entry_points, error_catalog, external_dependencies, db_tables, file_ops,
        pre_dispatch, analysis_model, analysis_two_step)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (program_id) DO UPDATE SET
       business_purpose      = EXCLUDED.business_purpose,
       input_contract        = EXCLUDED.input_contract,
       output_contract       = EXCLUDED.output_contract,
       entry_points          = EXCLUDED.entry_points,
       error_catalog         = EXCLUDED.error_catalog,
       external_dependencies = EXCLUDED.external_dependencies,
       db_tables             = EXCLUDED.db_tables,
       file_ops              = EXCLUDED.file_ops,
       pre_dispatch          = EXCLUDED.pre_dispatch,
       analysis_model        = EXCLUDED.analysis_model,
       analysis_two_step     = EXCLUDED.analysis_two_step,
       updated_at            = NOW()
     RETURNING *`,
    [
      program_id,
      business_purpose ?? null,
      input_contract   ?? null,
      output_contract  ?? null,
      JSON.stringify(entry_points          ?? []),
      JSON.stringify(error_catalog         ?? []),
      JSON.stringify(external_dependencies ?? []),
      JSON.stringify(db_tables             ?? []),
      JSON.stringify(file_ops              ?? []),
      JSON.stringify(pre_dispatch          ?? []),
      analysis_model     ?? null,
      analysis_two_step  ?? null,
    ]
  )
  return rows[0]
}
```

- [ ] **Step 2: Run tests — must still pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | tail -6
```

Expected: `Tests  179 passed (179)`

- [ ] **Step 3: Commit**

```bash
git add server/src/models/programAnalysis.js
git commit -m "feat(model): upsertBusinessAnalysis accepts pre_dispatch, analysis_model, analysis_two_step"
```

---

## Task 3: Richer `db_tables` in Prompts

**Files:**
- Modify: `server/src/ai/prompts.js`

`db_tables` gains two new fields per entry: `keyFields` (WHERE lookup fields) and `notFoundAction` (what the program does if the row is absent).

- [ ] **Step 1: Update `BUSINESS_ANALYSIS_PROMPT` — db_tables schema and rule**

In `BUSINESS_ANALYSIS_PROMPT`, replace the `dbTables` line in the JSON schema:

```js
// old:
  "dbTables": [
    { "table": "TABLE-NAME", "operation": "SELECT|INSERT|UPDATE|DELETE", "fields": ["FIELD-NAME"] }
  ],

// new:
  "dbTables": [
    {
      "table": "TABLE-NAME",
      "operation": "SELECT|INSERT|UPDATE|DELETE",
      "fields": ["FIELD-NAME"],
      "keyFields": ["KEY-FIELD-USED-IN-WHERE-OR-INDEX"],
      "notFoundAction": "error 1500 | fallback read with key X | return empty | n/a"
    }
  ],
```

In the `Rules:` section, replace the `dbTables` rule:

```
- dbTables: combine DATABASE OPERATIONS (EXEC SQL) and DATABASE OPERATIONS (TUX MIDDLEWARE); for each table access also capture: keyFields = fields used in the WHERE clause or key lookup (e.g. primary key field); notFoundAction = what happens if the row does not exist (error code, fallback read with a different key, or "return empty"); if no key info is available use []; if write-only (INSERT/UPDATE/DELETE) set notFoundAction to "n/a"
```

- [ ] **Step 2: Update `ANALYZE_ENTRY_POINT_PROMPT` — same db_tables schema**

The per-entry-point prompt doesn't have `dbTables` in its output schema (it only returns steps/sideEffects/returns/errors). No change needed here — the richer table data comes from the main analysis call.

- [ ] **Step 3: Update `C_BUSINESS_ANALYSIS_PROMPT` — same db_tables change**

Replace `dbTables` line in `C_BUSINESS_ANALYSIS_PROMPT` JSON schema:

```js
// old:
  "dbTables": [
    { "table": "table-name", "operation": "SGE|RDN|UPD|DEL|INL", "fields": ["field-name"] }
  ],

// new:
  "dbTables": [
    {
      "table": "table-name",
      "operation": "SGE|RDN|UPD|DEL|INL",
      "fields": ["field-name"],
      "keyFields": ["key-field-used-in-lookup"],
      "notFoundAction": "error code | fallback read | return empty | n/a"
    }
  ],
```

Replace the `dbTables` rule in `C_BUSINESS_ANALYSIS_PROMPT`:

```
- dbTables: use DATABASE CALLS (svcCallPlnsqlio) — for each call also capture: keyFields = fields passed as lookup key; notFoundAction = what happens if no row found (error code, fallback call, or "return empty"); INL/UPD/DEL → notFoundAction "n/a"
```

- [ ] **Step 4: Run tests — must still pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | tail -6
```

Expected: `Tests  179 passed (179)`

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/prompts.js
git commit -m "feat(prompts): db_tables gains keyFields + notFoundAction for WHERE key and not-found tracking"
```

---

## Task 4: COBOL Orchestrator — keep `paragraphNames`, add `pre_dispatch` + `analysis_two_step`

**Files:**
- Modify: `server/src/ai/orchestrator.js`

Three changes:
1. `mapResult` — stop stripping `paragraphNames` from entry_points
2. `mapResult` — accept `preDispatch` arg, include in return shape
3. `runAnalysis` — track whether large-file two-step was used; pass pre-dispatch list to `mapResult`

- [ ] **Step 1: Update `mapResult` in `orchestrator.js`**

Find the `mapResult` function. Replace it:

```js
function mapResult(spec, preDispatch = [], twoStep = false) {
  const params = spec.parameters ?? []
  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(params.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(params.filter(p => p.direction !== 'in')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  (spec.fileIO ?? []).map(f => ({ file: f.file, operations: f.operations })),
    pre_dispatch:       preDispatch,
    analysis_two_step:  twoStep,
  }
}
```

Key difference from old: `entry_points` is now `spec.entryPoints ?? []` with no `.map(({ paragraphNames: _, ...ep }) => ep)` — `paragraphNames` are kept.

- [ ] **Step 2: Update `runAnalysis` to pass pre-dispatch and two-step flag**

In `runAnalysis`, find the two return points (small file and after large-file merge). Replace both:

```js
  // --- Small file path ---
  if (estimateTokens(fullContext) <= TOKEN_LIMIT) {
    spec = await provider.extractBusinessAnalysis(fullContext, signal)
    // small file → single call, twoStep = false
    logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
    emit('progress', { stage: 'step', step: 2, total: 2 })
    return mapResult(spec, preDispatchNames, false)
  }

  // --- Large file path ---
  // ... (existing snippet + parallel detail logic unchanged) ...
  // At the very end, replace the existing return:
  logAndEmit(emit, programName, 'done', { stage: 'analysis', message: 'Analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })
  return mapResult(spec, preDispatchNames, true)
```

Remove the old single `return mapResult(spec)` at the bottom (it will no longer exist after splitting into two paths).

- [ ] **Step 3: Run tests — expect some failures (we'll fix in Task 6)**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | grep -E "FAIL|passed|failed" | tail -5
```

Expected: existing orchestrator tests may fail if they assert `paragraphNames` is undefined — that's OK, Task 6 fixes tests.

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/orchestrator.js
git commit -m "feat(orchestrator): keep paragraphNames in entry_points; return pre_dispatch + analysis_two_step"
```

---

## Task 5: C Orchestrator — same changes

**Files:**
- Modify: `server/src/ai/cOrchestrator.js`

- [ ] **Step 1: Update `mapResult` in `cOrchestrator.js`**

Replace `mapResult`:

```js
function mapResult(spec, preDispatch = [], twoStep = false) {
  const params = spec.parameters ?? []
  return {
    business_purpose: spec.businessPurpose ?? '',
    input_contract:   JSON.stringify(params.filter(p => p.direction !== 'out')),
    output_contract:  JSON.stringify(params.filter(p => p.direction === 'out' || p.direction === 'inout')),
    entry_points:          spec.entryPoints ?? [],
    error_catalog:         spec.errorCatalog ?? [],
    external_dependencies: spec.externalDependencies ?? [],
    db_tables: spec.dbTables ?? [],
    file_ops:  [],
    pre_dispatch:       preDispatch,
    analysis_two_step:  twoStep,
  }
}
```

Same change: `spec.entryPoints ?? []` without stripping `paragraphNames`.

- [ ] **Step 2: Update `runCAnalysis` to pass pre-dispatch and two-step**

In `runCAnalysis`, replace the two `return mapResult(spec)` calls:

```js
  // Small file path:
  if (estimateCTokens(fullContext) <= TOKEN_LIMIT) {
    spec = await provider.extractBusinessAnalysis(fullContext, signal, 'c')
    logAndEmit('done', { stage: 'analysis', message: 'C analysis complete' })
    emit('progress', { stage: 'step', step: 2, total: 2 })
    return mapResult(spec, preDispatch, false)
  }

  // After large-file parallel step, replace the final return:
  logAndEmit('done', { stage: 'analysis', message: 'C analysis complete' })
  emit('progress', { stage: 'step', step: 2, total: 2 })
  return mapResult(spec, preDispatch, true)
```

- [ ] **Step 3: Commit**

```bash
git add server/src/ai/cOrchestrator.js
git commit -m "feat(c-orchestrator): keep paragraphNames; return pre_dispatch + analysis_two_step"
```

---

## Task 6: Update Tests

**Files:**
- Modify: `server/tests/ai/orchestrator.test.js`
- Modify: `server/tests/ai/cOrchestrator.test.js`

- [ ] **Step 1: Update existing `orchestrator.test.js` assertion that checks `paragraphNames` is stripped**

Find this test (in `runAnalysis — large file two-step`):

```js
it('strips paragraphNames from final entry_points', async () => {
  const provider = makeProvider()
  const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
  expect(result.entry_points[0].paragraphNames).toBeUndefined()
})
```

Replace with the inverse — `paragraphNames` is now KEPT:

```js
it('keeps paragraphNames in final entry_points', async () => {
  const provider = makeProvider()
  const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
  expect(Array.isArray(result.entry_points[0].paragraphNames)).toBe(true)
})
```

- [ ] **Step 2: Add 4 new tests to `orchestrator.test.js`**

Append inside `describe('runAnalysis — small file', ...)`:

```js
it('returns analysis_two_step: false for small file', async () => {
  const provider = makeProvider()
  const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  expect(result.analysis_two_step).toBe(false)
})

it('returns pre_dispatch as array', async () => {
  const provider = makeProvider()
  const result = await runAnalysis({ cobolText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  expect(Array.isArray(result.pre_dispatch)).toBe(true)
})
```

Append inside `describe('runAnalysis — large file two-step', ...)`:

```js
it('returns analysis_two_step: true for large file', async () => {
  const provider = makeProvider()
  const result = await runAnalysis({ cobolText: '', chunks: hugeChunks, provider, emit: () => {}, programName: 'T' })
  expect(result.analysis_two_step).toBe(true)
})
```

- [ ] **Step 3: Add 3 new tests to `cOrchestrator.test.js`**

Inside `describe('runCAnalysis', ...)`, append:

```js
it('returns analysis_two_step: false for small file', async () => {
  const provider = makeProvider()
  const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  expect(result.analysis_two_step).toBe(false)
})

it('returns pre_dispatch as array', async () => {
  const provider = makeProvider()
  const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  expect(Array.isArray(result.pre_dispatch)).toBe(true)
})

it('keeps paragraphNames in entry_points', async () => {
  const provider = makeProvider({
    extractBusinessAnalysis: vi.fn().mockResolvedValue({
      businessPurpose: 'Test',
      parameters: [],
      entryPoints: [{ condition: 'always', businessName: 'Run', paragraphNames: ['pvtFoo'], steps: [], sideEffects: [], returns: '', errors: [] }],
      errorCatalog: [], externalDependencies: [], dbTables: [], fileIO: [],
    }),
  })
  const result = await runCAnalysis({ cText: MINIMAL_C, uText: '', chunks: makeChunks(), provider, emit: () => {}, programName: 'T' })
  expect(Array.isArray(result.entry_points[0].paragraphNames)).toBe(true)
})
```

- [ ] **Step 4: Run all tests — all must pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | tail -6
```

Expected: `Tests  182 passed (182)` (179 + 3 net new after updating 1 existing assertion)

- [ ] **Step 5: Commit**

```bash
git add server/tests/ai/orchestrator.test.js server/tests/ai/cOrchestrator.test.js
git commit -m "test: update orchestrator tests — paragraphNames kept; add pre_dispatch + analysis_two_step assertions"
```

---

## Task 7: Service Layer — Pass `analysis_model`

**Files:**
- Modify: `server/src/services/analysisService.js`

The service knows which settings were used. After running analysis, it annotates the result with `analysis_model` before saving.

- [ ] **Step 1: Update `runAnalysisCore` in `analysisService.js`**

Find the block that calls `upsertBusinessAnalysis`:

```js
    await upsertBusinessAnalysis(programId, result)
```

Replace with:

```js
    const analysisModel = settings.ai_provider === 'openai'
      ? (settings.openai_model_interface ?? 'gpt-4o')
      : (settings.claude_model_interface ?? 'claude-sonnet-4-6')
    await upsertBusinessAnalysis(programId, { ...result, analysis_model: analysisModel })
```

- [ ] **Step 2: Run all tests — must still pass**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/server && npm test 2>&1 | tail -6
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/analysisService.js
git commit -m "feat(service): annotate analysis result with analysis_model from settings before saving"
```

---

## Task 8: Frontend — `DataTab` and `LogicTab`

**Files:**
- Modify: `client/src/components/Panel/DataTab.jsx`
- Modify: `client/src/components/Panel/LogicTab.jsx`

### DataTab changes

Each `db_tables` row now shows:
- Table name + operation badge (existing)
- Fields: `fields` list (existing)
- Key: `keyFields` (new — WHERE fields)
- Not found: `notFoundAction` (new — what happens when row absent)

Footer shows `analysis_model` and `analysis_two_step` if present.

- [ ] **Step 1: Replace `DataTab.jsx`**

```jsx
function opColor(op = '') {
  const hasRead  = /READ|SELECT|SGE|RDN/.test(op)
  const hasWrite = /WRITE|INSERT|UPDATE|DELETE|INL|UPD|DEL/.test(op)
  if (hasRead && hasWrite) return '#f59e0b'
  if (hasRead) return '#4ade80'
  return '#f87171'
}

const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const subLabelStyle = { color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2, marginTop: 6 }

export default function DataTab({ analysis }) {
  const dbTables = analysis?.db_tables ?? []
  const fileOps  = analysis?.file_ops  ?? []
  const model    = analysis?.analysis_model
  const twoStep  = analysis?.analysis_two_step

  if (!dbTables.length && !fileOps.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No database tables or file operations found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {dbTables.length > 0 && (
        <div>
          <label style={labelStyle}>Database Tables ({dbTables.length})</label>
          {dbTables.map((t, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{t.table}</span>
                <span style={{ fontSize: 11, color: opColor(t.operation), fontFamily: 'monospace' }}>{t.operation}</span>
              </div>

              {t.fields?.length > 0 && (
                <>
                  <div style={subLabelStyle}>Fields</div>
                  <p style={{ color: '#94a3b8', fontSize: 11, margin: 0 }}>{t.fields.join(', ')}</p>
                </>
              )}

              {t.keyFields?.length > 0 && (
                <>
                  <div style={subLabelStyle}>Key (WHERE)</div>
                  <p style={{ color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', margin: 0 }}>{t.keyFields.join(', ')}</p>
                </>
              )}

              {t.notFoundAction && t.notFoundAction !== 'n/a' && (
                <>
                  <div style={subLabelStyle}>Not Found</div>
                  <p style={{ color: '#f59e0b', fontSize: 11, margin: 0 }}>→ {t.notFoundAction}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {fileOps.length > 0 && (
        <div>
          <label style={labelStyle}>File I/O</label>
          {fileOps.map((f, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{f.file}</span>
                <span style={{ fontSize: 11, color: opColor((f.operations ?? []).join(' ')) }}>
                  {(f.operations ?? []).join(', ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {(model || twoStep != null) && (
        <div style={{ borderTop: '1px solid #1e293b', paddingTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {model && (
            <span style={{ color: '#334155', fontSize: 10, fontFamily: 'monospace' }}>{model}</span>
          )}
          {twoStep != null && (
            <span style={{ color: '#334155', fontSize: 10 }}>two-step: {twoStep ? 'yes' : 'no'}</span>
          )}
        </div>
      )}

    </div>
  )
}
```

### LogicTab changes

Add a pre-dispatch section at the top when `analysis.pre_dispatch` is non-empty.

- [ ] **Step 2: Update `LogicTab.jsx` — add pre-dispatch section**

After the opening `<div>` in the return, before the `{entryPoints.length > 0 && ...}` block, insert:

```jsx
      {preDispatch.length > 0 && (
        <div style={sectionStyle}>
          <label style={labelStyle}>Pre-Dispatch (runs before every mode)</label>
          <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {preDispatch.map((name, i) => (
              <span key={i} style={{ background: '#172554', color: '#93c5fd', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontFamily: 'monospace' }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
```

And add `const preDispatch = analysis?.pre_dispatch ?? []` at the top of the component (alongside the existing `entryPoints` and `errorCatalog` extractions).

Also update the empty-state guard:

```jsx
  if (!preDispatch.length && !entryPoints.length && !errorCatalog.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No business logic extracted yet.</p>
  }
```

- [ ] **Step 3: Build client to verify no errors**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main/client && npx vite build 2>&1 | grep -E "error|✓ built"
```

Expected: `✓ built in ...s`

- [ ] **Step 4: Commit**

```bash
cd /home/darias/Projects/aiconverter/aiconverter-main
git add client/src/components/Panel/DataTab.jsx client/src/components/Panel/LogicTab.jsx
git commit -m "feat(ui): DataTab shows keyFields + notFoundAction + analysis metadata; LogicTab shows pre-dispatch"
```

---

## Self-Review

**Spec coverage:**
- ✅ `paragraphNames` kept in `entry_points` — Task 4, 5 (mapResult change)
- ✅ `db_tables` with `keyFields` + `notFoundAction` — Task 3 (prompts) + Task 8 (DataTab)
- ✅ `pre_dispatch` stored — Task 1 (DB) + Task 2 (model) + Task 4/5 (orchestrators) + Task 8 (LogicTab)
- ✅ `analysis_model` stored — Task 1 (DB) + Task 2 (model) + Task 7 (service)
- ✅ `analysis_two_step` stored — Task 1 (DB) + Task 2 (model) + Task 4/5 (orchestrators)
- ✅ Frontend display of SQL/queries (keyFields, notFoundAction) — Task 8
- ✅ Tests updated — Task 6

**Placeholder scan:** No TBDs. All steps have actual code.

**Type consistency:**
- `mapResult(spec, preDispatch, twoStep)` — called with `(spec, preDispatchNames, false/true)` in both orchestrators ✅
- `upsertBusinessAnalysis` param `pre_dispatch` default `[]` — matches `mapResult` return field name ✅
- `analysis.pre_dispatch` in `LogicTab` — matches DB column name returned via `getAnalysisByProgramId` ✅
- `analysis.analysis_two_step` in `DataTab` — matches DB column ✅
- `analysis.analysis_model` in `DataTab` — matches DB column ✅
- `t.keyFields` in `DataTab` — populated by AI from updated prompt schema; optional (`?.length`) guards missing data ✅
- `t.notFoundAction` in `DataTab` — same, optional guard present ✅

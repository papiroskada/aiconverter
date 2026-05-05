# Table Catalog Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lazy "Enrich Tables" button in the DataTab that calls a new backend endpoint, which uses AI to describe what each DB table represents and what its columns mean — without storing results in the database.

**Architecture:** New `GET /api/programs/:id/table-catalog` route reads the program's COBOL source from disk, extracts working storage, and calls a new `enrichTableCatalog` provider method with a purpose-built prompt. The frontend stores the result locally in React state (not in DB). The result is discarded on page reload — it's a diagnostic aid, not analysis data.

**Tech Stack:** Express, Vitest (supertest), React, `server/src/ai/providers/claude.js` + `openai.js`, `client/src/components/Panel/DataTab.jsx`

---

## File Map

| File | Change |
|---|---|
| `server/src/ai/prompts.js` | Add `TABLE_CATALOG_PROMPT` export |
| `server/src/ai/providers/base.js` | Add `enrichTableCatalog` abstract method |
| `server/src/ai/providers/claude.js` | Implement `enrichTableCatalog` |
| `server/src/ai/providers/openai.js` | Implement `enrichTableCatalog` |
| `server/src/routes/programs.js` | Add `GET /:id/table-catalog` route |
| `server/tests/routes/programs.test.js` | Add table-catalog route tests |
| `client/src/api/programs.js` | Add `fetchTableCatalog(id)` |
| `client/src/components/Panel/TableCatalogPanel.jsx` | New component — displays enriched catalog |
| `client/src/components/Panel/DataTab.jsx` | Add "Enrich Tables" button + inline catalog state |

---

### Task 1: TABLE_CATALOG_PROMPT and provider method

**Files:**
- Modify: `server/src/ai/prompts.js`
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/claude.js`
- Modify: `server/src/ai/providers/openai.js`

- [ ] **Step 1: Add TABLE_CATALOG_PROMPT to prompts.js**

Append at the end of `server/src/ai/prompts.js`:

```js
export const TABLE_CATALOG_PROMPT = (context) => `
You are a COBOL expert identifying what database tables and columns represent in business terms.

${context}

Return ONLY valid JSON matching this schema exactly:
{
  "tables": [
    {
      "table": "exact-table-name",
      "description": "one sentence: what business entity or concept this table stores",
      "columns": [
        {
          "name": "COBOL-FIELD-NAME",
          "jsType": "string|number|boolean",
          "description": "business meaning of this column"
        }
      ]
    }
  ]
}

Rules:
- table: use the EXACT table name from KNOWN TABLES — never invent or rename
- description: one sentence, business domain language (e.g. "Stores enabled environments per user login")
- columns: include ONLY the fields listed in the WORKING STORAGE prefix group for this table
- jsType: PIC X = string, PIC 9 = number, PIC X with 88-levels = string (enum), no PIC = object; omit group-level fields
- description: explain what the field represents for the business, not what its data type is
- If a table has no working-storage declarations visible, return columns: []
`
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
cd server && npm test
```
Expected: all tests pass.

- [ ] **Step 3: Add enrichTableCatalog to base.js**

In `server/src/ai/providers/base.js`, add a new method to `BaseProvider`:

```js
export class BaseProvider {
  async extractBusinessAnalysis(context, signal) { throw new Error('Not implemented') }
  async analyzeEntryPoint(condition, businessName, context, signal) { throw new Error('Not implemented') }
  async enrichTableCatalog(context, signal) { throw new Error('Not implemented') }
}
```

- [ ] **Step 4: Implement enrichTableCatalog in ClaudeProvider**

In `server/src/ai/providers/claude.js`:

1. Add `TABLE_CATALOG_PROMPT` to the import line:
```js
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, C_BUSINESS_ANALYSIS_PROMPT, C_ANALYZE_ENTRY_POINT_PROMPT, TABLE_CATALOG_PROMPT } from '../prompts.js'
```

2. Add the method to `ClaudeProvider`:
```js
async enrichTableCatalog(context, signal) {
  return this.#callClaude(TABLE_CATALOG_PROMPT(context), 4096, this.modelDetail, signal)
}
```

- [ ] **Step 5: Implement enrichTableCatalog in OpenAIProvider**

In `server/src/ai/providers/openai.js`:

1. Add `TABLE_CATALOG_PROMPT` to the import line:
```js
import { BUSINESS_ANALYSIS_PROMPT, ANALYZE_ENTRY_POINT_PROMPT, C_BUSINESS_ANALYSIS_PROMPT, C_ANALYZE_ENTRY_POINT_PROMPT, TABLE_CATALOG_PROMPT } from '../prompts.js'
```

2. Add the method to `OpenAIProvider`:
```js
async enrichTableCatalog(context, signal) {
  return this.#callOpenAI(TABLE_CATALOG_PROMPT(context), 4096, this.modelDetail, signal)
}
```

- [ ] **Step 6: Add BaseProvider test**

In `server/tests/ai/orchestrator.test.js`, add to the `BaseProvider` describe block (around line 5):

```js
it('throws NotImplemented on enrichTableCatalog', async () => {
  await expect(new BaseProvider().enrichTableCatalog('')).rejects.toThrow('Not implemented')
})
```

- [ ] **Step 7: Run tests**

```bash
cd server && npm test
```
Expected: all tests pass including the new BaseProvider test.

- [ ] **Step 8: Commit**

```bash
git add server/src/ai/prompts.js server/src/ai/providers/base.js server/src/ai/providers/claude.js server/src/ai/providers/openai.js server/tests/ai/orchestrator.test.js
git commit -m "feat(ai): add TABLE_CATALOG_PROMPT and enrichTableCatalog provider method"
```

---

### Task 2: Backend route GET /programs/:id/table-catalog

**Files:**
- Modify: `server/src/routes/programs.js`
- Modify: `server/tests/routes/programs.test.js`

The route reads the COBOL source file from disk, extracts working-storage vars, formats a context string from `db_tables` + WS declarations, calls `enrichTableCatalog`, and returns the result directly without storing it.

- [ ] **Step 1: Write failing route tests**

In `server/tests/routes/programs.test.js`, look at the existing test structure to find the `makeProgram`/`makeAnalysis` helpers and add:

```js
describe('GET /api/programs/:id/table-catalog', () => {
  it('returns 404 when program not found', async () => {
    const res = await request(app).get('/api/programs/9999/table-catalog')
    expect(res.status).toBe(404)
  })

  it('returns 400 when program has no source file', async () => {
    const program = await createProgram({ name: 'NOFILE', file_path: null, status: 'done' })
    const res = await request(app).get(`/api/programs/${program.id}/table-catalog`)
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no source file/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd server && npm test -- tests/routes/programs.test.js
```
Expected: FAIL — route does not exist yet, returns 404 for all paths (Express falls through to 404 middleware).

- [ ] **Step 3: Add the route to programs.js**

In `server/src/routes/programs.js`, add the following imports at the top (after the existing imports):

```js
import { readFileSync } from 'fs'
import { preprocessCobol } from '../parser/cobolParser.js'
import { extractWorkingStorage } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { getSettings } from '../models/settings.js'
```

Then add the route before `export default router`:

```js
// GET /api/programs/:id/table-catalog  (lazy enrichment — not stored in DB)
router.get('/:id/table-catalog', async (req, res, next) => {
  try {
    const program = await findProgramById(req.params.id)
    if (!program) return res.status(404).json({ error: 'Not found' })
    if (!program.file_path) return res.status(400).json({ error: 'No source file for this program' })

    const analysis = await getAnalysisByProgramId(req.params.id)
    const dbTables = analysis?.db_tables ?? []

    const rawText = readFileSync(program.file_path, 'utf8')
    const cobolText = (program.file_type ?? 'cobol') === 'cobol' ? preprocessCobol(rawText) : rawText
    const wsVars = extractWorkingStorage(cobolText)

    const knownTables = dbTables.length
      ? dbTables.map(t => {
          const ops = t.operation ? ` (${t.operation})` : ''
          const fields = t.fields?.length ? `  fields: ${t.fields.join(', ')}` : ''
          return `  ${t.table}${ops}${fields ? '\n' + fields : ''}`
        }).join('\n')
      : '  (none)'

    const wsText = wsVars.length
      ? wsVars.map(v => {
          const pic = v.pic ? ` PIC ${v.pic}` : ''
          const conds = v.conditions.map(c => `     88 ${c.name} = ${c.value}`).join('\n')
          return `  ${v.level} ${v.name}${pic}${conds ? '\n' + conds : ''}`
        }).join('\n')
      : '  (none)'

    const context = `KNOWN TABLES FROM ANALYSIS:\n${knownTables}\n\nWORKING-STORAGE SECTION:\n${wsText}`

    const settings = await getSettings()
    const provider = await getProvider(settings)
    const result = await provider.enrichTableCatalog(context)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
```

- [ ] **Step 4: Run tests**

```bash
cd server && npm test -- tests/routes/programs.test.js
```
Expected: all route tests pass including the two new ones.

- [ ] **Step 5: Run full suite**

```bash
cd server && npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/programs.js server/tests/routes/programs.test.js
git commit -m "feat(routes): add GET /programs/:id/table-catalog lazy enrichment endpoint"
```

---

### Task 3: Frontend API function

**Files:**
- Modify: `client/src/api/programs.js`

- [ ] **Step 1: Add fetchTableCatalog to programs.js**

In `client/src/api/programs.js`, append:

```js
export async function fetchTableCatalog(id) {
  const res = await fetch(`${BASE}/${id}/table-catalog`)
  if (!res.ok) throw new Error('Failed to fetch table catalog')
  return res.json()
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/api/programs.js
git commit -m "feat(api): add fetchTableCatalog client function"
```

---

### Task 4: TableCatalogPanel component

**Files:**
- Create: `client/src/components/Panel/TableCatalogPanel.jsx`

This component receives an array of enriched table objects and renders them. It is purely presentational — state management happens in DataTab.

- [ ] **Step 1: Create TableCatalogPanel.jsx**

Create `client/src/components/Panel/TableCatalogPanel.jsx`:

```jsx
const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const subLabelStyle = { color: '#475569', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2, marginTop: 6 }

export default function TableCatalogPanel({ tables }) {
  if (!tables?.length) return <p style={{ color: '#64748b', margin: 0 }}>No table catalog available.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={labelStyle}>Table Catalog ({tables.length})</label>
      {tables.map((t, i) => (
        <div key={i} style={rowStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>{t.table}</span>
          </div>
          {t.description && (
            <p style={{ color: '#94a3b8', fontSize: 11, margin: '0 0 4px 0' }}>{t.description}</p>
          )}
          {t.columns?.length > 0 && (
            <>
              <div style={subLabelStyle}>Columns</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {t.columns.map((col, j) => (
                  <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 11, minWidth: 160 }}>{col.name}</span>
                    <span style={{ color: '#475569', fontSize: 10 }}>{col.jsType}</span>
                    <span style={{ color: '#64748b', fontSize: 11 }}>{col.description}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Panel/TableCatalogPanel.jsx
git commit -m "feat(ui): add TableCatalogPanel component"
```

---

### Task 5: Wire button and catalog state into DataTab

**Files:**
- Modify: `client/src/components/Panel/DataTab.jsx`

Add a button "Enrich Tables" that calls `fetchTableCatalog`, stores the result in local state, and shows `TableCatalogPanel` below the DB Tables section. The button shows a loading state while fetching, and an error message if the call fails.

- [ ] **Step 1: Update DataTab.jsx**

Replace the entire content of `client/src/components/Panel/DataTab.jsx`:

```jsx
import { useState } from 'react'
import { fetchTableCatalog } from '../../api/programs.js'
import TableCatalogPanel from './TableCatalogPanel.jsx'

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

export default function DataTab({ analysis, programId }) {
  const dbTables = analysis?.db_tables ?? []
  const fileOps  = analysis?.file_ops  ?? []
  const model    = analysis?.analysis_model
  const twoStep  = analysis?.analysis_two_step

  const [catalog, setCatalog]       = useState(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError]     = useState(null)

  async function handleEnrich() {
    setCatalogLoading(true)
    setCatalogError(null)
    try {
      const data = await fetchTableCatalog(programId)
      setCatalog(data.tables ?? [])
    } catch (err) {
      setCatalogError(err.message)
    } finally {
      setCatalogLoading(false)
    }
  }

  if (!dbTables.length && !fileOps.length) {
    return <p style={{ color: '#64748b', margin: 0 }}>No database tables or file operations found.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {dbTables.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Database Tables ({dbTables.length})</label>
            {!catalog && (
              <button
                onClick={handleEnrich}
                disabled={catalogLoading}
                style={{
                  background: 'transparent', border: '1px solid #334155', borderRadius: 4,
                  color: '#94a3b8', fontSize: 10, padding: '2px 8px', cursor: catalogLoading ? 'default' : 'pointer',
                  opacity: catalogLoading ? 0.6 : 1,
                }}
              >
                {catalogLoading ? 'Enriching…' : 'Enrich Tables'}
              </button>
            )}
          </div>
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
          {catalogError && (
            <p style={{ color: '#f87171', fontSize: 11, margin: '4px 0 0 0' }}>Enrichment failed: {catalogError}</p>
          )}
          {catalog && <TableCatalogPanel tables={catalog} />}
        </div>
      )}

      {(() => {
        const entryPoints = (analysis?.entry_points ?? []).filter(ep => ep.dbOperations?.length > 0)
        if (!entryPoints.length) return null
        return (
          <div>
            <label style={labelStyle}>Per-Mode Operations</label>
            {entryPoints.map((ep, i) => (
              <div key={i} style={rowStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ background: '#1e3a5f', color: '#93c5fd', borderRadius: 3, padding: '1px 6px', fontSize: 10, fontFamily: 'monospace' }}>
                    {ep.condition}
                  </span>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>{ep.businessName}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {ep.dbOperations.map((op, j) => (
                    <span key={j} style={{
                      background: '#0f172a', border: '1px solid #1e293b',
                      borderRadius: 3, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace',
                      color: opColor(op.operation),
                    }}>
                      {op.table} {op.operation}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

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

- [ ] **Step 2: Find where DataTab is used and add programId prop**

Search for usages of `<DataTab` in the codebase:

```bash
grep -rn "<DataTab" client/src/
```

For each usage found, add `programId={program.id}` (or whatever the program ID variable is called in that component's scope) to the `<DataTab` element.

- [ ] **Step 3: Run backend tests**

```bash
cd server && npm test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Panel/DataTab.jsx client/src/components/Panel/TableCatalogPanel.jsx
git commit -m "feat(ui): add Enrich Tables button and TableCatalogPanel to DataTab"
```

---

## Self-Review

**Spec coverage:**
- ✓ Separate `/programs/:id/table-catalog` endpoint (Task 2)
- ✓ AI prompt for table/column enrichment using WS + known db_tables (Task 1)
- ✓ Frontend button in DataTab (Task 5)
- ✓ TableCatalogPanel component (Task 4)
- ✓ Lazy enrichment — not stored in DB (route returns directly, state is local React)
- ✓ Both providers (Claude + OpenAI) implement `enrichTableCatalog` (Task 1)

**Placeholder scan:** None found.

**Type consistency:** `fetchTableCatalog(id)` → `data.tables` (array) matches `TABLE_CATALOG_PROMPT` schema `{ tables: [...] }` matches `TableCatalogPanel({ tables })` prop.

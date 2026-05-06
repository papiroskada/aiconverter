# Code Generation Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Зробити генерацію коду корисною на практиці — правильний стиль з першого разу, цілісний модуль на програму, спільні типи для DB, правильний порядок генерації між залежними програмами.

**Принцип:** бізнес-логіка є єдиним джерелом для генерації — не сирий COBOL. Якщо щось у коді неправильно → значить щось неправильно у бізнес-логіці → людина виправляє там.

---

## File Map

| Файл | Зміна |
|------|-------|
| `server/src/models/settings.js` | Task 1 — нові поля в DEFAULTS |
| `server/src/db/migrations/` | Task 1 — ALTER TABLE settings |
| `client/src/components/Settings/SettingsDrawer.jsx` | Task 1 — UI для нових полів |
| `server/src/ai/prompts.js` | Task 2, 3 — новий PROGRAM_GENERATION_PROMPT, оновлення CODE_GENERATION_PROMPT |
| `server/src/services/codeGenerationService.js` | Task 2, 3, 4 — logic_only mode, generateProgram, generateDbTypes |
| `server/src/routes/programs.js` | Task 3, 4, 5 — нові endpoints |
| `server/src/models/programAnalysis.js` | Task 5 — getAnalysesByProgramIds |

---

## Task 1: Налаштовувані target patterns у Settings

**Мета:** команда один раз описує свої конвенції → всі генерації відразу у правильному стилі.

**Нові поля settings:**
- `code_db_read` — патерн читання з DB (default: `await db.select('{table}', { {key}: {value} })`)
- `code_db_write` — патерн запису (default: `await db.insert('{table}', data)` / `await db.update('{table}', data, { {key} })`)
- `code_error_convention` — патерн помилки (default: `return { error: {code}, field: '{field}' }`)
- `code_external_call` — патерн зовнішнього виклику (default: `await callProgram('{name}', input)`)
- `code_language` — `typescript` або `javascript` (default: `typescript`)

- [ ] **Крок 1: DB міграція**

Створити файл `server/src/db/migrations/add_code_gen_settings.sql`:
```sql
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS code_db_read       TEXT,
  ADD COLUMN IF NOT EXISTS code_db_write      TEXT,
  ADD COLUMN IF NOT EXISTS code_error_convention TEXT,
  ADD COLUMN IF NOT EXISTS code_external_call TEXT,
  ADD COLUMN IF NOT EXISTS code_language      TEXT DEFAULT 'typescript';
```

Виконати: `psql $DATABASE_URL -f server/src/db/migrations/add_code_gen_settings.sql`

- [ ] **Крок 2: оновити DEFAULTS в `server/src/models/settings.js`**

```js
const DEFAULTS = {
  // ... існуючі поля ...
  code_db_read:           "await db.select('{table}', { {key}: {value} })",
  code_db_write:          "await db.insert('{table}', data) / await db.update('{table}', data, { {key} })",
  code_error_convention:  "return { error: {code}, field: '{field}' }",
  code_external_call:     "await callProgram('{name}', input)",
  code_language:          'typescript',
}
```

Додати нові поля до масиву `allowed` в `upsertSettings`.

- [ ] **Крок 3: UI в `SettingsDrawer.jsx`**

Додати секцію "Code Generation" з п'ятьма `<textarea>` полями (по одному на патерн). Кожне поле має label з прикладом. `code_language` — `<select>` з двома опціями. Зберігається через існуючий механізм settings.

---

## Task 2: Logic-only mode — без сирого COBOL у промпті

**Мета:** довести що intermediate layer достатній. Якщо якість не падає — COBOL більше не потрібен у code gen.

- [ ] **Крок 1: додати `code_source_mode` до settings**

```js
// В DEFAULTS:
code_source_mode: 'with_source', // 'with_source' | 'logic_only'
```

Міграція:
```sql
ALTER TABLE settings ADD COLUMN IF NOT EXISTS code_source_mode TEXT DEFAULT 'with_source';
```

- [ ] **Крок 2: оновити `buildCodeGenContext` в `codeGenerationService.js`**

Знайти блок де формується контекст (рядки 85–100). Параграфи підставляти тільки якщо `settings.code_source_mode === 'with_source'`:

```js
// В buildCodeGenContext — додати параметр settings
function buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
  // ...
  const sourceSection = settings.code_source_mode === 'logic_only'
    ? '' 
    : `\nCOBOL SOURCE PARAGRAPHS:\n${paragraphSource}`

  return [
    // ... всі існуючі секції без paragraphSource ...
    sourceSection,
  ].filter(Boolean).join('\n')
}
```

- [ ] **Крок 3: оновити `CODE_GENERATION_PROMPT` в `prompts.js`**

Перший рядок правил змінити з:
```
- Derive ALL logic from the COBOL SOURCE PARAGRAPHS
```
на:
```
- Derive ALL logic from the BUSINESS LOGIC STEPS provided — COBOL SOURCE PARAGRAPHS may or may not be present; if absent, implement strictly from steps, dbOperations, and notFoundAction
```

- [ ] **Крок 4: додати перемикач у SettingsDrawer**

`<select>` для `code_source_mode`: "Business logic + COBOL source" / "Business logic only".

---

## Task 3: Генерація цілої програми за один виклик

**Мета:** один TypeScript модуль з усіма entry points, dispatcher і спільними типами — замість розрізнених функцій по одній.

### 3a. Новий промпт

- [ ] **Крок 1: додати `PROGRAM_GENERATION_PROMPT` в `server/src/ai/prompts.js`**

```js
export const PROGRAM_GENERATION_PROMPT = (context, patterns) => `
You are a COBOL-to-${patterns.language} expert. Generate a complete module for the program described below.

${context}

TARGET PATTERNS (use these exact patterns — no substitutions):
- DB read:       ${patterns.dbRead}
- DB write:      ${patterns.dbWrite}
- Error:         ${patterns.errorConvention}
- External call: ${patterns.externalCall}

Return ONLY valid JSON:
{
  "imports": ["import statement 1", "import statement 2"],
  "sharedTypes": "TypeScript interface/type declarations used across entry points",
  "functions": [
    {
      "condition": "entry point condition e.g. FUNC='INS'",
      "name": "camelCase function name",
      "code": "complete ${patterns.language} async function — no placeholders"
    }
  ],
  "dispatcher": "main exported function that dispatches to the above based on input",
  "notes": ["assumption or decision worth explaining"]
}

Rules:
- dispatcher: reads the dispatch field from input (e.g. input.func) and calls the matching function
- Each function: implement every branch from its STEPS exactly — no summarizing, no skipping
- notFoundAction: implement exactly as described — { type: error } → return/throw error; { type: defaults } → set the specified fields and continue; { type: continue } → continue; { type: skip } → skip the operation
- errorCatalog: use ONLY codes listed — never invent codes not in the catalog
- sharedTypes: declare interfaces for input, output, and any shared structures
- imports: include only what the generated code actually uses
`
```

### 3b. Новий сервіс

- [ ] **Крок 2: додати `generateProgram(programId)` в `codeGenerationService.js`**

```js
export async function generateProgram(programId) {
  const [program, analysis, allChunks, settings] = await Promise.all([
    findProgramById(programId),
    getAnalysisByProgramId(programId),
    getChunksByProgramId(programId),
    getSettings(),
  ])

  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (!analysis) throw Object.assign(new Error('No analysis'), { status: 422 })

  const entryPoints = analysis.entry_points ?? []
  if (!entryPoints.length) throw Object.assign(new Error('No entry points'), { status: 422 })

  const cache = program.structural_cache
  const performGraph = cache?.performGraph ? deserializePerformGraph(cache.performGraph) : new Map()
  const preDispatchNames = cache?.preDispatchNames ?? []
  const paragraphChunks = allChunks.filter(c =>
    c.chunk_type === 'paragraph' || c.chunk_type === 'sub_paragraph'
  )

  // Зібрати всі параграфи для всіх entry points
  const allParagraphNames = [...new Set(entryPoints.flatMap(ep => ep.paragraphNames ?? []))]
  const relevantChunks = selectRelevantChunks(paragraphChunks, allParagraphNames, performGraph, preDispatchNames)

  let tableSchemas = {}
  let wsConstants = []
  if (program.file_path) {
    try {
      const cobolText = readFileSync(program.file_path, 'utf8')
      tableSchemas = extractTuxTableSchemas(cobolText)
      wsConstants = extractWsConstants(cobolText)
    } catch { /* non-fatal */ }
  }

  const patterns = {
    language:         settings.code_language          ?? 'typescript',
    dbRead:           settings.code_db_read           ?? "await db.select('{table}', { {key}: {value} })",
    dbWrite:          settings.code_db_write          ?? "await db.insert('{table}', data)",
    errorConvention:  settings.code_error_convention  ?? "return { error: {code}, field: '{field}' }",
    externalCall:     settings.code_external_call     ?? "await callProgram('{name}', input)",
  }

  const context = buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)
  const provider = await getProvider(settings)
  const result = await provider.generateProgram(context, patterns)

  return {
    programName: program.name,
    entryPoints: entryPoints.map(ep => ({ condition: ep.condition, businessName: ep.businessName })),
    paragraphsIncluded: relevantChunks.map(c => c.chunk_name),
    contextTokenEstimate: Math.ceil(context.length / 4),
    ...result,
  }
}
```

- [ ] **Крок 3: додати `buildProgramContext` в `codeGenerationService.js`**

Аналогічно до `buildCodeGenContext` але включає всі entry points разом (всі steps, всі dbOperations):

```js
function buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings) {
  const errorList = (analysis.error_catalog ?? [])
    .map(e => `  ${e.code}${e.businessMeaning ? ` — ${e.businessMeaning}` : ''}${e.systemAction ? `; ${e.systemAction}` : ''}`)
    .join('\n') || '  (none)'

  const depList = (analysis.external_dependencies ?? [])
    .map(d => `  ${d.program}: ${d.purpose}; in: ${d.dataIn ?? '?'}; out: ${d.dataOut ?? '?'}`)
    .join('\n') || '  (none)'

  const allDbTables = (analysis.db_tables ?? []).filter(t => !t.ai_hallucinated)
  const dbSection = formatTableSchemas(allDbTables, tableSchemas)

  const paragraphText = relevantChunks.map(c => c.cobol_text).join('\n').toUpperCase()
  const referencedConstants = (wsConstants ?? []).filter(c => paragraphText.includes(c.name))
  const wsConstantsList = referencedConstants.length
    ? referencedConstants.map(c => `  ${c.name} = "${c.value}" (js: ${c.camelName})`).join('\n')
    : '  (none)'

  const entryPointsSection = (analysis.entry_points ?? []).map(ep => {
    const steps = (ep.steps ?? []).map((s, i) => `    ${i + 1}. ${s}`).join('\n')
    const sideEffects = (ep.sideEffects ?? []).map(s => `    - ${s}`).join('\n')
    const epErrors = (ep.errors ?? []).map(s => `    - ${s}`).join('\n')
    const epDb = formatTableSchemas(ep.dbOperations?.length ? ep.dbOperations : [], tableSchemas)
    return [
      `  WHEN ${ep.condition} → ${ep.businessName}`,
      `  Steps:\n${steps || '    (none)'}`,
      `  Side Effects:\n${sideEffects || '    (none)'}`,
      `  Errors:\n${epErrors || '    (none)'}`,
      `  DB Operations:\n${epDb}`,
    ].join('\n')
  }).join('\n\n')

  const paragraphSource = settings.code_source_mode === 'logic_only' ? '' :
    relevantChunks.map(c => `[${c.chunk_name}]\n${c.cobol_text}`).join('\n\n') || '(none)'

  return [
    `PROGRAM: ${program.name}`,
    `PURPOSE: ${analysis.business_purpose ?? '(unknown)'}`,
    `\nINPUT PARAMETERS:\n${formatParams(analysis.input_contract)}`,
    `\nOUTPUT PARAMETERS:\n${formatParams(analysis.output_contract)}`,
    `\nWS CONSTANTS:\n${wsConstantsList}`,
    `\nERROR CATALOG:\n${errorList}`,
    `\nDB TABLE SCHEMAS:\n${dbSection}`,
    `\nEXTERNAL DEPENDENCIES:\n${depList}`,
    `\nPRE-DISPATCH: ${(analysis.pre_dispatch ?? []).join(', ') || '(none)'}`,
    `\nENTRY POINTS:\n${entryPointsSection}`,
    paragraphSource ? `\nCOBOL SOURCE PARAGRAPHS:\n${paragraphSource}` : '',
  ].filter(Boolean).join('\n')
}
```

- [ ] **Крок 4: додати `generateProgram` в claude провайдері**

В `server/src/ai/providers/claude.js` поряд з `generateCode`:

```js
async generateProgram(context, patterns) {
  const prompt = PROGRAM_GENERATION_PROMPT(context, patterns)
  const text = await this._call(prompt, this.modelMain)
  return JSON.parse(stripFences(text))
}
```

Додати імпорт `PROGRAM_GENERATION_PROMPT` в `providers/claude.js`.

### 3c. Endpoint

- [ ] **Крок 5: новий endpoint в `server/src/routes/programs.js`**

```js
// POST /api/programs/:id/generate-program
router.post('/:id/generate-program', async (req, res, next) => {
  try {
    const result = await generateProgram(req.params.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
})
```

Додати `generateProgram` до імпорту з `codeGenerationService.js`.

---

## Task 4: Генерація спільного файлу DB типів (без AI)

**Мета:** `types/db.ts` — одне місце для всіх DB row інтерфейсів. Детермінований, без AI.

- [ ] **Крок 1: додати `generateDbTypes(programIds)` в `codeGenerationService.js`**

```js
export async function generateDbTypes(programIds) {
  const programs = await Promise.all(programIds.map(findProgramById))

  // Зібрати всі TUX table schemas з файлів
  const allSchemas = {}
  for (const program of programs.filter(Boolean)) {
    if (!program.file_path) continue
    try {
      const cobolText = readFileSync(program.file_path, 'utf8')
      const schemas = extractTuxTableSchemas(cobolText)
      Object.assign(allSchemas, schemas)
    } catch { /* non-fatal */ }
  }

  if (!Object.keys(allSchemas).length) return { code: '// No DB schemas found\n', tables: [] }

  const interfaces = Object.entries(allSchemas).map(([table, fields]) => {
    const name = table.replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase()) + 'Row'
    const fieldLines = fields.map(f => `  ${f.camelName}: ${f.type === 'number' ? 'number' : 'string'}`)
    return `export interface ${name} {\n${fieldLines.join('\n')}\n}`
  })

  return {
    code: `// Auto-generated DB row types — do not edit manually\n\n${interfaces.join('\n\n')}\n`,
    tables: Object.keys(allSchemas),
  }
}
```

- [ ] **Крок 2: endpoint**

```js
// POST /api/programs/db-types  (body: { programIds: [...] })
router.post('/db-types', async (req, res, next) => {
  try {
    const { programIds } = req.body
    if (!Array.isArray(programIds)) return res.status(400).json({ error: 'programIds must be array' })
    const result = await generateDbTypes(programIds)
    res.json(result)
  } catch (err) { next(err) }
})
```

---

## Task 5: Топологічний порядок генерації для застосунку

**Мета:** генерувати програми в правильному порядку — листові спочатку, потім ті що їх викликають. Коли генерується A, інтерфейс B вже існує.

- [ ] **Крок 1: функція топологічного сортування**

Додати `buildGenerationOrder(programIds)` в `codeGenerationService.js`:

```js
async function buildGenerationOrder(programIds) {
  const idSet = new Set(programIds.map(String))
  // Для кожної програми отримати її вихідні виклики
  const callsMap = new Map()
  await Promise.all(programIds.map(async id => {
    const calls = await getCallsFromProgram(id)
    // Тільки виклики всередині нашого набору
    callsMap.set(String(id), calls
      .filter(c => c.callee_program_id && idSet.has(String(c.callee_program_id)))
      .map(c => String(c.callee_program_id))
    )
  }))

  // Kahn's algorithm
  const inDegree = new Map(programIds.map(id => [String(id), 0]))
  for (const [, deps] of callsMap) {
    for (const dep of deps) inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1)
  }
  const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const [caller, deps] of callsMap) {
      if (deps.includes(id)) {
        const newDeg = (inDegree.get(caller) ?? 1) - 1
        inDegree.set(caller, newDeg)
        if (newDeg === 0) queue.push(caller)
      }
    }
  }
  // Якщо є цикли — додати решту в кінець
  const remaining = programIds.map(String).filter(id => !order.includes(id))
  return [...order, ...remaining]
}
```

Додати імпорт `getCallsFromProgram` з `../models/programCalls.js`.

- [ ] **Крок 2: `generateApplication(applicationProgramIds)` в `codeGenerationService.js`**

```js
export async function generateApplication(programIds) {
  const order = await buildGenerationOrder(programIds)
  const results = []
  const generatedInterfaces = new Map() // programId → { functionName, inputType, outputType }

  for (const programId of order) {
    try {
      // TODO Task 5b: передавати generatedInterfaces в контекст генерації
      const result = await generateProgram(programId)
      results.push({ programId, status: 'ok', ...result })
      // Зберегти інтерфейс для наступних програм
      generatedInterfaces.set(programId, {
        programName: result.programName,
        dispatcherName: result.programName.toLowerCase(),
      })
    } catch (err) {
      results.push({ programId, status: 'error', error: err.message })
    }
  }

  return { order, results }
}
```

- [ ] **Крок 3: endpoint**

```js
// POST /api/applications/:id/generate  
// (потребує applicationPrograms.js щоб отримати programIds)
router.post('/applications/:id/generate', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT program_id FROM application_programs WHERE application_id = $1',
      [req.params.id]
    )
    const programIds = rows.map(r => r.program_id)
    if (!programIds.length) return res.status(422).json({ error: 'No programs in application' })
    const result = await generateApplication(programIds)
    res.json(result)
  } catch (err) { next(err) }
})
```

---

## Task 6: Pre-generation consistency check

**Мета:** до генерації — показати невідповідності між тим що одна програма каже про виклик іншої і тим що та інша декларує як свій інтерфейс.

- [ ] **Крок 1: `checkConsistency(programIds)` в `codeGenerationService.js`**

```js
export async function checkConsistency(programIds) {
  const analyses = await Promise.all(programIds.map(getAnalysisByProgramId))
  const programs = await Promise.all(programIds.map(findProgramById))

  // Побудувати map name → analysis
  const byName = new Map()
  programs.forEach((p, i) => { if (p && analyses[i]) byName.set(p.name, analyses[i]) })

  const warnings = []
  for (let i = 0; i < programs.length; i++) {
    const program = programs[i]
    const analysis = analyses[i]
    if (!program || !analysis) continue

    for (const dep of (analysis.external_dependencies ?? [])) {
      const targetAnalysis = byName.get(dep.program)
      if (!targetAnalysis) continue // програма не завантажена — не перевіряємо

      const inputContract = JSON.parse(targetAnalysis.input_contract ?? '[]')
      const inputNames = new Set(inputContract.map(p => p.cobolName?.toUpperCase()))

      // dep.dataIn — текстовий опис що передається; шукаємо явні імена полів
      const mentionedFields = (dep.dataIn ?? '').match(/[A-Z][A-Z0-9-]{2,}/g) ?? []
      const mismatches = mentionedFields.filter(f => !inputNames.has(f))

      if (mismatches.length) {
        warnings.push({
          caller: program.name,
          callee: dep.program,
          issue: `Fields mentioned in dataIn not found in ${dep.program} input_contract: ${mismatches.join(', ')}`,
        })
      }
    }
  }

  return warnings
}
```

- [ ] **Крок 2: endpoint**

```js
// POST /api/programs/consistency-check  (body: { programIds: [...] })
router.post('/consistency-check', async (req, res, next) => {
  try {
    const { programIds } = req.body
    if (!Array.isArray(programIds)) return res.status(400).json({ error: 'programIds must be array' })
    const warnings = await checkConsistency(programIds)
    res.json({ warnings })
  } catch (err) { next(err) }
})
```

---

## Порядок виконання

Tasks незалежні за винятком:
- Task 3 залежить від Task 1 (patterns) і Task 2 (logic_only) — виконати після них
- Task 5 залежить від Task 3 — виконати останнім

**Рекомендований порядок: 1 → 2 → 4 → 3 → 6 → 5**

| Task | Зусилля | Цінність |
|------|---------|----------|
| 1. Configurable patterns | мале | висока |
| 2. Logic-only mode | мале | висока (метрика якості BL) |
| 4. DB types | середнє | висока |
| 3. Whole program generation | велике | дуже висока |
| 6. Consistency check | середнє | середня |
| 5. Topological order | велике | висока (для batch) |

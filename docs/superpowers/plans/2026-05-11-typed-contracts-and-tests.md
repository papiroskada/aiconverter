# Plan: Typed Contracts + Optional Test Generation

## Мета

Два незалежних покращення генерації коду:

1. **Typed contracts** — генерувати TypeScript інтерфейси з `input_contract` / `output_contract` та використовувати їх у міжпрограмних викликах
2. **Optional tests** — генерувати mock-based unit тести з аналізу при запиті `includeTests: true`

---

## Частина 1 — Typed Contracts

### Що змінюється

**`codeGenerationService.js`** — нова функція `generateProgramTypes(programIds)`:

```typescript
// Вхід: масив програм з їх input_contract / output_contract
// Вихід:
{
  code: `
    export interface ExrvllInput {
      execLgnId: string   // EUR-EXEC-LGN-ID
      macaddr: string     // CDV-MACADDR
    }
    export interface ExrvllOutput {
      insyncActv: number
      returnCode: number
    }
  `,
  programs: ['EXRVLL', 'ARCUSACS']
}
```

Логіка детерміністична — без AI. Бере `input_contract` / `output_contract` з БД, перетворює PIC типи у TS типи (вже є `picToJsType`), генерує інтерфейси.

**`PROGRAM_GENERATION_PROMPT`** — отримує додаткову секцію:

```
TYPESCRIPT INTERFACES (use these for function signature):
  Input type:  ExrvllInput
  Output type: ExrvllOutput
  Import from: './types.js'
```

AI буде генерувати:
```typescript
import type { ExrvllInput, ExrvllOutput } from './types.js'

export async function execute(input: ExrvllInput): Promise<ExrvllOutput> { ... }
```

**`wireInterProgramCalls`** — замість `callProgram('ARCUSACS', input)` генерує типізований виклик:

```typescript
import type { ArcusacsInput } from './types.js'
import { execute as executeArcusacs } from './ARCUSACS.js'
// ...
const result = await executeArcusacs(input as ArcusacsInput)
```

**`generateProject`** — додає `src/types.ts` до списку файлів поряд з `src/db.ts` і `src/index.ts`.

### Новий роут

```
POST /api/programs/program-types
Body: { programIds: number[] }
Response: { code: string, programs: string[] }
```

Аналогічно до існуючого `/db-types`.

### Зміни UI

У CodeTab при `Download project .zip` — `types.ts` вже буде всередині (додається в `generateProject`). Окремої кнопки не потрібно.

### Файли для зміни

| Файл | Зміна |
|------|-------|
| `server/src/services/codeGenerationService.js` | `generateProgramTypes()`, оновити `generateProject()`, оновити `wireInterProgramCalls()` |
| `server/src/ai/prompts.js` | Додати секцію TYPESCRIPT INTERFACES у `PROGRAM_GENERATION_PROMPT` |
| `server/src/routes/programs.js` | Новий роут `POST /program-types` |

---

## Частина 2 — Optional Test Generation

### Що генерується

З даних аналізу (без додаткових AI викликів для збору контексту) генеруємо тести що покривають:

- **Input validation** — для кожного кроку зі згадкою "blank", "zero", "invalid" → тест з очікуваним error кодом
- **NotFoundAction** — для кожної DB операції з `notFoundAction != null` → тест з замоканим `db` що повертає `null`
  - `{ type: 'error' }` → expect error code
  - `{ type: 'defaults' }` → expect specific fields set, no error
  - `{ type: 'continue' }` → expect execution continues
- **Happy path** — всі DB операції повертають валідні дані, очікуємо успіх

Формат тестів — Vitest (вже використовується в проєкті):

```typescript
import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() }
}))
vi.mock('../callProgram.js', () => ({ callProgram: vi.fn() }))

import { db } from '../db.js'
import { getLoginRecord } from '../EXRVLL.js'

describe('EXRVLL — getLoginRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  test('error 1500 when execLgnId is blank', async () => {
    const res = await getLoginRecord({ execLgnId: '          ' })
    expect(res).toMatchObject({ error: 1500 })
  })

  test('error 1502 when exreur not found', async () => {
    vi.mocked(db.select).mockResolvedValueOnce(null)
    const res = await getLoginRecord({ execLgnId: 'TEST001   ' })
    expect(res).toMatchObject({ error: 1502 })
  })

  test('sets defaults when exrcdv not found (insyncActv=0, updAuthReqd=1)', async () => {
    vi.mocked(db.select)
      .mockResolvedValueOnce({ eurEnblFlg: '1' })  // exreur found
      .mockResolvedValueOnce(null)                  // exrcdv not found
    const res = await getLoginRecord({ execLgnId: 'TEST001   ' })
    expect(res.insyncActv).toBe(0)
    expect(res.updAuthReqd).toBe(1)
    expect(res.error).toBeUndefined()
  })

  test('happy path returns populated output', async () => {
    vi.mocked(db.select).mockResolvedValue({ eurEnblFlg: '1', cdvMacaddr: 'AABBCC001122' })
    const res = await getLoginRecord({ execLgnId: 'TEST001   ' })
    expect(res.error).toBeUndefined()
  })
})
```

### API зміни

**Існуючий ендпоінт** `POST /api/programs/:id/generate` отримує опціональний флаг:

```json
// Request
{ "condition": "FUNC='RD'", "includeTests": true }

// Response (розширений)
{
  "functionName": "getLoginRecord",
  "code": "...",
  "tests": "...",       // присутній тільки якщо includeTests=true
  "notes": [...]
}
```

Аналогічно для `generateFullProgram` (whole-program endpoint): `{ includeTests: true }`.

Для `generateProject` — якщо `includeTests: true` у body, `__tests__/*.test.ts` додаються до zip файлів.

### Нові функції

**`codeGenerationService.js`**:

```javascript
// Генерує тести для одного entry point
export async function generateEntryPointTests(programId, condition)

// Внутрішній хелпер — будує контекст для тестів (аналогічний buildCodeGenContext але коротший)
function buildTestGenContext(program, analysis, ep, tableSchemas)
```

**`prompts.js`** — новий промпт `TEST_GENERATION_PROMPT(context)`:

```
You are generating Vitest unit tests for a TypeScript function converted from COBOL.

${context}

Return ONLY valid JSON:
{
  "testFile": "complete vitest test file — ready to run",
  "coverage": ["list of scenarios covered"]
}

Rules:
- Mock db and callProgram modules at the top
- One test per error code from ERROR CATALOG
- One test per notFoundAction (type: error / defaults / continue)
- One happy path test
- Use exact field names from INPUT/OUTPUT PARAMETERS
- For notFoundAction defaults: assert exact field values from notFoundAction.fields
- Never invent error codes not in ERROR CATALOG
```

**`providers/claude.js` і `providers/openai.js`** — новий метод `generateTests(context)`.

### Зміни UI — CodeTab

```
[Generate module]  [☐ Include tests]

// після генерації з тестами:

[ Code ] [ Tests ]   ← tabs

↓ Download .ts    ↓ Download .test.ts    ↓ Download project .zip    [Regenerate]
```

Реалізація: додати `testsTab` state і умовний рендер другого `<pre>` блоку.

### Файли для зміни

| Файл | Зміна |
|------|-------|
| `server/src/services/codeGenerationService.js` | `generateEntryPointTests()`, `buildTestGenContext()`, оновити `generateEntryPoint()` і `generateProgram()` для `includeTests` флагу, оновити `generateProject()` |
| `server/src/ai/prompts.js` | `TEST_GENERATION_PROMPT` |
| `server/src/ai/providers/claude.js` | метод `generateTests(context)` |
| `server/src/ai/providers/openai.js` | метод `generateTests(context)` |
| `server/src/routes/programs.js` | `includeTests` у `/generate` ендпоінті |
| `client/src/components/Panel/CodeTab.jsx` | checkbox + tabs + download .test.ts |
| `client/src/api/programs.js` | передавати `includeTests` у API виклики |

---

## Порядок реалізації

1. **Typed contracts (детерміновано)** — починати звідси, бо без AI, швидко, низький ризик
   - `generateProgramTypes()` функція
   - Роут `/program-types`
   - Оновити `generateProject()` щоб включав `types.ts`
   - Оновити промпт і `wireInterProgramCalls`

2. **Test generation (AI)**
   - `TEST_GENERATION_PROMPT` + provider метод
   - `generateEntryPointTests()` + `buildTestGenContext()`
   - Роут зміна (includeTests флаг)
   - UI: checkbox + tabs + download

Частини незалежні — можна реалізовувати паралельно або окремо.

---

## Вплив на вартість

Тести — окремий AI виклик, менший ніж для генерації коду (менший output):

| Сценарій | Додатковий час | Додаткова вартість |
|----------|---------------|-------------------|
| Один entry point з тестами | +3-5 сек | ~+$0.01 |
| Повна програма (3-5 entry points) з тестами | +8-15 сек | ~+$0.03-0.05 |
| Project zip (20 програм) з тестами | +1-2 хв | ~+$0.60-1.00 |

Typed contracts — детерміновано, без AI, вартість нульова.

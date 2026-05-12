# System Overview — AI Converter Pipeline

## 1. Завантаження файлу

Користувач завантажує `.cbl`, `.cob` або `.c` файл через UI.

**`analysisService.uploadAndStartAnalysis`** виконує такі кроки:

1. Визначає тип файлу: `cobol` або `c`.
2. **Препроцесинг** (тільки для COBOL): `preprocessCobol(text)` —
   - Визначає формат: fixed-format (перші 6 символів рядка — цифри) або free-format.
   - Fixed-format: вирізає sequence numbers (cols 1–6), identification area (cols 73+), пропускає рядки-коментарі (col 7 = `*`, `/`, `D`).
   - Обрізає файл на параграфі `OPEN-REC.` (якщо є) — він містить boilerplate без корисної логіки.
   - Згортає послідовні порожні рядки.
3. Зберігає препроцесований текст на диск (`uploads/{program_id}.cbl`), шлях фіксує в БД.
4. **Парсинг** в чанки (`parseCobol` або `parseCProgram`).
5. Зберігає чанки в БД (`program_chunks`).
6. Запускає аналіз у фоні.

---

## 2. Парсинг в чанки

**`parseCobol(cobolText)`** проходить по рядках і ділить файл на логічні блоки:

| `chunk_type`    | Що це                                         |
|-----------------|-----------------------------------------------|
| `data_summary`  | Секції даних: WORKING-STORAGE, LINKAGE, FILE  |
| `paragraph`     | Параграф PROCEDURE DIVISION (≤ 300 рядків)    |
| `sub_paragraph` | Параграф > 300 рядків → вікна з overlap 45 рядків |

**Алгоритм:**
- Вхід в DATA DIVISION → починає збирати секції (`data_summary`).
- Вхід в PROCEDURE DIVISION → починає збирати параграфи.
- Параграф детектується по рядку вигляду `PARAGRAPH-NAME.` на початку рядка (без відступу або PROCEDURE PARA).
- Якщо параграф > 300 рядків, він нарізається вікнами по 300 рядків з перекриттям 45 рядків (`sub_paragraph`). Overlap 45 рядків (~15%) достатній щоб AI у другому вікні бачив відкриті IF/EVALUATE блоки.

---

## 3. Структурний аналіз (до AI)

Перед зверненням до AI парсер витягує структурну інформацію прямо з тексту (без AI). Результати кешуються в `programs.structural_cache` після першого аналізу — при повторному аналізі екстракція пропускається.

| Що витягується                   | Функція                       | Звідки береться                                |
|----------------------------------|-------------------------------|------------------------------------------------|
| Linkage Section variables        | `extractLinkageVars`          | LINKAGE SECTION, level + PIC + direction       |
| Working-Storage variables        | `extractWorkingStorage`       | WORKING-STORAGE SECTION                        |
| CALL statements                  | `extractCalls`                | `CALL 'PROGRAM' USING ...`                     |
| EXEC SQL operations              | `extractExecSql`              | SQL блоки між EXEC SQL … END-EXEC              |
| TUX middleware tables            | `extractTuxTables`            | `{PREFIX}-TABNAM VALUE "tablename"` декларації |
| EVALUATE dispatch                | `extractEvaluateDispatch`     | EVALUATE … WHEN блоки                          |
| Paragraph PERFORM graph          | `extractPerformGraph`         | PERFORM виклики між параграфами; `PERFORM A THRU B` розширює весь діапазон параграфів від A до B |
| Missing PERFORM targets          | `collectMissingParagraphs`    | PERFORM цілі, яких немає серед визначених параграфів — сигнал динамічного PERFORM або неповного THRU |
| Pre-dispatch paragraphs          | `findPreDispatchParagraphs`   | PERFORM до EVALUATE в dispatch-параграфі       |
| Error entries (SEQ-NO + DATA-EL) | `extractErrorEntries`         | `MOVE nnnn TO *SEQ-NO` + `MOVE "X" TO *DATA-EL` |
| SELECT file declarations         | `extractSelectFiles`          | `SELECT ... ASSIGN ...`                        |

**Direction linkage fields**: визначається по суфіксу імені —
`{3 chars}{R|U}I-…` → `in`, `{3 chars}{R|U}O-…` → `out`, інакше `null`.

**TUX tables — три стратегії:**
- Strategy 1: `MOVE "RD" TO {PREFIX}-FUNC` — пряме присвоєння операції
- Strategy 2a: назва параграфа `{VERB}-{PREFIX}-...` де VERB = VLD/READ/INS/UPD/DEL — операція з назви
- Strategy 2b: ціль PERFORM — `PERFORM READ-CDV` → суфікс `CDV` шукається в `suffixToPrefix` map (побудований з TABNAM декларацій). Вирішує проблему truncation: якщо визначення параграфа обрізане `OPEN-REC.`, але PERFORM залишився — таблиця все одно знайдеться.

Для полів ключа — сканує MOVE до PERFORM у вікні 15 рядків; пробує і повний (`EXRCDV-`), і короткий (`CDV-`) префікс.

**`filterEntryPoints(entryPoints, evaluateDispatch)`** — фільтрує entry points після AI відповіді: якщо структурний аналіз знайшов EVALUATE dispatch, тільки ті entry points залишаються, чиї `paragraphNames` перетинаються з dispatch targets. Entry points типу `always` не фільтруються. Вирішує проблему copy-book параграфів (SCCGTERR тощо), які AI помилково виносить як окремі операції.

---

## 4. Формування контексту для AI

**`buildStructural`** збирає всю структурну інформацію в текстовий блок:

```
LINKAGE SECTION VARIABLES:
  01 VLLRI-EXEC-LGN-ID (X(10)) [in]
  ...

WORKING-STORAGE VARIABLES:
  ...

CALL STATEMENTS:
  CALL 'ARCUSACS' USING WS-AREA

DATABASE OPERATIONS (EXEC SQL):
  EXREUR: SELECT  key: EUR-EXEC-LGN-ID  fields: EUR-ENBL-FLG, EUR-STATUS

DATABASE OPERATIONS (TUX MIDDLEWARE):
  extcns: READ  key: eur_exec_lgn_id

ENTRY POINT DISPATCH:
  EVALUATE WS-FUNC:
    WHEN "INS" → PERFORM INSERT-RECORD
    WHEN "UPD" → PERFORM UPDATE-RECORD

PRE-DISPATCH PARAGRAPHS: VALIDATE-LINKAGE, INITIAL-SETUP

ERROR ENTRIES: 1500 (EUR-EXEC-LGN-ID), 1600 (CNS-ENV-NM)

WARNING — PERFORM targets not found as paragraph definitions (possible dynamic PERFORM or THRU gaps): WS-DYNAMIC-PARA
```

Секція `WARNING` з'являється лише якщо `collectMissingParagraphs` повернув непорожній set.

**`buildContext`** = structural block + повний текст параграфів (для малих файлів).

---

## 5. Малий vs великий файл

**Ліміти** (`orchestrator.js`):

| Константа     | Значення    | Сенс                                              |
|---------------|-------------|---------------------------------------------------|
| `TOKEN_LIMIT` | 80 000      | Повний контекст ≤ цього → один AI виклик          |
| `MODEL_LIMIT` | 100 000     | Якщо snippets > цього → ще коротші сніпети (3 рядки) |

**Токени оцінюються**: `ceil(text.length / 4)`.

### Малий файл (≤ 80k токенів)
Один виклик AI з повним контекстом (структура + всі параграфи повністю).

### Великий файл (> 80k токенів) — двокроковий аналіз

**Крок 1** — структура + короткі сніпети параграфів (5 рядків, або 3 якщо > 100k):
- AI ідентифікує entry points та їх `paragraphNames`.
- Параграф з `EVALUATE` завжди показується повністю (щоб AI бачив dispatch).

**Крок 2** — для кожного entry point паралельно:
- Беруться `paragraphNames` з кроку 1.
- До них додаються pre-dispatch параграфи.
- Транзитивно розкриваються всі PERFORM залежності (`resolveTransitive`).
- AI отримує: структура + тільки релевантні параграфи повністю.
- Повертає `steps`, `sideEffects`, `returns`, `errors`, `dbOperations` для цього entry point.

---

## 6. Що надсилається AI і що отримуємо

### Промпт (COBOL)
- `BUSINESS_ANALYSIS_PROMPT(context)` — основний аналіз.
- `ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)` — детальний аналіз entry point (великий файл, крок 2).

### AI повертає JSON

```json
{
  "businessPurpose": "...",
  "parameters": [
    { "name": "camelCase", "cobolName": "COBOL-NAME", "type": "string|number|object", "direction": "in|out|inout", "description": "..." }
  ],
  "entryPoints": [
    {
      "condition": "FUNC='INS'",
      "businessName": "Create Record",
      "paragraphNames": ["INSERT-RECORD"],
      "steps": ["Validates EXEC-LGN-ID is not spaces; if blank, returns error 1500", "..."],
      "sideEffects": ["Inserts row into exreur"],
      "returns": "...",
      "errors": ["1500 (EUR-EXEC-LGN-ID): login not provided"],
      "dbOperations": [{ "table": "exreur", "operation": "INSERT", "keyFields": [], "notFoundAction": null }]
    }
  ],
  "errorCatalog": [{ "code": "1500", "businessMeaning": "...", "systemAction": "..." }],
  "externalDependencies": [{ "program": "ARCUSACS", "purpose": "...", "dataIn": "...", "dataOut": "..." }],
  "dbTables": [{ "table": "exreur", "operation": "SELECT", "fields": [...], "keyFields": [...], "notFoundAction": { "type": "error", "code": 1500 } }],
  "fileIO": [{ "file": "USR-FILE", "operations": ["OPEN","READ","CLOSE"] }]
}
```

**Важливо:** AI не вигадує назви таблиць — правило в промпті вимагає використовувати ТОЧНІ назви з секцій `DATABASE OPERATIONS` вище. Якщо таблиця є в параграфі але не в структурному блоці — писати COBOL-префікс як є.

**`notFoundAction` — структурований об'єкт** (для SELECT-операцій). Чотири типи:
- `{ "type": "error", "code": N }` — виконання зупиняється, повертається код помилки
- `{ "type": "defaults", "fields": { "FIELD": value }, "logError": bool }` — встановлюються конкретні поля й виконання продовжується
- `{ "type": "continue" }` — відсутність запису є нормальною бізнес-логікою
- `{ "type": "skip" }` — операція умовно пропускається (не виконується взагалі)
- INSERT/UPDATE/DELETE → `null`

AI визначає тип, читаючи COBOL параграф, а не здогадуючись з каталогу помилок.

**`errorCatalog`** — тільки коди, які буквально присутні в COBOL (`MOVE <literal> TO status-field`). Вигадані коди на кшталт `9999` заборонені правилом промпту.

**Валідація `dbTables` (`validateDbTables`):** після отримання відповіді AI, кожна таблиця в `dbTables` перевіряється проти списку відомих таблиць з `extractExecSql` + `extractTuxTables`. Якщо назва таблиці не знайдена в жодному з джерел — запис помічається `ai_hallucinated: true`. Якщо структурний аналіз не знайшов жодної таблиці (порожній known set) — валідація пропускається (ми не можемо стверджувати що AI помилився).

### `mapResult` перетворює відповідь AI

| AI поле           | DB поле                                                            |
|-------------------|--------------------------------------------------------------------|
| `businessPurpose` | `business_purpose` (text)                                         |
| `parameters`      | Використовуються тільки `description` поля — типи й direction беруться з `linkageVars` (parsed PIC) |
| `entryPoints`     | `entry_points` (JSON)                                             |
| `errorCatalog`    | `error_catalog` (JSON)                                            |
| `externalDependencies` | `external_dependencies` (JSON)                             |
| `dbTables`        | `db_tables` (JSON)                                                |
| `fileIO`          | `file_ops` (JSON)                                                 |

**`input_contract` / `output_contract`** — будуються з PARSED `linkageVars`:
- `type`: PIC X → `string`, PIC 9/S9 → `number`, group (no PIC) → `object`
- `direction`: з суфіксу імені (RI → in, RO → out, інше → inout)
- `description`: береться з AI відповіді через `cobolName` lookup

---

## 7. Що зберігається в БД

### Таблиця `programs`
| Поле               | Зміст                                        |
|--------------------|----------------------------------------------|
| `name`             | Ім'я програми (з назви файлу, uppercase)    |
| `file_path`        | Шлях до препроцесованого файлу на диску      |
| `file_type`        | `cobol` або `c`                              |
| `status`           | `pending` / `analyzing` / `analyzed` / `failed` |
| `companion_content`| Текст заголовочного `.h` файлу (для C)      |
| `structural_cache` | JSONB — кеш структурного аналізу (linkageVars, calls, execSqlTables, tuxTables, performGraph тощо). Заповнюється після першого аналізу. При повторному аналізі — структурна екстракція пропускається, дані беруться звідси. |

### Таблиця `program_chunks`
Кожен чанк після парсингу:
| Поле             | Зміст                                        |
|------------------|----------------------------------------------|
| `chunk_type`     | `data_summary` / `paragraph` / `sub_paragraph` |
| `chunk_name`     | Назва параграфу або секції                   |
| `cobol_text`     | Текст чанку                                  |
| `start_line`, `end_line` | Рядки в оригінальному файлі          |
| `token_estimate` | Приблизна кількість токенів                  |

### Таблиця `program_analysis`
Результат AI аналізу:
| Поле                    | Зміст                                            |
|-------------------------|--------------------------------------------------|
| `business_purpose`      | Одне речення — навіщо ця програма               |
| `input_contract`        | JSON array параметрів напрямку `in` / `inout`   |
| `output_contract`       | JSON array параметрів напрямку `out` / `inout`  |
| `entry_points`          | JSON array — операції, кроки, DB ops, помилки   |
| `error_catalog`         | JSON array — всі коди помилок з поясненнями     |
| `external_dependencies` | JSON array — зовнішні CALL (не C_xxx утиліти)   |
| `db_tables`             | JSON array — таблиці, операції, ключові поля. Записи що не пройшли cross-validation мають `ai_hallucinated: true` |
| `file_ops`              | JSON array — файлові I/O операції               |
| `pre_dispatch`          | JSON array — параграфи, що виконуються до EVALUATE |
| `analysis_model`        | Модель AI, яка використовувалась                |
| `analysis_two_step`     | `true` якщо файл великий і аналіз двокроковий   |
| `flags`                 | JSONB — мітки entry points (warning/deprecated)  |

### Таблиця `program_calls`
Залежності між програмами на рівні структурної екстракції (всі `CALL` оператори, не фільтровані AI):

| Поле                | Зміст                                                   |
|---------------------|---------------------------------------------------------|
| `caller_program_id` | FK → programs.id (програма, що викликає)               |
| `callee_name`       | Ім'я викликаної програми (uppercase)                    |
| `callee_program_id` | FK → programs.id (null якщо програма ще не завантажена) |
| `call_context`      | USING аргументи з CALL оператора                        |

UNIQUE constraint: `(caller_program_id, callee_name)`.

`callee_program_id` автоматично заповнюється при завантаженні цільової програми (`backfillCallTargets`).

**API:**
- `GET /api/programs/callers/:name` — всі програми, що викликають програму з даним іменем
- `GET /api/programs/:id/calls` — всі програми, які викликає дана програма

### Що НЕ зберігається
- Оригінальний (непрепроцесований) текст файлу — тільки препроцесований на диску.
- Table catalog (збагачення колонок) — обчислюється на вимогу через `/table-catalog`, не зберігається.

---

## 8. Повторний аналіз

**`reanalyze(programId)`** (`analysisService.js`):
1. Очищає `structural_cache` → `NULL` в БД перед запуском.
2. Читає файл з диску, запускає `runAnalysisCore`.
3. Без очищення кешу — нові версії екстракторів не вступають в дію (дані беруться зі старого кешу).

---

## 9. Генерація коду

**Endpoint:** `POST /api/programs/:id/generate`  
**Body:** `{ "condition": "FUNC='RD'", "includeTests": false }` — умова entry point (або відсутнє → перший entry point); `includeTests` — опціонально, генерує unit тести разом з кодом.  
**Response:** `{ functionName, code, notes, paragraphsIncluded, contextTokenEstimate, tests? }`

Поле `tests` присутнє тільки якщо `includeTests: true` — містить готовий Vitest файл.

### Контекст для генерації (`codeGenerationService.js`)

Формується з трьох джерел (без повного файлу, тільки релевантні частини):

| Джерело | Що дає |
|---------|--------|
| `program_analysis` (БД) | `business_purpose`, `input_contract`, `output_contract`, `error_catalog`, `external_dependencies`, `entry_points[i]` (steps, sideEffects, errors, dbOperations) |
| `programs.structural_cache` (БД) | `performGraph` + `preDispatchNames` для транзитивного розкриття PERFORM залежностей |
| `program_chunks` (БД) | Тільки параграфи релевантного entry point (+ pre-dispatch + транзитивні PERFORM цілі) |
| Файл на диску | `extractTuxTableSchemas` — схеми полів TUX буферів; `extractWsConstants` — VALUE-ініціалізовані WS константи |

### `extractTuxTableSchemas(cobolText)`

Витягує структуру запису для кожної TUX таблиці з WS секції. Патерн:
- `EXRCDV-TABNAM VALUE "exrcdv"` → повний префікс `EXRCDV`, короткий `CDV` (останні 3 символи)
- Шукає всі `CDV-*` поля з PIC типами
- `CDV-KEY` / `CDV-DATA` — групи без PIC, ігноруються
- Повертає `{ [tableName]: [{ name, camelName, pic, type }] }`

Результат для `exrcdv`:
```
CDV-MACADDR (X(12), string)
CDV-HOST-NM (X(15), string)
CDV-UPD-AUTH-REQD (9(1), number)
CDV-INSYNC-ACTV (9(1), number)
...
```

### `extractWsConstants(cobolText)`

Знаходить VALUE-ініціалізовані WS поля з рядковими літералами — бізнес-константи типу:
```
WS-PRS-MD-INFO PIC X(01) VALUE "1"
```

Виключає фігуративні константи (`SPACES`, `ZERO` тощо) і інфраструктурні суфікси (`TABNAM`, `FUNC`...).

### Параграфи в контексті

Той самий алгоритм що й для двокрокового аналізу:
1. Беруться `paragraphNames` вибраного entry point.
2. Додаються pre-dispatch параграфи.
3. Транзитивно розкриваються всі PERFORM залежності через `resolveTransitive`.
4. З `program_chunks` вибираються тільки ці параграфи (≈ 60–200 рядків для типового entry point замість повного файлу 5000+ рядків).

### Промпт (`CODE_GENERATION_PROMPT`)

Вимагає повну реалізацію без заглушок:
- DB операції: `await db.select(TABLE, { keyField: value })`
- Зовнішні виклики: `await callProgram(NAME, inputObj)`
- Помилки: `return { error: 1500, field: 'FIELD-NAME' }`
- 88-level умови → boolean перевірки
- Порядок steps — дотриматись строго

Повертає JSON: `{ functionName, code, notes }`.

### Якість генерації (поточний стан PoC)

**Добре:**
- Правильні camelCase назви полів з точними COBOL PIC типами
- Правильні WS константи (без плейсхолдерів)
- ICF×CDV вкладений IF здебільшого коректний (`(icfAutoUpd === 0 || cdvInsyncActv === 0) ? 0 : 1`)

**Відомі проблеми (вирішені):**
- Error 1508 (CDV not found) — раніше AI генерував як hard error. Виправлено: новий структурований `notFoundAction` з типом `defaults` точно описує `SET-OUT-LNK-NO-CDV` → INSYNC-ACTV=0, UPD-AUTH-REQD=1 + `logError: true`. Steps тепер повинні містити inline-опис поведінки при not found.
- AI вигадував `catch → error: 9999` якого немає в COBOL — тепер заборонено явним правилом `errorCatalog`: тільки коди з буквальних MOVE в COBOL-джерелі.

**Експеримент: steps vs. no steps**

Прибрання `steps` з контексту дало гірший результат: AI вигадував зайві функції (`callService`, `logError`) і підтягував нерелевантні WS константи. Steps залишаються в контексті — вони зменшують noise і дають AI правильний порядок операцій. Покращені правила промпту (`CODE_GENERATION_PROMPT`) вимагають: логіку брати з COBOL параграфів, boolean умови переводити буквально, не додавати catch блоки яких немає в COBOL.

---

## 10. Типізовані контракти між програмами

**Endpoint:** `POST /api/programs/program-types`  
**Body:** `{ "programIds": [1, 2, 3] }`  
**Response:** `{ code, programs }` — готовий `types.ts` файл і список програм.

### `generateProgramTypes(programIds)`

Детерміністична функція (без AI). Читає `input_contract` і `output_contract` з `program_analysis` для кожної програми та генерує TypeScript інтерфейси:

```typescript
// src/types.ts — авто-згенерований файл
export interface ExrvllInput {
  execLgnId: string     // EUR-EXEC-LGN-ID
  macaddr: string       // CDV-MACADDR
}
export interface ExrvllOutput {
  insyncActv: number
  updAuthReqd: number
  returnCode: number
}
```

Правила перетворення типів — ті самі що і в `mapResult`:
- PIC X → `string`
- PIC 9 / S9 → `number`
- group level (no PIC) → `object`

### Вплив на генерацію коду

`PROGRAM_GENERATION_PROMPT` отримує додаткову секцію:

```
TYPESCRIPT INTERFACES (use for function signature):
  Input type:  ExrvllInput
  Output type: ExrvllOutput
  Import from: './types.js'
```

AI генерує типізовані сигнатури:

```typescript
import type { ExrvllInput, ExrvllOutput } from './types.js'

export async function execute(input: ExrvllInput): Promise<ExrvllOutput> { ... }
```

### Типізований wiring між програмами

`wireInterProgramCalls` (у `generateApplication`) замінює нетипізований виклик:

```typescript
// До (нетипізований)
const result = await callProgram('ARCUSACS', input)

// Після (типізований)
import type { ArcusacsInput } from './types.js'
import { execute as executeArcusacs } from './ARCUSACS.js'
const result = await executeArcusacs(input as ArcusacsInput)
```

### Структура project zip (оновлена)

```
src/
  types.ts              ← новий: всі Input/Output інтерфейси
  db.ts                 ← DB заглушка
  index.ts              ← реєстр програм
  EXRVLL.ts
  ARCUSACS.ts
  __tests__/            ← новий: якщо includeTests=true
    EXRVLL.test.ts
    ARCUSACS.test.ts
```

---

## 11. Генерація тестів (опціонально)

### Підхід

Mock-based unit тести генеруються з аналізу — без запуску COBOL коду (він недоступний). Джерелом є структурований аналіз що вже є в БД: `errorCatalog`, `dbOperations.notFoundAction`, `steps`, `input_contract`.

### Покриття тестів

| Тип тесту | Джерело даних | Що перевіряє |
|-----------|---------------|--------------|
| Input validation | `steps` зі словами "blank", "zero", "invalid" | Повертає правильний error код |
| NotFoundAction error | `dbOperations` з `{ type: 'error', code: N }` | `db.select` → null → повертає error N |
| NotFoundAction defaults | `dbOperations` з `{ type: 'defaults', fields }` | `db.select` → null → встановлює конкретні поля, продовжує виконання |
| NotFoundAction continue | `dbOperations` з `{ type: 'continue' }` | `db.select` → null → виконання продовжується нормально |
| Happy path | `output_contract` | Всі DB операції успішні → повертає populated output |

### Промпт `TEST_GENERATION_PROMPT`

Отримує той самий контекст що й `CODE_GENERATION_PROMPT` (без COBOL параграфів — тільки аналіз).

Правила генерації:
- Мокувати `db` і `callProgram` через `vi.mock`
- Один тест на кожен error код з `errorCatalog`
- Один тест на кожну `notFoundAction` (окрім null)
- Один happy path тест
- Використовувати точні назви полів з `input_contract` / `output_contract`
- Для `{ type: 'defaults' }` — перевіряти точні значення з `notFoundAction.fields`
- Не вигадувати error коди яких немає в `errorCatalog`

Повертає JSON: `{ testFile, coverage }`.

### `generateEntryPointTests(programId, condition)`

Новий публічний метод у `codeGenerationService.js`. Будує контекст через `buildTestGenContext` — скорочена версія `buildCodeGenContext` без COBOL параграфів (вони не потрібні для тестів).

### Providers

Нові методи `claude.generateTests(context)` і `openai.generateTests(context)` — аналогічні до `generateCode` але з іншим промптом і схемою відповіді.

### UI (CodeTab)

- Checkbox "Include tests" перед генерацією
- Після генерації з тестами — два таби: **Code** і **Tests**
- Додаткова кнопка `↓ Download .test.ts`
- У project zip тести потрапляють автоматично в `src/__tests__/` якщо `includeTests: true`

### Вартість

Окремий AI виклик, менший за генерацію коду (~30-50% від вартості code gen). Тригериться тільки при явному `includeTests: true`.

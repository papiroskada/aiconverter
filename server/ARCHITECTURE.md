# Server Architecture

## Overview

Node.js + Express сервер для конвертації COBOL/C legacy-коду в TypeScript/JavaScript за допомогою LLM. Приймає вихідні файли через REST API, парсить їх структурно, відправляє на аналіз до AI-провайдера, зберігає результати в PostgreSQL, і може згенерувати готовий JS/TS код.

**Технологічний стек:** Node.js (ESM), Express, PostgreSQL (`pg`), Anthropic SDK / OpenAI SDK, Vitest, Multer, SSE для real-time прогресу.

---

## Директорна структура

```
server/
├── server.js                         # Точка входу — запуск HTTP-сервера
├── src/
│   ├── app.js                        # Express-конфігурація, middleware, монтування роутів
│   ├── logger.js                     # Кольоровий консольний логер з таймінгами
│   ├── db/
│   │   ├── client.js                 # PostgreSQL connection pool (pg.Pool)
│   │   ├── migrate.js                # Запуск schema.sql при старті
│   │   └── schema.sql                # DDL: таблиці, enum-типи, міграції
│   ├── models/                       # Data access layer — SQL-запити без бізнес-логіки
│   │   ├── applications.js
│   │   ├── programs.js
│   │   ├── programAnalysis.js
│   │   ├── programChunks.js
│   │   ├── programEdges.js
│   │   ├── programCalls.js
│   │   └── settings.js
│   ├── parser/                       # Статичний парсинг без AI
│   │   ├── cobolParser.js            # Лексичний аналіз COBOL
│   │   ├── cobolExtractor.js         # Regex-вилучення конструкцій
│   │   └── cParser.js                # Парсинг C-файлів
│   ├── ai/
│   │   ├── orchestrator.js           # COBOL AI-аналіз
│   │   ├── cOrchestrator.js          # C AI-аналіз
│   │   ├── prompts.js                # LLM-промпти + JSON-схеми
│   │   └── providers/
│   │       ├── base.js               # Абстрактний клас провайдера
│   │       ├── claude.js             # Anthropic Claude
│   │       └── openai.js             # OpenAI GPT
│   ├── routes/
│   │   ├── programs.js               # /api/programs — завантаження, аналіз, генерація коду
│   │   ├── applications.js           # /api/applications — batch-управління
│   │   └── settings.js               # /api/settings — налаштування AI
│   └── services/
│       ├── analysisService.js        # Orchestration upload → parse → analyze
│       ├── batchService.js           # Конкурентний batch-аналіз (3 воркери)
│       ├── graphService.js           # Підтримка графу залежностей
│       ├── exportService.js          # Експорт в Markdown / OpenAPI
│       └── codeGen/
│           ├── index.js              # Ре-експорт публічного API
│           ├── utils.js              # Чисті утиліти
│           ├── formatters.js         # Форматери для LLM-промптів
│           ├── contextBuilders.js    # Збірка контекстів для LLM + завантаження даних
│           ├── typeGeneration.js     # Детерміноване генерування TypeScript типів
│           ├── programGeneration.js  # Генерація коду для entry point / програми
│           └── appGeneration.js      # Генерація на рівні застосунку + project scaffold
├── tests/
│   ├── ai/
│   ├── parser/
│   ├── routes/
│   └── services/
└── uploads/                          # Збережені вихідні файли (UUID-іменовані)
```

---

## Шари архітектури

```
HTTP Request
     │
  routes/          — маршрутизація, HTTP-специфічні речі (status codes, SSE, multer)
     │
  services/        — бізнес-оркестрація, координує моделі + AI
     │
  models/          — SQL-запити, нічого крім роботи з БД
     │
  parser/ + ai/    — статичний аналіз і LLM-виклики
     │
  db/client.js     — PostgreSQL pool
```

---

## База даних

### Таблиці

#### `applications`
Групує набір програм для batch-аналізу.

| Колонка | Тип | Опис |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | Назва застосунку (UPPERCASE) |
| `status` | TEXT | `pending` / `analyzing` / `analyzed` / `failed` |

#### `programs`
Центральна таблиця. Кожен запис — один COBOL або C файл.

| Колонка | Тип | Опис |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | Ім'я програми (ім'я файлу без розширення, UPPERCASE) |
| `status` | `program_status` | `pending` / `analyzing` / `analyzed` / `failed` |
| `file_path` | TEXT | Шлях до збереженого файлу в `uploads/` |
| `file_type` | TEXT | `cobol` або `c` |
| `application_id` | UUID FK | Посилання на `applications`, nullable |
| `companion_content` | TEXT | Вміст допоміжного `.u` файлу (для C-програм) |
| `structural_cache` | JSONB | Кеш результатів regex-парсингу (щоб не перечитувати при реаналізі) |
| `analyzed_at` | TIMESTAMP | |

#### `program_analysis`
Результат AI-аналізу. Один запис на програму (UNIQUE по `program_id`).

| Колонка | Тип | Опис |
|---|---|---|
| `program_id` | UUID FK | |
| `business_purpose` | TEXT | Бізнес-ціль у одному реченні |
| `input_contract` | TEXT (JSON) | Масив вхідних параметрів з типами |
| `output_contract` | TEXT (JSON) | Масив вихідних параметрів |
| `entry_points` | JSONB | Масив entry-points (умова, кроки, DB-операції, помилки) |
| `error_catalog` | JSONB | Всі коди помилок програми |
| `external_dependencies` | JSONB | Виклики інших програм |
| `db_tables` | JSONB | Таблиці БД з операціями та notFoundAction |
| `pre_dispatch` | JSONB | Параграфи, що виконуються перед кожним entry-point |
| `analysis_model` | TEXT | Яка модель виконала аналіз |
| `analysis_two_step` | BOOLEAN | Чи використовувався двокроковий аналіз |
| `flags` | JSONB | Мітки `warning` / `deprecated` на entry-points |

#### `program_chunks`
Фрагменти вихідного коду, розбиті для вкладання в LLM-контекст.

| Колонка | Тип | Опис |
|---|---|---|
| `program_id` | UUID FK | |
| `chunk_type` | `chunk_type` | `data_summary` / `paragraph` / `sub_paragraph` / `function` / `entry_point` |
| `chunk_name` | TEXT | Ім'я параграфа / функції |
| `start_line` / `end_line` | INT | Позиція в оригінальному файлі |
| `cobol_text` | TEXT | Текст фрагменту |
| `token_estimate` | INT | Оцінка кількості токенів |

#### `program_edges`
Граф залежностей між програмами (виявлені CALL-зв'язки).

| Колонка | Тип | Опис |
|---|---|---|
| `from_program_id` | UUID FK | Програма-caller |
| `to_program_name` | TEXT | Ім'я callee (може не існувати в системі — "phantom") |
| `to_program_id` | UUID FK nullable | Заповнюється коли callee завантажено |

#### `program_calls`
Структурно вилучені CALL-оператори (не AI-фільтровані, тому більш вичерпні ніж `external_dependencies`).

| Колонка | Тип | Опис |
|---|---|---|
| `caller_program_id` | UUID FK | |
| `callee_name` | TEXT | |
| `callee_program_id` | UUID FK nullable | |
| `call_context` | TEXT | Аргументи USING |

#### `settings`
Singleton-рядок (id=1). Глобальна конфігурація.

| Колонка | Опис |
|---|---|
| `ai_provider` | `claude` або `openai` |
| `claude_model_interface` | Модель для основного аналізу (за замовчуванням `claude-sonnet-4-6`) |
| `claude_model_rules` | Модель для detail-аналізу (за замовчуванням `claude-haiku-4-5-20251001`) |
| `openai_model_interface` / `openai_model_rules` | Аналоги для OpenAI |
| `code_language` | `typescript` або `javascript` |
| `code_db_read` / `code_db_write` | Патерни для генерації коду (шаблони з `{table}`, `{key}`) |
| `code_error_convention` | Патерн для повернення помилок |
| `code_external_call` | Патерн для виклику інших програм |
| `code_source_mode` | `with_source` або `logic_only` |

---

## Шар моделей (`src/models/`)

Тонкі обгортки над `pool.query()`. Не містять бізнес-логіки.

### `programs.js`
| Функція | SQL-дія |
|---|---|
| `createProgram(data)` | INSERT → повертає програму |
| `findProgramById(id)` | SELECT за id |
| `findProgramByName(name)` | SELECT за name (UPPERCASE) |
| `getAllPrograms()` | SELECT всіх (включно з phantom) |
| `updateProgramStatus(id, status, opts)` | UPDATE status, опційно analyzed_at |
| `updateFilePath(id, filePath)` | UPDATE file_path |
| `updateProgramApplicationId(id, appId)` | UPDATE application_id |
| `saveStructuralCache(id, cache)` | UPDATE structural_cache (null = скинути) |
| `deleteProgramById(id)` | DELETE |
| `deleteOrphanedPhantoms()` | DELETE phantom-програми без edges |
| `getProgramsByApplicationId(appId)` | SELECT за application_id |
| `deleteProgramsByApplicationId(appId)` | DELETE всіх програм застосунку |

### `programAnalysis.js`
| Функція | SQL-дія |
|---|---|
| `upsertBusinessAnalysis(programId, data)` | INSERT ON CONFLICT UPDATE — зберігає весь результат аналізу |
| `getAnalysisByProgramId(id)` | SELECT |
| `updateFlag(programId, condition, flag)` | UPDATE flags JSONB для конкретного entry-point |
| `patchEntryPoints(programId, entry_points)` | UPDATE entry_points JSONB |

### `programChunks.js`
| Функція | SQL-дія |
|---|---|
| `insertChunks(programId, chunks)` | DELETE старих + INSERT нових, повертає збережені |
| `getChunksByProgramId(id)` | SELECT всіх chunks ORDER BY order_index |

### `programEdges.js`
| Функція | SQL-дія |
|---|---|
| `getAllEdges()` | SELECT всіх edges з іменами програм |
| `getEdgesForProgram(id)` | SELECT edges де from або to = id |
| `upsertEdge(fromId, toName, toId)` | INSERT ON CONFLICT DO NOTHING |
| `resolveEdge(toName, toId)` | UPDATE to_program_id коли program завантажено |

### `programCalls.js`
| Функція | SQL-дія |
|---|---|
| `upsertCall(data)` | INSERT ON CONFLICT UPDATE |
| `getCallsFromProgram(callerId)` | SELECT всіх CALL з програми |
| `getCallersOf(calleeName)` | SELECT всіх програм, що викликають дану |
| `backfillCallResolutions(calleeName, calleeId)` | UPDATE callee_program_id де callee_name = calleeName |

### `applications.js`
| Функція | SQL-дія |
|---|---|
| `createApplication(data)` | INSERT |
| `getAllApplications()` | SELECT з COUNT програм |
| `findApplicationById(id)` | SELECT |
| `getApplicationPrograms(id)` | SELECT програм застосунку |
| `updateApplicationStatus(id, status)` | UPDATE status |
| `deleteApplicationById(id)` | DELETE |

### `settings.js`
| Функція | Дія |
|---|---|
| `getSettings()` | SELECT (або INSERT DEFAULT якщо singleton відсутній) |
| `updateSettings(data)` | UPDATE settings SET ... |

---

## Парсери (`src/parser/`)

Статичний аналіз без AI. Тільки читання, без звернення до БД.

### `cobolParser.js` (407 рядків)

**Основна задача:** розбити COBOL-текст на chunks і побудувати граф PERFORM-залежностей.

| Функція | Що робить |
|---|---|
| `preprocessCobol(text)` | Видаляє sequence numbers (cols 1-6) з fixed-format COBOL |
| `parseCobol(text)` | Ділить програму на `data_summary` (WORKING-STORAGE, LINKAGE, FILE) і `paragraph`/`sub_paragraph` chunks; оцінює токени |
| `extractLinkageVars(text)` | Витягує змінні LINKAGE SECTION з рівнями, PIC та 88-level conditions; визначає direction за позицією (input/output/inout) |
| `extractWorkingStorage(text)` | Витягує WORKING-STORAGE змінні аналогічно |
| `extractEvaluateDispatch(text)` | Знаходить EVALUATE-блоки і зіставляє WHEN-значення → PERFORM-параграфи |
| `extractPerformGraph(chunks)` | Будує `Map<string, Set<string>>` залежностей PERFORM між параграфами |
| `resolveTransitive(name, graph)` | DFS по performGraph — повертає всі транзитивні залежності параграфа |
| `collectMissingParagraphs(graph)` | Параграфи, на які є PERFORM але немає визначення |

**Алгоритм chunking:** максимум 300 рядків, 45 рядків перекриття між сусідніми фрагментами. Параграфи, що відповідають EVALUATE-dispatch, завжди включаються повністю.

### `cobolExtractor.js` (413 рядків)

**Основна задача:** regex-вилучення конкретних конструкцій з COBOL.

| Функція | Що витягує |
|---|---|
| `extractCalls(text)` | CALL '...' USING ... — список зовнішніх викликів |
| `extractExecSql(text)` | EXEC SQL блоки → `{ table, operation, fields, keyFields }` |
| `extractTuxTables(text)` | Tuxedo middleware виклики (svcCallFdbsqlio та ін.) |
| `extractConstructs(text)` | Список конструкцій: EXEC SQL, FILE I/O, EVALUATE, PERFORM VARYING тощо |
| `extractErrorEntries(text)` | 88-level items з числовими кодами → `{ seqNo, dataElement }` |
| `extractTuxTableSchemas(text)` | WORKING-STORAGE копії Tuxedo-таблиць → `Map<tableName, Field[]>` з PIC-типами та camelCase іменами |
| `extractWsConstants(text)` | VALUE-ініціалізовані поля з WORKING-STORAGE → `{ name, value, camelName }` |

### `cParser.js` (253 рядки)

**Основна задача:** аналог cobolParser для C-файлів CAPI-сервісів.

| Функція | Що робить |
|---|---|
| `parseCProgram(text)` | Ділить C-файл на `function` chunks і `entry_point` chunks |
| `extractCFunctions(text)` | Знаходить визначення функцій (не прототипи): ім'я, аргументи, тіло |
| `extractCIncludes(text)` | `#include` заголовки |
| `extractCServiceCalls(text)` | Виклики svcCall*/c_* функцій |
| `extractCErrorCodes(text)` | Присвоєння числових кодів помилок в output-полях |
| `extractCDbCalls(text)` | svcCallPlnsqlio виклики → `{ table, operation, keyFields }` |
| `extractCModeSwitch(text)` | switch/if-блоки диспетчеризації за mode-полем |

---

## AI-шар (`src/ai/`)

### `providers/base.js`

Абстрактний клас `BaseProvider` з методами:
- `extractBusinessAnalysis(context, signal)` → об'єкт за схемою `BUSINESS_ANALYSIS_PROMPT`
- `analyzeEntryPoint(condition, businessName, context, signal)` → деталі одного entry-point
- `generateCode(context)` → `{ functionName, code, notes }`
- `generateProgram(context, patterns)` → `{ sharedTypes, functions[], dispatcher, imports[], notes[] }`
- `generateTests(context)` → `{ testFile, coverage[] }`

**`getProvider(settings)`** — фабрика: повертає `ClaudeProvider` або `OpenAIProvider` залежно від `settings.ai_provider`.

### `providers/claude.js`

Реалізація через `@anthropic-ai/sdk`. Використовує дві моделі:
- `claude_model_interface` (за замовчуванням `claude-sonnet-4-6`) — для `extractBusinessAnalysis`, `generateCode`, `generateProgram`, `generateTests`
- `claude_model_rules` (за замовчуванням `claude-haiku-4-5-20251001`) — для `analyzeEntryPoint` (детальний аналіз одного entry-point, менша модель = швидше)

Всі методи викликають `client.messages.create({ model, max_tokens: 8192, messages })` і парсять JSON з відповіді.

### `providers/openai.js`

Аналогічна реалізація через `openai` SDK. Використовує `gpt-4o` і `gpt-4o-mini` відповідно.

### `prompts.js` (329 рядків)

Сім LLM-промптів:

| Константа | Використання | Модель |
|---|---|---|
| `BUSINESS_ANALYSIS_PROMPT(context)` | Повний аналіз програми | interface (Sonnet/GPT-4o) |
| `ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)` | Деталі одного entry-point при two-step | rules (Haiku/GPT-4o-mini) |
| `C_BUSINESS_ANALYSIS_PROMPT(context)` | Аналіз C-файлу | interface |
| `C_ANALYZE_ENTRY_POINT_PROMPT(condition, businessName, context)` | Деталі entry-point для C | rules |
| `CODE_GENERATION_PROMPT(context)` | Генерація одного entry-point | interface |
| `PROGRAM_GENERATION_PROMPT(context, patterns)` | Генерація всього модуля | interface |
| `TEST_GENERATION_PROMPT(context)` | Vitest-тести для entry-point | interface |

Кожен промпт містить повну JSON-схему відповіді та деталізовані правила.

### `orchestrator.js` (311 рядків) — COBOL-оркестратор

**Основна задача:** побудувати контекст для LLM, викликати провайдера, нормалізувати результат.

| Функція | Що робить |
|---|---|
| `runAnalysis({ cobolText, chunks, provider, emit, programName, signal, structuralCacheIn })` | Головна точка входу. Вирішує: one-step або two-step. Повертає `{ result, structuralCache }` |
| `estimateTokens(text)` | `Math.ceil(text.length / 4)` |
| `serializePerformGraph(graph)` / `deserializePerformGraph(obj)` | Map↔JSON для зберігання в `structural_cache` |
| `validateDbTables(dbTables, execSqlTables, tuxTables)` | Помічає `ai_hallucinated: true` таблиці, яких нема в структурному парсингу |
| `filterEntryPoints(entryPoints, evaluateDispatch)` | Залишає тільки entry-points, що відповідають EVALUATE-цілям |

**Стратегія токенів:**
- ≤ 80 000 токенів → один виклик LLM з повним кодом
- > 80 000 токенів → two-step: спочатку 5-рядкові сніппети → потім паралельний detail-аналіз кожного entry-point
- > 100 000 токенів → скорочення до 3-рядкових сніпетів

### `cOrchestrator.js` (163 рядки) — C-оркестратор

Аналог `orchestrator.js` для C-файлів. Відмінності:
- Нема PERFORM-graph, замість нього — function-call граф
- Mode-dispatch через switch/if замість EVALUATE
- PRE-DISPATCH FUNCTIONS замість PRE-DISPATCH PARAGRAPHS
- DATABASE CALLS через `svcCallPlnsqlio` замість EXEC SQL / Tuxedo

---

## Сервіси (`src/services/`)

### `analysisService.js` (244 рядки)

Оркеструє повний lifecycle аналізу одного файлу.

| Функція | Що робить |
|---|---|
| `uploadAndStartAnalysis(file, sseEmitters, applicationId, companion)` | Зберігає файл на диск, парсить (COBOL або C), зберігає chunks, запускає аналіз (fire-and-forget для single, повертає програму для batch) |
| `runProgramFromFile(programId, programSseEmitters, settings, appSseEmitters)` | Читає збережений файл і запускає аналіз — використовується batch-сервісом |
| `reanalyze(programId, sseEmitters)` | Скидає `structural_cache`, перезапускає аналіз із наявними chunks |
| `deleteProgram(programId, sseEmitters)` | Видаляє з БД + файл з диску + закриває SSE-з'єднання |
| `cancelProgram(programId)` | Викликає `AbortController.abort()` для активного аналізу |
| `runAnalysisCore(...)` *(internal)* | Власне виконання: вибір COBOL/C оркестратора, збереження результату, оновлення графу, обробка AbortError |

**SSE:** кожен `programId` має `Set<Response>` в `sseEmitters`. `makeEmit(programId, sseEmitters)` будує функцію яка пише `event: X\ndata: {...}\n\n` до всіх підписників.

**Стан:** `Map<programId, AbortController>` для активних аналізів.

### `batchService.js` (102 рядки)

Запускає аналіз набору програм з обмеженням конкурентності.

| Функція | Що робить |
|---|---|
| `startBatchAnalysis(applicationId, mode, appSseEmitters)` | Запускає `sequential` (один за одним) або `parallel` (3 воркери) аналіз усіх програм застосунку; fire-and-forget |
| `cancelBatch(applicationId)` | Помічає batch як скасований; нові воркери не запускаються, поточні доходять до кінця |
| `runWithConcurrencyLimit(tasks, limit)` *(internal)* | Promise-pool: тримає max `limit` паралельних задач |

Статус застосунку оновлюється через `updateApplicationStatus`: `pending → analyzing` при старті, `analyzed` або `failed` по завершенні.

### `graphService.js` (32 рядки)

| Функція | Що робить |
|---|---|
| `updateGraphAfterAnalysis(programId, deps)` | Після аналізу — upsert edges для `external_dependencies`; якщо callee ще не в БД, він лишається як "phantom" (edge без `to_program_id`) |
| `backfillEdgesForNewProgram(program)` | Коли нова програма завантажена — оновлює існуючі phantom-edges, що посилались на її ім'я |

### `exportService.js` (197 рядків)

| Функція | Що робить |
|---|---|
| `toMarkdown(program, analysis)` | Генерує Markdown-специфікацію: бізнес-ціль, contracts, entry-points (кроки, side effects, errors, DB-операції), error catalog, dependencies, DB tables |
| `toOpenApi(program, analysis)` | Генерує OpenAPI 3.0 spec: кожен entry-point → окремий POST-endpoint зі схемами request/response |

### `codeGen/` (704 рядки → 6 файлів)

#### `utils.js`
Чисті функції без зовнішніх залежностей (крім `cobolParser`):

| Функція | Що робить |
|---|---|
| `toPascal(name)` | COBOL-ім'я → PascalCase (замінює `-` і `_` на uppercase) |
| `assembleCode(result)` | Збирає `{ imports, sharedTypes, functions, dispatcher }` в один рядок коду |
| `mergeTestFiles(files)` | Зливає кілька vitest-файлів: boilerplate з першого, `describe`-блоки з решти |
| `getPatterns(settings)` | Витягує `{ language, dbRead, dbWrite, errorConvention, externalCall }` з settings |
| `selectRelevantChunks(paragraphChunks, paragraphNames, performGraph, preDispatchNames)` | Транзитивно розширює набір потрібних параграфів через performGraph |

#### `formatters.js`
Форматери для рядків у LLM-промптах:

| Функція | Що робить |
|---|---|
| `formatParams(contractJson)` | JSON-масив параметрів → читабельний рядок |
| `formatNotFoundAction(nfa)` | `{ type, code, fields }` → людський текст (`"error 1500"`, `"set defaults (X=1) and continue"`) |
| `formatTableSchemas(dbTables, tableSchemas)` | Масив DB-операцій → блок з полями, ключами, notFoundAction |
| `sourceSection(relevantChunks, settings)` | Якщо `code_source_mode !== 'logic_only'` → секція `COBOL SOURCE PARAGRAPHS` |

#### `contextBuilders.js`
Завантаження даних і збірка контекстних рядків для LLM:

| Функція | Що робить |
|---|---|
| `loadProgramData(programId)` | `Promise.all` → program + analysis + chunks; десеріалізує `performGraph`; зчитує файл для `extractTuxTableSchemas` і `extractWsConstants` |
| `buildCodeGenContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)` | Контекст для генерації **одного** entry-point: параметри, патерни, WS constants, error catalog, DB schemas, залежності, кроки |
| `buildProgramContext(program, analysis, relevantChunks, tableSchemas, wsConstants, settings)` | Контекст для генерації **всього** модуля: всі entry-points разом |
| `buildTestGenContext(program, analysis, ep, tableSchemas, wsConstants)` | Контекст для генерації тестів одного entry-point |

#### `typeGeneration.js`
Детерміноване генерування TypeScript-інтерфейсів (без AI):

| Функція | Що робить |
|---|---|
| `generateProgramTypes(programIds)` | З `input_contract` / `output_contract` → `export interface ProgramInput { ... }` + `Output` для кожної програми |
| `generateDbTypes(programIds)` | Читає файли, викликає `extractTuxTableSchemas` → `export interface TableNameRow { ... }` |

#### `programGeneration.js`
Генерація коду для одного entry-point або цілої програми:

| Функція | Що робить |
|---|---|
| `generateEntryPoint(programId, condition, { includeTests })` | Знаходить entry-point за condition → buildCodeGenContext → `provider.generateCode` → результат + опційно тести |
| `generateEntryPointTests(programId, condition)` | Окремо генерує тести для entry-point без коду |
| `generateProgram(programId, { includeTests })` | Всі entry-points → buildProgramContext → `provider.generateProgram` → `assembleCode` → результат |
| `checkConsistency(programIds)` | Крос-перевірка: поля в `external_dependencies[].dataIn` існують у `input_contract` callee; повертає список розбіжностей |

#### `appGeneration.js`
Генерація на рівні застосунку:

| Функція | Що робить |
|---|---|
| `generateApplication(programIds)` | Топологічне сортування → послідовна генерація всіх програм → `wireInterProgramCalls` |
| `generateProject(programIds, { includeTests })` | `generateApplication` + `generateProgramTypes` + db-stub + index-файл + опційно тести → масив `{ path, content }` |
| `buildGenerationOrder(programIds)` *(internal)* | Алгоритм Кана: callee-програми генеруються першими (leaf-first) |
| `wireInterProgramCalls(results)` *(internal)* | Замінює `callProgram('NAME', ...)` на `executeNAME(...)` та додає import-рядки |

---

## Роути (`src/routes/`)

### `routes/programs.js` — `/api/programs`

| Метод | Шлях | Що робить |
|---|---|---|
| `GET` | `/` | Всі програми + всі edges |
| `GET` | `/:id` | Програма + analysis + chunks + edges |
| `GET` | `/:id/stream` | SSE — підписка на прогрес аналізу |
| `GET` | `/:id/chunks` | Список chunks |
| `GET` | `/:id/export?format=markdown\|openapi` | Завантаження специфікації |
| `GET` | `/callers/:name` | Хто викликає дану програму |
| `GET` | `/:id/calls` | Кого викликає дана програма |
| `POST` | `/upload` | Завантаження файлу (+ companion), запуск аналізу |
| `POST` | `/:id/analyze` | Реаналіз |
| `POST` | `/:id/generate` | Генерація entry-point `{ condition, includeTests }` |
| `POST` | `/:id/generate-tests` | Окремо тести для entry-point |
| `POST` | `/:id/generate-program` | Генерація всього модуля `{ includeTests }` |
| `POST` | `/program-types` | TypeScript interfaces для programIds[] |
| `POST` | `/db-types` | TypeScript row-types для DB-таблиць |
| `POST` | `/consistency-check` | Перевірка сумісності programIds[] |
| `POST` | `/application/:appId/generate` | Генерація всіх програм застосунку |
| `POST` | `/application/:appId/generate-project` | Повний project scaffold |
| `DELETE` | `/:id` | Видалення програми |
| `POST` | `/:id/cancel` | Відміна аналізу |
| `PATCH` | `/:id/flags` | Встановлення/зняття прапора entry-point |
| `PATCH` | `/:id/entry-points` | Ручне редагування entry-points |

**SSE:** `Map<programId, Set<Response>>`. При закритті з'єднання — автоматичне видалення з мапи.

### `routes/applications.js` — `/api/applications`

| Метод | Шлях | Що робить |
|---|---|---|
| `GET` | `/` | Список застосунків з кількістю програм |
| `GET` | `/:id` | Застосунок + список програм |
| `GET` | `/:id/stream` | SSE — прогрес batch-аналізу |
| `POST` | `/` | Створення застосунку |
| `POST` | `/:id/analyze` | Запуск batch-аналізу (`{ mode: 'sequential'\|'parallel' }`) |
| `POST` | `/:id/cancel` | Відміна batch-аналізу |
| `DELETE` | `/:id` | Видалення застосунку + всіх програм + файлів |

**SSE:** `Map<applicationId, Set<Response>>`. Події програм форвардяться на app-stream з `programId` і `programName` у payload.

### `routes/settings.js` — `/api/settings`

| Метод | Шлях | Що робить |
|---|---|---|
| `GET` | `/` | Поточні налаштування (без API-ключів) |
| `PUT` | `/` | Оновлення налаштувань |

---

## Потоки даних

### Завантаження і аналіз одного файлу

```
POST /api/programs/upload
  └─ analysisService.uploadAndStartAnalysis()
       ├─ preprocessCobol() / залишити як є (C)
       ├─ createProgram() або updateProgramStatus('analyzing')
       ├─ writeFileSync() → uploads/{id}.cbl
       ├─ updateFilePath()
       ├─ backfillEdgesForNewProgram()
       ├─ parseCobol() / parseCProgram() → chunks
       ├─ insertChunks()
       └─ runAnalysisCore() [fire-and-forget]
            ├─ getProvider(settings)
            ├─ runAnalysis() / runCAnalysis()
            │    ├─ extractLinkageVars(), extractCalls(), ...  (структурний парсинг)
            │    ├─ buildStructural() + buildContext()
            │    ├─ estimateTokens() → one-step або two-step
            │    └─ provider.extractBusinessAnalysis() [+ analyzeEntryPoint() ×N]
            ├─ upsertBusinessAnalysis()
            ├─ updateGraphAfterAnalysis()
            ├─ upsertCall() ×N
            └─ updateProgramStatus('analyzed')

SSE events: parsing → step 1/2 → step 2/2 → done / failed / cancelled
```

### Генерація коду

```
POST /api/programs/:id/generate  { condition, includeTests }
  └─ generateEntryPoint(programId, condition)
       ├─ loadProgramData()
       │    ├─ findProgramById() + getAnalysisByProgramId() + getChunksByProgramId()
       │    ├─ deserializePerformGraph()
       │    └─ readFileSync() → extractTuxTableSchemas() + extractWsConstants()
       ├─ selectRelevantChunks() — транзитивне розширення через performGraph
       ├─ buildCodeGenContext()
       ├─ provider.generateCode(context)
       └─ [опційно] buildTestGenContext() → provider.generateTests()
```

### Batch-аналіз

```
POST /api/applications/:id/analyze  { mode: 'parallel' }
  └─ batchService.startBatchAnalysis() [fire-and-forget]
       ├─ updateApplicationStatus('analyzing')
       ├─ getProgramsByApplicationId()
       ├─ mode='parallel': runWithConcurrencyLimit(tasks, 3)
       │   кожна задача: analysisService.runProgramFromFile()
       │                   + emit на program-SSE і app-SSE
       └─ updateApplicationStatus('analyzed' / 'failed')
```

---

## Тести (`tests/`)

| Директорія | Файли | Що тестується |
|---|---|---|
| `tests/parser/` | `cobolParser.test.js` (56), `cobolExtractor.test.js` (33), `cParser.test.js` (46) | Парсинг: fixed-format, chunking, CALL-вилучення, SQL-regex, condition names, C-функції |
| `tests/ai/` | `orchestrator.test.js` (35), `cOrchestrator.test.js` (12) | Token-стратегія, two-step логіка, buildStructural, mapResult, filterEntryPoints |
| `tests/routes/` | `programs.test.js` (9), `applications.test.js` (4), `settings.test.js` (4) | HTTP endpoint контракти, статус-коди, SSE |
| `tests/services/` | `batchService.test.js` (3), `graphService.test.js` (7) | Concurrency limit, скасування batch, backfill edges |

**Запуск:** `npm test` (vitest run)

---

## Змінні середовища (`.env`)

| Змінна | Опис |
|---|---|
| `PORT` | HTTP-порт (за замовчуванням 3001) |
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Ключ Claude (можна також зберігати в БД через settings) |
| `OPENAI_API_KEY` | Ключ OpenAI (аналогічно) |

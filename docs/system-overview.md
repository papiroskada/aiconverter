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

**TUX tables — дві стратегії:**
- Strategy 1: `MOVE "RD" TO {PREFIX}-FUNC`
- Strategy 2: назва параграфа `{VERB}-{PREFIX}-...` (VLD, READ, INS, UPD, DEL = відповідні операції)

Для полів ключа — сканує MOVE до PERFORM у вікні 15 рядків.

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
      "dbOperations": [{ "table": "exreur", "operation": "INSERT", "keyFields": [], "notFoundAction": "n/a" }]
    }
  ],
  "errorCatalog": [{ "code": "1500", "businessMeaning": "...", "systemAction": "..." }],
  "externalDependencies": [{ "program": "ARCUSACS", "purpose": "...", "dataIn": "...", "dataOut": "..." }],
  "dbTables": [{ "table": "exreur", "operation": "SELECT/INSERT", "fields": [...], "keyFields": [...], "notFoundAction": "..." }],
  "fileIO": [{ "file": "USR-FILE", "operations": ["OPEN","READ","CLOSE"] }]
}
```

**Важливо:** AI не вигадує назви таблиць — правило в промпті вимагає використовувати ТОЧНІ назви з секцій `DATABASE OPERATIONS` вище. Якщо таблиця є в параграфі але не в структурному блоці — писати COBOL-префікс як є.

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

# Технічна документація фронтенду — COBOL Converter

## 1. Технологічний стек

### Основні залежності

| Бібліотека / інструмент | Версія | Призначення |
|---|---|---|
| React | 18.3.1 | UI-фреймворк |
| React DOM | 18.3.1 | Рендеринг React у браузері |
| Vite | 4.x | Збірник (bundler) та dev-сервер |
| ReactFlow | 11.11.4 | Інтерактивна візуалізація графів залежностей |
| @dagrejs/dagre | 3.0.0 | Алгоритм ієрархічного розміщення вузлів графу |
| Mermaid | 11.13.0 | Генерація діаграм з текстового опису |
| jszip | 3.10.1 | Пакування згенерованих файлів у ZIP-архів |

### Dev-залежності

| Бібліотека | Версія | Призначення |
|---|---|---|
| @vitejs/plugin-react | 4.3.1 | Fast Refresh підтримка в Vite |
| Vitest | 2.0.5 | Test runner (Jest-сумісний) |
| @testing-library/react | 16.0.0 | Утиліти для тестування React-компонентів |
| @testing-library/jest-dom | 6.9.1 | Додаткові DOM-матчери для тестів |
| jsdom | 24.1.1 | Симуляція DOM-середовища в тестах |

### Мова і модульна система
Фронтенд написаний на **JavaScript ESM** (не TypeScript). Всі файли — `.jsx` (React-компоненти) або `.js` (API, хуки, утиліти).

---

## 2. Структура проекту

```
client/
├── src/
│   ├── api/                    # HTTP-клієнти для REST API
│   │   ├── applications.js     # Операції з проектами (applications)
│   │   ├── programs.js         # Операції з програмами (COBOL files)
│   │   └── settings.js         # Читання і збереження налаштувань
│   ├── components/             # React-компоненти
│   │   ├── Graph/              # Граф залежностей (ReactFlow)
│   │   │   ├── ProgramGraph.jsx
│   │   │   └── ProgramNode.jsx
│   │   ├── Programs/           # Grid-вигляд списку програм
│   │   │   └── ProgramGrid.jsx
│   │   ├── Panel/              # Детальна панель програми
│   │   │   ├── ProgramDetail.jsx
│   │   │   ├── OverviewTab.jsx
│   │   │   ├── LogicTab.jsx
│   │   │   ├── DataTab.jsx
│   │   │   ├── CodeTab.jsx
│   │   │   ├── ConnectionsTab.jsx
│   │   │   └── DetailPanel.jsx
│   │   ├── Sidebar/            # Ліва бічна панель
│   │   │   └── Sidebar.jsx
│   │   ├── Upload/             # Завантаження файлів
│   │   │   ├── ConfirmationModal.jsx
│   │   │   ├── UploadButton.jsx
│   │   │   └── UploadControls.jsx
│   │   ├── Nav/                # Верхня/бічна навігація
│   │   │   └── IconNav.jsx
│   │   └── Settings/           # Панель налаштувань
│   │       └── SettingsDrawer.jsx
│   ├── hooks/                  # Custom React hooks
│   │   ├── usePrograms.js      # Завантаження графу, Dagre-layout
│   │   ├── useSSE.js           # SSE для одиничної програми
│   │   └── useAppSSE.js        # SSE для батч-аналізу
│   ├── App.jsx                 # Кореневий компонент, управління views
│   ├── main.jsx                # Точка входу (React DOM render)
│   └── index.css               # Глобальні стилі
├── tests/                      # Тести (Vitest)
├── index.html                  # HTML-оболонка
├── package.json
├── vite.config.js
└── vitest.setup.js
```

---

## 3. Архітектура

### 3.1 Управління станом

Фронтенд **не використовує зовнішніх state-менеджерів** (Redux, Zustand тощо). Весь стан зберігається локально через React-хуки:

- `useState` — основний стан компонентів і кореневого `App`
- `useCallback` — мемоізація колбеків для оптимізації ре-рендерів
- `useRef` — зберігання мутабельних значень без тригера ре-рендеру (SSE з'єднання, тімери)
- Increment-based refresh triggers — `setPanelRefreshTrigger(t => t + 1)` для примусового перезавантаження дочірніх компонентів

### 3.2 Маршрутизація

Фронтенд **не використовує бібліотек для роутингу** (React Router тощо). Навігація реалізована через view-стан у `App.jsx`:

```
view: 'list'    → ProgramGrid   (картки всіх програм)
view: 'graph'   → ProgramGraph  (граф залежностей)
view: 'program' → ProgramDetail (детальна сторінка програми)
```

Перехід між вигляднями відбувається через `setView()` та `setSelectedProgramId()`.

### 3.3 Потік даних (Data Flow)

```
1. Початкове завантаження
   usePrograms() → fetchGraph() [GET /api/programs]
   → будує ReactFlow nodes + edges
   → Dagre розраховує позиції вузлів

2. Вибір програми
   Клік у списку / графі → setSelectedProgramId(id) + setView('program')
   → ProgramDetail викликає fetchProgram(id) [GET /api/programs/:id]

3. Реальний час (аналіз)
   uploadFile() → сервер запускає аналіз
   → SSE стрім /api/programs/:id/stream
   → події: chunk_done, metadata, progress, done, failed
   → оновлення локального стану → ре-рендер

4. Батч-аналіз
   startApplicationAnalysis() → /api/applications/:id/analyze
   → SSE стрім /api/applications/:id/stream
   → App.jsx обробляє progress/done → оновлює stepProgress, filterNodes
```

### 3.4 Комунікація з сервером

| Тип | Використання |
|---|---|
| `fetch()` | Всі REST-запити (без axios або graphql) |
| `EventSource` | Server-Sent Events для real-time оновлень |
| Proxy (Vite) | `/api/*` → `http://localhost:3001` (тільки в dev-режимі) |

### 3.5 Стилізація

Всі компоненти використовують **inline styles** (без CSS-модулів, Tailwind або styled-components).

**Кольорова палітра:**

| Призначення | Колір |
|---|---|
| Фон основний | `#0f172a` |
| Фон контейнерів | `#1e293b` |
| Текст основний | `#e2e8f0` |
| Текст вторинний | `#94a3b8` |
| Текст приглушений | `#475569` |
| Статус: Analyzed | `#4ade80` (зелений) |
| Статус: Analyzing | `#60a5fa` (синій) |
| Статус: Failed | `#f87171` (червоний) |
| Статус: Pending | `#475569` (сірий) |
| Попередження / прапори | `#f59e0b` (помаранчевий) |
| Активний / фокус | `#60a5fa` (синій) |

---

## 4. Компоненти

### 4.1 Кореневий компонент

**`App.jsx`** — управляє поточним вигляндом, вибраною програмою та додатком, станом батч-аналізу, видимістю панелі налаштувань. Рендерить `IconNav`, `Sidebar`, одне з трьох головних відображень та `SettingsDrawer`.

### 4.2 Таблиця компонентів

| Компонент | Файл | Опис |
|---|---|---|
| `IconNav` | `Nav/IconNav.jsx` | Вертикальна панель іконок: логотип, перемикач list/graph, кнопка налаштувань |
| `Sidebar` | `Sidebar/Sidebar.jsx` | Ліва панель: список проектів, фільтр програм, контроль батч-аналізу, завантаження |
| `ProgramGrid` | `Programs/ProgramGrid.jsx` | Картковий вигляд програм: статус, тип файлу, кількість entry points, прапори |
| `ProgramGraph` | `Graph/ProgramGraph.jsx` | Інтерактивний граф залежностей (ReactFlow + Dagre), legend, minimap |
| `ProgramNode` | `Graph/ProgramNode.jsx` | Окремий вузол у графі |
| `ProgramDetail` | `Panel/ProgramDetail.jsx` | Повносторінкова деталізація програми з вкладками |
| `OverviewTab` | `Panel/OverviewTab.jsx` | Вкладка: ім'я, статус, тип файлу, метадані |
| `LogicTab` | `Panel/LogicTab.jsx` | Вкладка: бізнес-логіка, кроки, коди помилок, прапори |
| `DataTab` | `Panel/DataTab.jsx` | Вкладка: таблиці БД, linkage-параметри, DB-операції, точки входу |
| `CodeTab` | `Panel/CodeTab.jsx` | Вкладка: генерація JS/TS коду, метрики якості, завантаження |
| `ConnectionsTab` | `Panel/ConnectionsTab.jsx` | Вкладка: що викликає цю програму і що вона викликає |
| `ConfirmationModal` | `Upload/ConfirmationModal.jsx` | Модальне вікно для завантаження папки: вибір моделі, прогрес |
| `UploadButton` | `Upload/UploadButton.jsx` | Кнопка завантаження одного файлу |
| `UploadControls` | `Upload/UploadControls.jsx` | Контроли завантаження папки у сайдбарі |
| `SettingsDrawer` | `Settings/SettingsDrawer.jsx` | Права панель налаштувань: API-ключі, патерни генерації коду |

### 4.3 Custom Hooks

| Хук | Файл | Опис |
|---|---|---|
| `usePrograms` | `hooks/usePrograms.js` | Завантаження повного графу, Dagre-layout, збереження позицій вузлів |
| `useSSE` | `hooks/useSSE.js` | EventSource-з'єднання для стріму одиничної програми |
| `useAppSSE` | `hooks/useAppSSE.js` | EventSource-з'єднання для батч-стріму додатку |

---

## 5. API-ендпоінти

Всі запити відправляються через базовий префікс `/api`. У dev-режимі Vite проксує їх на `http://localhost:3001`.

### 5.1 Applications (Проекти)

| Метод | URL | Тіло / параметри | Опис |
|---|---|---|---|
| `GET` | `/api/applications` | — | Отримати список всіх проектів |
| `POST` | `/api/applications` | `{ name: string }` | Створити новий проект |
| `GET` | `/api/applications/:id` | — | Отримати деталі одного проекту |
| `DELETE` | `/api/applications/:id` | — | Видалити проект |
| `POST` | `/api/applications/:id/analyze` | `{ mode: 'sequential' \| 'parallel' }` | Запустити батч-аналіз |
| `POST` | `/api/applications/:id/cancel` | — | Скасувати батч-аналіз |

### 5.2 Programs (COBOL-файли)

| Метод | URL | Тіло / параметри | Опис |
|---|---|---|---|
| `GET` | `/api/programs` | — | Отримати всі програми та зв'язки (граф) |
| `GET` | `/api/programs/:id` | — | Отримати деталі однієї програми з результатами аналізу |
| `POST` | `/api/programs/upload` | `FormData: file, application_id?, companion?` | Завантажити COBOL-файл |
| `POST` | `/api/programs/:id/analyze` | — | Повторно запустити аналіз програми |
| `DELETE` | `/api/programs/:id` | — | Видалити програму |
| `POST` | `/api/programs/:id/cancel` | — | Скасувати аналіз |
| `PATCH` | `/api/programs/:id/entry-points` | `{ entry_points: string[] }` | Зберегти точки входу |
| `PATCH` | `/api/programs/:id/flags` | `{ condition: string, flag: string }` | Виставити прапор (warning/deprecated) |
| `POST` | `/api/programs/:id/generate-program` | `{ includeTests: boolean }` | Згенерувати JavaScript з однієї програми |
| `GET` | `/api/programs/:id/generated-code` | — | Отримати закешований згенерований код |
| `POST` | `/api/programs/application/:appId/generate-project` | `{ includeTests: boolean }` | Згенерувати JS-код для всіх програм (ZIP) |
| `POST` | `/api/programs/application/:appId/generate` | — | Оркеструвати повну генерацію коду проекту |
| `POST` | `/api/programs/program-types` | `{ programIds: string[] }` | Згенерувати TypeScript-типи |

### 5.3 SSE (Server-Sent Events)

| URL | Тип | Events |
|---|---|---|
| `/api/programs/:id/stream` | Стрім аналізу програми | `chunk_done`, `metadata`, `progress`, `done`, `failed` |
| `/api/applications/:id/stream` | Стрім батч-аналізу | `progress`, `done`, `failed` |

### 5.4 Settings (Налаштування)

| Метод | URL | Тіло | Опис |
|---|---|---|---|
| `GET` | `/api/settings` | — | Отримати всі налаштування |
| `PUT` | `/api/settings` | `{ [key]: value }` | Зберегти налаштування |

---

## 6. Real-time комунікація (Server-Sent Events)

Фронтенд використовує **Server-Sent Events (SSE)** для відстеження прогресу довготривалих операцій (аналіз COBOL-файлів). SSE — це однонаправлений push-протокол поверх HTTP, де сервер надсилає події клієнту по відкритому з'єднанню.

### Аналіз одиничної програми (`useSSE.js`)

```
ProgramDetail монтується
    ↓
new EventSource('/api/programs/:id/stream')
    ↓
Сервер надсилає:
  progress  → оновлення поточного кроку
  chunk_done → частина аналізу завершена
  metadata   → метадані програми
  done       → аналіз завершений → fetchProgram() для оновлення даних
  failed     → помилка → показати повідомлення
    ↓
unmount → eventSource.close()
```

**Fallback (polling):** якщо SSE-з'єднання втрачено, `ProgramDetail` вмикає polling кожні 8 секунд для підхоплення події `done`.

### Батч-аналіз (`useAppSSE.js`)

```
startApplicationAnalysis() викликається
    ↓
new EventSource('/api/applications/:id/stream')
    ↓
App.jsx обробляє:
  progress → оновлює stepProgress Map (programId → {step, total})
             → відображається в ProgramGrid і Sidebar
  done     → очищує batchAppId → fetchGraph() → ре-рендер
  failed   → повідомлення про помилку
    ↓
Після завершення → eventSource.close()
```

---

## 7. Авторизація

**Поточний стан: авторизація відсутня.**

Фронтенд не реалізує жодного механізму автентифікації чи авторизації:
- Немає JWT, cookie-сесій або OAuth-потоків
- Немає захищених маршрутів
- Немає перевірки прав доступу

API-запити до бекенду відправляються без токенів авторизації (`Authorization` заголовок відсутній у всіх fetch-викликах).

API-ключі LLM-провайдерів (Claude, OpenAI) зберігаються на сервері через `/api/settings`. Фронтенд зберігає їх у UI (`SettingsDrawer`), але не передає напряму в запити до LLM-API — це робить бекенд.

---

## 8. UI-функціональність

### 8.1 Панель проектів (Sidebar)
- Створення та видалення COBOL-проектів (applications)
- Перегляд статусу аналізу кожного проекту
- Перемикання між проектами (фільтрує список програм)
- Запуск / скасування батч-аналізу
- Вибір режиму аналізу: `sequential` або `parallel`
- Завантаження одного або цілої папки COBOL-файлів

### 8.2 Список програм (ProgramGrid — `view: 'list'`)
- Картковий вигляд всіх програм поточного проекту
- Фільтрація за ім'ям, статусом
- Колірне кодування статусу: analyzed / analyzing / failed / pending
- Відображення типу файлу (`.cbl`, `.c`), кількості entry points, наявності прапорів
- Прогрес-бар по кроках під час аналізу
- Клік на картку → відкриває детальну панель

### 8.3 Граф залежностей (ProgramGraph — `view: 'graph'`)
- Інтерактивна DirectedGraph-візуалізація (хто що викликає)
- Pan / zoom засобами ReactFlow
- Перетягування вузлів для перекомпонування
- Клік на вузол → відкриває детальну панель
- Легенда статусів, minimap

### 8.4 Детальна панель програми (ProgramDetail — `view: 'program'`)

**Вкладка Overview**
- Ім'я файлу, поточний статус, тип файлу, метадані

**Вкладка Logic**
- Бізнес-правила та кроки виконання
- Каталог кодів помилок з підказками
- Дії при відсутності даних (`notFoundActions`)
- Прапори: `warning`, `deprecated` (редагуються inline)
- Маркери DB-операцій (read / write / both) з кольоровим кодуванням

**Вкладка Data**
- Таблиці БД з ключовими полями
- Linkage section (вхідні / вихідні параметри)
- DB-операції в розрізі режимів виконання
- Inline-редагування entry points

**Вкладка Connections**
- Які програми викликають цю (`callers`)
- Які програми викликає ця (`callees`)

**Вкладка Code**
- Метрика confidence score та quality (mechanical%, mechanical holes)
- Генерація JavaScript з однієї програми (з тестами або без)
- Генерація TypeScript-типів
- Завантаження згенерованих файлів
- Генерація ZIP-архіву для всього проекту

### 8.5 Завантаження файлів (ConfirmationModal)
- Підтримка `.cbl` / `.cob` файлів
- Companion-файли: `.c` (умови), `.u` (копі-бук), `.s` (структури)
- Вибір AI-провайдера (Claude або OpenAI) та конкретних моделей для кожного етапу аналізу
- Відображення прогресу завантаження кожного файлу

### 8.6 Налаштування (SettingsDrawer)
- Введення API-ключів (Claude / OpenAI), поле приховане
- Патерни генерації коду:
  - DB read-операції
  - DB write-операції
  - Конвенція обробки помилок
  - Зовнішні виклики

---

## 9. Запуск та збірка

```bash
# Запуск dev-сервера (hot reload, proxy → localhost:3001)
npm run dev

# Продакшн-збірка → dist/
npm run build

# Запуск тестів
npm test
```

Dev-сервер Vite проксює всі запити `/api/*` на `http://localhost:3001` (Node.js-сервер). Для повноцінного запуску необхідно, щоб бекенд вже працював.

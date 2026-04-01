# COBOL Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app that uploads COBOL files, analyzes them with AI (Claude/OpenAI), stores structured documentation, and visualizes program dependencies as an interactive graph.

**Architecture:** Node.js/Express backend with PostgreSQL, React frontend with React Flow. COBOL is pre-parsed into chunks (≤300 lines) without AI, then each chunk is analyzed sequentially with AI, progress streamed via SSE.

**Tech Stack:** Node.js (ESM), Express, PostgreSQL (`pg`), `multer`, `@anthropic-ai/sdk`, `openai`, Vitest (backend tests), React 18, Vite, React Flow (`reactflow`), Vitest + React Testing Library (frontend tests).

---

## File Structure

```
aiconverter2/
├── server/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql          # All CREATE TABLE statements + enums + constraints
│   │   │   ├── client.js           # pg Pool singleton
│   │   │   └── migrate.js          # Runs schema.sql against DB (CLI: node src/db/migrate.js)
│   │   ├── models/
│   │   │   ├── programs.js         # CRUD for programs table
│   │   │   ├── programAnalysis.js  # CRUD for program_analysis table
│   │   │   ├── programChunks.js    # CRUD for program_chunks table
│   │   │   └── programEdges.js     # CRUD for program_edges table
│   │   ├── parser/
│   │   │   └── cobolParser.js      # Pre-parser: divisions → sections → paragraphs → chunks
│   │   ├── ai/
│   │   │   ├── providers/
│   │   │   │   ├── base.js         # AIProvider interface (throws NotImplemented)
│   │   │   │   ├── claude.js       # ClaudeProvider using @anthropic-ai/sdk
│   │   │   │   └── openai.js       # OpenAIProvider using openai SDK
│   │   │   ├── prompts.js          # Prompt templates: metadata, chunk, synthesis
│   │   │   └── orchestrator.js     # Runs Phase 1+2: calls provider, emits SSE events
│   │   ├── services/
│   │   │   ├── analysisService.js  # Coordinates upload → parse → analyze pipeline
│   │   │   └── graphService.js     # Phase 3: graph update + phantom edge backfill
│   │   ├── routes/
│   │   │   └── programs.js         # All /api/programs/* Express routes
│   │   └── app.js                  # Express app setup (middleware, routes, no listen())
│   ├── server.js                   # Entry point: imports app.js, calls app.listen()
│   ├── tests/
│   │   ├── parser/cobolParser.test.js
│   │   ├── ai/orchestrator.test.js
│   │   ├── services/graphService.test.js
│   │   └── routes/programs.test.js
│   ├── uploads/                    # COBOL files stored here (gitignored)
│   ├── .env.example
│   ├── package.json
│   └── vitest.config.js
│
└── client/
    ├── src/
    │   ├── api/
    │   │   └── programs.js         # fetch wrappers for all API endpoints + SSE client
    │   ├── components/
    │   │   ├── Graph/
    │   │   │   ├── ProgramGraph.jsx    # React Flow canvas, node layout, edge rendering
    │   │   │   └── ProgramNode.jsx     # Custom node: name, status color, dashed/solid border
    │   │   ├── Panel/
    │   │   │   ├── DetailPanel.jsx     # Slide-in container, tab switcher
    │   │   │   ├── OverviewTab.jsx     # Description, call params, external calls, DB tables
    │   │   │   ├── LogicBlocksTab.jsx  # Expandable chunk list with flow_steps
    │   │   │   └── ConnectionsTab.jsx  # Incoming/outgoing program links
    │   │   └── Upload/
    │   │       └── UploadButton.jsx    # File input + POST /api/programs/upload
    │   ├── hooks/
    │   │   ├── usePrograms.js      # Fetch graph data, handle SSE updates, update graph state
    │   │   └── useSSE.js           # Open/close SSE connection, parse events
    │   ├── App.jsx                 # Root: graph + panel side-by-side
    │   └── main.jsx                # Vite entry point
    ├── tests/
    │   ├── components/ProgramNode.test.jsx
    │   └── hooks/useSSE.test.js
    ├── index.html
    ├── package.json
    └── vite.config.js
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/vitest.config.js`
- Create: `server/.env.example`
- Create: `server/server.js`
- Create: `server/src/app.js`
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/src/main.jsx`
- Create: `client/src/App.jsx`

- [ ] **Step 1: Create server package.json**

```json
{
  "name": "cobol-converter-server",
  "version": "1.0.0",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "vitest run",
    "migrate": "node src/db/migrate.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "openai": "^4.52.0",
    "pg": "^8.12.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.0.5"
  }
}
```

Save to `server/package.json`.

- [ ] **Step 2: Create server vitest config**

```js
// server/vitest.config.js
export default {
  test: {
    environment: 'node',
    globals: true,
  },
}
```

- [ ] **Step 3: Create .env.example**

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cobol_converter
AI_PROVIDER=claude
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
PORT=3001
```

Save to `server/.env.example`. Copy to `server/.env` and fill in real values.

- [ ] **Step 4: Create Express app**

```js
// server/src/app.js
import express from 'express'
import cors from 'cors'
import programsRouter from './routes/programs.js'

const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/programs', programsRouter)

export default app
```

- [ ] **Step 5: Create server entry point**

```js
// server/server.js
import 'dotenv/config'
import app from './src/app.js'

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
```

- [ ] **Step 6: Install server dependencies**

```bash
cd server && npm install
```

- [ ] **Step 7: Create client package.json**

```json
{
  "name": "cobol-converter-client",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "reactflow": "^11.11.4"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.1",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 8: Create vite config**

```js
// client/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
```

- [ ] **Step 9: Create index.html and React entry**

```html
<!-- client/index.html -->
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>COBOL Converter</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

```jsx
// client/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
```

```jsx
// client/src/App.jsx
export default function App() {
  return <div style={{ width: '100vw', height: '100vh' }}>COBOL Converter</div>
}
```

- [ ] **Step 10: Install client dependencies**

```bash
cd client && npm install
```

- [ ] **Step 11: Verify both servers start**

```bash
# Terminal 1
cd server && npm run dev
# Expected: Server running on http://localhost:3001

# Terminal 2
cd client && npm run dev
# Expected: Vite dev server at http://localhost:5173
```

- [ ] **Step 12: Commit**

```bash
cd /Users/dariasidenko/aiconverter2
git add server/ client/
git commit -m "feat: scaffold server and client projects"
```

---

## Task 2: Database Schema and Connection

**Files:**
- Create: `server/src/db/schema.sql`
- Create: `server/src/db/client.js`
- Create: `server/src/db/migrate.js`

Prerequisites: PostgreSQL running locally. Create database: `createdb cobol_converter`

- [ ] **Step 1: Write schema.sql**

```sql
-- server/src/db/schema.sql

CREATE TYPE program_status AS ENUM ('pending', 'analyzing', 'analyzed', 'failed');
CREATE TYPE chunk_type AS ENUM ('data_summary', 'paragraph', 'sub_paragraph');
CREATE TYPE chunk_status AS ENUM ('pending', 'done', 'failed');

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status program_status NOT NULL DEFAULT 'pending',
  file_path TEXT,
  analyzed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  description TEXT,
  call_parameters JSONB NOT NULL DEFAULT '[]',
  external_calls JSONB NOT NULL DEFAULT '[]',
  db_tables JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (program_id)
);

CREATE TABLE IF NOT EXISTS program_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  chunk_type chunk_type NOT NULL,
  chunk_name TEXT NOT NULL,
  start_line INT NOT NULL,
  end_line INT NOT NULL,
  cobol_text TEXT NOT NULL,
  analysis JSONB,
  token_estimate INT NOT NULL DEFAULT 0,
  order_index INT NOT NULL DEFAULT 0,
  status chunk_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  to_program_name TEXT NOT NULL,
  to_program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  context TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (from_program_id, to_program_name)
);
```

- [ ] **Step 2: Write DB client**

```js
// server/src/db/client.js
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export default pool
```

- [ ] **Step 3: Write migration runner**

```js
// server/src/db/migrate.js
import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pool from './client.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')

await pool.query(sql)
console.log('Migration complete')
await pool.end()
```

- [ ] **Step 4: Run migration**

```bash
cd server && npm run migrate
```

Expected output: `Migration complete`

- [ ] **Step 5: Verify tables exist**

```bash
psql cobol_converter -c "\dt"
```

Expected: `program_analysis`, `program_chunks`, `program_edges`, `programs`

- [ ] **Step 6: Commit**

```bash
git add server/src/db/
git commit -m "feat: add database schema and migration"
```

---

## Task 3: COBOL Pre-parser

**Files:**
- Create: `server/src/parser/cobolParser.js`
- Create: `server/tests/parser/cobolParser.test.js`

The pre-parser takes raw COBOL text and returns an array of chunks. No AI involved. Key rules:
- Divisions are identified by lines matching `/^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i`
- DATA DIVISION sections: lines matching `/^\s*(WORKING-STORAGE|FILE|LINKAGE)\s+SECTION/i`
- PROCEDURE paragraphs: lines matching `/^\s{0,7}([A-Z][A-Z0-9-]+)\./` that appear after `PROCEDURE DIVISION`
- Chunks ≤ 300 lines; larger ones split with 20-line overlap
- Token estimate: `Math.ceil(text.length / 4)`

- [ ] **Step 1: Write failing tests**

```js
// server/tests/parser/cobolParser.test.js
import { parseCobol } from '../../src/parser/cobolParser.js'

const MINI_COBOL = `
 IDENTIFICATION DIVISION.
 PROGRAM-ID. TEST.
 DATA DIVISION.
 WORKING-STORAGE SECTION.
 01 WS-VAR PIC X.
 PROCEDURE DIVISION.
 MAIN-PARA.
     MOVE "A" TO WS-VAR.
     STOP RUN.
`.trim()

describe('parseCobol', () => {
  test('returns array of chunks', () => {
    const chunks = parseCobol(MINI_COBOL)
    expect(Array.isArray(chunks)).toBe(true)
    expect(chunks.length).toBeGreaterThan(0)
  })

  test('each chunk has required fields', () => {
    const chunks = parseCobol(MINI_COBOL)
    for (const chunk of chunks) {
      expect(chunk).toHaveProperty('chunk_type')
      expect(chunk).toHaveProperty('chunk_name')
      expect(chunk).toHaveProperty('start_line')
      expect(chunk).toHaveProperty('end_line')
      expect(chunk).toHaveProperty('cobol_text')
      expect(chunk).toHaveProperty('token_estimate')
      expect(chunk).toHaveProperty('order_index')
      expect(typeof chunk.chunk_name).toBe('string')
      expect(chunk.chunk_name.length).toBeGreaterThan(0)
    }
  })

  test('identifies WORKING-STORAGE section as data_summary chunk', () => {
    const chunks = parseCobol(MINI_COBOL)
    const ws = chunks.find(c => c.chunk_name === 'WORKING-STORAGE')
    expect(ws).toBeDefined()
    expect(ws.chunk_type).toBe('data_summary')
  })

  test('identifies MAIN-PARA as paragraph chunk', () => {
    const chunks = parseCobol(MINI_COBOL)
    const para = chunks.find(c => c.chunk_name === 'MAIN-PARA')
    expect(para).toBeDefined()
    expect(para.chunk_type).toBe('paragraph')
  })

  test('token_estimate is positive integer', () => {
    const chunks = parseCobol(MINI_COBOL)
    for (const chunk of chunks) {
      expect(Number.isInteger(chunk.token_estimate)).toBe(true)
      expect(chunk.token_estimate).toBeGreaterThan(0)
    }
  })

  test('splits large sections into sub-chunks with [N] naming', () => {
    // Build a DATA section > 300 lines
    const lines = [
      ' IDENTIFICATION DIVISION.',
      ' PROGRAM-ID. BIG.',
      ' DATA DIVISION.',
      ' WORKING-STORAGE SECTION.',
    ]
    for (let i = 0; i < 350; i++) lines.push(` 01 VAR-${i} PIC X.`)
    lines.push(' PROCEDURE DIVISION.')
    lines.push(' MAIN. STOP RUN.')

    const chunks = parseCobol(lines.join('\n'))
    const ws1 = chunks.find(c => c.chunk_name === 'WORKING-STORAGE')
    const ws2 = chunks.find(c => c.chunk_name === 'WORKING-STORAGE [2]')
    expect(ws1).toBeDefined()
    expect(ws2).toBeDefined()
    expect(ws1.end_line - ws1.start_line).toBeLessThanOrEqual(300)
  })

  test('splits large paragraphs into sub_paragraph chunks', () => {
    const lines = [
      ' IDENTIFICATION DIVISION.',
      ' PROGRAM-ID. BIG.',
      ' PROCEDURE DIVISION.',
      ' LONG-PARA.',
    ]
    for (let i = 0; i < 350; i++) lines.push(`     MOVE ${i} TO WS-X.`)
    lines.push(' END-PARA. EXIT.')

    const chunks = parseCobol(lines.join('\n'))
    const sub = chunks.filter(c => c.chunk_type === 'sub_paragraph')
    expect(sub.length).toBeGreaterThan(0)
    expect(sub[0].chunk_name).toMatch(/LONG-PARA \[/)
  })

  test('order_index is sequential starting at 0', () => {
    const chunks = parseCobol(MINI_COBOL)
    chunks.forEach((c, i) => expect(c.order_index).toBe(i))
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd server && npx vitest run tests/parser/cobolParser.test.js
```

Expected: FAIL — `parseCobol` not found

- [ ] **Step 3: Implement cobolParser.js**

```js
// server/src/parser/cobolParser.js

const CHUNK_MAX_LINES = 300
const CHUNK_OVERLAP = 20

const DIVISION_RE = /^\s*(IDENTIFICATION|ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION/i
const DATA_SECTION_RE = /^\s*(WORKING-STORAGE|FILE|LINKAGE)\s+SECTION/i
const PROCEDURE_PARA_RE = /^([A-Z][A-Z0-9-]{2,})\./

function tokenEstimate(text) {
  return Math.max(1, Math.ceil(text.length / 4))
}

function splitIntoWindows(lines, startLine, baseName, chunkType) {
  const chunks = []
  let windowStart = 0
  let windowIndex = 1

  while (windowStart < lines.length) {
    const windowEnd = Math.min(windowStart + CHUNK_MAX_LINES, lines.length)
    const sliceLines = lines.slice(windowStart, windowEnd)
    const text = sliceLines.join('\n')
    const name = windowIndex === 1 ? baseName : `${baseName} [${windowIndex}]`

    chunks.push({
      chunk_type: chunkType,
      chunk_name: name,
      start_line: startLine + windowStart + 1,
      end_line: startLine + windowEnd,
      cobol_text: text,
      token_estimate: tokenEstimate(text),
    })

    if (windowEnd >= lines.length) break
    windowStart = windowEnd - CHUNK_OVERLAP
    windowIndex++
  }
  return chunks
}

export function parseCobol(cobolText) {
  const lines = cobolText.split('\n')
  const rawChunks = []

  let inData = false
  let inProcedure = false
  let currentSection = null
  let currentSectionStart = -1
  let currentPara = null
  let currentParaStart = -1

  function flushSection(endIdx) {
    if (!currentSection || currentSectionStart === -1) return
    const sectionLines = lines.slice(currentSectionStart, endIdx)
    const windows = splitIntoWindows(sectionLines, currentSectionStart, currentSection, 'data_summary')
    rawChunks.push(...windows)
    currentSection = null
    currentSectionStart = -1
  }

  function flushPara(endIdx) {
    if (!currentPara || currentParaStart === -1) return
    const paraLines = lines.slice(currentParaStart, endIdx)
    if (paraLines.length <= CHUNK_MAX_LINES) {
      const text = paraLines.join('\n')
      rawChunks.push({
        chunk_type: 'paragraph',
        chunk_name: currentPara,
        start_line: currentParaStart + 1,
        end_line: endIdx,
        cobol_text: text,
        token_estimate: tokenEstimate(text),
      })
    } else {
      const windows = splitIntoWindows(paraLines, currentParaStart, currentPara, 'sub_paragraph')
      // First window stays as paragraph type, rest are sub_paragraph
      if (windows.length > 0) windows[0].chunk_type = 'sub_paragraph'
      rawChunks.push(...windows)
    }
    currentPara = null
    currentParaStart = -1
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (DIVISION_RE.test(line)) {
      flushSection(i)
      flushPara(i)
      inData = /DATA\s+DIVISION/i.test(line)
      inProcedure = /PROCEDURE\s+DIVISION/i.test(line)
      continue
    }

    if (inData && DATA_SECTION_RE.test(line)) {
      flushSection(i)
      const match = line.match(DATA_SECTION_RE)
      currentSection = match[1].toUpperCase()
      currentSectionStart = i
      continue
    }

    if (inProcedure) {
      const trimmed = line.trimStart()
      const match = trimmed.match(PROCEDURE_PARA_RE)
      if (match && !/^(END-|EXIT|GOBACK|STOP)/.test(trimmed)) {
        flushPara(i)
        currentPara = match[1]
        currentParaStart = i
      }
    }
  }

  flushSection(lines.length)
  flushPara(lines.length)

  return rawChunks.map((chunk, i) => ({ ...chunk, order_index: i }))
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd server && npx vitest run tests/parser/cobolParser.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/parser/ server/tests/parser/
git commit -m "feat: implement COBOL pre-parser with chunking"
```

---

## Task 4: Data Models

**Files:**
- Create: `server/src/models/programs.js`
- Create: `server/src/models/programAnalysis.js`
- Create: `server/src/models/programChunks.js`
- Create: `server/src/models/programEdges.js`

No unit tests for models (they wrap SQL directly; tested via route integration tests in Task 8). Keep each function simple: one SQL query per function, return rows.

- [ ] **Step 1: programs.js**

```js
// server/src/models/programs.js
import pool from '../db/client.js'

export async function createProgram({ name, file_path = null, status = 'pending' }) {
  const { rows } = await pool.query(
    `INSERT INTO programs (name, file_path, status)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, file_path, status]
  )
  return rows[0]
}

export async function findProgramByName(name) {
  const { rows } = await pool.query(
    'SELECT * FROM programs WHERE name = $1 LIMIT 1',
    [name]
  )
  return rows[0] || null
}

export async function findProgramById(id) {
  const { rows } = await pool.query('SELECT * FROM programs WHERE id = $1', [id])
  return rows[0] || null
}

export async function updateProgramStatus(id, status, extra = {}) {
  const { rows } = await pool.query(
    `UPDATE programs SET status = $1, updated_at = NOW()
     ${extra.analyzed_at ? ', analyzed_at = NOW()' : ''}
     WHERE id = $2 RETURNING *`,
    [status, id]
  )
  return rows[0]
}

export async function getAllPrograms() {
  const { rows } = await pool.query('SELECT id, name, status FROM programs ORDER BY created_at ASC')
  return rows
}
```

- [ ] **Step 2: programAnalysis.js**

```js
// server/src/models/programAnalysis.js
import pool from '../db/client.js'

export async function upsertAnalysis({ program_id, description, call_parameters, external_calls, db_tables }) {
  const { rows } = await pool.query(
    `INSERT INTO program_analysis (program_id, description, call_parameters, external_calls, db_tables)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (program_id) DO UPDATE
       SET description = EXCLUDED.description,
           call_parameters = EXCLUDED.call_parameters,
           external_calls = EXCLUDED.external_calls,
           db_tables = EXCLUDED.db_tables,
           updated_at = NOW()
     RETURNING *`,
    [program_id, description, JSON.stringify(call_parameters), JSON.stringify(external_calls), JSON.stringify(db_tables)]
  )
  return rows[0]
}

export async function getAnalysisByProgramId(program_id) {
  const { rows } = await pool.query(
    'SELECT * FROM program_analysis WHERE program_id = $1',
    [program_id]
  )
  return rows[0] || null
}

export async function updateDescription(program_id, description) {
  const { rows } = await pool.query(
    `UPDATE program_analysis SET description = $1, updated_at = NOW()
     WHERE program_id = $2 RETURNING *`,
    [description, program_id]
  )
  return rows[0]
}
```

- [ ] **Step 3: programChunks.js**

```js
// server/src/models/programChunks.js
import pool from '../db/client.js'

export async function insertChunks(program_id, chunks) {
  if (chunks.length === 0) return []
  const values = chunks.map((c, i) => {
    const base = i * 7
    return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7})`
  }).join(', ')

  const params = chunks.flatMap(c => [
    program_id, c.chunk_type, c.chunk_name, c.start_line, c.end_line,
    c.cobol_text, c.token_estimate
  ])

  const { rows } = await pool.query(
    `INSERT INTO program_chunks
       (program_id, chunk_type, chunk_name, start_line, end_line, cobol_text, token_estimate)
     VALUES ${values}
     RETURNING *`,
    params
  )
  return rows
}

export async function getChunksByProgramId(program_id) {
  const { rows } = await pool.query(
    'SELECT * FROM program_chunks WHERE program_id = $1 ORDER BY order_index ASC',
    [program_id]
  )
  return rows
}

export async function getRetryableChunks(program_id) {
  const { rows } = await pool.query(
    `SELECT * FROM program_chunks
     WHERE program_id = $1 AND status IN ('pending', 'failed')
     ORDER BY order_index ASC`,
    [program_id]
  )
  return rows
}

export async function updateChunkAnalysis(id, analysis) {
  const { rows } = await pool.query(
    `UPDATE program_chunks
     SET analysis = $1, status = 'done', updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [JSON.stringify(analysis), id]
  )
  return rows[0]
}

export async function markChunkFailed(id) {
  await pool.query(
    `UPDATE program_chunks SET status = 'failed', updated_at = NOW() WHERE id = $1`,
    [id]
  )
}
```

- [ ] **Step 4: programEdges.js**

```js
// server/src/models/programEdges.js
import pool from '../db/client.js'

export async function upsertEdge({ from_program_id, to_program_name, to_program_id = null, context = null }) {
  await pool.query(
    `INSERT INTO program_edges (from_program_id, to_program_name, to_program_id, context)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (from_program_id, to_program_name) DO NOTHING`,
    [from_program_id, to_program_name, to_program_id, context]
  )
}

export async function backfillPhantomEdges(program_name, program_id) {
  await pool.query(
    `UPDATE program_edges
     SET to_program_id = $1
     WHERE to_program_name = $2 AND to_program_id IS NULL`,
    [program_id, program_name]
  )
}

export async function getAllEdges() {
  const { rows } = await pool.query(
    `SELECT from_program_id AS "from", to_program_id AS "to", to_program_name AS to_name
     FROM program_edges`
  )
  return rows
}

export async function getEdgesForProgram(program_id) {
  const { rows } = await pool.query(
    `SELECT pe.*,
            fp.name AS from_program_name,
            tp.name AS to_program_name_resolved
     FROM program_edges pe
     JOIN programs fp ON fp.id = pe.from_program_id
     LEFT JOIN programs tp ON tp.id = pe.to_program_id
     WHERE pe.from_program_id = $1 OR pe.to_program_id = $1`,
    [program_id]
  )
  return rows
}
```

- [ ] **Step 5: Commit**

```bash
git add server/src/models/
git commit -m "feat: add data model query functions"
```

---

## Task 5: AI Provider Abstraction

**Files:**
- Create: `server/src/ai/providers/base.js`
- Create: `server/src/ai/prompts.js`
- Create: `server/src/ai/providers/claude.js`
- Create: `server/src/ai/providers/openai.js`

- [ ] **Step 1: Write failing test for base interface**

```js
// server/tests/ai/orchestrator.test.js
import { describe, it, expect, vi } from 'vitest'

// We'll test orchestrator here; first verify provider interface
import { BaseProvider } from '../../src/ai/providers/base.js'

describe('BaseProvider', () => {
  it('throws NotImplemented on extractMetadata', async () => {
    const p = new BaseProvider()
    await expect(p.extractMetadata('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on analyzeChunk', async () => {
    const p = new BaseProvider()
    await expect(p.analyzeChunk('')).rejects.toThrow('Not implemented')
  })

  it('throws NotImplemented on synthesize', async () => {
    const p = new BaseProvider()
    await expect(p.synthesize('')).rejects.toThrow('Not implemented')
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

- [ ] **Step 3: Implement base provider**

```js
// server/src/ai/providers/base.js
export class BaseProvider {
  async extractMetadata(cobolText) {
    throw new Error('Not implemented')
  }

  async analyzeChunk(chunkText) {
    throw new Error('Not implemented')
  }

  async synthesize(descriptions) {
    throw new Error('Not implemented')
  }
}
```

- [ ] **Step 4: Create prompts.js**

```js
// server/src/ai/prompts.js

export const METADATA_PROMPT = (cobolText) => `
You are a COBOL expert. Analyze this COBOL program header and extract structured metadata.

Return ONLY valid JSON matching this schema exactly:
{
  "description": "brief description of what this program does",
  "call_parameters": [
    { "name": "PARAM-NAME", "type": "data type", "description": "what it controls", "future_endpoint": null }
  ],
  "external_calls": [
    { "program_name": "PROGNAME", "context": "why it is called", "is_system_call": false }
  ],
  "db_tables": [
    { "table": "TABLE-NAME", "operation": "READ|WRITE|READ/WRITE", "fields": ["FIELD-A"] }
  ]
}

COBOL CODE:
${cobolText}
`

export const CHUNK_PROMPT = (chunkText) => `
You are a COBOL expert. Analyze this COBOL paragraph and extract its business logic.

Return ONLY valid JSON matching this schema exactly:
{
  "description": "one sentence description of what this paragraph does",
  "flow_steps": ["step 1", "step 2"],
  "variables_used": ["VAR-NAME"],
  "calls": ["CALLED-PROGRAM"],
  "db_ops": [
    { "table": "TABLE-NAME", "operation": "READ|WRITE|READ/WRITE", "fields": ["FIELD"] }
  ]
}

COBOL CODE:
${chunkText}
`

export const SYNTHESIS_PROMPT = (descriptions) => `
You are a COBOL expert. Based on these paragraph descriptions from a single COBOL program,
write a concise overall summary of what the program does as a whole.

Return ONLY valid JSON:
{ "summary": "one to three sentence summary" }

PARAGRAPH DESCRIPTIONS:
${descriptions}
`
```

- [ ] **Step 5: Implement ClaudeProvider**

```js
// server/src/ai/providers/claude.js
import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { METADATA_PROMPT, CHUNK_PROMPT, SYNTHESIS_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }

  async #callClaude(prompt) {
    const message = await this.client.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].text.trim()
    return JSON.parse(text)
  }

  async extractMetadata(cobolText) {
    return this.#callClaude(METADATA_PROMPT(cobolText))
  }

  async analyzeChunk(chunkText) {
    return this.#callClaude(CHUNK_PROMPT(chunkText))
  }

  async synthesize(descriptions) {
    return this.#callClaude(SYNTHESIS_PROMPT(descriptions))
  }
}
```

- [ ] **Step 6: Implement OpenAIProvider**

```js
// server/src/ai/providers/openai.js
import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { METADATA_PROMPT, CHUNK_PROMPT, SYNTHESIS_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor() {
    super()
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  async #callOpenAI(prompt) {
    const completion = await this.client.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractMetadata(cobolText) {
    return this.#callOpenAI(METADATA_PROMPT(cobolText))
  }

  async analyzeChunk(chunkText) {
    return this.#callOpenAI(CHUNK_PROMPT(chunkText))
  }

  async synthesize(descriptions) {
    return this.#callOpenAI(SYNTHESIS_PROMPT(descriptions))
  }
}
```

- [ ] **Step 7: Add provider factory**

```js
// server/src/ai/providers/base.js  (append at bottom)
import { ClaudeProvider } from './claude.js'
import { OpenAIProvider } from './openai.js'

export function getProvider() {
  const name = process.env.AI_PROVIDER || 'claude'
  if (name === 'openai') return new OpenAIProvider()
  return new ClaudeProvider()
}
```

- [ ] **Step 8: Run base provider test — verify it passes**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

Expected: 3 tests PASS

- [ ] **Step 9: Commit**

```bash
git add server/src/ai/
git commit -m "feat: add AI provider abstraction with Claude and OpenAI implementations"
```

---

## Task 6: AI Orchestrator

**Files:**
- Create: `server/src/ai/orchestrator.js`
- Modify: `server/tests/ai/orchestrator.test.js`

The orchestrator runs the full analysis pipeline and emits events to an SSE response object. It is designed to be testable by injecting a mock provider and mock SSE emitter.

- [ ] **Step 1: Add orchestrator tests**

Append to `server/tests/ai/orchestrator.test.js`:

```js
import { runAnalysis } from '../../src/ai/orchestrator.js'

describe('runAnalysis', () => {
  it('calls extractMetadata, analyzeChunk per chunk, synthesize', async () => {
    const mockProvider = {
      extractMetadata: vi.fn().mockResolvedValue({
        description: 'test desc',
        call_parameters: [],
        external_calls: [],
        db_tables: [],
      }),
      analyzeChunk: vi.fn().mockResolvedValue({
        description: 'chunk desc',
        flow_steps: ['step 1'],
        variables_used: [],
        calls: [],
        db_ops: [],
      }),
      synthesize: vi.fn().mockResolvedValue({ summary: 'overall summary' }),
    }

    const chunks = [
      { id: 'c1', chunk_type: 'paragraph', chunk_name: 'MAIN-PARA', cobol_text: 'MOVE 1 TO X.' },
    ]

    const events = []
    const mockEmit = (event, data) => events.push({ event, data })

    const result = await runAnalysis({
      cobolText: 'IDENTIFICATION DIVISION.',
      chunks,
      provider: mockProvider,
      emit: mockEmit,
    })

    expect(mockProvider.extractMetadata).toHaveBeenCalledOnce()
    expect(mockProvider.analyzeChunk).toHaveBeenCalledOnce()
    expect(mockProvider.synthesize).toHaveBeenCalledOnce()
    expect(result.metadata.description).toBe('test desc')
    expect(result.chunkResults).toHaveLength(1)
    expect(result.summary).toBe('overall summary')
    expect(events.some(e => e.event === 'chunk_done')).toBe(true)
    expect(events.some(e => e.event === 'done')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

- [ ] **Step 3: Implement orchestrator**

```js
// server/src/ai/orchestrator.js

export async function runAnalysis({ cobolText, chunks, provider, emit }) {
  // Step 1: extract metadata from IDENTIFICATION + first DATA lines
  const headerLines = cobolText.split('\n').slice(0, 100).join('\n')
  const metadata = await provider.extractMetadata(headerLines)
  emit('metadata', metadata)

  // Step 2: analyze each chunk
  const chunkResults = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    try {
      const analysis = await provider.analyzeChunk(chunk.cobol_text)
      chunkResults.push({ chunk, analysis })
      emit('chunk_done', { chunkId: chunk.id, index: i + 1, total: chunks.length })
    } catch (err) {
      emit('chunk_failed', { chunkId: chunk.id, error: err.message })
      chunkResults.push({ chunk, analysis: null, error: err.message })
    }
  }

  // Step 3: synthesize
  const descriptions = chunkResults
    .filter(r => r.analysis)
    .map(r => `${r.chunk.chunk_name}: ${r.analysis.description}`)
    .join('\n')
  const { summary } = await provider.synthesize(descriptions)
  emit('done', { summary })

  return { metadata, chunkResults, summary }
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd server && npx vitest run tests/ai/orchestrator.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/ai/orchestrator.js server/tests/ai/
git commit -m "feat: implement AI orchestrator with injectable provider and emitter"
```

---

## Task 7: Analysis Service and Graph Service

**Files:**
- Create: `server/src/services/analysisService.js`
- Create: `server/src/services/graphService.js`
- Create: `server/tests/services/graphService.test.js`

- [ ] **Step 1: Write graph service test**

```js
// server/tests/services/graphService.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/models/programs.js', () => ({
  findProgramByName: vi.fn(),
  createProgram: vi.fn(),
  updateProgramStatus: vi.fn(),
}))
vi.mock('../../src/models/programEdges.js', () => ({
  upsertEdge: vi.fn(),
  backfillPhantomEdges: vi.fn(),
}))

import { updateGraphAfterAnalysis } from '../../src/services/graphService.js'
import * as programsModel from '../../src/models/programs.js'
import * as edgesModel from '../../src/models/programEdges.js'

describe('updateGraphAfterAnalysis', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates pending program node for unknown external call', async () => {
    programsModel.findProgramByName.mockResolvedValue(null)
    programsModel.createProgram.mockResolvedValue({ id: 'new-id', name: 'ARCUST' })
    programsModel.updateProgramStatus.mockResolvedValue({})

    await updateGraphAfterAnalysis('prog-id', [
      { program_name: 'ARCUST', context: 'customer lookup', is_system_call: false }
    ])

    expect(programsModel.createProgram).toHaveBeenCalledWith({ name: 'ARCUST', status: 'pending' })
    expect(edgesModel.upsertEdge).toHaveBeenCalledWith({
      from_program_id: 'prog-id',
      to_program_name: 'ARCUST',
      to_program_id: 'new-id',
      context: 'customer lookup',
    })
  })

  it('skips system calls from graph', async () => {
    await updateGraphAfterAnalysis('prog-id', [
      { program_name: 'c_curpid', context: 'get pid', is_system_call: true }
    ])
    expect(programsModel.findProgramByName).not.toHaveBeenCalled()
    expect(edgesModel.upsertEdge).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd server && npx vitest run tests/services/graphService.test.js
```

- [ ] **Step 3: Implement graphService.js**

```js
// server/src/services/graphService.js
import { findProgramByName, createProgram, updateProgramStatus } from '../models/programs.js'
import { upsertEdge, backfillPhantomEdges } from '../models/programEdges.js'

export async function updateGraphAfterAnalysis(fromProgramId, externalCalls) {
  for (const call of externalCalls) {
    if (call.is_system_call) continue

    let target = await findProgramByName(call.program_name)
    let targetId = target ? target.id : null

    if (!target) {
      const created = await createProgram({ name: call.program_name, status: 'pending' })
      targetId = created.id
    }

    await upsertEdge({
      from_program_id: fromProgramId,
      to_program_name: call.program_name,
      to_program_id: targetId,
      context: call.context,
    })
  }

  await updateProgramStatus(fromProgramId, 'analyzed', { analyzed_at: true })
}

export async function backfillEdgesForNewProgram(program) {
  await backfillPhantomEdges(program.name, program.id)
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
cd server && npx vitest run tests/services/graphService.test.js
```

- [ ] **Step 5: Implement analysisService.js**

```js
// server/src/services/analysisService.js
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { createProgram, updateProgramStatus, findProgramByName } from '../models/programs.js'
import { upsertAnalysis, updateDescription } from '../models/programAnalysis.js'
import { insertChunks, updateChunkAnalysis, markChunkFailed, getRetryableChunks } from '../models/programChunks.js'
import { backfillEdgesForNewProgram, updateGraphAfterAnalysis } from './graphService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

export async function uploadAndStartAnalysis(file, sseEmitters) {
  mkdirSync(UPLOADS_DIR, { recursive: true })

  const cobolText = file.buffer.toString('utf8')
  const programName = file.originalname.replace(/\.cbl$/i, '').toUpperCase()

  // Create or find program record
  let program = await findProgramByName(programName)
  if (!program) {
    program = await createProgram({ name: programName, status: 'analyzing' })
  } else {
    if (program.status === 'analyzing') {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
  }

  // Save file to disk
  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  writeFileSync(filePath, cobolText)

  // Backfill phantom edges that referenced this program name
  await backfillEdgesForNewProgram(program)

  // Parse COBOL into chunks (sync, fast)
  const parsedChunks = parseCobol(cobolText)
  // insertChunks returns rows with DB-assigned UUIDs — must use these, not parsedChunks
  const savedChunks = await insertChunks(program.id, parsedChunks)

  // Start AI analysis in background (non-blocking)
  runAnalysisInBackground(program.id, cobolText, savedChunks, sseEmitters)

  return program
}

async function runAnalysisInBackground(programId, cobolText, parsedChunks, sseEmitters) {
  const provider = getProvider()

  const emit = (event, data) => {
    const emitters = sseEmitters.get(programId) || []
    for (const res of emitters) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }

  try {
    const { metadata, chunkResults, summary } = await runAnalysis({
      cobolText,
      chunks: chunksWithIds,
      provider,
      emit,
    })

    // Save metadata
    await upsertAnalysis({ program_id: programId, ...metadata })

    // Save chunk results
    for (const { chunk, analysis, error } of chunkResults) {
      if (chunk.id && analysis) await updateChunkAnalysis(chunk.id, analysis)
      else if (chunk.id && error) await markChunkFailed(chunk.id)
    }

    // Save synthesis summary
    await updateDescription(programId, summary)

    // Update graph
    await updateGraphAfterAnalysis(programId, metadata.external_calls)

    emit('done', { programId })
  } catch (err) {
    await updateProgramStatus(programId, 'failed')
    emit('failed', { error: err.message })
  }
}

export async function reanalyze(programId, sseEmitters) {
  const program = await import('../models/programs.js').then(m => m.findProgramById(programId))
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') throw Object.assign(new Error('Already analyzing'), { status: 409 })

  await updateProgramStatus(programId, 'analyzing')
  const { readFileSync } = await import('fs')
  const cobolText = readFileSync(program.file_path, 'utf8')
  const retryChunks = await getRetryableChunks(programId)

  runAnalysisInBackground(programId, cobolText, retryChunks, sseEmitters)
}
```

- [ ] **Step 6: Commit**

```bash
git add server/src/services/ server/tests/services/
git commit -m "feat: implement analysis service and graph update service"
```

---

## Task 8: Express Routes

**Files:**
- Create: `server/src/routes/programs.js`
- Create: `server/tests/routes/programs.test.js`

The routes file owns the SSE emitter registry (a `Map<programId, Set<res>>`). This is in-process state, sufficient for v1.

- [ ] **Step 1: Write route tests**

```js
// server/tests/routes/programs.test.js
import { describe, it, expect, vi, beforeAll } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/services/analysisService.js', () => ({
  uploadAndStartAnalysis: vi.fn().mockResolvedValue({ id: 'prog-123', name: 'TESTPROG', status: 'analyzing' }),
  reanalyze: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/models/programs.js', () => ({
  getAllPrograms: vi.fn().mockResolvedValue([{ id: 'p1', name: 'PROG1', status: 'analyzed' }]),
  findProgramById: vi.fn().mockResolvedValue({ id: 'p1', name: 'PROG1', status: 'analyzed' }),
}))
vi.mock('../../src/models/programEdges.js', () => ({
  getAllEdges: vi.fn().mockResolvedValue([]),
  getEdgesForProgram: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../src/models/programAnalysis.js', () => ({
  getAnalysisByProgramId: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../src/models/programChunks.js', () => ({
  getChunksByProgramId: vi.fn().mockResolvedValue([]),
}))
```

Add `supertest` to devDependencies: `npm install --save-dev supertest`

```js
describe('GET /api/programs', () => {
  it('returns programs and edges', async () => {
    const res = await request(app).get('/api/programs')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('programs')
    expect(res.body).toHaveProperty('edges')
    expect(res.body.programs[0].name).toBe('PROG1')
  })
})

describe('POST /api/programs/upload', () => {
  it('accepts a .cbl file and returns program id', async () => {
    const res = await request(app)
      .post('/api/programs/upload')
      .attach('file', Buffer.from('IDENTIFICATION DIVISION.'), 'TEST.cbl')
    expect(res.status).toBe(202)
    expect(res.body.id).toBe('prog-123')
    expect(res.body.status).toBe('analyzing')
  })
})
```

- [ ] **Step 2: Install supertest**

```bash
cd server && npm install --save-dev supertest
```

- [ ] **Step 3: Run test — verify it fails**

```bash
cd server && npx vitest run tests/routes/programs.test.js
```

- [ ] **Step 4: Implement routes**

```js
// server/src/routes/programs.js
import { Router } from 'express'
import multer from 'multer'
import { getAllPrograms, findProgramById } from '../models/programs.js'
import { getAllEdges, getEdgesForProgram } from '../models/programEdges.js'
import { getAnalysisByProgramId } from '../models/programAnalysis.js'
import { getChunksByProgramId } from '../models/programChunks.js'
import { uploadAndStartAnalysis, reanalyze } from '../services/analysisService.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage() })

// SSE emitter registry: programId → Set of response objects
const sseEmitters = new Map()

// GET /api/programs
router.get('/', async (req, res) => {
  const [programs, edges] = await Promise.all([getAllPrograms(), getAllEdges()])
  res.json({ programs, edges })
})

// GET /api/programs/:id
router.get('/:id', async (req, res) => {
  const program = await findProgramById(req.params.id)
  if (!program) return res.status(404).json({ error: 'Not found' })

  const [analysis, chunks, edges] = await Promise.all([
    getAnalysisByProgramId(req.params.id),
    getChunksByProgramId(req.params.id),
    getEdgesForProgram(req.params.id),
  ])
  res.json({ ...program, analysis, chunks, edges })
})

// GET /api/programs/:id/stream  (SSE)
router.get('/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { id } = req.params
  if (!sseEmitters.has(id)) sseEmitters.set(id, new Set())
  sseEmitters.get(id).add(res)

  req.on('close', () => {
    sseEmitters.get(id)?.delete(res)
  })
})

// GET /api/programs/:id/chunks
router.get('/:id/chunks', async (req, res) => {
  const chunks = await getChunksByProgramId(req.params.id)
  res.json(chunks)
})

// POST /api/programs/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const program = await uploadAndStartAnalysis(req.file, sseEmitters)
    res.status(202).json({ id: program.id, status: program.status })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /api/programs/:id/analyze  (re-analyze)
router.post('/:id/analyze', async (req, res) => {
  try {
    await reanalyze(req.params.id, sseEmitters)
    res.json({ status: 'analyzing' })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

export default router
```

- [ ] **Step 5: Run route tests — verify they pass**

```bash
cd server && npx vitest run tests/routes/programs.test.js
```

Expected: All tests PASS

- [ ] **Step 6: Run all server tests**

```bash
cd server && npm test
```

Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/ server/tests/routes/
git commit -m "feat: implement API routes with SSE streaming"
```

---

## Task 9: React Graph View

**Files:**
- Create: `client/src/api/programs.js`
- Create: `client/src/hooks/usePrograms.js`
- Create: `client/src/hooks/useSSE.js`
- Create: `client/src/components/Graph/ProgramNode.jsx`
- Create: `client/src/components/Graph/ProgramGraph.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Write ProgramNode test**

```jsx
// client/tests/components/ProgramNode.test.jsx
import { render, screen } from '@testing-library/react'
import ProgramNode from '../../src/components/Graph/ProgramNode.jsx'
import { ReactFlowProvider } from 'reactflow'

const wrap = (ui) => render(<ReactFlowProvider>{ui}</ReactFlowProvider>)

test('shows program name', () => {
  wrap(<ProgramNode data={{ name: 'ARERCD', status: 'analyzed', isPhantom: false }} />)
  expect(screen.getByText('ARERCD')).toBeInTheDocument()
})

test('applies green style for analyzed status', () => {
  const { container } = wrap(<ProgramNode data={{ name: 'ARERCD', status: 'analyzed', isPhantom: false }} />)
  const node = container.firstChild
  expect(node.style.borderColor || node.className).toMatch(/4ade80|analyzed/i)
})

test('applies dashed border for phantom nodes', () => {
  const { container } = wrap(<ProgramNode data={{ name: 'ARCUST', status: 'pending', isPhantom: true }} />)
  const node = container.firstChild
  expect(node.style.borderStyle || node.className).toMatch(/dashed|phantom/i)
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
cd client && npx vitest run tests/components/ProgramNode.test.jsx
```

- [ ] **Step 3: Implement ProgramNode**

```jsx
// client/src/components/Graph/ProgramNode.jsx
import { Handle, Position } from 'reactflow'

const STATUS_STYLES = {
  analyzed: { borderColor: '#4ade80', background: '#166534' },
  analyzing: { borderColor: '#60a5fa', background: '#1e3a5f', animation: 'pulse 1.5s infinite' },
  pending: { borderColor: '#475569', background: '#1e293b' },
  failed: { borderColor: '#f87171', background: '#450a0a' },
}

export default function ProgramNode({ data }) {
  const style = STATUS_STYLES[data.status] || STATUS_STYLES.pending
  return (
    <div
      style={{
        padding: '8px 14px',
        borderRadius: 8,
        border: `2px ${data.isPhantom ? 'dashed' : 'solid'} ${style.borderColor}`,
        background: style.background,
        color: '#e2e8f0',
        fontSize: 13,
        fontWeight: 600,
        minWidth: 90,
        textAlign: 'center',
        animation: style.animation,
      }}
      className={`status-${data.status} ${data.isPhantom ? 'phantom' : ''}`}
    >
      <Handle type="target" position={Position.Top} />
      {data.name}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

- [ ] **Step 4: Run ProgramNode test — verify it passes**

```bash
cd client && npx vitest run tests/components/ProgramNode.test.jsx
```

- [ ] **Step 5: Implement API client**

```js
// client/src/api/programs.js

const BASE = '/api/programs'

export async function fetchGraph() {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch graph')
  return res.json()
}

export async function fetchProgram(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch program')
  return res.json()
}

export async function uploadFile(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}

export async function triggerReanalyze(id) {
  const res = await fetch(`${BASE}/${id}/analyze`, { method: 'POST' })
  if (!res.ok) throw new Error('Reanalyze failed')
  return res.json()
}
```

- [ ] **Step 6: Implement useSSE hook**

```js
// client/src/hooks/useSSE.js
import { useEffect, useRef } from 'react'

export function useSSE(programId, onEvent) {
  const esRef = useRef(null)

  useEffect(() => {
    if (!programId) return
    const es = new EventSource(`/api/programs/${programId}/stream`)
    esRef.current = es

    const handle = (e) => {
      try {
        onEvent(e.type, JSON.parse(e.data))
      } catch {}
    }

    ;['chunk_done', 'metadata', 'done', 'failed'].forEach(event =>
      es.addEventListener(event, handle)
    )

    return () => es.close()
  }, [programId])
}
```

- [ ] **Step 7: Implement usePrograms hook**

```js
// client/src/hooks/usePrograms.js
import { useState, useEffect, useCallback } from 'react'
import { fetchGraph } from '../api/programs.js'

function buildNodes(programs, edges) {
  const realNodes = programs.map(p => ({
    id: p.id,
    type: 'programNode',
    position: { x: Math.random() * 600, y: Math.random() * 400 },
    data: { name: p.name, status: p.status, isPhantom: false },
  }))

  // Add phantom nodes for referenced-but-not-yet-uploaded programs
  const programIds = new Set(programs.map(p => p.id))
  const phantomNames = new Set(
    edges.filter(e => !e.to).map(e => e.to_name)
  )
  const phantomNodes = [...phantomNames].map(name => ({
    id: `phantom-${name}`,
    type: 'programNode',
    position: { x: Math.random() * 600, y: Math.random() * 400 },
    data: { name, status: 'pending', isPhantom: true },
  }))

  return [...realNodes, ...phantomNodes]
}

function buildEdges(edges) {
  return edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.from,
    target: e.to || `phantom-${e.to_name}`,
    animated: false,
  }))
}

export function usePrograms() {
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const { programs, edges: rawEdges } = await fetchGraph()
    setNodes(buildNodes(programs, rawEdges))
    setEdges(buildEdges(rawEdges))
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const markAnalyzing = useCallback((programId) => {
    setNodes(prev => prev.map(n =>
      n.id === programId ? { ...n, data: { ...n.data, status: 'analyzing' } } : n
    ))
  }, [])

  const markAnalyzed = useCallback((programId) => {
    setNodes(prev => prev.map(n =>
      n.id === programId ? { ...n, data: { ...n.data, status: 'analyzed' } } : n
    ))
  }, [])

  return { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed }
}
```

- [ ] **Step 8: Implement ProgramGraph**

```jsx
// client/src/components/Graph/ProgramGraph.jsx
import ReactFlow, { Background, Controls, MiniMap } from 'reactflow'
import 'reactflow/dist/style.css'
import ProgramNode from './ProgramNode.jsx'

const nodeTypes = { programNode: ProgramNode }

export default function ProgramGraph({ nodes, edges, onNodeClick }) {
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, node) => onNodeClick(node)}
      fitView
    >
      <Background color="#1e293b" />
      <Controls />
      <MiniMap nodeColor={n => {
        const s = n.data?.status
        if (s === 'analyzed') return '#4ade80'
        if (s === 'analyzing') return '#60a5fa'
        return '#475569'
      }} />
    </ReactFlow>
  )
}
```

- [ ] **Step 9: Wire up App.jsx**

```jsx
// client/src/App.jsx
import { useState } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import { usePrograms } from './hooks/usePrograms.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a', position: 'relative' }}>
      <ProgramGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => setSelectedId(node.id)}
      />
      {/* Detail panel and Upload button added in next tasks */}
    </div>
  )
}
```

- [ ] **Step 10: Start both servers and verify graph renders**

```bash
# Terminal 1: cd server && npm run dev
# Terminal 2: cd client && npm run dev
# Open http://localhost:5173
```

Expected: Dark background, empty graph canvas with controls visible.

- [ ] **Step 11: Commit**

```bash
git add client/src/ client/tests/
git commit -m "feat: implement graph view with React Flow and custom nodes"
```

---

## Task 10: Upload Button and SSE Progress

**Files:**
- Create: `client/src/components/Upload/UploadButton.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Implement UploadButton**

```jsx
// client/src/components/Upload/UploadButton.jsx
import { useRef, useState } from 'react'
import { uploadFile } from '../../api/programs.js'

export default function UploadButton({ onUploaded }) {
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const program = await uploadFile(file)
      onUploaded(program)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      inputRef.current.value = ''
    }
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".cbl,.cob"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
      <button
        onClick={() => inputRef.current.click()}
        disabled={uploading}
        style={{
          background: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: 8,
          padding: '10px 20px',
          fontSize: 14,
          fontWeight: 600,
          cursor: uploading ? 'not-allowed' : 'pointer',
          opacity: uploading ? 0.7 : 1,
        }}
      >
        {uploading ? 'Uploading…' : '+ Upload COBOL'}
      </button>
      {error && (
        <div style={{ color: '#f87171', fontSize: 12, marginTop: 6, textAlign: 'right' }}>{error}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update App.jsx with upload + SSE + detail panel placeholder**

```jsx
// client/src/App.jsx
import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import UploadButton from './components/Upload/UploadButton.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useSSE } from './hooks/useSSE.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [progress, setProgress] = useState(null)

  useSSE(analyzingId, (event, data) => {
    if (event === 'chunk_done') {
      setProgress(`Analyzing chunk ${data.index} of ${data.total}…`)
    }
    if (event === 'done') {
      markAnalyzed(analyzingId)
      setAnalyzingId(null)
      setProgress(null)
      refresh()
    }
    if (event === 'failed') {
      setAnalyzingId(null)
      setProgress(null)
      refresh()
    }
  })

  const handleUploaded = useCallback((program) => {
    markAnalyzing(program.id)
    setAnalyzingId(program.id)
    setProgress('Starting analysis…')
    refresh()
  }, [markAnalyzing, refresh])

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0f172a', position: 'relative' }}>
      <ProgramGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => setSelectedId(node.id)}
      />
      <UploadButton onUploaded={handleUploaded} />
      {progress && (
        <div style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', color: '#60a5fa', padding: '8px 16px',
          borderRadius: 8, fontSize: 13, border: '1px solid #334155',
        }}>
          {progress}
        </div>
      )}
      {/* Detail panel rendered here in Task 11 */}
    </div>
  )
}
```

- [ ] **Step 3: Test upload flow manually**

1. Ensure server is running with valid `.env`
2. Open http://localhost:5173
3. Click "Upload COBOL", select `arercd.cbl`
4. Verify progress banner appears
5. Verify node turns blue/animated while analyzing
6. Verify node turns green when done

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Upload/ client/src/App.jsx
git commit -m "feat: add file upload and SSE progress tracking"
```

---

## Task 11: Detail Panel

**Files:**
- Create: `client/src/components/Panel/DetailPanel.jsx`
- Create: `client/src/components/Panel/OverviewTab.jsx`
- Create: `client/src/components/Panel/LogicBlocksTab.jsx`
- Create: `client/src/components/Panel/ConnectionsTab.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Implement OverviewTab**

```jsx
// client/src/components/Panel/OverviewTab.jsx
export default function OverviewTab({ analysis }) {
  if (!analysis) return <p style={{ color: '#64748b' }}>No analysis yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {analysis.description && (
        <section>
          <label style={labelStyle}>Description</label>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6, margin: 0 }}>{analysis.description}</p>
        </section>
      )}

      {analysis.call_parameters?.length > 0 && (
        <section>
          <label style={labelStyle}>Call Parameters</label>
          {analysis.call_parameters.map((p, i) => (
            <div key={i} style={rowStyle}>
              <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</span>
              <span style={{ color: '#94a3b8', fontSize: 12 }}>{p.type}</span>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 0' }}>{p.description}</p>
            </div>
          ))}
        </section>
      )}

      {analysis.external_calls?.length > 0 && (
        <section>
          <label style={labelStyle}>External Calls</label>
          {analysis.external_calls.map((c, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: c.is_system_call ? '#64748b' : '#60a5fa' }}>{c.program_name}</span>
                {c.is_system_call && <span style={{ fontSize: 10, color: '#475569' }}>system</span>}
              </div>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '2px 0 0' }}>{c.context}</p>
            </div>
          ))}
        </section>
      )}

      {analysis.db_tables?.length > 0 && (
        <section>
          <label style={labelStyle}>DB Tables</label>
          {analysis.db_tables.map((t, i) => (
            <div key={i} style={rowStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#e2e8f0' }}>{t.table}</span>
                <span style={{ fontSize: 11, color: '#f59e0b' }}>{t.operation}</span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 11, margin: '2px 0 0' }}>
                {t.fields?.join(', ')}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
```

- [ ] **Step 2: Implement LogicBlocksTab**

```jsx
// client/src/components/Panel/LogicBlocksTab.jsx
import { useState } from 'react'

export default function LogicBlocksTab({ chunks }) {
  const [expanded, setExpanded] = useState(null)

  if (!chunks?.length) return <p style={{ color: '#64748b' }}>No chunks yet.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {chunks.map(chunk => (
        <div key={chunk.id} style={{ background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
          <button
            onClick={() => setExpanded(expanded === chunk.id ? null : chunk.id)}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{chunk.chunk_name}</span>
            <span style={{ color: '#475569', fontSize: 11 }}>{expanded === chunk.id ? '▲' : '▼'}</span>
          </button>
          {expanded === chunk.id && chunk.analysis && (
            <div style={{ padding: '0 10px 10px', borderTop: '1px solid #1e293b' }}>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0' }}>{chunk.analysis.description}</p>
              {chunk.analysis.flow_steps?.length > 0 && (
                <ol style={{ color: '#cbd5e1', fontSize: 12, paddingLeft: 18, margin: 0 }}>
                  {chunk.analysis.flow_steps.map((s, i) => <li key={i} style={{ marginBottom: 3 }}>{s}</li>)}
                </ol>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Implement ConnectionsTab**

```jsx
// client/src/components/Panel/ConnectionsTab.jsx
export default function ConnectionsTab({ edges, programId, onNavigate }) {
  const incoming = edges.filter(e => e.to_program_id === programId)
  const outgoing = edges.filter(e => e.from_program_id === programId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section>
        <label style={labelStyle}>Called by ({incoming.length})</label>
        {incoming.length === 0 ? <p style={emptyStyle}>None</p> : incoming.map((e, i) => (
          <div key={i} style={rowStyle} onClick={() => onNavigate(e.from_program_id)} className="clickable">
            <span style={{ color: '#60a5fa', cursor: 'pointer' }}>{e.from_program_name}</span>
          </div>
        ))}
      </section>
      <section>
        <label style={labelStyle}>Calls ({outgoing.length})</label>
        {outgoing.length === 0 ? <p style={emptyStyle}>None</p> : outgoing.map((e, i) => (
          <div key={i} style={rowStyle} onClick={() => e.to_program_id && onNavigate(e.to_program_id)}>
            <span style={{ color: e.to_program_id ? '#60a5fa' : '#64748b', cursor: e.to_program_id ? 'pointer' : 'default' }}>
              {e.to_program_name}
            </span>
            {!e.to_program_id && <span style={{ fontSize: 10, color: '#475569', marginLeft: 8 }}>not uploaded</span>}
          </div>
        ))}
      </section>
    </div>
  )
}

const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#64748b', textTransform: 'uppercase', display: 'block', marginBottom: 6 }
const rowStyle = { background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 4 }
const emptyStyle = { color: '#475569', fontSize: 12, margin: 0 }
```

- [ ] **Step 4: Implement DetailPanel**

```jsx
// client/src/components/Panel/DetailPanel.jsx
import { useState, useEffect } from 'react'
import { fetchProgram } from '../../api/programs.js'
import OverviewTab from './OverviewTab.jsx'
import LogicBlocksTab from './LogicBlocksTab.jsx'
import ConnectionsTab from './ConnectionsTab.jsx'

const TABS = ['Overview', 'Logic Blocks', 'Connections']
const STATUS_COLOR = { analyzed: '#4ade80', analyzing: '#60a5fa', pending: '#475569', failed: '#f87171' }

export default function DetailPanel({ programId, onClose, onNavigate }) {
  const [program, setProgram] = useState(null)
  const [tab, setTab] = useState('Overview')

  useEffect(() => {
    if (!programId) return
    fetchProgram(programId).then(setProgram)
  }, [programId])

  if (!programId) return null

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 340, height: '100%',
      background: '#1e293b', borderLeft: '1px solid #334155', display: 'flex', flexDirection: 'column',
      zIndex: 10, overflowY: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', background: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#e2e8f0' }}>{program?.name || '…'}</div>
          {program && <div style={{ fontSize: 11, color: STATUS_COLOR[program.status], marginTop: 2 }}>● {program.status}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer' }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#0f172a', borderBottom: '1px solid #334155' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '8px 4px', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #60a5fa' : '2px solid transparent',
            color: tab === t ? '#60a5fa' : '#475569', fontSize: 12, cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 14, overflowY: 'auto', flex: 1 }}>
        {!program ? <p style={{ color: '#64748b' }}>Loading…</p> : (
          <>
            {tab === 'Overview' && <OverviewTab analysis={program.analysis} />}
            {tab === 'Logic Blocks' && <LogicBlocksTab chunks={program.chunks} />}
            {tab === 'Connections' && <ConnectionsTab edges={program.edges || []} programId={programId} onNavigate={onNavigate} />}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add DetailPanel to App.jsx**

Add import at top: `import DetailPanel from './components/Panel/DetailPanel.jsx'`

Replace `{/* Detail panel rendered here in Task 11 */}` with:

```jsx
<DetailPanel
  programId={selectedId}
  onClose={() => setSelectedId(null)}
  onNavigate={(id) => setSelectedId(id)}
/>
```

- [ ] **Step 6: Manual end-to-end verification**

1. Upload `arercd.cbl`
2. Watch progress banner update chunk-by-chunk
3. When done: node turns green
4. Click node → panel slides in from right
5. Check Overview tab: description, call parameters, external calls, DB tables populated
6. Check Logic Blocks tab: paragraphs listed, expandable
7. Check Connections tab: outgoing links to referenced programs

- [ ] **Step 7: Run all tests**

```bash
cd server && npm test
cd client && npm test
```

Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add client/src/components/Panel/ client/src/App.jsx
git commit -m "feat: implement detail panel with Overview, Logic Blocks, and Connections tabs"
```

---

## Task 12: Add .gitignore and Final Cleanup

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

```
# Dependencies
server/node_modules/
client/node_modules/

# Uploads
server/uploads/

# Env
server/.env

# Build
client/dist/

# Brainstorm artifacts
.superpowers/

# OS
.DS_Store
```

- [ ] **Step 2: Final test run**

```bash
cd server && npm test && cd ../client && npm test
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/dariasidenko/aiconverter2
git add .gitignore
git commit -m "chore: add gitignore"
```

---

## Appendix: Running the App

**Prerequisites:**
- PostgreSQL running locally
- `createdb cobol_converter`
- `cp server/.env.example server/.env` and fill in API keys

**First run:**
```bash
cd server && npm install && npm run migrate
cd ../client && npm install
```

**Development:**
```bash
# Terminal 1
cd server && npm run dev

# Terminal 2
cd client && npm run dev
```

Open http://localhost:5173

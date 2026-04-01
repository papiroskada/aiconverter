# Applications & Batch Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group COBOL programs into applications, enable folder-based batch upload with sequential/parallel analysis, persist API keys and model config in DB, add a settings drawer and CLI scanner.

**Architecture:** New `applications` and `settings` tables anchor the feature. A `batchService` reads settings from DB and orchestrates analysis via existing `runAnalysisInBackground`. The frontend gains a `ConfirmationModal` (folder picker → settings → progress) and a `SettingsDrawer` (API key management). A CLI script mirrors the UI flow over HTTP.

**Tech Stack:** Node.js ESM, Express, PostgreSQL (pg), Anthropic SDK, OpenAI SDK, React 18, Vitest + Supertest

---

## File Map

**Create:**
- `server/src/models/applications.js` — CRUD for applications table
- `server/src/models/settings.js` — get/upsert single-row settings
- `server/src/routes/applications.js` — REST + SSE for applications
- `server/src/routes/settings.js` — GET/PUT settings
- `server/src/services/batchService.js` — sequential/parallel batch orchestration
- `cli/scan.js` — CLI directory scanner
- `client/src/api/applications.js` — fetch wrapper for applications API
- `client/src/api/settings.js` — fetch wrapper for settings API
- `client/src/hooks/useAppSSE.js` — SSE hook for application-level stream
- `client/src/components/Upload/UploadControls.jsx` — replaces UploadButton
- `client/src/components/Upload/ConfirmationModal.jsx` — folder confirmation + settings form
- `client/src/components/Settings/SettingsDrawer.jsx` — API key management
- `server/tests/routes/settings.test.js`
- `server/tests/routes/applications.test.js`
- `server/tests/services/batchService.test.js`

**Modify:**
- `server/src/db/schema.sql` — full rewrite with applications + settings
- `server/src/ai/providers/base.js` — `getProvider(config)` accepts settings object
- `server/src/ai/providers/claude.js` — receive api key + models via constructor
- `server/src/ai/providers/openai.js` — receive api key + models via constructor
- `server/src/services/analysisService.js` — accept `applicationId`, pass settings to provider
- `server/src/app.js` — register new routers
- `client/src/api/programs.js` — `uploadFile` accepts optional `applicationId`
- `client/src/App.jsx` — integrate UploadControls, SettingsDrawer, useAppSSE

---

## Task 1: DB Schema Reset

**Files:**
- Modify: `server/src/db/schema.sql`

- [ ] **Step 1: Rewrite schema.sql**

Replace entire file content with:

```sql
-- Drop and recreate types (idempotent reset)
DROP TYPE IF EXISTS program_status CASCADE;
DROP TYPE IF EXISTS chunk_type CASCADE;
DROP TYPE IF EXISTS chunk_status CASCADE;

CREATE TYPE program_status AS ENUM ('pending', 'analyzing', 'analyzed', 'failed');
CREATE TYPE chunk_type AS ENUM ('data_summary', 'paragraph', 'sub_paragraph');
CREATE TYPE chunk_status AS ENUM ('pending', 'done', 'failed');

CREATE TABLE IF NOT EXISTS applications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  id                     INT PRIMARY KEY DEFAULT 1,
  ai_provider            TEXT NOT NULL DEFAULT 'claude',
  claude_api_key         TEXT,
  openai_api_key         TEXT,
  claude_model_interface TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  claude_model_rules     TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  claude_model_diagram   TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  openai_model_interface TEXT NOT NULL DEFAULT 'gpt-4o',
  openai_model_rules     TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  openai_model_diagram   TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at             TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS programs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  status         program_status NOT NULL DEFAULT 'pending',
  file_path      TEXT,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  analyzed_at    TIMESTAMP,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  description     TEXT,
  flow_narrative  TEXT,
  input_contract  TEXT,
  output_contract TEXT,
  call_parameters JSONB NOT NULL DEFAULT '[]',
  external_calls  JSONB NOT NULL DEFAULT '[]',
  db_tables       JSONB NOT NULL DEFAULT '[]',
  file_ops        JSONB NOT NULL DEFAULT '[]',
  diagram         TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (program_id)
);

CREATE TABLE IF NOT EXISTS program_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id    UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  chunk_type    chunk_type NOT NULL,
  chunk_name    TEXT NOT NULL,
  start_line    INT NOT NULL,
  end_line      INT NOT NULL,
  cobol_text    TEXT NOT NULL,
  analysis      JSONB,
  token_estimate INT NOT NULL DEFAULT 0,
  order_index   INT NOT NULL DEFAULT 0,
  status        chunk_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS program_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  to_program_name TEXT NOT NULL,
  to_program_id   UUID REFERENCES programs(id) ON DELETE SET NULL,
  context         TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (from_program_id, to_program_name)
);
```

- [ ] **Step 2: Run migration**

```bash
cd server && node -e "
import('dotenv/config').then(() => import('./src/db/client.js')).then(async ({ default: pool }) => {
  const { readFileSync } = await import('fs')
  const sql = readFileSync('./src/db/schema.sql', 'utf8')
  await pool.query(sql)
  console.log('Migration complete')
  await pool.end()
})
"
```

Expected: `Migration complete`

- [ ] **Step 3: Commit**

```bash
git add server/src/db/schema.sql
git commit -m "feat: reset schema with applications and settings tables"
```

---

## Task 2: Settings Model + Route

**Files:**
- Create: `server/src/models/settings.js`
- Create: `server/src/routes/settings.js`
- Create: `server/tests/routes/settings.test.js`
- Modify: `server/src/app.js`

- [ ] **Step 1: Write failing tests**

Create `server/tests/routes/settings.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/models/settings.js', () => ({
  getSettings: vi.fn().mockResolvedValue({
    ai_provider: 'claude',
    claude_api_key: 'sk-ant-api03-abcdefgh1234',
    openai_api_key: null,
    claude_model_interface: 'claude-sonnet-4-6',
    claude_model_rules: 'claude-haiku-4-5-20251001',
    claude_model_diagram: 'claude-haiku-4-5-20251001',
    openai_model_interface: 'gpt-4o',
    openai_model_rules: 'gpt-4o-mini',
    openai_model_diagram: 'gpt-4o-mini',
  }),
  upsertSettings: vi.fn().mockResolvedValue(undefined),
}))

describe('GET /api/settings', () => {
  it('returns settings with masked api key', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.status).toBe(200)
    expect(res.body.ai_provider).toBe('claude')
    expect(res.body.claude_api_key).toMatch(/••••/)
    expect(res.body.claude_api_key).toMatch(/1234$/)
    expect(res.body.openai_api_key).toBeNull()
  })

  it('returns model fields', async () => {
    const res = await request(app).get('/api/settings')
    expect(res.body.claude_model_interface).toBe('claude-sonnet-4-6')
    expect(res.body.openai_model_rules).toBe('gpt-4o-mini')
  })
})

describe('PUT /api/settings', () => {
  it('calls upsertSettings and returns 204', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ ai_provider: 'openai', openai_api_key: 'sk-newkey' })
    expect(res.status).toBe(204)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/routes/settings.test.js
```

Expected: FAIL — `Cannot find module '../../src/models/settings.js'`

- [ ] **Step 3: Create settings model**

Create `server/src/models/settings.js`:

```js
import pool from '../db/client.js'

const DEFAULTS = {
  ai_provider: 'claude',
  claude_api_key: null,
  openai_api_key: null,
  claude_model_interface: 'claude-sonnet-4-6',
  claude_model_rules: 'claude-haiku-4-5-20251001',
  claude_model_diagram: 'claude-haiku-4-5-20251001',
  openai_model_interface: 'gpt-4o',
  openai_model_rules: 'gpt-4o-mini',
  openai_model_diagram: 'gpt-4o-mini',
}

export async function getSettings() {
  const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1')
  return rows[0] ?? DEFAULTS
}

export async function upsertSettings(fields) {
  const allowed = Object.keys(DEFAULTS)
  const updates = Object.fromEntries(
    Object.entries(fields).filter(([k]) => allowed.includes(k))
  )
  if (Object.keys(updates).length === 0) return

  const cols = Object.keys(updates)
  const vals = Object.values(updates)
  const setClauses = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')

  await pool.query(
    `INSERT INTO settings (id, ${cols.join(', ')})
     VALUES (1, ${cols.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (id) DO UPDATE SET ${setClauses}, updated_at = NOW()`,
    vals
  )
}
```

- [ ] **Step 4: Create settings route**

Create `server/src/routes/settings.js`:

```js
import { Router } from 'express'
import { getSettings, upsertSettings } from '../models/settings.js'

const router = Router()

function maskKey(key) {
  if (!key) return null
  const dashIdx = key.indexOf('-', key.indexOf('-') + 1)
  const prefix = dashIdx > 0 ? key.slice(0, dashIdx + 1) : key.slice(0, 6)
  const suffix = key.slice(-4)
  return `${prefix}••••${suffix}`
}

router.get('/', async (req, res, next) => {
  try {
    const s = await getSettings()
    res.json({
      ...s,
      claude_api_key: maskKey(s.claude_api_key),
      openai_api_key: maskKey(s.openai_api_key),
    })
  } catch (err) {
    next(err)
  }
})

router.put('/', async (req, res, next) => {
  try {
    await upsertSettings(req.body)
    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
```

- [ ] **Step 5: Register route in app.js**

Modify `server/src/app.js`:

```js
import express from 'express'
import cors from 'cors'
import programsRouter from './routes/programs.js'
import settingsRouter from './routes/settings.js'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/programs', programsRouter)
app.use('/api/settings', settingsRouter)

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd server && npx vitest run tests/routes/settings.test.js
```

Expected: PASS (2 describe blocks, 3 tests)

- [ ] **Step 7: Commit**

```bash
git add server/src/models/settings.js server/src/routes/settings.js server/src/app.js server/tests/routes/settings.test.js
git commit -m "feat: settings model and GET/PUT /api/settings route"
```

---

## Task 3: Applications Model + CRUD Routes

**Files:**
- Create: `server/src/models/applications.js`
- Create: `server/src/routes/applications.js`
- Create: `server/tests/routes/applications.test.js`
- Modify: `server/src/app.js`

- [ ] **Step 1: Write failing tests**

Create `server/tests/routes/applications.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import app from '../../src/app.js'

vi.mock('../../src/models/applications.js', () => ({
  createApplication: vi.fn().mockResolvedValue({ id: 'app-1', name: 'MY APP', status: 'pending' }),
  getAllApplications: vi.fn().mockResolvedValue([
    { id: 'app-1', name: 'MY APP', status: 'pending', program_count: '3' },
  ]),
  findApplicationById: vi.fn().mockResolvedValue({ id: 'app-1', name: 'MY APP', status: 'pending' }),
  getApplicationPrograms: vi.fn().mockResolvedValue([
    { id: 'p1', name: 'PROG1', status: 'analyzed' },
  ]),
  updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/services/batchService.js', () => ({
  startBatchAnalysis: vi.fn().mockResolvedValue(undefined),
}))

describe('POST /api/applications', () => {
  it('creates application and returns 201', async () => {
    const res = await request(app).post('/api/applications').send({ name: 'MY APP' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('app-1')
    expect(res.body.name).toBe('MY APP')
  })
})

describe('GET /api/applications', () => {
  it('returns list with programCount', async () => {
    const res = await request(app).get('/api/applications')
    expect(res.status).toBe(200)
    expect(res.body[0].programCount).toBe(3)
  })
})

describe('GET /api/applications/:id', () => {
  it('returns application with programs array', async () => {
    const res = await request(app).get('/api/applications/app-1')
    expect(res.status).toBe(200)
    expect(res.body.programs).toHaveLength(1)
    expect(res.body.programs[0].name).toBe('PROG1')
  })
})

describe('POST /api/applications/:id/analyze', () => {
  it('accepts mode and returns 202', async () => {
    const res = await request(app)
      .post('/api/applications/app-1/analyze')
      .send({ mode: 'sequential' })
    expect(res.status).toBe(202)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/routes/applications.test.js
```

Expected: FAIL — `Cannot find module '../../src/models/applications.js'`

- [ ] **Step 3: Create applications model**

Create `server/src/models/applications.js`:

```js
import pool from '../db/client.js'

export async function createApplication({ name }) {
  const { rows } = await pool.query(
    `INSERT INTO applications (name) VALUES ($1) RETURNING *`,
    [name]
  )
  return rows[0]
}

export async function getAllApplications() {
  const { rows } = await pool.query(`
    SELECT a.id, a.name, a.status, a.created_at, a.updated_at,
           COUNT(p.id) AS program_count
    FROM applications a
    LEFT JOIN programs p ON p.application_id = a.id
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `)
  return rows
}

export async function findApplicationById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM applications WHERE id = $1',
    [id]
  )
  return rows[0] || null
}

export async function getApplicationPrograms(applicationId) {
  const { rows } = await pool.query(
    'SELECT id, name, status FROM programs WHERE application_id = $1 ORDER BY created_at ASC',
    [applicationId]
  )
  return rows
}

export async function updateApplicationStatus(id, status) {
  await pool.query(
    'UPDATE applications SET status = $1, updated_at = NOW() WHERE id = $2',
    [status, id]
  )
}
```

- [ ] **Step 4: Create applications route (CRUD only, no analyze yet)**

Create `server/src/routes/applications.js`:

```js
import { Router } from 'express'
import {
  createApplication,
  getAllApplications,
  findApplicationById,
  getApplicationPrograms,
} from '../models/applications.js'
import { startBatchAnalysis } from '../services/batchService.js'

const router = Router()

// SSE emitter registry: applicationId → Set of response objects
export const appSseEmitters = new Map()

router.post('/', async (req, res, next) => {
  try {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    const app = await createApplication({ name: name.trim().toUpperCase() })
    res.status(201).json(app)
  } catch (err) {
    next(err)
  }
})

router.get('/', async (req, res, next) => {
  try {
    const apps = await getAllApplications()
    res.json(apps.map(a => ({ ...a, programCount: parseInt(a.program_count, 10) })))
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const programs = await getApplicationPrograms(req.params.id)
    res.json({ ...application, programs })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const { id } = req.params
  if (!appSseEmitters.has(id)) appSseEmitters.set(id, new Set())
  appSseEmitters.get(id).add(res)

  req.on('close', () => {
    const set = appSseEmitters.get(id)
    if (set) {
      set.delete(res)
      if (set.size === 0) appSseEmitters.delete(id)
    }
  })
})

router.post('/:id/analyze', async (req, res, next) => {
  try {
    const application = await findApplicationById(req.params.id)
    if (!application) return res.status(404).json({ error: 'Not found' })
    const mode = req.body.mode === 'parallel' ? 'parallel' : 'sequential'
    startBatchAnalysis(req.params.id, mode, appSseEmitters)
    res.status(202).json({ status: 'analyzing', mode })
  } catch (err) {
    next(err)
  }
})

export default router
```

- [ ] **Step 5: Create stub batchService so tests can import it**

Create `server/src/services/batchService.js`:

```js
export async function startBatchAnalysis(applicationId, mode, appSseEmitters) {
  // implemented in Task 5
}
```

- [ ] **Step 6: Register applications router in app.js**

Modify `server/src/app.js`:

```js
import express from 'express'
import cors from 'cors'
import programsRouter from './routes/programs.js'
import settingsRouter from './routes/settings.js'
import applicationsRouter from './routes/applications.js'

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/programs', programsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/applications', applicationsRouter)

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app
```

- [ ] **Step 7: Run tests — expect pass**

```bash
cd server && npx vitest run tests/routes/applications.test.js
```

Expected: PASS (4 describe blocks, 4 tests)

- [ ] **Step 8: Commit**

```bash
git add server/src/models/applications.js server/src/routes/applications.js server/src/services/batchService.js server/src/app.js server/tests/routes/applications.test.js
git commit -m "feat: applications model, CRUD routes, and SSE stream endpoint"
```

---

## Task 4: Update Providers to Accept Settings Config

**Files:**
- Modify: `server/src/ai/providers/base.js`
- Modify: `server/src/ai/providers/claude.js`
- Modify: `server/src/ai/providers/openai.js`

- [ ] **Step 1: Update base.js — getProvider accepts config**

Replace `server/src/ai/providers/base.js`:

```js
export class BaseProvider {
  async extractInterface(context) { throw new Error('Not implemented') }
  async extractRules(context) { throw new Error('Not implemented') }
  async generateDiagram(summary) { throw new Error('Not implemented') }
}

/**
 * @param {object} config - from settings table row
 * @param {string} config.ai_provider
 * @param {string|null} config.claude_api_key
 * @param {string|null} config.openai_api_key
 * @param {string} config.claude_model_interface
 * @param {string} config.claude_model_rules
 * @param {string} config.claude_model_diagram
 * @param {string} config.openai_model_interface
 * @param {string} config.openai_model_rules
 * @param {string} config.openai_model_diagram
 */
export async function getProvider(config = {}) {
  const provider = config.ai_provider || process.env.AI_PROVIDER || 'claude'
  if (provider === 'openai') {
    const { OpenAIProvider } = await import('./openai.js')
    return new OpenAIProvider(config)
  }
  const { ClaudeProvider } = await import('./claude.js')
  return new ClaudeProvider(config)
}
```

- [ ] **Step 2: Update claude.js — accept config in constructor**

Replace `server/src/ai/providers/claude.js`:

```js
import Anthropic from '@anthropic-ai/sdk'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class ClaudeProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.claude_api_key || process.env.ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
    this.modelInterface = config.claude_model_interface || process.env.CLAUDE_MODEL_INTERFACE || 'claude-sonnet-4-6'
    this.modelRules     = config.claude_model_rules    || process.env.CLAUDE_MODEL_RULES    || 'claude-haiku-4-5-20251001'
    this.modelDiagram   = config.claude_model_diagram  || process.env.CLAUDE_MODEL_DIAGRAM  || 'claude-haiku-4-5-20251001'
  }

  async #callClaude(prompt, maxTokens, model) {
    const message = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = message.content[0].text.trim()
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    return JSON.parse(cleaned)
  }

  async extractInterface(context) {
    return this.#callClaude(INTERFACE_PROMPT(context), 4096, this.modelInterface)
  }

  async extractRules(context) {
    const result = await this.#callClaude(RULES_PROMPT(context), 4096, this.modelRules)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary) {
    const message = await this.client.messages.create({
      model: this.modelDiagram,
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return message.content[0].text.trim()
  }
}
```

- [ ] **Step 3: Update openai.js — accept config in constructor**

Replace `server/src/ai/providers/openai.js`:

```js
import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import { INTERFACE_PROMPT, RULES_PROMPT, DIAGRAM_PROMPT } from '../prompts.js'

export class OpenAIProvider extends BaseProvider {
  constructor(config = {}) {
    super()
    const apiKey = config.openai_api_key || process.env.OPENAI_API_KEY
    this.client = new OpenAI({ apiKey })
    this.modelInterface = config.openai_model_interface || process.env.OPENAI_MODEL_INTERFACE || 'gpt-4o'
    this.modelRules     = config.openai_model_rules    || process.env.OPENAI_MODEL_RULES    || 'gpt-4o-mini'
    this.modelDiagram   = config.openai_model_diagram  || process.env.OPENAI_MODEL_DIAGRAM  || 'gpt-4o-mini'
  }

  async #callOpenAI(prompt, maxTokens, model) {
    const completion = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    return JSON.parse(completion.choices[0].message.content)
  }

  async extractInterface(context) {
    return this.#callOpenAI(INTERFACE_PROMPT(context), 4096, this.modelInterface)
  }

  async extractRules(context) {
    const result = await this.#callOpenAI(RULES_PROMPT(context), 4096, this.modelRules)
    return result.paragraphRules ?? []
  }

  async generateDiagram(summary) {
    const completion = await this.client.chat.completions.create({
      model: this.modelDiagram,
      max_tokens: 1024,
      messages: [{ role: 'user', content: DIAGRAM_PROMPT(summary) }],
    })
    return completion.choices[0].message.content.trim()
  }
}
```

- [ ] **Step 4: Rewrite analysisService.js**

Replace entire `server/src/services/analysisService.js` with:

```js
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCobol } from '../parser/cobolParser.js'
import { getProvider } from '../ai/providers/base.js'
import { runAnalysis } from '../ai/orchestrator.js'
import { logger } from '../logger.js'
import { getSettings } from '../models/settings.js'
import { createProgram, updateProgramStatus, findProgramByName, findProgramById, updateFilePath, deleteProgramById, deleteOrphanedPhantoms } from '../models/programs.js'
import { upsertAnalysis, updateDiagram, updateAnalysisFields } from '../models/programAnalysis.js'
import { insertChunks, getChunksByProgramId, updateChunkPurpose } from '../models/programChunks.js'
import { backfillEdgesForNewProgram, updateGraphAfterAnalysis } from './graphService.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UPLOADS_DIR = join(__dirname, '../../../uploads')

function makeEmit(programId, sseEmitters) {
  return (event, data) => {
    const emitters = sseEmitters.get(programId) || []
    for (const res of emitters) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
  }
}

// Core analysis logic — awaitable, accepts a pre-built emit function
async function runAnalysisCore(programId, programName, cobolText, savedChunks, emit, settings) {
  const provider = await getProvider(settings)
  try {
    const {
      description, flow_narrative, input_contract, output_contract,
      external_calls, db_tables, file_ops, sections, diagram,
    } = await runAnalysis({ cobolText, chunks: savedChunks, provider, emit, programName })

    await upsertAnalysis({ program_id: programId, description, call_parameters: [], external_calls: [], db_tables: [] })
    await updateAnalysisFields(programId, { external_calls, db_tables, file_ops, input_contract, output_contract, flow_narrative })
    if (diagram != null) await updateDiagram(programId, diagram)

    const chunkNameMap = new Map(savedChunks.map(c => [c.chunk_name, c.id]))
    for (const section of sections) {
      const chunkId = chunkNameMap.get(section.name)
      if (chunkId) await updateChunkPurpose(chunkId, section.purpose, section.rules ?? [])
    }

    await updateGraphAfterAnalysis(programId, external_calls)
    await updateProgramStatus(programId, 'analyzed', { analyzed_at: true })
    emit('done', { programId })
  } catch (err) {
    logger.error(programName, `Analysis failed: ${err.message}`)
    emit('progress', { stage: 'failed', message: `Analysis failed: ${err.message}` })
    await updateProgramStatus(programId, 'failed')
    emit('failed', { error: err.message })
  }
}

// Single-file upload: saves file, parses, and fire-and-forgets analysis (no applicationId)
// Batch upload: saves file and parses only — batchService handles analysis (with applicationId)
export async function uploadAndStartAnalysis(file, sseEmitters, applicationId = null) {
  mkdirSync(UPLOADS_DIR, { recursive: true })

  const cobolText = file.buffer.toString('utf8')
  const programName = file.originalname.replace(/\.cbl$/i, '').toUpperCase()

  let program = await findProgramByName(programName)
  if (!program) {
    program = await createProgram({ name: programName, status: 'analyzing', application_id: applicationId })
  } else {
    if (program.status === 'analyzing') {
      throw Object.assign(new Error('Already analyzing'), { status: 409 })
    }
    await updateProgramStatus(program.id, 'analyzing')
  }

  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  writeFileSync(filePath, cobolText)
  await updateFilePath(program.id, filePath)

  await backfillEdgesForNewProgram(program)

  const emit = makeEmit(program.id, sseEmitters)

  const t0 = Date.now()
  logger.start(programName, 'Parsing COBOL file...')
  emit('progress', { stage: 'parsing', message: 'Parsing COBOL file...' })
  const parsedChunks = parseCobol(cobolText)
  const savedChunks = await insertChunks(program.id, parsedChunks)
  const parseDuration = Date.now() - t0
  logger.done(programName, `Parsed ${savedChunks.length} chunks`, parseDuration)
  emit('progress', { stage: 'parsing', message: `Parsed ${savedChunks.length} chunks`, durationMs: parseDuration })

  // Single-file: start analysis immediately (fire-and-forget)
  if (!applicationId) {
    const settings = await getSettings()
    runAnalysisCore(program.id, programName, cobolText, savedChunks, emit, settings)
  }

  return program
}

// Called by batchService: reads saved file, runs analysis, emits on both program and app SSE
export async function runProgramFromFile(programId, programSseEmitters, settings, appSseEmitters = null) {
  const program = await findProgramById(programId)
  if (!program || !program.file_path) return

  await updateProgramStatus(programId, 'analyzing')
  const cobolText = readFileSync(program.file_path, 'utf8')
  const savedChunks = await getChunksByProgramId(programId)

  const programEmit = makeEmit(programId, programSseEmitters)
  const emit = (event, data) => {
    programEmit(event, data)
    if (appSseEmitters && program.application_id) {
      const appEmitters = appSseEmitters.get(program.application_id) || new Set()
      for (const res of appEmitters) {
        res.write(`event: ${event}\ndata: ${JSON.stringify({ programId, programName: program.name, ...data })}\n\n`)
      }
    }
  }

  await runAnalysisCore(programId, program.name, cobolText, savedChunks, emit, settings)
}

export async function reanalyze(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') throw Object.assign(new Error('Already analyzing'), { status: 409 })

  await updateProgramStatus(programId, 'analyzing')
  const filePath = join(UPLOADS_DIR, `${program.id}.cbl`)
  const cobolText = readFileSync(filePath, 'utf8')
  const existingChunks = await getChunksByProgramId(programId)
  const settings = await getSettings()
  const emit = makeEmit(programId, sseEmitters)

  runAnalysisCore(programId, program.name, cobolText, existingChunks, emit, settings)
}

export async function deleteProgram(programId, sseEmitters) {
  const program = await findProgramById(programId)
  if (!program) throw Object.assign(new Error('Not found'), { status: 404 })
  if (program.status === 'analyzing') {
    throw Object.assign(new Error('Cannot delete program while analyzing'), { status: 409 })
  }

  await deleteProgramById(programId)
  await deleteOrphanedPhantoms()

  if (program.file_path) {
    try {
      rmSync(program.file_path, { force: true })
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(program.name, `Failed to remove file: ${err.message}`)
      }
    }
  }

  const emitters = sseEmitters.get(programId)
  if (emitters) {
    for (const res of emitters) res.end()
    sseEmitters.delete(programId)
  }
}
```

Also update `models/programs.js` — `createProgram` must accept `application_id`:

```js
export async function createProgram({ name, file_path = null, status = 'pending', application_id = null }) {
  const { rows } = await pool.query(
    `INSERT INTO programs (name, file_path, status, application_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, file_path, status, application_id]
  )
  return rows[0]
}
```

- [ ] **Step 5: Update programs upload route to pass applicationId**

In `server/src/routes/programs.js`, update the upload handler:

```js
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const applicationId = req.body.application_id || null
    const program = await uploadAndStartAnalysis(req.file, sseEmitters, applicationId)
    res.status(202).json({ id: program.id, status: program.status })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})
```

- [ ] **Step 6: Run existing tests to verify nothing broke**

```bash
cd server && npx vitest run
```

Expected: all existing tests pass

- [ ] **Step 7: Commit**

```bash
git add server/src/ai/providers/base.js server/src/ai/providers/claude.js server/src/ai/providers/openai.js server/src/services/analysisService.js server/src/models/programs.js server/src/routes/programs.js
git commit -m "feat: providers accept settings config, analysisService passes settings through"
```

---

## Task 5: Batch Service

**Files:**
- Modify: `server/src/services/batchService.js`
- Create: `server/tests/services/batchService.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/tests/services/batchService.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startBatchAnalysis } from '../../src/services/batchService.js'

vi.mock('../../src/models/applications.js', () => ({
  getApplicationPrograms: vi.fn(),
  updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/models/settings.js', () => ({
  getSettings: vi.fn().mockResolvedValue({ ai_provider: 'claude' }),
}))
vi.mock('../../src/services/analysisService.js', () => ({
  runProgramFromFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../src/models/programs.js', () => ({
  findProgramById: vi.fn().mockImplementation((id) =>
    Promise.resolve({ id, name: `PROG${id}`, status: 'pending', file_path: `/uploads/${id}.cbl` })
  ),
}))

import { getApplicationPrograms } from '../../src/models/applications.js'
import { runProgramFromFile } from '../../src/services/analysisService.js'

describe('startBatchAnalysis — sequential', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes programs one at a time', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', name: 'PROG1', status: 'pending' },
      { id: 'p2', name: 'PROG2', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'sequential', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(2)
  })

  it('skips already-analyzed programs', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', name: 'PROG1', status: 'analyzed' },
      { id: 'p2', name: 'PROG2', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'sequential', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(1)
  })
})

describe('startBatchAnalysis — parallel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('processes up to 3 programs concurrently', async () => {
    getApplicationPrograms.mockResolvedValue([
      { id: 'p1', status: 'pending' },
      { id: 'p2', status: 'pending' },
      { id: 'p3', status: 'pending' },
      { id: 'p4', status: 'pending' },
    ])
    const emitters = new Map()
    await startBatchAnalysis('app-1', 'parallel', emitters)
    expect(runProgramFromFile).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run tests/services/batchService.test.js
```

Expected: FAIL — `runProgramFromFile is not a function`

- [ ] **Step 3: Verify runProgramFromFile is exported from analysisService**

`runProgramFromFile` was added in Task 4 Step 4. Confirm it exists in `server/src/services/analysisService.js` before proceeding.

```bash
grep -n "export async function runProgramFromFile" server/src/services/analysisService.js
```

Expected: line number printed (e.g. `45:export async function runProgramFromFile`)

- [ ] **Step 4: Implement batchService**

Replace `server/src/services/batchService.js`:

```js
import { getApplicationPrograms, updateApplicationStatus } from '../models/applications.js'
import { getSettings } from '../models/settings.js'
import { runProgramFromFile } from './analysisService.js'

const CONCURRENCY_LIMIT = 3

async function runWithConcurrencyLimit(tasks, limit) {
  const results = []
  const executing = new Set()

  for (const task of tasks) {
    const p = task().then(r => { executing.delete(p); return r })
    executing.add(p)
    results.push(p)
    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  return Promise.allSettled(results)
}

export async function startBatchAnalysis(applicationId, mode, appSseEmitters) {
  const [programs, settings] = await Promise.all([
    getApplicationPrograms(applicationId),
    getSettings(),
  ])

  const pending = programs.filter(p => p.status !== 'analyzed')
  if (pending.length === 0) return

  await updateApplicationStatus(applicationId, 'analyzing')

  const sseEmitters = new Map() // program-level emitters (not used for batch, app-level used instead)

  const run = async () => {
    if (mode === 'parallel') {
      const tasks = pending.map(p => () => runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters))
      await runWithConcurrencyLimit(tasks, CONCURRENCY_LIMIT)
    } else {
      for (const p of pending) {
        await runProgramFromFile(p.id, sseEmitters, settings, appSseEmitters)
      }
    }

    const updated = await getApplicationPrograms(applicationId)
    const allDone = updated.every(p => p.status === 'analyzed' || p.status === 'failed')
    const anyFailed = updated.some(p => p.status === 'failed')
    await updateApplicationStatus(applicationId, anyFailed ? 'failed' : allDone ? 'analyzed' : 'analyzing')

    // Emit done on app SSE
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: done\ndata: ${JSON.stringify({ applicationId })}\n\n`)
    }
  }

  run().catch(err => {
    updateApplicationStatus(applicationId, 'failed')
    const emitters = appSseEmitters.get(applicationId) || []
    for (const res of emitters) {
      res.write(`event: failed\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    }
  })
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
cd server && npx vitest run tests/services/batchService.test.js
```

Expected: PASS

- [ ] **Step 6: Run all tests**

```bash
cd server && npx vitest run
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add server/src/services/batchService.js server/src/services/analysisService.js server/tests/services/batchService.test.js
git commit -m "feat: batch service with sequential and parallel modes, concurrency limit 3"
```

---

## Task 6: CLI Scanner

**Files:**
- Create: `cli/scan.js`

- [ ] **Step 1: Create cli/scan.js**

```bash
mkdir -p cli
```

Create `cli/scan.js`:

```js
#!/usr/bin/env node
import { readdirSync, statSync, readFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { parseArgs } from 'util'

const { values } = parseArgs({
  options: {
    dir:     { type: 'string' },
    name:    { type: 'string' },
    mode:    { type: 'string', default: 'sequential' },
    'api-url': { type: 'string', default: 'http://localhost:3001' },
  },
})

const dir     = values['dir']
const name    = values['name'] || basename(dir || '.')
const mode    = values['mode']
const apiUrl  = values['api-url']

if (!dir) {
  console.error('Usage: node cli/scan.js --dir /path/to/cobol [--name "My App"] [--mode sequential|parallel]')
  process.exit(1)
}

function collectFiles(directory) {
  return readdirSync(directory)
    .filter(f => ['.cbl', '.cob'].includes(extname(f).toLowerCase()))
    .map(f => join(directory, f))
}

async function post(path, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function uploadFile(filePath, applicationId) {
  const form = new FormData()
  const content = readFileSync(filePath)
  form.append('file', new Blob([content]), basename(filePath))
  form.append('application_id', applicationId)

  const res = await fetch(`${apiUrl}/api/programs/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Upload ${filePath} failed: ${res.status}`)
  return res.json()
}

async function pollUntilDone(applicationId) {
  const delay = ms => new Promise(r => setTimeout(r, ms))
  while (true) {
    const res = await fetch(`${apiUrl}/api/applications/${applicationId}`)
    const app = await res.json()
    console.clear()
    console.log(`Application: ${app.name}  [${app.status}]\n`)
    for (const p of app.programs) {
      const bar = p.status === 'analyzed' ? '████████████' : p.status === 'analyzing' ? '██░░░░░░░░░░' : '░░░░░░░░░░░░'
      console.log(`  ${p.name.padEnd(20)} ${bar}  ${p.status}`)
    }
    if (app.status === 'analyzed' || app.status === 'failed') break
    await delay(2000)
  }
}

async function main() {
  const files = collectFiles(dir)
  if (files.length === 0) {
    console.error(`No .cbl or .cob files found in ${dir}`)
    process.exit(1)
  }

  console.log(`Found ${files.length} files in ${dir}`)
  const { id: applicationId } = await post('/api/applications', { name })
  console.log(`Created application: ${name} (${applicationId})`)

  console.log('Uploading files...')
  for (const filePath of files) {
    process.stdout.write(`  ${basename(filePath)}... `)
    await uploadFile(filePath, applicationId)
    console.log('done')
  }

  console.log(`\nStarting ${mode} analysis...`)
  await post(`/api/applications/${applicationId}/analyze`, { mode })

  await pollUntilDone(applicationId)
  console.log('\nDone.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
```

- [ ] **Step 2: Verify the file is executable and parses args correctly**

```bash
node cli/scan.js 2>&1
```

Expected: `Usage: node cli/scan.js --dir ...`

- [ ] **Step 3: Commit**

```bash
git add cli/scan.js
git commit -m "feat: CLI scanner for batch directory upload"
```

---

## Task 7: Frontend API Clients

**Files:**
- Create: `client/src/api/applications.js`
- Create: `client/src/api/settings.js`
- Modify: `client/src/api/programs.js`

- [ ] **Step 1: Create applications.js API client**

Create `client/src/api/applications.js`:

```js
const BASE = '/api/applications'

export async function createApplication(name) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to create application')
  return res.json()
}

export async function fetchApplication(id) {
  const res = await fetch(`${BASE}/${id}`)
  if (!res.ok) throw new Error('Failed to fetch application')
  return res.json()
}

export async function startApplicationAnalysis(id, mode) {
  const res = await fetch(`${BASE}/${id}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  if (!res.ok) throw new Error('Failed to start analysis')
  return res.json()
}
```

- [ ] **Step 2: Create settings.js API client**

Create `client/src/api/settings.js`:

```js
const BASE = '/api/settings'

export async function fetchSettings() {
  const res = await fetch(BASE)
  if (!res.ok) throw new Error('Failed to fetch settings')
  return res.json()
}

export async function saveSettings(fields) {
  const res = await fetch(BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) throw new Error('Failed to save settings')
}
```

- [ ] **Step 3: Update programs.js — uploadFile accepts applicationId**

Modify `client/src/api/programs.js`, update `uploadFile`:

```js
export async function uploadFile(file, applicationId = null) {
  const form = new FormData()
  form.append('file', file)
  if (applicationId) form.append('application_id', applicationId)
  const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
  if (!res.ok) throw new Error('Upload failed')
  return res.json()
}
```

- [ ] **Step 4: Commit**

```bash
git add client/src/api/applications.js client/src/api/settings.js client/src/api/programs.js
git commit -m "feat: frontend API clients for applications and settings"
```

---

## Task 8: useAppSSE Hook

**Files:**
- Create: `client/src/hooks/useAppSSE.js`

- [ ] **Step 1: Create useAppSSE.js**

Create `client/src/hooks/useAppSSE.js`:

```js
import { useEffect, useRef } from 'react'

export function useAppSSE(applicationId, onEvent) {
  const onEventRef = useRef(onEvent)
  useEffect(() => { onEventRef.current = onEvent })

  useEffect(() => {
    if (!applicationId) return
    const es = new EventSource(`/api/applications/${applicationId}/stream`)

    const handle = (e) => {
      try {
        onEventRef.current(e.type, JSON.parse(e.data))
      } catch (err) {
        console.error('App SSE parse error', err)
      }
    }

    ;['progress', 'done', 'failed'].forEach(event => es.addEventListener(event, handle))

    return () => es.close()
  }, [applicationId])
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useAppSSE.js
git commit -m "feat: useAppSSE hook for application-level SSE stream"
```

---

## Task 9: SettingsDrawer Component

**Files:**
- Create: `client/src/components/Settings/SettingsDrawer.jsx`

- [ ] **Step 1: Create SettingsDrawer.jsx**

Create `client/src/components/Settings/SettingsDrawer.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { fetchSettings, saveSettings } from '../../api/settings.js'

const inputStyle = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '6px 10px',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}

const labelStyle = { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }

export default function SettingsDrawer({ open, onClose }) {
  const [claudeKey, setClaudeKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [claudeEditing, setClaudeEditing] = useState(false)
  const [openaiEditing, setOpenaiEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    fetchSettings().then(s => {
      setClaudeKey(s.claude_api_key ?? '')
      setOpenaiKey(s.openai_api_key ?? '')
    })
  }, [open])

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const fields = {}
      if (claudeEditing) fields.claude_api_key = claudeKey
      if (openaiEditing) fields.openai_api_key = openaiKey
      await saveSettings(fields)
      setClaudeEditing(false)
      setOpenaiEditing(false)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 320, height: '100vh',
      background: '#1e293b', borderLeft: '1px solid #334155',
      padding: 24, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 20,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>Settings</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
      </div>

      <div>
        <label style={labelStyle}>Anthropic API Key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            type={claudeEditing ? 'text' : 'password'}
            value={claudeKey}
            onChange={e => setClaudeKey(e.target.value)}
            readOnly={!claudeEditing}
            placeholder="sk-ant-..."
          />
          <button
            onClick={() => setClaudeEditing(e => !e)}
            style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12 }}
          >
            {claudeEditing ? 'Lock' : 'Edit'}
          </button>
        </div>
      </div>

      <div>
        <label style={labelStyle}>OpenAI API Key</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            type={openaiEditing ? 'text' : 'password'}
            value={openaiKey}
            onChange={e => setOpenaiKey(e.target.value)}
            readOnly={!openaiEditing}
            placeholder="sk-..."
          />
          <button
            onClick={() => setOpenaiEditing(e => !e)}
            style={{ background: '#334155', border: 'none', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', padding: '6px 10px', fontSize: 12 }}
          >
            {openaiEditing ? 'Lock' : 'Edit'}
          </button>
        </div>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      <button
        onClick={handleSave}
        disabled={saving || (!claudeEditing && !openaiEditing)}
        style={{
          background: '#2563eb', color: 'white', border: 'none', borderRadius: 8,
          padding: '10px', fontWeight: 600, cursor: 'pointer', fontSize: 14,
          opacity: (saving || (!claudeEditing && !openaiEditing)) ? 0.5 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/Settings/SettingsDrawer.jsx
git commit -m "feat: SettingsDrawer component for API key management"
```

---

## Task 10: UploadControls + ConfirmationModal

**Files:**
- Create: `client/src/components/Upload/UploadControls.jsx`
- Create: `client/src/components/Upload/ConfirmationModal.jsx`

- [ ] **Step 1: Create ConfirmationModal.jsx**

Create `client/src/components/Upload/ConfirmationModal.jsx`:

```jsx
import { useState } from 'react'
import { createApplication, startApplicationAnalysis } from '../../api/applications.js'
import { uploadFile } from '../../api/programs.js'
import { saveSettings } from '../../api/settings.js'

const CLAUDE_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']
const OPENAI_MODELS_FULL = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
const OPENAI_MODELS_LITE = ['gpt-4o-mini', 'gpt-4o']

const inputStyle = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
  color: '#e2e8f0', padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box',
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const labelStyle = { color: '#94a3b8', fontSize: 12, marginBottom: 4, display: 'block' }
const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 12 }

export default function ConfirmationModal({ files, defaultName, onClose, onStarted }) {
  const [appName, setAppName] = useState(defaultName)
  const [provider, setProvider] = useState('claude')
  const [modelInterface, setModelInterface] = useState('claude-sonnet-4-6')
  const [modelRules, setModelRules] = useState('claude-haiku-4-5-20251001')
  const [modelDiagram, setModelDiagram] = useState('claude-haiku-4-5-20251001')
  const [mode, setMode] = useState('sequential')
  const [phase, setPhase] = useState('confirm') // 'confirm' | 'progress'
  const [progress, setProgress] = useState({}) // programId → status
  const [applicationId, setApplicationId] = useState(null)
  const [uploadStatus, setUploadStatus] = useState('') // status text during upload phase
  const [error, setError] = useState(null)

  function handleProviderChange(p) {
    setProvider(p)
    if (p === 'claude') {
      setModelInterface('claude-sonnet-4-6')
      setModelRules('claude-haiku-4-5-20251001')
      setModelDiagram('claude-haiku-4-5-20251001')
    } else {
      setModelInterface('gpt-4o')
      setModelRules('gpt-4o-mini')
      setModelDiagram('gpt-4o-mini')
    }
  }

  async function handleStart() {
    setError(null)
    setPhase('progress')

    try {
      // 1. Save settings
      const settingsFields = provider === 'claude'
        ? { ai_provider: 'claude', claude_model_interface: modelInterface, claude_model_rules: modelRules, claude_model_diagram: modelDiagram }
        : { ai_provider: 'openai', openai_model_interface: modelInterface, openai_model_rules: modelRules, openai_model_diagram: modelDiagram }
      await saveSettings(settingsFields)

      // 2. Create application
      const app = await createApplication(appName)
      setApplicationId(app.id)

      // 3. Upload files sequentially
      const initialProgress = {}
      for (const f of files) initialProgress[f.name] = 'pending'
      setProgress(initialProgress)

      for (const file of files) {
        setUploadStatus(`Uploading ${file.name}…`)
        await uploadFile(file, app.id)
        setProgress(prev => ({ ...prev, [file.name]: 'uploaded' }))
      }
      setUploadStatus('')

      // 4. Trigger analysis
      await startApplicationAnalysis(app.id, mode)

      // 5. Notify parent to subscribe to SSE
      onStarted(app.id)
    } catch (err) {
      setError(err.message)
      setPhase('confirm')
    }
  }

  const modelOptions = provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_FULL

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: '#1e293b', borderRadius: 12, padding: 28, width: 480,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 20, overflow: 'hidden',
      }}>
        {phase === 'confirm' ? (
          <>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>New Application</div>

            <div style={sectionStyle}>
              <label style={labelStyle}>Application Name</label>
              <input style={inputStyle} value={appName} onChange={e => setAppName(e.target.value)} />
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>{files.length} files found</label>
              <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {files.map(f => (
                  <span key={f.name} style={{ color: '#64748b', fontSize: 12 }}>{f.name}</span>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid #334155', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 600 }}>Analysis Settings</span>

              <div>
                <label style={labelStyle}>Provider</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['claude', 'openai'].map(p => (
                    <label key={p} style={{ color: '#e2e8f0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="provider" value={p} checked={provider === p} onChange={() => handleProviderChange(p)} />
                      {p === 'claude' ? 'Claude' : 'OpenAI'}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                {[
                  ['Interface', modelInterface, setModelInterface, modelOptions],
                  ['Rules', modelRules, setModelRules, provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_LITE],
                  ['Diagram', modelDiagram, setModelDiagram, provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS_LITE],
                ].map(([label, value, setter, options]) => (
                  <div key={label}>
                    <label style={labelStyle}>{label}</label>
                    <select style={selectStyle} value={value} onChange={e => setter(e.target.value)}>
                      {options.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                ))}
              </div>

              <div>
                <label style={labelStyle}>Mode</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  {['sequential', 'parallel'].map(m => (
                    <label key={m} style={{ color: '#e2e8f0', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                      {m === 'parallel' && <span style={{ color: '#64748b', fontSize: 11 }}>(faster, ~3x cost)</span>}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }}>
                Cancel
              </button>
              <button
                onClick={handleStart}
                disabled={!appName.trim()}
                style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 600, cursor: 'pointer', fontSize: 14, opacity: !appName.trim() ? 0.5 : 1 }}
              >
                Start Analysis
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 16 }}>{appName}</div>
            {uploadStatus && <div style={{ color: '#64748b', fontSize: 12 }}>{uploadStatus}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
              {files.map(f => {
                const status = progress[f.name] ?? 'pending'
                const bar = status === 'analyzed' ? '████████████' : status === 'analyzing' ? '██░░░░░░░░░░' : status === 'uploaded' ? '░░░░░░░░░░░░' : '░░░░░░░░░░░░'
                const color = status === 'analyzed' ? '#22c55e' : status === 'analyzing' ? '#3b82f6' : status === 'failed' ? '#ef4444' : '#64748b'
                return (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: '#e2e8f0', fontSize: 12, width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <span style={{ color, fontSize: 11, fontFamily: 'monospace' }}>{bar}</span>
                    <span style={{ color, fontSize: 11 }}>{status}</span>
                  </div>
                )
              })}
            </div>
            <button onClick={onClose} style={{ background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, alignSelf: 'flex-end' }}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create UploadControls.jsx**

Create `client/src/components/Upload/UploadControls.jsx`:

```jsx
import { useRef, useState } from 'react'
import { uploadFile } from '../../api/programs.js'
import ConfirmationModal from './ConfirmationModal.jsx'

const btnBase = {
  color: 'white', border: 'none', borderRadius: 8,
  padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

export default function UploadControls({ onUploaded, onBatchStarted }) {
  const fileRef = useRef(null)
  const folderRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [folderFiles, setFolderFiles] = useState(null)
  const [defaultName, setDefaultName] = useState('')

  async function handleSingleFile(e) {
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
      fileRef.current.value = ''
    }
  }

  function handleFolderSelect(e) {
    const files = Array.from(e.target.files).filter(f =>
      f.name.match(/\.(cbl|cob)$/i)
    )
    if (files.length === 0) return
    // Derive folder name from webkitRelativePath
    const folderName = files[0].webkitRelativePath.split('/')[0] || 'Application'
    setDefaultName(folderName.toUpperCase())
    setFolderFiles(files)
    folderRef.current.value = ''
  }

  return (
    <div style={{ position: 'absolute', bottom: 24, right: 24, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
      <input ref={fileRef} type="file" accept=".cbl,.cob" style={{ display: 'none' }} onChange={handleSingleFile} />
      <input ref={folderRef} type="file" webkitdirectory="" style={{ display: 'none' }} onChange={handleFolderSelect} />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => fileRef.current.click()}
          disabled={uploading}
          style={{ ...btnBase, background: '#334155', opacity: uploading ? 0.7 : 1 }}
        >
          {uploading ? 'Uploading…' : '+ Upload File'}
        </button>
        <button
          onClick={() => folderRef.current.click()}
          style={{ ...btnBase, background: '#2563eb' }}
        >
          + Upload Folder
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      {folderFiles && (
        <ConfirmationModal
          files={folderFiles}
          defaultName={defaultName}
          onClose={() => setFolderFiles(null)}
          onStarted={(appId) => {
            setFolderFiles(null)
            onBatchStarted(appId)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Upload/UploadControls.jsx client/src/components/Upload/ConfirmationModal.jsx
git commit -m "feat: UploadControls with folder picker and ConfirmationModal"
```

---

## Task 11: Wire Everything in App.jsx

**Files:**
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Update App.jsx**

Replace `client/src/App.jsx`:

```jsx
import { useState, useCallback } from 'react'
import ProgramGraph from './components/Graph/ProgramGraph.jsx'
import UploadControls from './components/Upload/UploadControls.jsx'
import DetailPanel from './components/Panel/DetailPanel.jsx'
import SettingsDrawer from './components/Settings/SettingsDrawer.jsx'
import { usePrograms } from './hooks/usePrograms.js'
import { useSSE } from './hooks/useSSE.js'
import { useAppSSE } from './hooks/useAppSSE.js'

export default function App() {
  const { nodes, edges, loading, refresh, markAnalyzing, markAnalyzed, onNodesChange } = usePrograms()
  const [selectedId, setSelectedId] = useState(null)
  const [analyzingId, setAnalyzingId] = useState(null)
  const [progressEvents, setProgressEvents] = useState([])
  const [progressForId, setProgressForId] = useState(null)
  const [panelRefreshTrigger, setPanelRefreshTrigger] = useState(0)
  const [batchAppId, setBatchAppId] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Single-file SSE (existing)
  useSSE(analyzingId, (event, data) => {
    if (event === 'progress') setProgressEvents(prev => [...prev, data])
    if (event === 'done') {
      markAnalyzed(analyzingId)
      setAnalyzingId(null)
      setProgressForId(null)
      setProgressEvents([])
      setPanelRefreshTrigger(t => t + 1)
      refresh()
    }
    if (event === 'failed') {
      setAnalyzingId(null)
      refresh()
    }
  })

  // Batch/application SSE
  useAppSSE(batchAppId, (event, data) => {
    if (event === 'progress' && data.programId) {
      if (data.stage === 'analyzing') markAnalyzing(data.programId)
    }
    if (event === 'done') {
      setBatchAppId(null)
      refresh()
    }
    if (event === 'failed') {
      setBatchAppId(null)
      refresh()
    }
  })

  const handleUploaded = useCallback(async (program) => {
    setAnalyzingId(program.id)
    setProgressForId(program.id)
    setProgressEvents([])
    await refresh()
    markAnalyzing(program.id)
  }, [markAnalyzing, refresh])

  const handleBatchStarted = useCallback(async (appId) => {
    setBatchAppId(appId)
    await refresh()
  }, [refresh])

  const handleDeleted = useCallback(async (programId) => {
    if (selectedId === programId) setSelectedId(null)
    if (analyzingId === programId) setAnalyzingId(null)
    if (progressForId === programId) {
      setProgressForId(null)
      setProgressEvents([])
    }
    await refresh()
  }, [selectedId, analyzingId, progressForId, refresh])

  if (loading) return <div style={{ color: '#e2e8f0', padding: 20 }}>Loading…</div>

  return (
    <div style={{ width: '100%', height: '100%', background: '#0f172a', position: 'relative' }}>
      <ProgramGraph
        nodes={nodes}
        edges={edges}
        onNodeClick={(node) => { if (!node.data.isPhantom) setSelectedId(node.id) }}
        onNodesChange={onNodesChange}
      />

      {/* Settings gear icon */}
      <button
        onClick={() => setSettingsOpen(true)}
        style={{
          position: 'absolute', top: 16, right: 16, zIndex: 10,
          background: '#1e293b', border: '1px solid #334155', borderRadius: 8,
          color: '#94a3b8', fontSize: 18, width: 36, height: 36, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Settings"
      >
        ⚙
      </button>

      <UploadControls onUploaded={handleUploaded} onBatchStarted={handleBatchStarted} />

      <DetailPanel
        programId={selectedId}
        progressForId={progressForId}
        progressEvents={progressEvents}
        refreshTrigger={panelRefreshTrigger}
        onClose={() => setSelectedId(null)}
        onNavigate={(id) => setSelectedId(id)}
        onDeleted={handleDeleted}
      />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat: wire UploadControls, SettingsDrawer, and batch SSE into App"
```

---

## Task 12: Manual Smoke Test

- [ ] **Step 1: Start the server**

```bash
cd server && node server.js
```

Expected: `Server running on port 3001`

- [ ] **Step 2: Verify settings endpoint works**

```bash
curl http://localhost:3001/api/settings
```

Expected: JSON with default model values and null API keys.

- [ ] **Step 3: Set an API key via PUT**

```bash
curl -X PUT http://localhost:3001/api/settings \
  -H "Content-Type: application/json" \
  -d '{"claude_api_key": "sk-ant-test-key-1234"}'
```

Expected: HTTP 204.

- [ ] **Step 4: Verify key is masked in GET**

```bash
curl http://localhost:3001/api/settings
```

Expected: `claude_api_key` shows masked value like `"sk-ant-••••1234"`.

- [ ] **Step 5: Create an application**

```bash
curl -X POST http://localhost:3001/api/applications \
  -H "Content-Type: application/json" \
  -d '{"name": "TEST APP"}'
```

Expected: `{"id":"...","name":"TEST APP","status":"pending"}`

- [ ] **Step 6: Start the client and verify UI**

```bash
cd client && npm run dev
```

Open `http://localhost:5173`. Verify:
- ⚙ gear icon appears top-right
- Two upload buttons appear bottom-right: `+ Upload File` and `+ Upload Folder`
- Clicking ⚙ opens the Settings drawer
- Clicking `+ Upload Folder` opens folder picker

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat: applications and batch upload complete"
```

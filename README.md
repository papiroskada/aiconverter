# AI COBOL Converter

Analyzes entire COBOL applications using AI. Upload individual files or whole folders, see the call graph, and get descriptions, flow narratives, data contracts, and Mermaid diagrams for each program.

---

## Prerequisites

- Node.js 20+
- PostgreSQL 14+

---

## Setup

### 1. Clone and install dependencies

```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Create the database

```bash
# Connect to PostgreSQL and create the database
psql -U postgres -c "CREATE DATABASE cobol_converter;"
```

### 3. Configure environment variables

```bash
cd server
cp .env.example .env
```

Open `server/.env` and set your API key:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cobol_converter
AI_PROVIDER=claude          # or: openai

ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...     # only needed if AI_PROVIDER=openai

PORT=3001
```

> API keys can also be set later through the Settings drawer in the UI.

### 4. Run database migration

```bash
cd server
npm run migrate
```

Expected output: `Migration complete`

---

## Running the app

Open two terminals:

**Terminal 1 — Server:**
```bash
cd server
npm run dev
```

Expected: `Server running on http://localhost:3001`

**Terminal 2 — Client:**
```bash
cd client
npm run dev
```

Expected: `Local: http://localhost:5173`

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Using the UI

### Upload a single file
Click **+ Upload File** (bottom right) and select a `.cbl` or `.cob` file. Analysis starts immediately. Click a node in the graph to see the results in the side panel.

### Upload a whole application (folder)
Click **+ Upload Folder** and select a directory containing COBOL files. A modal appears where you can:
- Set the application name
- Choose the AI provider and models
- Choose **Sequential** (one at a time) or **Parallel** (up to 3 at once, ~3× faster)

Click **Start Analysis**. A batch badge appears at the top while analysis runs. Click **Stop** at any time to cancel — programs reset to `pending` and can be re-run.

### Settings
Click the **⚙** gear icon (top right) to open the Settings drawer. Enter your API keys here if you did not set them in `.env`.

---

## CLI scanner

Scan a local directory and start analysis without opening the browser:

```bash
node cli/scan.js --dir /path/to/cobol/project --name "MY APP" --mode sequential
```

Options:

| Flag | Description | Default |
|------|-------------|---------|
| `--dir` | Path to directory with `.cbl`/`.cob` files | (required) |
| `--name` | Application name | Folder name |
| `--mode` | `sequential` or `parallel` | `sequential` |
| `--api-url` | Server base URL | `http://localhost:3001` |

The CLI polls the server and prints a live progress table until analysis finishes.

---

## Running tests

```bash
cd server
npm test
```

---

## Project structure

```
server/          Express + PostgreSQL backend
  src/
    ai/          AI providers (Claude, OpenAI) and orchestrator
    models/      Database access (programs, applications, settings, …)
    routes/      REST API routes
    services/    Analysis and batch orchestration
    parser/      COBOL parser (paragraphs, SQL, linkage sections)
    db/          Schema and migration

client/          React 18 + Vite frontend
  src/
    api/         Fetch wrappers
    components/  Graph, Panel, Upload, Settings
    hooks/       usePrograms, useSSE, useAppSSE

cli/             CLI scanner script
```

---

## Environment variables reference

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/cobol_converter` |
| `AI_PROVIDER` | `claude` or `openai` | `claude` |
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `OPENAI_API_KEY` | OpenAI API key | — |
| `PORT` | Server port | `3001` |
| `CLAUDE_MODEL_INTERFACE` | Model for interface extraction | `claude-sonnet-4-6` |
| `CLAUDE_MODEL_RULES` | Model for rules extraction | `claude-haiku-4-5-20251001` |
| `CLAUDE_MODEL_DIAGRAM` | Model for diagram generation | `claude-haiku-4-5-20251001` |
| `OPENAI_MODEL_INTERFACE` | Model for interface extraction | `gpt-4o` |
| `OPENAI_MODEL_RULES` | Model for rules extraction | `gpt-4o-mini` |
| `OPENAI_MODEL_DIAGRAM` | Model for diagram generation | `gpt-4o-mini` |

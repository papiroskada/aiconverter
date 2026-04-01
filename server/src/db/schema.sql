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

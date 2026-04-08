-- Create types if they don't already exist (safe for re-runs)
DO $$ BEGIN CREATE TYPE program_status AS ENUM ('pending', 'analyzing', 'analyzed', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE chunk_type AS ENUM ('data_summary', 'paragraph', 'sub_paragraph'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE chunk_status AS ENUM ('pending', 'done', 'failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;

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
  openai_model_interface TEXT NOT NULL DEFAULT 'gpt-4o',
  openai_model_rules     TEXT NOT NULL DEFAULT 'gpt-4o-mini',
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
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  business_purpose      TEXT,
  input_contract        TEXT,
  output_contract       TEXT,
  entry_points          JSONB NOT NULL DEFAULT '[]',
  error_catalog         JSONB NOT NULL DEFAULT '[]',
  external_dependencies JSONB NOT NULL DEFAULT '[]',
  db_tables             JSONB NOT NULL DEFAULT '[]',
  file_ops              JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
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

-- Migrate program_analysis to business-logic schema
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS business_purpose      TEXT,
  ADD COLUMN IF NOT EXISTS entry_points          JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS error_catalog         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS external_dependencies JSONB NOT NULL DEFAULT '[]';

ALTER TABLE program_analysis
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS flow_narrative,
  DROP COLUMN IF EXISTS call_parameters,
  DROP COLUMN IF EXISTS external_calls,
  DROP COLUMN IF EXISTS diagram;

-- Restore columns lost if the old DROP TYPE ... CASCADE was run
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS status program_status NOT NULL DEFAULT 'pending';

ALTER TABLE program_chunks
  ADD COLUMN IF NOT EXISTS chunk_type chunk_type NOT NULL DEFAULT 'paragraph',
  ADD COLUMN IF NOT EXISTS status chunk_status NOT NULL DEFAULT 'pending';

-- Remove obsolete diagram model settings
ALTER TABLE settings
  DROP COLUMN IF EXISTS claude_model_diagram,
  DROP COLUMN IF EXISTS openai_model_diagram;

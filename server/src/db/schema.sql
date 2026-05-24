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

-- C parser support: new chunk types and program metadata
ALTER TYPE chunk_type ADD VALUE IF NOT EXISTS 'function';
ALTER TYPE chunk_type ADD VALUE IF NOT EXISTS 'entry_point';

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS file_type         TEXT NOT NULL DEFAULT 'cobol',
  ADD COLUMN IF NOT EXISTS companion_content TEXT;

-- Analysis data enrichment: pre-dispatch list, model metadata, two-step flag
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS pre_dispatch       JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS analysis_model     TEXT,
  ADD COLUMN IF NOT EXISTS analysis_two_step  BOOLEAN;

-- Per-entry-point user flags
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS flags JSONB NOT NULL DEFAULT '{}';

-- Structural analysis cache: avoids re-running regex extraction on re-analysis
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS structural_cache JSONB;

-- Inter-program call dependency table (from structural extraction, not AI-filtered)
CREATE TABLE IF NOT EXISTS program_calls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caller_program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  callee_name       TEXT NOT NULL,
  callee_program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  call_context      TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (caller_program_id, callee_name)
);

-- Code generation target patterns and source mode
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS code_db_read           TEXT,
  ADD COLUMN IF NOT EXISTS code_db_write          TEXT,
  ADD COLUMN IF NOT EXISTS code_error_convention  TEXT,
  ADD COLUMN IF NOT EXISTS code_external_call     TEXT,
  ADD COLUMN IF NOT EXISTS code_language          TEXT NOT NULL DEFAULT 'typescript',
  ADD COLUMN IF NOT EXISTS code_source_mode       TEXT NOT NULL DEFAULT 'with_source';

-- Cache last generated code per program
ALTER TABLE program_analysis
  ADD COLUMN IF NOT EXISTS generated_code     TEXT,
  ADD COLUMN IF NOT EXISTS generated_tests    TEXT,
  ADD COLUMN IF NOT EXISTS generated_language TEXT,
  ADD COLUMN IF NOT EXISTS generated_notes    TEXT,
  ADD COLUMN IF NOT EXISTS generated_at       TIMESTAMP;

-- ── Auth & RBAC ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'developer', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   UUID,
  ip            TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Encrypted API keys — separate from plaintext settings columns
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS claude_api_key_enc TEXT,
  ADD COLUMN IF NOT EXISTS openai_api_key_enc TEXT;

-- Per-user per-entry-point review flags
CREATE TABLE IF NOT EXISTS program_flags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  condition  TEXT NOT NULL,
  flag       TEXT NOT NULL CHECK (flag IN ('approved', 'warning', 'deprecated')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, user_id, condition)
);

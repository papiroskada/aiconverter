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

ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS diagram TEXT;
ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS input_contract TEXT;
ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS output_contract TEXT;
ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS flow_narrative TEXT;
ALTER TABLE program_analysis ADD COLUMN IF NOT EXISTS file_ops JSONB NOT NULL DEFAULT '[]';

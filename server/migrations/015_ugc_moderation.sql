-- backpack_ragnarok -- server/migrations/015_ugc_moderation.sql
-- REQ-0144: UGC skin moderation gates -- automated verdict + stored evidence +
-- operator override (appeal) path. Three tables, consumed ONLY through
-- server/storage.cjs (via server/storage_moderation.cjs), the project's single
-- persistence chokepoint. Mirrors the render_inspections relational profile
-- (008): a genuine relational schema (FKs, UNIQUE evidence key, jsonb gate
-- evidence), NOT the "id + doc verbatim jsonb" profile tables.
--
-- Apply as the postgres superuser (same invocation as 001..014):
--   docker exec -i supabase-db psql -U postgres < server/migrations/015_ugc_moderation.sql
--
-- Idempotent: guarded CREATE TABLE / CREATE INDEX IF NOT EXISTS + re-runnable
-- GRANTs throughout.

-- One row per distinct submitted bitmap (dedup by content hash).
CREATE TABLE IF NOT EXISTS ugc_submissions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  input_sha256  text NOT NULL UNIQUE,
  kind          text NOT NULL DEFAULT 'bpskin',
  source        text,
  byte_size     integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per automated verdict. gates holds the full per-gate evidence array
-- (gate_id, gate_version, verdict, score, threshold, model, model_sha256,
-- evidence) exactly as the tools/moderation_gate.py pipeline emits it. The
-- UNIQUE key makes re-recording an identical verdict idempotent.
CREATE TABLE IF NOT EXISTS moderation_verdicts (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id    bigint NOT NULL REFERENCES ugc_submissions(id) ON DELETE CASCADE,
  pipeline_version text NOT NULL,
  verdict          text NOT NULL,
  verdict_sha256   text NOT NULL,
  input_sha256     text NOT NULL,
  gates            jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id, pipeline_version, verdict_sha256)
);
CREATE INDEX IF NOT EXISTS moderation_verdicts_submission_idx ON moderation_verdicts (submission_id);

-- The reject/appeal override path: a human operator UPHOLDs or OVERRIDEs an
-- automated verdict, with a recorded reason. Append-only audit trail.
CREATE TABLE IF NOT EXISTS moderation_overrides (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  verdict_id  bigint NOT NULL REFERENCES moderation_verdicts(id) ON DELETE CASCADE,
  operator    text NOT NULL,
  action      text NOT NULL,   -- UPHOLD | OVERRIDE_APPROVE | OVERRIDE_REJECT
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_overrides_verdict_idx ON moderation_overrides (verdict_id);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON ugc_submissions      TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON moderation_verdicts  TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON moderation_overrides TO backpack;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO backpack;

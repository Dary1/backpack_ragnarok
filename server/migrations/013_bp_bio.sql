-- backpack_ragnarok -- server/migrations/013_bp_bio.sql
-- REQ-0060: Pack Biography ledger (per BP instance). Mirrors
-- 011_sealed_seeds.sql: one jsonb doc column keyed by the BP instance uid
-- (canvas bps[].id === sim bpId === gacha-minted uid).
--   docker exec -i supabase-db psql -U postgres < server/migrations/013_bp_bio.sql
-- Idempotent. The 'backpack' role is created in 001_init.sql (runs first).
CREATE TABLE IF NOT EXISTS bp_bio (
  bp_uid     text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON bp_bio TO backpack;

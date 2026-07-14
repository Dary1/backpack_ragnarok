-- backpack_ragnarok -- server/migrations/012_starter_claims.sql
-- REQ-0051: schema for the starter-unit claim ledger (per-player regrant
-- once-per-starter-unit gate). Mirrors 006_dismantle.sql exactly: one jsonb doc per
-- player holding the entire ledger verbatim (id + doc in, id + doc out).
--
-- Apply as the postgres superuser (same invocation as 001..011):
--   docker exec -i supabase-db psql -U postgres < server/migrations/012_starter_claims.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS starter_claims (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON starter_claims TO backpack;

-- backpack_ragnarok -- server/migrations/011_starter_claims.sql
-- REQ-0051: schema for the starter-job claim ledger (per-player regrant
-- once-per-job gate). Mirrors 006_dismantle.sql exactly: one jsonb doc per
-- player holding the entire ledger verbatim (id + doc in, id + doc out).
--
-- Apply as the postgres superuser (same invocation as 001..010):
--   docker exec -i supabase-db psql -U postgres < server/migrations/011_starter_claims.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS starter_claims (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON starter_claims TO backpack;

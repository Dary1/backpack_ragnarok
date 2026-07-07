-- backpack_ragnarok -- server/migrations/006_dismantle.sql
-- REQ-0063: schema for the dismantle ledger (per-player, permanent
-- per-Dex-entry 分解値 counts). Mirrors 001_init.sql's profiles table
-- shape exactly (one jsonb `doc` column holding the entire ledger doc
-- verbatim, "id + doc in, id + doc out") -- the ledger is a single
-- whole-doc-per-player blob, not a per-item-row table the way
-- warehouse_items is, since suppression math (server/services/
-- dismantle.cjs) always reads a player's ENTIRE counts map at once.
--
-- Apply as the postgres superuser (same invocation as 001..005):
--   docker exec -i supabase-db psql -U postgres < server/migrations/006_dismantle.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS dismantle_ledger (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON dismantle_ledger TO backpack;

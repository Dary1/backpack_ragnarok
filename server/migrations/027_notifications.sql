-- backpack_ragnarok -- server/migrations/027_notifications.sql
-- REQ-0327: per-player notification feed. Mirrors 013_bp_bio.sql: one
-- jsonb doc column keyed by the player id, carrying { schema_version,
-- playerId, seq, entries[] }. The files backend is the one exercised by
-- the api_test suite / the storage chokepoint; this table gives the pg
-- backend byte-for-byte parity with every sibling store.
--   docker exec -i supabase-db psql -U postgres < server/migrations/027_notifications.sql
-- Idempotent. The 'backpack' role is created in 001_init.sql (runs first).
CREATE TABLE IF NOT EXISTS notifications (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO backpack;

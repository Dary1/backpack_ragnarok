-- backpack_ragnarok -- server/migrations/014_bp_skin.sql
-- REQ-0126: per-BP-instance cosmetic skin slot. Mirrors 013_bp_bio.sql: one
-- jsonb doc keyed by the BP instance uid (canvas bps[].id === sim bpId ===
-- gacha-minted uid). A slot doc is { bp_uid, skin_id, updated_at }; skin_id
-- null (or a missing row) resolves to the neutral default -- absence never
-- blocks rendering.
--   docker exec -i supabase-db psql -U postgres < server/migrations/014_bp_skin.sql
-- Idempotent. The 'backpack' role is created in 001_init.sql (runs first).
CREATE TABLE IF NOT EXISTS bp_skin (
  bp_uid     text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON bp_skin TO backpack;

-- backpack_ragnarok -- server/migrations/024_skin_prefs.sql
-- REQ-0266: schema for the per-PROFILE skin selection (which unit_skin def a
-- player has picked for each of their units, per slot). Mirrors
-- 012_starter_claims.sql exactly: one jsonb doc per player holding the entire
-- selection verbatim (id + doc in, id + doc out).
--
-- The doc is { player_id, unit: {<unitId>: <skinId>}, bpskin: {<unitId>:
-- <skinId>}, updated_at }. ABSENCE IS THE DEFAULT (REQ-0266 D5): no migration
-- ever writes a row for an existing profile -- a missing row, a missing map, a
-- missing unit key and a null value all resolve to the def-declared default at
-- READ time. This is the house convention (REQ-0141 state.guide, REQ-0126
-- decision 5, REQ-0042 inv.pages[].tms, REQ-0037 dev_mode, REQ-0118c authId).
--
-- It lives in its OWN root rather than in the profile canvas because
-- writeProfile() replaces `canvas` WHOLESALE on every PUT -- the same reason
-- bp_bio (013) and bp_skin (014) are sibling roots. Unlike those two this one
-- is keyed by PLAYER, not by BP instance, hence the 012 template.
--
-- Apply as the postgres superuser (same invocation as 001..023):
--   docker exec -i supabase-db psql -U postgres < server/migrations/024_skin_prefs.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).
-- The 'backpack' role is created in 001_init.sql (runs first).

CREATE TABLE IF NOT EXISTS skin_prefs (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON skin_prefs TO backpack;

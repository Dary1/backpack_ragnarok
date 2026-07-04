-- backpack_ragnarok -- server/migrations/002_schedule.sql
-- REQ-0036 P1-B: schema for the Dungeon Schedule service (rooms, runs,
-- warehouse). Mirrors 001_init.sql's conventions exactly: one jsonb `doc`
-- column per table holding the entire document verbatim (same
-- "id + doc in, id + doc out" shape storage.cjs's profiles/players
-- tables already use), so schedule.cjs's pg-mode read/write path stays a
-- thin translation layer, same as storage.cjs.
--
-- Three tables:
--   schedule_rooms(room_id, doc, updated_at)     -- one row per room
--   schedule_runs(run_id, room_id, doc, updated_at) -- one row per run
--     (room_id kept as a real column, not just inside doc, so "list runs
--     for room X" can use a plain indexed WHERE rather than a jsonb
--     containment query)
--   warehouse_items(item_uid, player_id, doc, harvested_at)
--     -- one row per warehoused item instance. player_id is a real column
--     (same reasoning: "list this player's warehouse" is the hot path,
--     needs an index) and harvested_at is ALSO a real column (not just
--     inside doc) so the TTL sweep's WHERE harvested_at < now() - 7d can
--     use a plain btree index instead of scanning + parsing jsonb per row.
--
-- Apply as the postgres superuser (see server/README.md "Postgres
-- backend" section for 001_init.sql's exact invocation pattern):
--   docker exec -i supabase-db psql -U postgres < server/migrations/002_schedule.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS schedule_rooms (
  room_id    text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_runs (
  run_id     text PRIMARY KEY,
  room_id    text NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_runs_room_id_idx ON schedule_runs (room_id);

CREATE TABLE IF NOT EXISTS warehouse_items (
  item_uid     text PRIMARY KEY,
  player_id    text NOT NULL,
  doc          jsonb NOT NULL,
  harvested_at timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS warehouse_items_player_id_idx ON warehouse_items (player_id);
CREATE INDEX IF NOT EXISTS warehouse_items_harvested_at_idx ON warehouse_items (harvested_at);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql (created
-- there; this migration only needs to grant it access to the 3 new
-- tables -- CREATE ROLE is NOT repeated here since 001_init.sql already
-- guards it with a DO block and always runs first).
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_rooms TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_runs TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON warehouse_items TO backpack;
-- No sequences to grant (all PKs are caller-supplied text ids, matching
-- 001_init.sql's profiles/players convention).

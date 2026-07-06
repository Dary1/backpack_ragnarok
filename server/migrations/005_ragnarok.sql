-- backpack_ragnarok -- server/migrations/005_ragnarok.sql
-- REQ-0066: schema for the Hall of Ragnarok (einherjar records + the
-- Eternal Order's daily-dawn rebuild cache). Mirrors 002..004's
-- conventions exactly: one jsonb `doc` column per table holding the
-- entire document verbatim ("id + doc in, id + doc out"), plus the
-- columns hot-path queries need as real indexed columns. Every id is
-- NAMESPACE-prefixed by server/storage.cjs (sha256(REPO_ROOT) slice),
-- same test-isolation scheme as every other table.
--
-- Two tables (see server/storage.cjs's ragnarok roots):
--   ragnarok_einherjar(einherjar_id, player_id, doc, devoted_at)
--     -- one row per Devotion rite; IMMUTABLE once the rite finalizes
--     (rite.state 'done' in the doc; REQ-0068 later appends perSeason
--     戦果 entries -- an UPDATE of the doc, never a delete). player_id
--     is a real column for the per-player hall listing; devoted_at for
--     chronology.
--   ragnarok_order_cache(cache_id, doc)
--     -- ONE row per namespace (cache_id = '<ns>:order'): the Eternal
--     Order standings, lazily rebuilt at the first read past each dawn
--     boundary (services/ragnarok.cjs getOrderDoc). A cache, not a
--     source of truth -- safe to TRUNCATE at any time (the next read
--     rebuilds from ragnarok_einherjar).
--
-- Apply as the postgres superuser (same invocation as 001..004):
--   docker exec -i supabase-db psql -U postgres < server/migrations/005_ragnarok.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS ragnarok_einherjar (
  einherjar_id text PRIMARY KEY,
  player_id    text NOT NULL,
  doc          jsonb NOT NULL,
  devoted_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ragnarok_einherjar_player_id_idx ON ragnarok_einherjar (player_id);
CREATE INDEX IF NOT EXISTS ragnarok_einherjar_devoted_at_idx ON ragnarok_einherjar (devoted_at);

CREATE TABLE IF NOT EXISTS ragnarok_order_cache (
  cache_id   text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON ragnarok_einherjar TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON ragnarok_order_cache TO backpack;
-- No sequences to grant (all PKs are caller-supplied text ids).

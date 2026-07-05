-- backpack_ragnarok -- server/migrations/003_gacha.sql
-- REQ-0042: schema for the Workshop gacha's two-phase pending-roll store.
-- Mirrors 002_schedule.sql's warehouse_items table shape exactly (one
-- jsonb `doc` column holding the whole pending-roll document verbatim),
-- kept as its OWN table rather than folded into warehouse_items because
-- the shapes genuinely differ: a pending gacha roll carries `cost` +
-- the full rolled BP definition (shape/linker/hpMax) and has no
-- harvestedAt/expiresAt/sourceRoomId/sourceRunId/TTL-sweep semantics --
-- see server/schedule.cjs's grantGachaPending()/finalizeGachaForCanvas()
-- module comment for the full two-phase design (mirrors warehouse
-- claim's claiming->finalize-on-PUT->lazy-revert pattern, reusing the
-- SAME finalize/revert MECHANISM but against this dedicated store since
-- the finalize condition itself is stricter: balance-delta AND
-- uid-presence, not uid-presence alone).
--
-- Apply as the postgres superuser (same invocation as 001_init.sql/
-- 002_schedule.sql):
--   docker exec -i supabase-db psql -U postgres < server/migrations/003_gacha.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS gacha_pending (
  roll_uid     text PRIMARY KEY,
  player_id    text NOT NULL,
  doc          jsonb NOT NULL,
  rolled_at    timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gacha_pending_player_id_idx ON gacha_pending (player_id);
CREATE INDEX IF NOT EXISTS gacha_pending_rolled_at_idx ON gacha_pending (rolled_at);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON gacha_pending TO backpack;

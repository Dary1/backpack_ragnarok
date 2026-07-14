-- backpack_ragnarok -- server/migrations/011_sealed_seeds.sql
-- REQ-0058: schema for the Sealed Seed Share service. Mirrors
-- 002_schedule.sql's conventions exactly: one jsonb `doc` column per
-- table holding the entire document verbatim (same "id + doc in, id +
-- doc out" shape storage.cjs's rooms/runs/profiles tables already use),
-- so storage/seals.cjs's pg-mode read/write path stays a thin translation
-- layer.
--
-- Two tables:
--   sealed_seeds(seal_id, doc, created_at) -- one row per minted seal.
--     doc holds the frozen tuple {sealId, createdBy, dungeonId,
--     dungeonType, level, genSeed, affixes, createdAt} verbatim.
--   seal_runs(seal_id, player_id, doc, updated_at) -- the participant-run
--     registry, keyed (seal_id, player_id) -- one row per participant per
--     seal (enforces the "each participant runs a given sealId once"
--     invariant at the storage layer via the composite PK; seal_id kept
--     as its own column + index so "list every participant of seal X" is
--     a plain indexed WHERE rather than a jsonb-containment scan).
--
-- Apply as the postgres superuser (see server/README.md "Postgres
-- backend" section for the exact invocation pattern):
--   docker exec -i supabase-db psql -U postgres < server/migrations/011_sealed_seeds.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout).

CREATE TABLE IF NOT EXISTS sealed_seeds (
  seal_id    text PRIMARY KEY,
  doc        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seal_runs (
  seal_id    text NOT NULL,
  player_id  text NOT NULL,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seal_id, player_id)
);
CREATE INDEX IF NOT EXISTS seal_runs_seal_id_idx ON seal_runs (seal_id);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql (created
-- there; this migration only grants it access to the 2 new tables --
-- CREATE ROLE is NOT repeated here since 001_init.sql already guards it
-- with a DO block and always runs first).
GRANT SELECT, INSERT, UPDATE, DELETE ON sealed_seeds TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON seal_runs TO backpack;

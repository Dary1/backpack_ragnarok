-- backpack_ragnarok — server/migrations/001_init.sql
-- REQ-0040: initial Postgres schema for storage.cjs's pg backend.
--
-- Two tables, mirroring the two JSON-file persistence roots storage.cjs
-- already owns (data/profiles/<id>.json and data/players/<id>.json):
--   profiles(player_id, doc, updated_at)
--   players(player_id, doc, created_at)
-- Both store the ENTIRE existing JSON document verbatim in a jsonb
-- column (`doc`) -- this is a deliberate "same shape, new substrate"
-- migration: no column-per-field redesign, so storage.cjs's pg-mode
-- read/write path stays a thin translation layer (id + doc in, id + doc
-- out) and tool_export_files.cjs can dump `doc` straight back out as a
-- byte-for-byte-equivalent JSON file.
--
-- Apply as the postgres superuser (documented in server/README.md):
--   docker exec -i supabase-db psql -U postgres < server/migrations/001_init.sql
--
-- Idempotent: safe to re-run (CREATE ... IF NOT EXISTS throughout;
-- role-creation guarded by a DO block since Postgres has no
-- CREATE ROLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS profiles (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  player_id  text PRIMARY KEY,
  doc        jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Dedicated low-privilege role for the backpack-api service (REQ-0040).
-- Login-capable, but granted ONLY table-level DML on the two tables
-- above -- no DDL, no superuser, no access to any other schema/table
-- Supabase's own stack (auth/storage/realtime/etc.) uses. The role's
-- password is set separately, out-of-band, via psql \password (NOT
-- embedded in this migration file, which is committed to git) -- see
-- server/README.md's "Postgres backend" section for the exact command.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backpack') THEN
    CREATE ROLE backpack LOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE postgres TO backpack;
GRANT USAGE ON SCHEMA public TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON players TO backpack;
-- No sequences to grant (both PKs are caller-supplied text ids, not
-- serial/identity columns) and no DELETE-cascading FKs between the two
-- tables (profiles.player_id references a player only by convention --
-- storage.cjs's isAllowedProfileId() enforces that at the application
-- layer, same as the pre-pg files backend did with players.readPlayer()).

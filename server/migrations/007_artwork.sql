-- backpack_ragnarok -- server/migrations/007_artwork.sql
-- REQ-0151: artwork registry (flux2 artwork generation + adopted-seed
-- registry). Two tables plus a kind ENUM. Unlike 001..006 (the "id + doc
-- verbatim jsonb" profile-style tables), this REQ is a genuine relational
-- schema: renders carry a real BYTEA image column, a per-artwork seed
-- UNIQUE constraint, and a circular adopted_render_id FK -- all consumed
-- ONLY through server/storage.cjs (the project's single persistence
-- chokepoint; the artwork path uses storage.cjs's async pg pool, not the
-- pg_sync bridge, because a PNG BYTEA blob is far larger than the sync
-- bridge's 4 MB SharedArrayBuffer + JSON round-trip was ever meant for).
--
-- Apply as the postgres superuser (same invocation as 001..006):
--   docker exec -i supabase-db psql -U postgres < server/migrations/007_artwork.sql
--
-- Idempotent: safe to re-run (guarded CREATE TYPE / CREATE TABLE IF NOT
-- EXISTS / guarded ADD CONSTRAINT throughout).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'artwork_kind') THEN
    CREATE TYPE artwork_kind AS ENUM ('po', 'si', 'unit', 'monster', 'bpskin');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS artworks (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_name       text NOT NULL UNIQUE,
  kind              artwork_kind NOT NULL,
  shape             jsonb,
  gen_width         integer NOT NULL,
  gen_height        integer NOT NULL,
  main_object       text NOT NULL DEFAULT '',
  prompt_template   text NOT NULL DEFAULT '',
  style_override    text,
  edge_padding      integer,
  adopted_render_id bigint,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS renders (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  artwork_id   bigint NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  seed         integer NOT NULL,
  image        bytea,
  image_sha256 text,
  final_prompt text,
  params       jsonb,
  status       text NOT NULL DEFAULT 'queued',
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artwork_id, seed)
);
CREATE INDEX IF NOT EXISTS renders_artwork_id_idx ON renders (artwork_id);

-- Circular FK: artworks.adopted_render_id -> renders.id. Added after
-- renders exists. ON DELETE RESTRICT is the DB-level half of "the adopted
-- render is undeletable" (storage.cjs refuses it first with a friendly
-- ADOPTED_UNDELETABLE error; this is the belt-and-suspenders backstop).
-- Dropping a whole artwork is done in storage.cjs by first NULLing
-- adopted_render_id inside the same transaction, so the renders CASCADE
-- above is never blocked by this RESTRICT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'artworks_adopted_render_fk'
  ) THEN
    ALTER TABLE artworks
      ADD CONSTRAINT artworks_adopted_render_fk
      FOREIGN KEY (adopted_render_id) REFERENCES renders (id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- Same dedicated low-privilege 'backpack' role from 001_init.sql. IDENTITY
-- columns own an implicit sequence; USAGE on it is required for INSERT.
GRANT SELECT, INSERT, UPDATE, DELETE ON artworks TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON renders  TO backpack;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO backpack;

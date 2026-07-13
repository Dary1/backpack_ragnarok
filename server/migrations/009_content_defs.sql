-- backpack_ragnarok -- server/migrations/009_content_defs.sql
-- REQ-0155: content-data registry (non-visual, variant-managed content
-- DATA in the same admin as the artwork registry). Two tables plus a kind
-- ENUM, consumed ONLY through server/storage.cjs (via storage_content.cjs),
-- the project's single persistence chokepoint -- no route/service opens the
-- DB itself. Mirrors 007_artwork.sql's relational profile (real columns, a
-- per-content auto-increment "variant_no" UNIQUE constraint, and a circular
-- adopted_variant_id FK) rather than the "id + doc verbatim jsonb"
-- profile-style tables of 001..006.
--
-- Determinism ruling (REQ-0155): the LLM generates N variants; variant_no
-- plays the seed's role as a stable handle; the STORED data JSONB is the
-- asset of record; provenance is the best-effort recipe with NO
-- regeneration guarantee -- the same doctrine as REQ-0151 renders.
--
-- Apply as the postgres superuser (same invocation as 001..008):
--   docker exec -i supabase-db psql -U postgres < server/migrations/009_content_defs.sql
--
-- Idempotent: guarded CREATE TYPE / CREATE TABLE IF NOT EXISTS / guarded
-- ADD CONSTRAINT / guarded CREATE TRIGGER throughout.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'content_kind') THEN
    CREATE TYPE content_kind AS ENUM ('po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS content_defs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  system_name        text NOT NULL UNIQUE,
  kind               content_kind NOT NULL,
  brief              text NOT NULL DEFAULT '',
  schema_ref         text NOT NULL DEFAULT '',
  gen_config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  adopted_variant_id bigint,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_variants (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_id   bigint NOT NULL REFERENCES content_defs(id) ON DELETE CASCADE,
  variant_no   integer NOT NULL,
  data         jsonb NOT NULL,
  data_sha256  text NOT NULL,
  provenance   jsonb NOT NULL DEFAULT '{}'::jsonb,
  machine_check jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent_review jsonb,
  status       text NOT NULL DEFAULT 'ok',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_id, variant_no)
);
CREATE INDEX IF NOT EXISTS content_variants_content_id_idx ON content_variants (content_id);

-- Circular FK: content_defs.adopted_variant_id -> content_variants.id.
-- ON DELETE RESTRICT is the DB-level half of "the adopted variant is
-- undeletable" (storage_content.cjs refuses it first with a friendly
-- ADOPTED_UNDELETABLE error; this is the belt-and-suspenders backstop).
-- Dropping a whole content_def NULLs adopted_variant_id in the same
-- transaction (storage_content.cjs), so the variants CASCADE is never
-- blocked by this RESTRICT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_defs_adopted_variant_fk'
  ) THEN
    ALTER TABLE content_defs
      ADD CONSTRAINT content_defs_adopted_variant_fk
      FOREIGN KEY (adopted_variant_id) REFERENCES content_variants (id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- IMMUTABILITY (REQ-0155 gate G1): a variant is the asset of record and is
-- NEVER mutated in place. A human edit in the UI creates a NEW variant with
-- provenance.source=human_edit + parent_variant_id -- it never UPDATEs an
-- existing row's data. This trigger refuses any UPDATE that changes the
-- immutable identity columns (content_id, variant_no, data, data_sha256,
-- provenance). The ADVISORY annotation columns (machine_check, agent_review,
-- status) remain updatable: machine_check is written by the auto-run checks
-- immediately after INSERT, agent_review is recorded later via the receiving
-- API, and status may flip ok<->failed -- none of these touch the
-- asset-of-record. Storage refuses the same first with a friendly
-- VARIANT_IMMUTABLE error; this trigger is the DB-level backstop.
CREATE OR REPLACE FUNCTION content_variants_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.content_id  IS DISTINCT FROM OLD.content_id
     OR NEW.variant_no  IS DISTINCT FROM OLD.variant_no
     OR NEW.data        IS DISTINCT FROM OLD.data
     OR NEW.data_sha256 IS DISTINCT FROM OLD.data_sha256
     OR NEW.provenance  IS DISTINCT FROM OLD.provenance THEN
    RAISE EXCEPTION 'content_variants are immutable: data/provenance/variant_no/content_id cannot change (create a new variant instead)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'content_variants_immutable_trg'
  ) THEN
    CREATE TRIGGER content_variants_immutable_trg
      BEFORE UPDATE ON content_variants
      FOR EACH ROW EXECUTE FUNCTION content_variants_immutable();
  END IF;
END
$$;

-- Same dedicated low-privilege 'backpack' role from 001_init.sql. IDENTITY
-- columns own an implicit sequence; USAGE on it is required for INSERT.
GRANT SELECT, INSERT, UPDATE, DELETE ON content_defs     TO backpack;
GRANT SELECT, INSERT, UPDATE, DELETE ON content_variants TO backpack;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO backpack;

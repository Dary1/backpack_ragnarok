-- backpack_ragnarok -- server/migrations/008_render_inspections.sql
-- REQ-0152: per-render inspection-kit results. One row per
-- (render_id, kit_id, kit_version): the unified kit output (verdict +
-- metrics/checks/notes) plus the input hash used for staleness/re-run
-- detection. Consumed ONLY through server/storage.cjs (via storage_art.cjs),
-- the project's single persistence chokepoint -- no route/service opens the
-- DB itself. Deleting a render CASCADES its inspection rows (advisory data,
-- meaningless without the render).
--
-- Apply as the postgres superuser (same invocation as 001..007):
--   docker exec -i supabase-db psql -U postgres < server/migrations/008_render_inspections.sql
--
-- Idempotent: guarded CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS / re-runnable GRANTs.

CREATE TABLE IF NOT EXISTS render_inspections (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  render_id        bigint NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  kit_id           text NOT NULL,
  kit_version      text NOT NULL,
  verdict          text NOT NULL,
  metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  checks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes            jsonb NOT NULL DEFAULT '[]'::jsonb,
  kit_input_sha256 text,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (render_id, kit_id, kit_version)
);
CREATE INDEX IF NOT EXISTS render_inspections_render_id_idx ON render_inspections (render_id);

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON render_inspections TO backpack;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO backpack;

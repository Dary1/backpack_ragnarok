-- backpack_ragnarok -- server/migrations/016_content_artwork_ref.sql
-- REQ-0174: content-artwork-ref -- a def-level SELECTABLE artwork reference.
-- The art linkage becomes an operator-selected reference on the CONTENT DEF
-- (registry row), pointing at an artwork instance of the matching type;
-- variants NEVER carry their own art -- they resolve through their parent def
-- (ruling 2026-07-14, content-wide canon). This SUPERSEDES REQ-0173's display-
-- layer batch-suffix inference (removed client-side): exact-name match stays
-- as the one-name-one-entity canonical fallback + the picker's suggested
-- default, but the authoritative linkage is now this explicit column.
--
-- artwork_ref is a SOFT reference to artworks.system_name (no FK: content_defs
-- and artworks are two independently managed ledgers -- the shared namespace is
-- a convention, not a constraint; validation lives at the write seam in
-- routes/content.cjs, which cross-reads the artworks table via storage.cjs).
-- A ref'd artwork later disappearing (the art registry has no delete today)
-- just degrades resolution to none -- documented graceful degradation.
--
-- Apply as the postgres superuser (same invocation as 001..015):
--   docker exec -i supabase-db psql -U postgres < server/migrations/016_content_artwork_ref.sql
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + re-runnable GRANT. Migration-first is
-- safe on a live deploy: the old api ignores the new column; the new api reads
-- it. New columns inherit the table's existing privileges, so the GRANT below
-- is belt-and-suspenders parity with 009's grant block, not a functional need.

ALTER TABLE content_defs ADD COLUMN IF NOT EXISTS artwork_ref text NULL;

-- Same dedicated low-privilege 'backpack' role from 001_init.sql.
GRANT SELECT, INSERT, UPDATE, DELETE ON content_defs TO backpack;

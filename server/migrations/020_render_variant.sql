-- backpack_ragnarok -- server/migrations/020_render_variant.sql
-- REQ-0223: allow same-seed A/B within one artwork, via a `variant` discriminator.
--
-- WHY --
-- 007_artwork.sql made a render's identity UNIQUE (artwork_id, seed). That was right
-- when a seed named a render one-for-one, but the workflows the admin now encourages
-- are exactly same-seed A/B:
--   * REQ-0186's one-shot lock override + lightbox compare wants "same seed, two locks".
--     REQ-0187 had to burn disjoint seed ranges (501-503 strict vs 511-512 off), so no
--     pair in that evidence is a true A/B -- lock effect and seed effect are confounded.
--   * The revision loop (instruction -> 3 seeds -> findings -> revised instruction) wants
--     the same seed across ROUNDS to isolate the prompt delta, and had to choose between
--     deleting renders (destroying provenance) and changing seeds (confounding).
--
-- SHAPE (c), owner-ratified 2026-07-17 -- see docs/REQ/todo/REQ-0223-*.md --
-- The seed KEEPS naming a render within an artwork; a `variant` discriminator breaks the
-- tie. Uniqueness widens to (artwork_id, seed, variant). Shapes (a) params_hash and
-- (b) explicit compare-sets were considered and set aside; the REQ file records why.
--
-- variant 0 IS THE COMPATIBILITY HINGE --
-- Every pre-existing render is variant 0, and `variant` defaults to 0, so:
--   * every legacy INSERT that names only (artwork_id, seed) still lands on variant 0 and
--     still collides with itself exactly as before -- DUPLICATE_SEED semantics are intact
--     for the ordinary path;
--   * every legacy seed-addressed route (/api/art/<name>/renders/<seed> and its /repack,
--     /cutout, /cancel, /inspect, DELETE siblings, plus adopt-by-seed) keeps resolving to
--     variant 0 without a URL change. A seed alone MEANS variant 0.
-- This matters more than it looks: seed is not merely a DB key here, it is the addressing
-- key of the whole art-admin API surface. Relaxing its uniqueness without a default would
-- have made six handlers that do `renders.find(r => r.seed === seed)` silently pick an
-- arbitrary twin. Pinning legacy addressing to variant 0 is what keeps this migration
-- narrow instead of forcing a re-addressing of every render route onto renders.id.
--
-- Apply as the postgres superuser (same invocation as 001..019):
--   docker exec -i supabase-db psql -U postgres < server/migrations/020_render_variant.sql
--
-- Idempotent. Migration-first is safe on a live deploy: old code never names `variant`,
-- so its inserts default to 0 and its reads are unaffected; the widened UNIQUE is strictly
-- more permissive than the one it replaces, so nothing old code did becomes illegal.

ALTER TABLE renders ADD COLUMN IF NOT EXISTS variant integer NOT NULL DEFAULT 0;

-- Value guard at the DB edge. 0 = the render a bare seed refers to; >0 = a twin slot
-- allocated by the one-shot override. Negative variants are meaningless.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'renders_variant_chk') THEN
    ALTER TABLE renders ADD CONSTRAINT renders_variant_chk CHECK (variant >= 0);
  END IF;
END $$;

-- Widen uniqueness: (artwork_id, seed) -> (artwork_id, seed, variant).
-- The old constraint is the one CREATE TABLE auto-named renders_artwork_id_seed_key.
-- Guarded both ways so a re-run is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'renders_artwork_id_seed_key') THEN
    ALTER TABLE renders DROP CONSTRAINT renders_artwork_id_seed_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'renders_artwork_seed_variant_key') THEN
    ALTER TABLE renders ADD CONSTRAINT renders_artwork_seed_variant_key
      UNIQUE (artwork_id, seed, variant);
  END IF;
END $$;

-- The A/B strip's read pattern: "every variant of this seed, in slot order". The existing
-- renders_artwork_id_idx does not serve it (it stops at artwork_id), and the UNIQUE above
-- is (artwork_id, seed, variant) so it does -- but only as a byproduct. Naming it here
-- keeps the lightbox's grouping query honest if the constraint is ever reshaped.
CREATE INDEX IF NOT EXISTS renders_artwork_seed_idx ON renders (artwork_id, seed, variant);

-- The circular FK artworks.adopted_render_id -> renders.id (007) is untouched: it keys on
-- renders.id, not on (artwork_id, seed), so widening the UNIQUE cannot reach it. Adoption
-- stays a pointer to ONE render row -- a twin is a separate row, hence separately
-- adoptable, and "the adopted render is undeletable" still names exactly one variant.

-- ---------------------------------------------------------------------------
-- REVERSIBLE PATH (REQ-0223 gate). Not run automatically -- copy/paste to roll back.
--
-- The down path is NOT unconditional: dropping back to UNIQUE (artwork_id, seed) is only
-- legal once no artwork has two renders sharing a seed. Any variant>0 row created since
-- this migration is, by construction, exactly such a collision. So the rollback must first
-- decide what those twins are worth. Refusing to guess is the point -- silently deleting
-- an operator's A/B evidence to satisfy a constraint would destroy the provenance this REQ
-- exists to protect.
--
--   -- 1. Look before you leap: what would have to go?
--   SELECT artwork_id, seed, count(*) AS variants
--     FROM renders GROUP BY artwork_id, seed HAVING count(*) > 1
--     ORDER BY artwork_id, seed;
--
--   -- 2. Deal with them deliberately. EITHER re-seed the twins onto free seeds
--   --    (keeps the images + params, loses the "true A/B" pairing) ...
--   --    ... OR delete them (DESTROYS evidence; never touches an adopted render):
--   --    DELETE FROM renders r WHERE r.variant > 0
--   --      AND NOT EXISTS (SELECT 1 FROM artworks a WHERE a.adopted_render_id = r.id);
--   --    (An ADOPTED variant>0 render must be un-adopted or re-seeded by hand first --
--   --     the RESTRICT FK from 007 will refuse the delete, correctly.)
--
--   -- 3. Only once step 1 returns zero rows, narrow the constraint back and drop:
--   DROP INDEX IF EXISTS renders_artwork_seed_idx;
--   ALTER TABLE renders DROP CONSTRAINT IF EXISTS renders_artwork_seed_variant_key;
--   ALTER TABLE renders ADD CONSTRAINT renders_artwork_id_seed_key UNIQUE (artwork_id, seed);
--   ALTER TABLE renders DROP CONSTRAINT IF EXISTS renders_variant_chk;
--   ALTER TABLE renders DROP COLUMN IF EXISTS variant;
-- ---------------------------------------------------------------------------

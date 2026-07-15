-- backpack_ragnarok -- server/migrations/018_artwork_shape_lock.sql
-- REQ-0186: per-artwork shape-conditioning controls for the po kind.
--
-- REQ-0183 wired REQ-0153's GREEN recipe (ReferenceLatent scaffold +
-- SetLatentNoiseMask) into po generation, hardcoded ON at dilation 8. This
-- migration gives the operator the two knobs that REQ-0153 actually MEASURED:
--
--   shape_lock         off    -- no conditioning (REQ-0153 Arm 0; 28.6% identity-fit)
--                      guide  -- ReferenceLatent only (Arm A; 60%)
--                      strict -- Arm A + hard latent mask (Arm C; 100%)
--                      auto   -- DEFAULT: strict for a shape that does NOT fill its
--                                bounding box (L, T -- where the baseline misses),
--                                off for one that does (1x3, 2x2 -- where REQ-0153
--                                recorded the baseline already PASSING because the
--                                ratified aspect-sizing law fits them). "Only pay
--                                the legibility cost where it buys something."
--   shape_dilation_px  slack in px around the owned cells for `strict` (default 8).
--
-- WHY NEW COLUMNS AND NOT artworks.shape --
-- REQ-0179 put custom's width/height inside the shape jsonb and noted no column was
-- needed. That precedent does NOT extend here. kit_registry.cjs kitParams() hashes
-- `shape` VERBATIM into kit_input_sha256, the inspection staleness key. Enforcement
-- settings inside shape would flip that hash, marking every existing inspection
-- STALE on a lock change even though neither the image nor the geometry moved --
-- a false staleness signal. shape stays pure geometry (what the kits legitimately
-- consult); HOW to enforce it lives beside it, like edge_padding does for bpskin.
--
-- Apply as the postgres superuser (same invocation as 001..017):
--   docker exec -i supabase-db psql -U postgres < server/migrations/018_artwork_shape_lock.sql
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Migration-first is safe on a live deploy:
-- NULL means "unset", and both the old code (which never reads these) and the new
-- code (which treats NULL as the `auto`/8 default) behave correctly against it, so
-- the column can land before the code without a flag day.

ALTER TABLE artworks ADD COLUMN IF NOT EXISTS shape_lock        text;
ALTER TABLE artworks ADD COLUMN IF NOT EXISTS shape_dilation_px integer;

-- Value guard at the DB edge, mirroring routes/art.cjs. NULL stays legal (= default).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artworks_shape_lock_chk') THEN
    ALTER TABLE artworks ADD CONSTRAINT artworks_shape_lock_chk
      CHECK (shape_lock IS NULL OR shape_lock IN ('auto', 'off', 'guide', 'strict'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'artworks_shape_dilation_px_chk') THEN
    ALTER TABLE artworks ADD CONSTRAINT artworks_shape_dilation_px_chk
      CHECK (shape_dilation_px IS NULL OR (shape_dilation_px >= 0 AND shape_dilation_px <= 16));
  END IF;
END $$;

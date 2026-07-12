# -*- coding: utf-8 -*-
"""
tools/tests/test_tool_icon_score.py -- REQ-0073 tests for tool_icon_score.py.

Mirrors the style of tools/tests/test_fit_parity.py: unittest.TestCase
classes, deterministic synthetic numpy boolean masks / in-memory-generated
PNGs (no network, no dependency on real candidate art -- none exists yet,
REQ-0073's generation pipeline is a separate, parallel piece of work).
Imports tool_icon_score as a module (which itself imports tool_fit_check as
a module) -- this test file does not reimplement or fork any scoring or fit
logic, it only exercises the public functions.

Fast by design: uses tool_icon_score.score_candidate()/score_terms() (single
solve() calls against tiny 1-2 cell regions), not full multi-item CLI runs.

Run with:
    ~/backpack_ragnarok/.venv/bin/python tools/tests/test_tool_icon_score.py
"""
import os
import sys
import shutil
import tempfile
import unittest

import numpy as np
from PIL import Image

TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS_DIR)

import tool_fit_check as fit           # noqa: E402  (imported, not forked)
import tool_icon_score as tis          # noqa: E402  (module under test)


def save_rgba(arr_bool, path):
    """bool HxW mask -> RGBA PNG, alpha=255 where True, 0 elsewhere. RGB
    stays black (0,0,0) inside content -- deliberately exercises the
    "dark-RGB transparent region" case that makes tool_fit_check.
    load_content() unsafe for alpha input (see tool_icon_score's own module
    docstring); load_content_alpha() must handle this correctly via the
    alpha channel, not grayscale."""
    h, w = arr_bool.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[arr_bool, 3] = 255
    Image.fromarray(rgba, mode="RGBA").save(path)


class TempPngTestCase(unittest.TestCase):
    """Base class: provides a scratch tempdir for synthetic PNG fixtures,
    cleaned up unconditionally in tearDown."""

    def setUp(self):
        self._tmpdir = tempfile.mkdtemp(prefix="tool_icon_score_test_")

    def tearDown(self):
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def _png(self, name, arr_bool):
        path = os.path.join(self._tmpdir, name)
        save_rgba(arr_bool, path)
        return path


class TestLoadContentAlpha(TempPngTestCase):
    """load_content_alpha must read the ALPHA channel, not grayscale (the
    bug tool_fit_check.load_content would have if reused here: PIL's
    RGBA->L conversion drops alpha and computes luminance from RGB only, so
    a transparent pixel with black RGB reads as "content" under a grayscale
    threshold). Also verifies the crop_to_content emptiness contract this
    module depends on (returns the ORIGINAL full-size all-False mask for an
    all-transparent image, never a (0,0) array)."""

    def test_alpha_channel_is_source_of_truth_not_rgb(self):
        # A 10x10 image, fully transparent (alpha=0) everywhere, but with a
        # black (0,0,0) RGB fill -- exactly the case that would misfire
        # under a naive RGB/grayscale-based content mask.
        arr = np.zeros((10, 10, 4), dtype=np.uint8)
        arr[:, :, :3] = 0     # black RGB
        arr[:, :, 3] = 0      # fully transparent
        path = os.path.join(self._tmpdir, "all_transparent_black.png")
        Image.fromarray(arr, mode="RGBA").save(path)

        mask = tis.load_content_alpha(path)
        self.assertFalse(mask.any(),
                          "an all-transparent (alpha=0) image must read as NO content, "
                          "even though its RGB is black")

    def test_alpha_content_detected_correctly(self):
        m = np.zeros((20, 20), bool)
        m[5:15, 5:15] = True
        path = self._png("square.png", m)
        mask = tis.load_content_alpha(path)
        # bbox-cropped via fit.crop_to_content -> should collapse exactly
        # to the 10x10 True region.
        self.assertEqual(mask.shape, (10, 10))
        self.assertTrue(mask.all())

    def test_empty_content_detected_via_any_not_size(self):
        """Regression test for the exact bug this tool's own synthetic
        validation caught during development: crop_to_content returns the
        ORIGINAL (uncropped) all-False mask for empty input, not a (0,0)
        array, so an emptiness check based on `.size == 0` alone would
        silently miss it. score_candidate() must correctly classify this
        as EMPTY_CONTENT / infeasible / score 0.0."""
        m = np.zeros((30, 30), bool)
        path = self._png("empty.png", m)
        mask = tis.load_content_alpha(path)
        # Confirms the documented crop_to_content contract this module
        # relies on: full original shape, not (0, 0).
        self.assertEqual(mask.shape, (30, 30))
        self.assertFalse(mask.any())

        cellset, _, _ = fit.shape_to_cellset([[0, 0]])
        allowed = fit.build_region(cellset)
        result = tis.score_candidate(path, allowed, cellset, any_angle=False)
        self.assertFalse(result["feasible"])
        self.assertEqual(result["score"], 0.0)


class TestScoreOrdering(TempPngTestCase):
    """Core scoring-sanity assertions (spec-mandated): a full-cell solid
    rectangle scores higher than a sparse/low-density blob for a plain
    square item, and an L-shaped blob matching beast_jaw's own cellset
    scores higher than a full bounding-box rectangle that overflows into
    beast_jaw's unowned corner cell."""

    def test_full_rect_beats_sparse_blob_on_square_item(self):
        CELL = fit.CELL
        cellset, _, _ = fit.shape_to_cellset([[0, 0]])
        allowed = fit.build_region(cellset)

        full_rect = np.ones((CELL, CELL), bool)
        full_path = self._png("full_rect.png", full_rect)

        # Sparse blob: bbox pinned to the full canvas via tiny corner marks,
        # low fill density inside that bbox (see tool_icon_score's own
        # validation script for why a merely-smaller-but-still-solid patch
        # does NOT work here -- crop_to_content erases "smaller before
        # cropping", so only within-bbox density differentiates candidates
        # of the same aspect ratio).
        sparse = np.zeros((CELL, CELL), bool)
        sparse[0:3, 0:3] = True
        sparse[0:3, -3:] = True
        sparse[-3:, 0:3] = True
        sparse[-3:, -3:] = True
        # REQ-0109: 20x20 center patch (was 10x10) -- keeps this fixture
        # above the MIN_CONTENT_FRAC=0.02 gate (content_frac 4.36%) so
        # "full beats sparse" stays meaningful post-gate.
        sparse[40:60, 40:60] = True
        sparse_path = self._png("sparse_blob.png", sparse)

        r_full = tis.score_candidate(full_path, allowed, cellset, any_angle=False)
        r_sparse = tis.score_candidate(sparse_path, allowed, cellset, any_angle=False)

        self.assertTrue(r_full["feasible"])
        self.assertTrue(r_sparse["feasible"])
        self.assertGreater(r_full["score"], r_sparse["score"],
                            "a full solid rectangle must score higher than a sparse/"
                            "low-density blob on a plain single-cell item")
        # single-cell item: uniformity_term must be exactly 1.0 always.
        self.assertEqual(r_full["terms"]["uniformity_term"], 1.0)
        self.assertEqual(r_sparse["terms"]["uniformity_term"], 1.0)

    def test_l_blob_beats_overflowing_rect_on_beast_jaw(self):
        """beast_jaw's real shape ([[0,1],[1,0],[1,1]], REQ-0029 [row,col]
        convention): an L missing the (0,0) corner of a 2x2 bbox. A plain
        filled 2x2-bbox rectangle overflows into that unowned corner and
        must be shrunk/repositioned by solve() to respect it, depressing
        both its coverage and uniformity relative to a blob shaped to the
        L region itself."""
        cellset, _, _ = fit.shape_to_cellset([[0, 1], [1, 0], [1, 1]])
        allowed = fit.build_region(cellset)

        from scipy.ndimage import binary_erosion
        l_blob = binary_erosion(allowed, iterations=2)
        l_path = self._png("l_blob.png", l_blob)

        CELL = fit.CELL
        full_rect = np.ones((2 * CELL, 2 * CELL), bool)
        rect_path = self._png("full_rect_2x2.png", full_rect)

        r_l = tis.score_candidate(l_path, allowed, cellset, any_angle=False)
        r_rect = tis.score_candidate(rect_path, allowed, cellset, any_angle=False)

        self.assertTrue(r_l["feasible"])
        self.assertTrue(r_rect["feasible"])
        self.assertGreater(r_l["score"], r_rect["score"],
                            "an L-shaped blob matching beast_jaw's cellset must score "
                            "higher than a full bbox rectangle that overflows into the "
                            "unowned corner cell")
        # 3 owned cells -> per_cell_coverage must have length 3 for both.
        self.assertEqual(len(r_l["per_cell_coverage"]), 3)
        self.assertEqual(len(r_rect["per_cell_coverage"]), 3)


class TestScoreItemWinnerSelection(TempPngTestCase):
    """score_item()'s argmax-with-tie-break-to-lower-index winner selection,
    exercised via the public entry point (glob + score + winner), not just
    the lower-level score_candidate()."""

    def test_winner_is_argmax_lower_index_on_tie(self):
        CELL = fit.CELL
        m = np.ones((CELL, CELL), bool)
        # Two byte-identical candidates -> guaranteed exact score tie ->
        # winner must be candidate_index 0 (the lower of the two), per spec
        # ("ties -> lower candidate index").
        self._png("tie_item_c0_alpha.png", m)
        self._png("tie_item_c1_alpha.png", m)

        entry = {"id": "tie_item", "shape": [[0, 0]]}
        r = tis.score_item(entry, self._tmpdir, "<id>_c*_alpha.png",
                            render_dir=None, any_angle=False)
        self.assertEqual(r["status"], "SCORED")
        self.assertEqual(len(r["candidates"]), 2)
        self.assertAlmostEqual(r["candidates"][0]["score"], r["candidates"][1]["score"])
        self.assertEqual(r["winner"]["candidate_index"], 0,
                          "on an exact score tie, the LOWER candidate index must win")

    def test_skipped_when_no_shape_or_gen_render(self):
        entry = {"id": "no_shape_item"}
        r = tis.score_item(entry, self._tmpdir, "<id>_c*_alpha.png",
                            render_dir=None, any_angle=False)
        self.assertEqual(r["status"], "SKIPPED")

    def test_skipped_when_no_candidates_match(self):
        entry = {"id": "nonexistent_item", "shape": [[0, 0]]}
        r = tis.score_item(entry, self._tmpdir, "<id>_c*_alpha.png",
                            render_dir=None, any_angle=False)
        self.assertEqual(r["status"], "SKIPPED")


class TestMinContentFracGate(TempPngTestCase):
    """MIN_CONTENT_FRAC feasibility gate 0 (REQ-0109 finalization of the
    REQ-0073 WIP): content fraction is measured on the FULL, ORIGINAL,
    UNCROPPED alpha canvas BEFORE any bbox-crop, so a matting-failure noise
    speck can never crop down to a deceptively well-fitting blob (observed
    on real data: 87.33/100 on ~0.1% content before the gate existed)."""

    def test_tiny_speck_on_large_canvas_is_content_too_small(self):
        # 512x512 canvas (262144 px) with a 10x10 speck (100 px):
        # content_frac ~= 0.038% << MIN_CONTENT_FRAC (2%).
        m = np.zeros((512, 512), bool)
        m[250:260, 250:260] = True
        path = self._png("speck_512.png", m)
        cellset, _, _ = fit.shape_to_cellset([[0, 0]])
        allowed = fit.build_region(cellset)
        r = tis.score_candidate(path, allowed, cellset, any_angle=False)
        self.assertFalse(r["feasible"])
        self.assertEqual(r["score"], 0.0)
        self.assertEqual(r["reason"], "content_too_small")

    def test_content_just_above_floor_is_feasible(self):
        # 100x100 canvas with a 10x25 rectangle: 250 px = exactly 2.5% of
        # the canvas, just above the 2% floor -> must pass the gate and
        # score normally.
        m = np.zeros((100, 100), bool)
        m[45:55, 40:65] = True
        path = self._png("just_above_floor.png", m)
        cellset, _, _ = fit.shape_to_cellset([[0, 0]])
        allowed = fit.build_region(cellset)
        r = tis.score_candidate(path, allowed, cellset, any_angle=False)
        self.assertTrue(r["feasible"])
        self.assertIsNone(r.get("reason"))
        self.assertGreater(r["score"], 0.0)



if __name__ == '__main__':
    unittest.main(verbosity=2)

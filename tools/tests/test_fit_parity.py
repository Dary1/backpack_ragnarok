# -*- coding: utf-8 -*-
"""
tools/tests/test_fit_parity.py -- REQ-0020 parity tests.

Imports BOTH the reference module (tools/reference/fit_algorithm_reference.py,
user-provided, TRUSTED, NORMATIVE) and the port (tools/tool_fit_check.py), runs
them side by side on shared, deterministically-generated fixtures, and asserts
identical outputs. Per the binding trust directive: if a mismatch is found,
the PORT is wrong -- never edit expectations to match the port.

Run with:
    ~/backpack_ragnarok/.venv/bin/python tools/tests/test_fit_parity.py

Fixtures are synthetic, deterministic numpy boolean masks (no network, no
external files):
  - an "L" blob (two arms meeting at a corner)
  - a thin diagonal bar
  - a near-cell-size square

Layouts:
  - the reference's own __main__ example layout (5 columns, the fit-cell mark)
  - a single-cell layout (one fit cell)

Mask sizes are deliberately chosen so max_scale's descending coarse scan
(from s_hi = min(H/h, W/w) down to the first feasible s) does not take an
excessive number of steps -- this is a property of the reference algorithm
itself (documented as non-monotonic-in-scale, hence the linear scan), not
something this test works around incorrectly: masks sized close to their
target grid's extent keep s_hi close to 1, which is also the realistic
regime for actual sprite icons (near-full-cell content).
"""
import os
import sys
import unittest

import numpy as np

TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFERENCE_DIR = os.path.join(TOOLS_DIR, "reference")

sys.path.insert(0, REFERENCE_DIR)
sys.path.insert(0, TOOLS_DIR)

import fit_algorithm_reference as ref          # noqa: E402  (reference, trusted/normative)
import tool_fit_check as port                  # noqa: E402  (our port)

FIT_CHAR = "□"    # white square (fit cell marker, matches the reference's own layout)
BLANK_CHAR = "　"  # ideographic space (blank cell marker, matches the reference's own layout)

REF_LAYOUT = [FIT_CHAR + BLANK_CHAR * 3 + FIT_CHAR,
              FIT_CHAR + BLANK_CHAR + FIT_CHAR + BLANK_CHAR + FIT_CHAR,
              FIT_CHAR + BLANK_CHAR + FIT_CHAR + BLANK_CHAR + FIT_CHAR,
              FIT_CHAR * 5]
SINGLE_CELL_LAYOUT = [FIT_CHAR]


# ---------------------------------------------------------------------
# Deterministic synthetic content-mask fixtures
# ---------------------------------------------------------------------

def make_l_blob(h, w, arm=None):
    """An 'L' shape: a vertical arm down the left edge, a horizontal arm
    along the bottom edge, meeting at the bottom-left corner."""
    m = np.zeros((h, w), bool)
    arm_w = arm if arm is not None else max(4, w // 5)
    arm_h = arm if arm is not None else max(4, h // 5)
    m[:, :arm_w] = True
    m[-arm_h:, :] = True
    return m


def make_diagonal_bar(n, width=10):
    """A thin diagonal stripe across an n x n canvas."""
    m = np.zeros((n, n), bool)
    half = width // 2
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half)
        m[i, lo:hi] = True
    return m


def make_near_cell_square(side=90):
    """A solid square sized just under one cell (CELL=100), to exercise the
    'content nearly fills a single cell' regime."""
    return np.ones((side, side), bool)


# ---------------------------------------------------------------------
# Comparison helpers
# ---------------------------------------------------------------------

def assert_masks_equal(tc, a, b, msg=""):
    tc.assertEqual(a.shape, b.shape, msg + " (shape mismatch)")
    tc.assertTrue(np.array_equal(a, b), msg + " (content mismatch)")


def assert_placement_equal(tc, p_ref, p_port, msg=""):
    tc.assertEqual(p_ref, p_port, msg)


def assert_max_scale_equal(tc, r_ref, r_port, msg="", scale_places=9):
    if r_ref is None or r_port is None:
        tc.assertEqual(r_ref, r_port, msg + " (one is None)")
        return
    s_ref, p_ref = r_ref
    s_port, p_port = r_port
    tc.assertAlmostEqual(s_ref, s_port, places=scale_places, msg=msg + " (scale)")
    tc.assertEqual(tuple(p_ref), tuple(p_port), msg + " (pos)")


def assert_solve_equal(tc, b_ref, b_port, msg="", scale_places=9):
    if b_ref is None or b_port is None:
        tc.assertEqual(b_ref, b_port, msg + " (one is None)")
        return
    tc.assertAlmostEqual(b_ref['scale'], b_port['scale'], places=scale_places, msg=msg + " (scale)")
    tc.assertEqual(b_ref['rot'], b_port['rot'], msg + " (rot)")
    tc.assertEqual(b_ref['flip'], b_port['flip'], msg + " (flip)")
    tc.assertEqual(tuple(b_ref['pos']), tuple(b_port['pos']), msg + " (pos)")


def assert_solve_any_angle_equal(tc, b_ref, b_port, msg="", scale_places=9):
    if b_ref is None or b_port is None:
        tc.assertEqual(b_ref, b_port, msg + " (one is None)")
        return
    tc.assertAlmostEqual(b_ref['scale'], b_port['scale'], places=scale_places, msg=msg + " (scale)")
    tc.assertAlmostEqual(b_ref['deg'], b_port['deg'], places=9, msg=msg + " (deg)")
    tc.assertEqual(b_ref['flip'], b_port['flip'], msg + " (flip)")
    tc.assertEqual(tuple(b_ref['pos']), tuple(b_port['pos']), msg + " (pos)")


class PadPinnedTestCase(unittest.TestCase):
    """Base class for tests that compare geometry (allowed-region masks,
    placements, solve() results) between the reference module and the port.

    Context (PAD policy change 2026-07-03): the reference
    (tools/reference/fit_algorithm_reference.py) is pinned NORMATIVE at
    PAD=2 and must stay byte-identical forever. tool_fit_check.py's
    production PAD was changed 2->5 (padding policy change, user directive).
    A naive reference-vs-port comparison at mismatched PAD values would
    produce different allowed-region geometry and fail for a reason that has
    nothing to do with whether the ported ALGORITHM/MECHANISM still matches
    the reference -- that would be testing "did the constants change"
    (trivially yes), not "did the port silently diverge from the trusted
    mechanism" (the actual thing this suite exists to prove).

    So for the duration of each reference-comparison test, we monkeypatch
    tool_fit_check's module-level PAD down to match the reference's PAD
    (via setUp/tearDown, restored unconditionally afterward even on
    failure/error) and run the comparison at that shared, pinned value.
    This keeps the suite proving MECHANISM parity, not constant equality.
    Production code (imported fresh elsewhere, or after this suite has
    finished) is unaffected -- see TestPortDefaultPad below, which asserts
    the real production default (5) with NO monkeypatching in effect.
    """

    def setUp(self):
        self._orig_port_pad = port.PAD
        port.PAD = ref.PAD  # pin port to reference's PAD (2) for this test only

    def tearDown(self):
        port.PAD = self._orig_port_pad  # restore production default (5)


class TestBuildRegionParity(PadPinnedTestCase):
    def test_ref_layout(self):
        allowed_ref, cellset_ref = ref.build_region(REF_LAYOUT)
        allowed_port, cellset_port = port.build_region_from_layout(REF_LAYOUT)
        assert_masks_equal(self, allowed_ref, allowed_port, "build_region allowed mask (5-col layout)")
        self.assertEqual(cellset_ref, cellset_port, "build_region cellset (5-col layout)")

    def test_single_cell_layout(self):
        allowed_ref, cellset_ref = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port, cellset_port = port.build_region_from_layout(SINGLE_CELL_LAYOUT)
        assert_masks_equal(self, allowed_ref, allowed_port, "build_region allowed mask (single-cell layout)")
        self.assertEqual(cellset_ref, cellset_port, "build_region cellset (single-cell layout)")

    def test_our_cellset_wrapper_matches_layout_form(self):
        """Our build_region(cellset) (JSON-shape-driven) must produce the same
        allowed mask as feeding an equivalent layout straight into the
        reference build_region -- i.e. our adaptation must not alter the
        reference's padding logic."""
        allowed_ref, cellset_ref = ref.build_region(REF_LAYOUT)
        allowed_port = port.build_region(cellset_ref)
        assert_masks_equal(self, allowed_ref, allowed_port, "build_region(cellset) vs build_region(layout)")


class TestFindPlacementParity(PadPinnedTestCase):
    def test_various_kernels_single_cell(self):
        allowed_ref, _ = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(ref.build_region(SINGLE_CELL_LAYOUT)[1])
        for name, kern in [
            ("square90", make_near_cell_square(90)),
            ("l_blob", make_l_blob(90, 90)),
            ("bar", make_diagonal_bar(90, 10)),
        ]:
            p_ref = ref.find_placement(allowed_ref, kern)
            p_port = port.find_placement(allowed_port, kern)
            assert_placement_equal(self, p_ref, p_port, "find_placement[%s]" % name)

    def test_oversized_kernel_returns_none_both(self):
        allowed_ref, _ = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(ref.build_region(SINGLE_CELL_LAYOUT)[1])
        kern = np.ones((500, 500), bool)
        self.assertIsNone(ref.find_placement(allowed_ref, kern))
        self.assertIsNone(port.find_placement(allowed_port, kern))


class TestMaxScaleParity(PadPinnedTestCase):
    def test_square_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_near_cell_square(90)
        r_ref = ref.max_scale(allowed_ref, content)
        r_port = port.max_scale(allowed_port, content)
        assert_max_scale_equal(self, r_ref, r_port, "max_scale square/single-cell")

    def test_l_blob_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_l_blob(90, 90)
        r_ref = ref.max_scale(allowed_ref, content)
        r_port = port.max_scale(allowed_port, content)
        assert_max_scale_equal(self, r_ref, r_port, "max_scale l_blob/single-cell")

    def test_bar_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_diagonal_bar(90, 10)
        r_ref = ref.max_scale(allowed_ref, content)
        r_port = port.max_scale(allowed_port, content)
        assert_max_scale_equal(self, r_ref, r_port, "max_scale bar/single-cell")

    def test_l_blob_ref_layout(self):
        allowed_ref, cellset = ref.build_region(REF_LAYOUT)
        allowed_port = port.build_region(cellset)
        H, W = allowed_ref.shape
        content = make_l_blob(H - 10, W - 10, arm=80)
        r_ref = ref.max_scale(allowed_ref, content)
        r_port = port.max_scale(allowed_port, content)
        assert_max_scale_equal(self, r_ref, r_port, "max_scale l_blob/5-col-layout")


class TestSolveParity(PadPinnedTestCase):
    def test_square_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_near_cell_square(90)
        b_ref = ref.solve(allowed_ref, content)
        b_port = port.solve(allowed_port, content)
        assert_solve_equal(self, b_ref, b_port, "solve square/single-cell")

    def test_l_blob_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_l_blob(90, 90)
        b_ref = ref.solve(allowed_ref, content)
        b_port = port.solve(allowed_port, content)
        assert_solve_equal(self, b_ref, b_port, "solve l_blob/single-cell")

    def test_bar_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_diagonal_bar(90, 10)
        b_ref = ref.solve(allowed_ref, content)
        b_port = port.solve(allowed_port, content)
        assert_solve_equal(self, b_ref, b_port, "solve bar/single-cell")

    def test_l_blob_ref_layout(self):
        allowed_ref, cellset = ref.build_region(REF_LAYOUT)
        allowed_port = port.build_region(cellset)
        H, W = allowed_ref.shape
        content = make_l_blob(H - 10, W - 10, arm=80)
        b_ref = ref.solve(allowed_ref, content)
        b_port = port.solve(allowed_port, content)
        assert_solve_equal(self, b_ref, b_port, "solve l_blob/5-col-layout")


class TestSolveTieBreak(PadPinnedTestCase):
    """REQ-0028: verifies solve()'s amended rotation tie-break order.

    Real-world bug (REQ-0028 investigation): tall (h>w) art fit into a wide
    2-cell horizontal region is scale-IDENTICAL whether rotated CCW90 (k=1)
    or CW90 (k=3, i.e. CCW270) -- rotating a plain filled rectangle 90 deg
    either direction yields the same rectangle shape/extent, so max_scale()
    returns the exact same scale for both. Before the REQ-0028 amendment,
    solve() iterated k in (0,1,2,3) and kept the FIRST strictly-greater
    scale, so on a tie the earlier-visited k=1 (CCW90) always won -- even
    when the user's intended/expected orientation was CW90. This is exactly
    why 5 real sprite icons ended up rotated the wrong way (CCW instead of
    CW) in content/sprite_all_v7.svg.

    The amendment changes solve()'s iteration order to k=(0,3,1,2), so on a
    scale tie between k=1 and k=3, k=3 (CW90) is now visited FIRST and wins
    (solve() only replaces `best` on STRICT '>' improvement, so the first
    candidate to reach the top score is the one that sticks).

    Rotation-direction convention (see reference module's own comment,
    "反時計回り 90°×k" = "counter-clockwise 90 deg x k"): solve()'s `rot`
    field is measured in the reference's own CCW-degree convention, where
    rot = k*90 for np.rot90(mask, k) (numpy's rot90 rotates CCW by default).
    So:
      k=0 -> rot=0    (no rotation)
      k=1 -> rot=90   (CCW90)
      k=2 -> rot=180
      k=3 -> rot=270  (CCW270 == CW90 visually: rotating CCW by 270 degrees
                       lands on the exact same orientation as rotating CW by
                       90 degrees -- 270 CCW and 90 CW are the same net turn)
    This test asserts best['rot'] == 270 for the tie case, which in this
    convention means "the CW90 orientation won the tie" -- NOT that the
    image is somehow left rotated 270 degrees counter-clockwise from a
    visual-CW perspective; 270-CCW and 90-CW are literally the same
    transform.
    """

    def test_tall_rect_in_wide_region_ties_ccw90_cw90_picks_cw90(self):
        # Wide 2-horizontal-cell allowed region (mirrors the real 5-icon
        # scenario: 128x64 target region, wide).
        allowed_ref, cellset = ref.build_region([FIT_CHAR * 2])
        allowed_port = port.build_region(cellset)

        # Tall (h > w) filled rectangle content -- no real icon art needed;
        # a plain filled rectangle reproduces the tie exactly because
        # rotating a solid rectangle 90 deg CCW or CW yields pixel-identical
        # rotated masks (both just swap h/w), so their max_scale() is
        # necessarily equal, while the unrotated (k=0) and 180 (k=2)
        # orientations keep the original (worse-fitting) tall aspect and so
        # are strictly worse in this wide region.
        content = np.zeros((90, 40), bool)
        content[:, :] = True

        b_ref = ref.solve(allowed_ref, content)
        b_port = port.solve(allowed_port, content)

        # First confirm the two ports agree with each other (standard parity
        # check), then confirm the winning orientation is specifically the
        # amended tie-break choice.
        assert_solve_equal(self, b_ref, b_port, "solve tall-rect tie-break")

        self.assertIsNotNone(b_ref)
        self.assertEqual(b_ref['rot'], 270,
                          "tie-break must pick k=3 (rot=270, CCW270==visual CW90), "
                          "not the old k=1 (rot=90, CCW90) default")
        self.assertFalse(b_ref['flip'])

        # Sanity: independently confirm this really is a tie and that rot0/180
        # are strictly worse, so the assertion above is proving tie-break
        # ORDER and not just "CW90 happened to be uniquely best".
        m_k1 = np.rot90(content, 1)
        m_k3 = np.rot90(content, 3)
        r_k1 = ref.max_scale(allowed_ref, m_k1, floor=0.0)
        r_k3 = ref.max_scale(allowed_ref, m_k3, floor=0.0)
        self.assertIsNotNone(r_k1)
        self.assertIsNotNone(r_k3)
        self.assertAlmostEqual(r_k1[0], r_k3[0], places=9,
                                msg="k=1 and k=3 must be an exact scale tie for this test to be meaningful")

        m_k0 = content
        m_k2 = np.rot90(content, 2)
        r_k0 = ref.max_scale(allowed_ref, m_k0, floor=0.0)
        r_k2 = ref.max_scale(allowed_ref, m_k2, floor=0.0)
        self.assertLess(r_k0[0], r_k1[0], "rot0 must be strictly worse than the CCW90/CW90 tie")
        self.assertLess(r_k2[0], r_k1[0], "rot180 must be strictly worse than the CCW90/CW90 tie")


class TestSolveAnyAngleParity(PadPinnedTestCase):
    def test_square_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_near_cell_square(90)
        b_ref = ref.solve_any_angle(allowed_ref, content)
        b_port = port.solve_any_angle(allowed_port, content)
        assert_solve_any_angle_equal(self, b_ref, b_port, "solve_any_angle square/single-cell")

    def test_l_blob_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_l_blob(90, 90)
        b_ref = ref.solve_any_angle(allowed_ref, content)
        b_port = port.solve_any_angle(allowed_port, content)
        assert_solve_any_angle_equal(self, b_ref, b_port, "solve_any_angle l_blob/single-cell")

    def test_bar_single_cell(self):
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        allowed_port = port.build_region(cellset)
        content = make_diagonal_bar(90, 10)
        b_ref = ref.solve_any_angle(allowed_ref, content)
        b_port = port.solve_any_angle(allowed_port, content)
        assert_solve_any_angle_equal(self, b_ref, b_port, "solve_any_angle bar/single-cell")

    def test_l_blob_ref_layout(self):
        allowed_ref, cellset = ref.build_region(REF_LAYOUT)
        allowed_port = port.build_region(cellset)
        H, W = allowed_ref.shape
        content = make_l_blob(H - 10, W - 10, arm=80)
        b_ref = ref.solve_any_angle(allowed_ref, content)
        b_port = port.solve_any_angle(allowed_port, content)
        assert_solve_any_angle_equal(self, b_ref, b_port, "solve_any_angle l_blob/5-col-layout")


class TestRotateMaskParity(unittest.TestCase):
    def test_various_angles(self):
        content = make_l_blob(90, 90)
        for deg in (0.0, 5.0, 37.5, 90.0, 123.4, 200.0, 359.0):
            m_ref = ref.rotate_mask(content, deg)
            m_port = port.rotate_mask(content, deg)
            assert_masks_equal(self, m_ref, m_port, "rotate_mask(deg=%s)" % deg)


class TestScaledParity(unittest.TestCase):
    def test_various_scales(self):
        content = make_l_blob(90, 90)
        for s in (0.1, 0.5, 0.999, 1.0, 1.0001, 2.3, 5.0):
            m_ref = ref.scaled(content, s)
            m_port = port.scaled(content, s)
            assert_masks_equal(self, m_ref, m_port, "scaled(s=%s)" % s)


class TestRenderParity(unittest.TestCase):
    def test_render_pixel_identical(self):
        import tempfile
        import shutil
        from PIL import Image
        allowed_ref, cellset = ref.build_region(SINGLE_CELL_LAYOUT)
        content = make_near_cell_square(90)
        best = ref.solve(allowed_ref, content)
        self.assertIsNotNone(best)
        tmpdir = tempfile.mkdtemp(prefix="fit_parity_render_")
        try:
            out_ref = os.path.join(tmpdir, "ref.png")
            out_port = os.path.join(tmpdir, "port.png")
            ref.render(allowed_ref, cellset, best, out_ref)
            port.render_reference(allowed_ref, cellset, best, out_port)
            a = np.array(Image.open(out_ref))
            b = np.array(Image.open(out_port))
            self.assertEqual(a.shape, b.shape, "render output shape")
            self.assertTrue(np.array_equal(a, b), "render output pixels")
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


class TestLoadContentParity(unittest.TestCase):
    """Reference raster-image content-mask loader (gray<128 + border cleanup),
    exercised against a deterministically-generated synthetic PNG (no network,
    no external file dependency beyond a tmp file this test creates itself)."""

    def setUp(self):
        import tempfile
        from PIL import Image
        arr = np.full((80, 80), 255, dtype=np.uint8)
        arr[10:60, 10:20] = 0
        arr[50:60, 10:50] = 0
        # add scan-border noise that load_content's border-cleanup must strip
        arr[0, :] = 0
        arr[:, 0] = 0
        self._tmpdir = tempfile.mkdtemp(prefix="fit_parity_")
        self._img_path = os.path.join(self._tmpdir, "synthetic.png")
        Image.fromarray(arr).save(self._img_path)

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmpdir, ignore_errors=True)

    def test_load_content_matches(self):
        m_ref = ref.load_content(self._img_path)
        m_port = port.load_content(self._img_path)
        assert_masks_equal(self, m_ref, m_port, "load_content")


class TestPortDefaultPad(unittest.TestCase):
    """Confirms tool_fit_check's own production/default PAD constant is 5
    (padding policy change, 2026-07-03) -- with NO monkeypatching in effect.
    This is intentionally NOT a PadPinnedTestCase: it must see the module's
    real, unmodified attribute. Uses importlib.reload to defend against test
    ordering artifacts (e.g. if unittest ever ran this in the same process
    after a PadPinnedTestCase whose tearDown somehow failed to restore)."""

    def test_default_pad_is_5(self):
        import importlib
        importlib.reload(port)
        try:
            self.assertEqual(port.PAD, 5, "tool_fit_check production default PAD must be 5")
        finally:
            importlib.reload(port)


if __name__ == '__main__':
    unittest.main(verbosity=2)

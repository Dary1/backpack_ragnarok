#!/usr/bin/env python3
"""REQ-0152 -- seam metric, promoted to a first-class module.

`seam_metric()` is LIFTED VERBATIM out of tools/spikes/req0150_flux_tiling.py
(the REQ-0150 §2 seamless-tiling BLOCKING SPIKE), which itself copied it
unchanged from REQ-0138 so the two are comparable. Promoting it here lets the
`tiling.seam` inspection kit import a real module instead of reaching into a
spikes/ file. The algorithm is unchanged: wrap-edge discontinuity vs interior
gradient baseline; ratio ~1.0 == the wrap edge is as continuous as any interior
edge (invisible seam); ratio >> 1.0 == a visible seam.

REQ-0138 (ratified) measured the seamless recipe at seam ratio 0.83-1.09 vs
2.76-3.77 for the plain control. The `tiling.seam` kit treats a ratio inside
[SEAM_BAND_LO, SEAM_BAND_HI] as PASS, else WARN (advisory -- never blocks) plus
a MANDATORY half-shift eyeball note, because the metric reads high on
low-contrast tiles (REQ-0150 spike finding). The upper bound is rounded 1.09 ->
1.10 for float safety; this numeric band is implementer-proposed for S7."""
import numpy as np

# REQ-0138 seamless band (from the ratified 0.83-1.09 seamless measurement;
# upper rounded to 1.10). Both ratio_x and ratio_y must lie in the band to PASS.
SEAM_BAND_LO = 0.83
SEAM_BAND_HI = 1.10


def seam_metric(img):
    """Wrap-edge discontinuity vs interior baseline; ~1.0 == invisible.

    Verbatim from tools/spikes/req0150_flux_tiling.py (REQ-0150 / REQ-0138)."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    wrap_x = np.abs(a[:, 0] - a[:, -1]).mean()
    wrap_y = np.abs(a[0, :] - a[-1, :]).mean()
    int_x = np.abs(np.diff(a, axis=1)).mean()
    int_y = np.abs(np.diff(a, axis=0)).mean()
    return {"wrap_x": float(wrap_x), "wrap_y": float(wrap_y),
            "interior_x": float(int_x), "interior_y": float(int_y),
            "ratio_x": float(wrap_x / max(int_x, 1e-6)),
            "ratio_y": float(wrap_y / max(int_y, 1e-6))}

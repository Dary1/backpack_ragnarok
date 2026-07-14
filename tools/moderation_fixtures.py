"""REQ-0144 -- deterministic, benign, PROCEDURAL test/seed fixtures.

Every image here is synthesised from pure math (numpy) with a fixed structure.
There is NO photographic content and NO learned generation: this module exists
so the moderation gates can be exercised (and the Gate 2 denylist seeded)
WITHOUT sourcing or shipping any real NSFW / CSAM / copyrighted material -- the
hard constraint in the REQ. The ip_mark_* patterns are abstract emblems used
only to prove the pHash-denylist mechanism fires; they resemble no real logo.

Same call -> byte-identical PNG -> identical sha256/pHash (determinism contract).
"""
from __future__ import annotations

import io
import numpy as np
from PIL import Image

SIDE = 256


def _to_img(arr):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def benign_gradient():
    """A calm diagonal gradient -- the canonical PASS fixture."""
    y, x = np.mgrid[0:SIDE, 0:SIDE].astype(np.float64)
    r = 60 + (x / SIDE) * 120
    g = 70 + (y / SIDE) * 110
    b = 90 + ((x + y) / (2 * SIDE)) * 100
    return _to_img(np.dstack([r, g, b]))


def ip_mark_a():
    """Abstract concentric-ring emblem -- a seed denylist entry (not a real logo)."""
    y, x = np.mgrid[0:SIDE, 0:SIDE].astype(np.float64)
    cx = cy = SIDE / 2.0
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    rings = (np.sin(d / 6.0) * 0.5 + 0.5) * 255.0
    return _to_img(np.dstack([rings, rings * 0.55, rings * 0.2]))


def ip_mark_b():
    """Abstract pinwheel/sector emblem -- a second seed denylist entry."""
    y, x = np.mgrid[0:SIDE, 0:SIDE].astype(np.float64)
    cx = cy = SIDE / 2.0
    ang = np.arctan2(y - cy, x - cx)
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (SIDE / 2.0)
    sectors = (np.sin(ang * 5.0 + d * 3.0) * 0.5 + 0.5) * 255.0
    fall = np.clip(1.0 - d, 0.0, 1.0)
    v = sectors * fall
    return _to_img(np.dstack([v, v * 0.4, v * 0.75]))


def png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


FIXTURES = {
    "benign_gradient": benign_gradient,
    "ip_mark_a": ip_mark_a,
    "ip_mark_b": ip_mark_b,
}
# REQ0144-SENTINEL fixtures v1

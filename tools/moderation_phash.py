"""REQ-0144 Gate 2 helper -- deterministic 64-bit perceptual hash (pHash).

DCT-based construction (Zauner 2010, the algorithm the `imagehash` library
ships as `phash`): grayscale -> 32x32 bilinear resize -> 2-D DCT-II (orthonormal)
-> keep the top-left 8x8 low-frequency block -> threshold each coefficient
against the block median -> pack into a 64-bit integer. Pure numpy/scipy/PIL,
CPU, no learned weights: same input bytes -> same hash (the REQ-0144
determinism contract). Used by Gate 2 (IP/logo-likeness denylist) to measure
Hamming distance against a curated denylist.
"""
from __future__ import annotations

import numpy as np
from scipy.fft import dct
from PIL import Image

IMG_SIZE = 32   # DCT input side
HASH_SIDE = 8   # low-frequency block side -> 8*8 = 64-bit hash
HASH_BITS = HASH_SIDE * HASH_SIDE


def _dct2(a):
    """2-D DCT-II with orthonormal norm (separable: rows then columns)."""
    return dct(dct(a, axis=0, norm="ortho"), axis=1, norm="ortho")


def phash_int(img: "Image.Image") -> int:
    """64-bit perceptual hash of a PIL image as a Python int."""
    g = img.convert("L").resize((IMG_SIZE, IMG_SIZE), Image.Resampling.BILINEAR)
    a = np.asarray(g, dtype=np.float64)
    block = _dct2(a)[:HASH_SIDE, :HASH_SIDE]
    med = float(np.median(block))
    bits = 0
    for i in range(HASH_SIDE):
        for j in range(HASH_SIDE):
            bits = (bits << 1) | (1 if float(block[i, j]) > med else 0)
    return bits


def phash_hex(img: "Image.Image") -> str:
    return format(phash_int(img), "016x")


def phash_from_path(path: str) -> int:
    with Image.open(path) as im:
        return phash_int(im.copy())


def hamming(a: int, b: int) -> int:
    return bin(int(a) ^ int(b)).count("1")


def hamming_hex(a: str, b: str) -> int:
    return hamming(int(a, 16), int(b, 16))

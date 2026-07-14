"""REQ-0144 Gate 1 -- local NSFW image classifier.

Model: AdamCodd/vit-base-nsfw-detector (ViT-base, 2-class sfw/nsfw), ONNX fp32,
run on onnxruntime CPUExecutionProvider. LOCAL + DETERMINISTIC: CPU inference,
single-threaded + sequential, fixed preprocessing -> same input bytes yield the
same score. "LLMs draft; scripts judge" -- there is no LLM in this path.

The 344 MB model is NOT committed. Like rembg's u2net weights it is cached out
of tree (default ~/.cache/backpack_moderation/...) and pinned by sha256 +
revision in tools/moderation_gates.json. If the model or onnxruntime is absent
the pipeline treats Gate 1 as ESCALATE (fail-safe), never PASS.
"""
from __future__ import annotations

import hashlib
import os

import numpy as np
from PIL import Image

DEFAULT_CACHE = "~/.cache/backpack_moderation/vit-base-nsfw-detector/model.onnx"
_SESSION = None
_SESSION_PATH = None


def default_model_path():
    return os.path.expanduser(os.environ.get("BPK_NSFW_MODEL", DEFAULT_CACHE))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def model_available(model_path=None):
    p = model_path or default_model_path()
    if not os.path.exists(p):
        return False
    try:
        import onnxruntime  # noqa: F401
        return True
    except Exception:
        return False


def _session(model_path):
    global _SESSION, _SESSION_PATH
    if _SESSION is not None and _SESSION_PATH == model_path:
        return _SESSION
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    _SESSION = ort.InferenceSession(model_path, sess_options=so, providers=["CPUExecutionProvider"])
    _SESSION_PATH = model_path
    return _SESSION


def preprocess(img, size=384):
    a = np.asarray(img.convert("RGB").resize((size, size), Image.Resampling.BILINEAR), dtype=np.float32) / 255.0
    a = (a - 0.5) / 0.5
    return np.transpose(a, (2, 0, 1))[None, ...].astype(np.float32)


def score_nsfw(img, model_path=None):
    """Return P(nsfw) in [0,1] for a PIL image. Raises if model/runtime absent."""
    p = model_path or default_model_path()
    sess = _session(p)
    logits = sess.run(None, {"pixel_values": preprocess(img)})[0][0].astype(np.float64)
    e = np.exp(logits - logits.max())
    pr = e / e.sum()
    return float(pr[1])

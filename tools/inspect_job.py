#!/usr/bin/env python3
"""REQ-0152 -- ONE inspection job, driven by the Node job runner.

Thin CLI boundary between the Node artwork-registry queue and the pure kit
library (tools/inspect_kits.py). stdin: one JSON job; stdout: one JSON result.

Modes:
  inspect  -- run kit_id over a render. Input PNG comes as png_b64 (Node has
              the stored BYTEA bytes) or png_path (tests). alpha_b64/alpha_path
              optional. Output stamps kit_version from the registry; the
              kit_input_sha256 (staleness key) is computed on the NODE side
              from the render's image_sha256 + kit params, so it stays
              identical between the write and the later staleness check.
  registry -- dump tools/inspect_kits.json (Node reads kits_for(kind)/version).
  verify   -- import the kit runtime deps (numpy/scipy/rembg/skimage/PIL) and
              report importability (G4 setup gate).

ART_ROUTE_MOCK plays no role here (kits are CPU-only, no ComfyUI). The runner
python MUST have numpy/scipy/PIL (+ rembg/skimage for the matte/bpskin kits);
the Node side resolves the project venv for that."""
import sys
import os
import io
import json
import base64
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _materialize(b64, path, suffix):
    """Return (path, is_temp): a real filesystem path for the PNG. Kits open
    by path (validate/score_candidate/seam all take a path or an Image)."""
    if path:
        return path, False
    if b64:
        raw = base64.b64decode(b64)
        fd, tmp = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        return tmp, True
    return None, False


def do_inspect(job):
    import inspect_kits as KITS
    kit_id = job["kit_id"]
    png_path, png_tmp = _materialize(job.get("png_b64"), job.get("png_path"), ".png")
    alpha_path, alpha_tmp = _materialize(job.get("alpha_b64"), job.get("alpha_path"), "_alpha.png")
    if not png_path:
        return {"status": "failed", "error": "no png_b64/png_path provided"}
    ctx = {
        "kind": job.get("kind"),
        "png_path": png_path,
        "alpha_path": alpha_path,
        "shape": job.get("shape"),
        "gen_width": job.get("gen_width"),
        "gen_height": job.get("gen_height"),
        "params": job.get("params") or {},
    }
    try:
        out = KITS.run_kit(kit_id, ctx)
    finally:
        if png_tmp:
            try: os.unlink(png_path)
            except OSError: pass
        if alpha_tmp:
            try: os.unlink(alpha_path)
            except OSError: pass
    out["status"] = "ok"
    out["kit_id"] = kit_id
    out["kit_version"] = KITS.kit_version(kit_id)
    return out


def do_registry():
    import inspect_kits as KITS
    return {"status": "ok", "kits": KITS._registry()}


def do_verify():
    deps = {}
    ok = True
    for mod in ("numpy", "scipy", "PIL", "skimage", "rembg"):
        try:
            __import__(mod)
            deps[mod] = True
        except Exception as e:  # noqa: BLE001
            deps[mod] = False
            deps[mod + "_error"] = str(e)[:200]
            ok = False
    return {"status": "ok" if ok else "failed", "deps": deps}


def main():
    job = json.load(sys.stdin)
    mode = job.get("mode", "inspect")
    if mode == "registry":
        print(json.dumps(do_registry())); return
    if mode == "verify":
        print(json.dumps(do_verify())); return
    print(json.dumps(do_inspect(job)))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"status": "failed", "error": str(e)}))
        sys.exit(0)

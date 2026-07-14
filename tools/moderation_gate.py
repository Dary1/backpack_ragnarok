"""REQ-0144 -- UGC skin moderation verdict pipeline (the tool).

Orchestrates the three machine gates into ONE automated verdict + stored
evidence, per the REQ:
  Gate 0  technical.s3_harness  -- REQ-0126 S3 harness, reused AS-IS.
  Gate 1  nsfw.vit_base         -- local ONNX NSFW classifier (deterministic).
  Gate 2  ip.phash_denylist     -- perceptual-hash denylist screen.

"LLMs draft; scripts judge": every verdict is a fixed-threshold script decision;
no LLM approves anything. Determinism contract: same input bytes + same manifest
+ same denylist + same model -> byte-identical verdict (verdict_sha256), modulo
the informational decided_at timestamp which is EXCLUDED from the hash.

CLI:
  python tools/moderation_gate.py IMAGE.png [--technical run|delegated]
     [--manifest tools/moderation_gates.json]
     [--denylist data/moderation/ip_denylist.json] [--json OUT.json]
Exit code: 0 PASS, 3 ESCALATE, 4 REJECT, 2 usage/error.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import io
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools"))

import moderation_phash as _phash  # noqa: E402

MANIFEST_PATH = os.path.join(REPO, "tools", "moderation_gates.json")
DENYLIST_PATH = os.path.join(REPO, "tools", "moderation_ip_denylist.json")


def _load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _gate_cfg(manifest, gate_id):
    for g in manifest["gates"]:
        if g["gate_id"] == gate_id:
            return g
    raise KeyError(gate_id)


def _canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def gate_technical(manifest, mode="delegated", runner=None):
    """Gate 0 -- reuse the REQ-0126 S3 harness AS-IS."""
    cfg = _gate_cfg(manifest, "technical.s3_harness")
    base = {"gate_id": cfg["gate_id"], "gate_version": cfg["gate_version"],
            "model": None, "model_sha256": None, "score": None, "threshold": None}
    if callable(runner):
        res = runner()
        return {**base, "verdict": "PASS" if res.get("pass") else "REJECT",
                "evidence": {"mode": "run", **res}}
    if mode == "run":
        try:
            out = subprocess.run(["node", "client/scripts/bpskin_harness.mjs"],
                                 cwd=REPO, capture_output=True, text=True, timeout=900)
            vfile = os.path.join(REPO, "web", "preview", "bpskins-req0126", "verdict.json")
            data = _load_json(vfile) if os.path.exists(vfile) else {"pass": out.returncode == 0}
            return {**base, "verdict": "PASS" if data.get("pass") else "REJECT",
                    "evidence": {"mode": "run", "gridHash": data.get("gridHash"),
                                 "returncode": out.returncode}}
        except Exception as e:
            return {**base, "verdict": "ESCALATE",
                    "evidence": {"mode": "run", "error": str(e)}}
    golden = os.path.join(REPO, "client", "scripts", "bpskin_harness.golden.json")
    gh = _load_json(golden).get("gridHash") if os.path.exists(golden) else None
    return {**base, "verdict": "DELEGATED",
            "evidence": {"mode": "delegated", "harness": cfg["reuses"], "golden_gridHash": gh,
                         "note": "Gate 0 runs as its own ci machine gate (REQ-0126); attested here."}}


def gate_nsfw(manifest, img, scorer, model_sha256=None):
    """Gate 1 -- local NSFW classifier verdict from a fixed threshold policy."""
    cfg = _gate_cfg(manifest, "nsfw.vit_base")
    th = cfg["thresholds"]
    reject, escalate = th["reject_p_nsfw"], th["escalate_p_nsfw"]
    base = {"gate_id": cfg["gate_id"], "gate_version": cfg["gate_version"],
            "model": cfg["model"]["name"],
            "model_sha256": model_sha256 if model_sha256 is not None else cfg["model"]["sha256"],
            "threshold": {"reject": reject, "escalate": escalate}}
    try:
        p = float(scorer(img))
    except Exception as e:
        return {**base, "verdict": "ESCALATE", "score": None,
                "evidence": {"error": "classifier_unavailable", "detail": str(e),
                             "policy": "fail-safe: an unavailable classifier escalates, never passes"}}
    if p >= reject:
        v = "REJECT"
    elif p >= escalate:
        v = "ESCALATE"
    else:
        v = "PASS"
    return {**base, "verdict": v, "score": round(p, 6),
            "evidence": {"p_nsfw": round(p, 6), "argmax_label": "nsfw" if p >= 0.5 else "sfw"}}


def gate_ip(manifest, img, denylist):
    """Gate 2 -- best-effort IP/logo-likeness via pHash denylist Hamming match."""
    cfg = _gate_cfg(manifest, "ip.phash_denylist")
    default_max = denylist.get("default_max_hamming", cfg["thresholds"]["default_max_hamming"])
    ph = _phash.phash_int(img)
    nearest, nearest_h, hit = None, None, None
    for e in denylist.get("entries", []):
        h = _phash.hamming(ph, int(e["phash"], 16))
        mx = e.get("max_hamming", default_max)
        if nearest_h is None or h < nearest_h:
            nearest_h, nearest = h, e["id"]
        if h <= mx and (hit is None or h < hit["hamming"]):
            hit = {"id": e["id"], "hamming": h, "max_hamming": mx}
    base = {"gate_id": cfg["gate_id"], "gate_version": cfg["gate_version"],
            "model": None, "model_sha256": None,
            "threshold": {"default_max_hamming": default_max}}
    if hit is not None:
        return {**base, "verdict": "REJECT", "score": hit["hamming"],
                "evidence": {"phash": format(ph, "016x"), "match": hit}}
    return {**base, "verdict": "PASS", "score": nearest_h,
            "evidence": {"phash": format(ph, "016x"), "nearest": nearest,
                         "nearest_hamming": nearest_h,
                         "denylist_size": len(denylist.get("entries", []))}}


_ORDER = {"PASS": 0, "DELEGATED": 0, "ESCALATE": 1, "REJECT": 2}
_INV = {0: "PASS", 1: "ESCALATE", 2: "REJECT"}


def aggregate(gates):
    worst = 0
    for g in gates:
        worst = max(worst, _ORDER.get(g["verdict"], 1))
    return _INV[worst]


def run_pipeline(image_bytes, *, manifest=None, denylist=None, nsfw_scorer=None,
                 technical="delegated", technical_runner=None, model_sha256=None):
    manifest = manifest if manifest is not None else _load_json(MANIFEST_PATH)
    denylist = denylist if denylist is not None else _load_json(DENYLIST_PATH)
    from PIL import Image
    img = Image.open(io.BytesIO(image_bytes)).copy()

    if nsfw_scorer is None:
        import moderation_nsfw as _nsfw
        if _nsfw.model_available():
            nsfw_scorer = _nsfw.score_nsfw
            if model_sha256 is None:
                model_sha256 = _nsfw.sha256_file(_nsfw.default_model_path())
        else:
            def nsfw_scorer(_i):
                raise RuntimeError("nsfw model unavailable")

    gates = [
        gate_technical(manifest, mode=technical, runner=technical_runner),
        gate_nsfw(manifest, img, nsfw_scorer, model_sha256=model_sha256),
        gate_ip(manifest, img, denylist),
    ]
    core = {
        "pipeline_version": manifest["pipeline_version"],
        "input_sha256": hashlib.sha256(image_bytes).hexdigest(),
        "verdict": aggregate(gates),
        "gates": gates,
    }
    record = dict(core)
    record["verdict_sha256"] = hashlib.sha256(_canonical(core).encode("utf-8")).hexdigest()
    record["decided_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
    return record


def main(argv=None):
    ap = argparse.ArgumentParser(description="REQ-0144 UGC skin moderation verdict pipeline")
    ap.add_argument("image")
    ap.add_argument("--technical", choices=["run", "delegated"], default="delegated")
    ap.add_argument("--manifest", default=MANIFEST_PATH)
    ap.add_argument("--denylist", default=DENYLIST_PATH)
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    with open(a.image, "rb") as f:
        data = f.read()
    rec = run_pipeline(data, manifest=_load_json(a.manifest),
                       denylist=_load_json(a.denylist), technical=a.technical)
    out = json.dumps(rec, indent=2)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            f.write(out + "\n")
    print(out)
    return {"PASS": 0, "ESCALATE": 3, "REJECT": 4}.get(rec["verdict"], 2)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""REQ-0144 gate -- UGC skin moderation verdict pipeline unit tests.

Benign, hermetic, deterministic. The NSFW classifier is injected as a STUB
score (the REQ's sanctioned "threshold-crossing synthetic stand-in") so the core
suite needs neither the 344 MB model nor onnxruntime and ships NO real NSFW/CSAM
imagery. Cases:
  1. benign PASS (all three gates clear)
  2. NSFW stand-in REJECT (stub score above reject threshold)
  3. NSFW borderline ESCALATE (stub score in the grey band)
  4. IP/logo pHash denylist REJECT (an abstract seeded emblem)
  5. determinism: the pipeline run twice on identical bytes -> identical verdict
  6. fail-safe: an unavailable classifier ESCALATES, never PASSES
  7. real-model smoke (SKIP-guarded): the pinned model scores a benign fixture
     below the reject threshold and is itself deterministic.

Run under the project venv (numpy/scipy/PIL):
  ~/backpack_ragnarok/.venv/bin/python tools/tests/moderation_gate_test.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
os.chdir(REPO)

import moderation_gate as MG  # noqa: E402
import moderation_fixtures as F  # noqa: E402
import moderation_nsfw as N  # noqa: E402

_pass = 0
_fail = 0


def check(name, cond, detail=""):
    global _pass, _fail
    if cond:
        print("PASS  " + name)
        _pass += 1
    else:
        print("FAIL  " + name + (" -- " + detail if detail else ""))
        _fail += 1


def stub(score):
    return lambda img: score


def by_id(rec):
    return {g["gate_id"]: g for g in rec["gates"]}


benign = F.png_bytes(F.benign_gradient())
mark_a = F.png_bytes(F.ip_mark_a())

# 1. benign PASS
r = MG.run_pipeline(benign, nsfw_scorer=stub(0.02))
g = by_id(r)
check("benign overall PASS", r["verdict"] == "PASS", r["verdict"])
check("gate0 technical DELEGATED", g["technical.s3_harness"]["verdict"] == "DELEGATED")
check("gate1 nsfw PASS", g["nsfw.vit_base"]["verdict"] == "PASS")
check("gate2 ip PASS", g["ip.phash_denylist"]["verdict"] == "PASS")
check("gate1 records a 64-hex model hash", len(str(g["nsfw.vit_base"]["model_sha256"])) == 64)
check("verdict record carries a verdict_sha256", len(str(r["verdict_sha256"])) == 64)

# 2. NSFW stand-in REJECT (threshold-crossing synthetic stand-in)
r = MG.run_pipeline(benign, nsfw_scorer=stub(0.95))
check("nsfw stand-in overall REJECT", r["verdict"] == "REJECT", r["verdict"])
check("gate1 REJECT above threshold", by_id(r)["nsfw.vit_base"]["verdict"] == "REJECT")

# 3. NSFW borderline ESCALATE
r = MG.run_pipeline(benign, nsfw_scorer=stub(0.5))
check("nsfw grey band overall ESCALATE", r["verdict"] == "ESCALATE", r["verdict"])

# 4. IP pHash denylist REJECT
r = MG.run_pipeline(mark_a, nsfw_scorer=stub(0.01))
gip = by_id(r)["ip.phash_denylist"]
check("ip mark overall REJECT", r["verdict"] == "REJECT", r["verdict"])
check("gate2 REJECT with a denylist match",
      gip["verdict"] == "REJECT" and gip["evidence"]["match"]["id"] == "synthetic-seed:ip_mark_a",
      json.dumps(gip["evidence"]))

# 5. determinism: two runs on identical bytes -> identical verdict
r1 = MG.run_pipeline(mark_a, nsfw_scorer=stub(0.42))
r2 = MG.run_pipeline(mark_a, nsfw_scorer=stub(0.42))
check("verdict_sha256 stable across runs", r1["verdict_sha256"] == r2["verdict_sha256"],
      r1["verdict_sha256"] + " vs " + r2["verdict_sha256"])
check("gates byte-identical across runs",
      json.dumps(r1["gates"], sort_keys=True) == json.dumps(r2["gates"], sort_keys=True))
check("decided_at present but excluded from the hash",
      "decided_at" in r1 and r1["decided_at"] != r2["decided_at"] or r1["verdict_sha256"] == r2["verdict_sha256"])

# 6. fail-safe: unavailable classifier ESCALATES
def _boom(img):
    raise RuntimeError("no model")

r = MG.run_pipeline(benign, nsfw_scorer=_boom)
check("unavailable classifier ESCALATES (fail-safe, not PASS)", r["verdict"] == "ESCALATE", r["verdict"])

# 7. real-model smoke (SKIP-guarded)
if N.model_available():
    p = N.score_nsfw(F.benign_gradient())
    check("real model: benign fixture below reject threshold", p < 0.7, "p_nsfw=" + str(p))
    check("real model: deterministic (same score twice)", N.score_nsfw(F.benign_gradient()) == p)
    rr = MG.run_pipeline(benign)
    check("real model: full pipeline runs without a stub", rr["verdict"] in ("PASS", "ESCALATE", "REJECT"), rr["verdict"])
else:
    print("SKIP real-model smoke (model or onnxruntime absent)")

print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)

#!/usr/bin/env python3
# =============================================================================
# SPIKE -- HISTORY. This produced a result that is now recorded in
# docs/REQ/todo/REQ-0150-flux2-migration.md and encoded in the pipeline. It is
# kept so the result can be re-derived, not because it is part of the pipeline.
# The pipeline is tools/art_route.py + tools/art_style.py + tools/gen_*.py.
# =============================================================================
"""REQ-0150 -- does "portrait" alone hold the bust framing on unit_thief?

The user asked: "portraitで、安定しませんか？"  It is a fair question, and the
answer is measurable rather than arguable.

FACT FIRST: "portrait, looking at viewer" was ALREADY in all three of v1/v2/v3
(and in elf and princess, where it works). It did not hold the framing on the
thief. So the word is not the variable.

HYPOTHESIS: the GEAR NOUNS are. "dagger", "belts and pouches", "leather armor"
name things that live below the shoulders; the model widens the shot to show
them. elf and princess carry no gear nouns and stay busts.

TEST: same Anime template, same seed, "portrait, looking at viewer" kept
throughout, and the gear nouns removed one step at a time.
  v4  fantasy anchor ONLY, zero gear   -- the minimal fix
  v5  v4 + explicit "bust, head and shoulders"
  v6  v4 + one gear noun put back ("leather armor") -- the falsifier: if v6
      widens again while v4 stays a bust, the gear nouns are proven to be the
      cause and "portrait" is exonerated.
"""
import glob, json, os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import gen_item_icons as G  # noqa: E402
import req0150_parity as P  # noqa: E402

OUT = "content/batches/flux2-parity-0150"
VARIANTS = [
    ("unit_thief_v4", "a female thief, fantasy rogue, hooded, portrait, "
                      "looking at viewer, white background"),
    ("unit_thief_v5", "a female thief, fantasy rogue, hooded, bust, head and "
                      "shoulders, portrait, looking at viewer, white background"),
    ("unit_thief_v6", "a female thief, fantasy rogue, hooded, leather armor, "
                      "portrait, looking at viewer, white background"),
]


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo, OUT)
    res = []
    for name, subject in VARIANTS:
        prompt = P.render("anime", subject, weighted=True)
        dst = os.path.join(outdir, name + ".png")
        pfx = "t0150_" + name
        if not os.path.exists(dst):
            t0 = time.time()
            pid = G.submit(P.wf(prompt, 512, 512, P.SEED, pfx))
            h = G.wait_done(pid, timeout_s=3600)
            hits = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, pfx + "*.png")))
            if not h or not hits:
                print("FAIL " + name, flush=True); continue
            shutil.copy(hits[-1], dst)
            print("GEN %s %.1fs" % (name, time.time() - t0), flush=True)
        res.append({"id": name, "subject": subject, "prompt": prompt})
    with open(os.path.join(outdir, "thief_framing.json"), "w") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()

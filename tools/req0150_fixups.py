#!/usr/bin/env python3
"""REQ-0150 §3 fixups -- the two assets the parity batch got wrong.

1. bpskin fill. The Anime template ("bold outline", cel-shading) rendered a
   leather OBJECT: a rounded, stitched, black-outlined patch on white. It cannot
   be a fill. REQ-0126 settles why a crop of it will not do either: a backpack is
   an arbitrary POLYOMINO (I, L, T, S/Z, inner-corner, holed) and the skin
   composes as `fill_texture` TILED across the cell interiors + autotiled edge
   tiles (straight / outer-corner / inner-corner). A one-off patch cannot cover a
   shape it does not know the size of, so the fill must genuinely tile.
   -> fill legs here drop "bold outline" and say, positively, what a fill is:
      allover, edge-to-edge, no focal object, no border, no outline, no frame.
      Decoded through CircularVAEDecode (REQ-0150 §2's measured recipe).
   The bordered patch is NOT wasted: it is the right SOURCE to slice straight and
   corner edge tiles from -- that is REQ-0146 (bpskin-edge-strip-spike), reserved.

2. unit_thief. "a female thief" + the Anime template produced a MODERN UNIFORMED
   OFFICER (peaked cap, suit, tie). The subject needs fantasy anchoring; the
   template stays exactly as the user ratified it.
"""
import glob, json, os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402
import req0150_parity as P  # noqa: E402  templates + conversion, one definition
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

OUT = "content/batches/flux2-parity-0150"

# --- fill_texture wording for the NEW (anime/cel-shaded) art direction --------
# REQ-0138's fill style was Norse painterly and is superseded; what carries over
# is the SHAPE of the constraint, not its words: name the fill positively and
# forbid the focal object / border / outline that "bold outline" invites.
FILL_STYLE = ("seamless repeating allover texture fill, tileable pattern, flat "
              "even lighting, uniform density edge to edge, filling the entire "
              "frame, no focal object, no single object, no border, no frame, "
              "no outline, no vignette, no shadow, cel-shaded coloring, flat "
              "colors, anime game texture, high detail, sharp focus")

FILLS = [
    ("bpskin_leather_fill_a", 101,
     "brown leather texture, worn grain and fine creases, " + FILL_STYLE),
    ("bpskin_leather_fill_b", 202,
     "brown leather texture, worn grain and fine creases, " + FILL_STYLE),
]

# --- thief: fantasy-anchored subjects, same ratified Anime template -----------
THIEVES = [
    ("unit_thief_v1", "a female thief, fantasy rogue, hooded leather armor, "
                      "dagger, portrait, looking at viewer, white background"),
    ("unit_thief_v2", "a female thief, medieval fantasy rogue in a dark hood and "
                      "worn leather armor, roguish smirk, portrait, looking at "
                      "viewer, white background"),
    ("unit_thief_v3", "a female rogue thief of a fantasy RPG, leather armor, "
                      "hood, belts and pouches, portrait, looking at viewer, "
                      "white background"),
]


def seam_metric(img):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    wx = np.abs(a[:, 0] - a[:, -1]).mean(); wy = np.abs(a[0, :] - a[-1, :]).mean()
    ix = np.abs(np.diff(a, axis=1)).mean(); iy = np.abs(np.diff(a, axis=0)).mean()
    return round(float(wx / max(ix, 1e-6)), 2), round(float(wy / max(iy, 1e-6)), 2)


def tiled2x2(img, path):
    w, h = img.size
    s = Image.new("RGB", (w, h)); q = img.resize((w // 2, h // 2), Image.LANCZOS)
    for dx in (0, w // 2):
        for dy in (0, h // 2):
            s.paste(q, (dx, dy))
    s.save(path)


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo, OUT); os.makedirs(outdir, exist_ok=True)
    res = {"fills": [], "thieves": []}

    for name, seed, subject in FILLS:
        prompt = subject  # NOT the Anime template -- see docstring
        dst = os.path.join(outdir, name + ".png")
        pfx = "f0150_" + name
        if not os.path.exists(dst):
            t0 = time.time()
            pid = G.submit(P.wf(prompt, 1024, 1024, seed, pfx, tiling=True))
            h = G.wait_done(pid, timeout_s=3600)
            hits = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, pfx + "*.png")))
            if not h or not hits:
                print("FAIL " + name, flush=True); continue
            shutil.copy(hits[-1], dst)
            print("GEN %s %.1fs" % (name, time.time() - t0), flush=True)
        img = Image.open(dst)
        tiled2x2(img, os.path.join(outdir, name + "_tiled2x2.png"))
        rx, ry = seam_metric(img)
        res["fills"].append({"id": name, "seed": seed, "prompt": prompt,
                             "seam_ratio_x": rx, "seam_ratio_y": ry})
        print("SEAM %s rx=%.2f ry=%.2f" % (name, rx, ry), flush=True)

    for name, subject in THIEVES:
        prompt = P.render("anime", subject, weighted=True)
        dst = os.path.join(outdir, name + ".png")
        pfx = "f0150_" + name
        if not os.path.exists(dst):
            t0 = time.time()
            pid = G.submit(P.wf(prompt, 512, 512, P.SEED, pfx))
            h = G.wait_done(pid, timeout_s=3600)
            hits = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, pfx + "*.png")))
            if not h or not hits:
                print("FAIL " + name, flush=True); continue
            shutil.copy(hits[-1], dst)
            print("GEN %s %.1fs" % (name, time.time() - t0), flush=True)
        res["thieves"].append({"id": name, "subject": subject, "prompt": prompt})

    with open(os.path.join(outdir, "fixups.json"), "w") as f:
        json.dump(res, f, indent=2, ensure_ascii=False)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()

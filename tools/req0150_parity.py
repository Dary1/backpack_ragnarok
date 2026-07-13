#!/usr/bin/env python3
"""REQ-0150 §3 -- parity batch: reproduce the user's InvokeAI settings on OUR flux2 pipeline.

The user (2026-07-13) found settings in InvokeAI Community Edition that give them
results they are happy with, and ratified them as the program's art direction:

  items + units  -> InvokeAI "Anime" template
  monsters       -> InvokeAI "Concept Art (Fantasy)" template
  FLUX.2 klein 4B, no LoRAs, euler, steps 30, flux2 VAE, Qwen3-4B encoder, seed 1
  generation size matched to the intended CELL FOOTPRINT (aspect ratio), not square

This SUPERSEDES the Norse dark-fantasy painterly direction, including REQ-0127's
ratified (S7 ALL GREEN) unit roster style. User decision, 2026-07-13.

Before regenerating every batch on this direction, PROVE the pipeline reproduces
what the user saw. Three things could silently diverge between InvokeAI and our
ComfyUI graph, and all three would poison a full regeneration:

 1. PROMPT WEIGHTING SYNTAX. InvokeAI's templates use its own emphasis syntax
    (`+` = x1.1, `++` = x1.21, `+++` = x1.331). ComfyUI does NOT understand it --
    pasted verbatim, "anime++" tokenises the plus signs as text. We convert to
    ComfyUI's `(text:weight)`. Whether that lands the same way on a Qwen3 text
    encoder is an open question, so this batch generates BOTH the weighted and a
    flattened (weights stripped) variant of two assets and compares.
 2. THE NEGATIVE PROMPT. Both InvokeAI templates carry one. On our route it is
    inactive (distilled klein, cfg 1.0, ConditioningZeroOut). Almost certainly it
    was inactive in the user's InvokeAI runs too, for the same reason -- but we
    do not depend on that: we drop it and steer from the POSITIVE only.
 3. SIZE SNAPPING. Some of the user's sizes are not multiples of 16 and cannot be
    latents (sword h=756, goblin w=386). Snapped to the exact cell footprint --
    see SIZE_NOTES.

STOP AT S7: nothing here goes to content/live/. The user rules on the gallery.
"""
import argparse, glob, json, os, re, shutil, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402  the ONE definition of the flux2 route
from PIL import Image  # noqa: E402

STEPS = 30          # user-verified. NOT klein's distilled default of 4.
CFG = 1.0
SAMPLER = "euler"
SEED = 1
CELL_PX = 128       # the game cell; the user's monster sizes are 1x this, items 2x

# --- InvokeAI default templates, verbatim -----------------------------------
# (invoke-ai/InvokeAI: default_style_presets.json). The negative_prompt of each
# is recorded for the record and NOT used -- see docstring note 2.
INVOKE_TEMPLATES = {
    "anime": {
        "positive": "{prompt} anime++, bold outline, cel-shaded coloring, shounen, seinen",
        "negative": "(photo)+++. greyscale. solid black. painting",
    },
    "concept_art_fantasy": {
        "positive": ("concept artwork of a {prompt}. (digital painterly art style)++, "
                     "mythological, (textured 2d dry media brushpack)++, glazed "
                     "brushstrokes, otherworldly. painting+, illustration+"),
        "negative": "photo. distorted, blurry, out of focus. sketch. (cgi, 3d.)++",
    },
}

# InvokeAI emphasis: a run of + or - IMMEDIATELY after a word or a (parenthesised
# group), and immediately BEFORE a boundary. The trailing-boundary lookahead is
# not optional: without it this eats the hyphen in "cel-shaded coloring" as a
# de-emphasis marker and emits "(cel:0.909)shaded coloring". That bug is invisible
# unless you print the prompt, and it would have poisoned every anime-template
# asset in the batch. The body also must not swallow its own '+' (else "anime++"
# yields "(anime+:1.1)").
_TRAIL = re.compile(r"(\([^)]+\)|[^\s,.()+]+)([+-]+)(?=[\s,.]|$)")


def invoke_to_comfy(t):
    """InvokeAI emphasis -> ComfyUI (text:weight). '+' is x1.1 compounding, '-' is /1.1.
    `anime++` -> `(anime:1.21)`; `(digital painterly art style)++` -> `(...:1.21)`."""
    def sub(m):
        body, marks = m.group(1), m.group(2)
        if body.startswith("(") and body.endswith(")"):
            body = body[1:-1]
        w = 1.1 ** len(marks) if marks[0] == "+" else 1.1 ** -len(marks)
        return f"({body}:{round(w, 3)})"
    return _TRAIL.sub(sub, t)


def flatten(t):
    """Same template with the emphasis markers simply dropped -- the control leg."""
    def sub(m):
        body = m.group(1)
        return body[1:-1] if body.startswith("(") and body.endswith(")") else body
    return _TRAIL.sub(sub, t)


def render(template, subject, weighted=True):
    t = INVOKE_TEMPLATES[template]["positive"]
    t = invoke_to_comfy(t) if weighted else flatten(t)
    return t.replace("{prompt}", subject) if "{prompt}" in t else f"{subject} {t}"


# --- the user's assets ------------------------------------------------------
# cells = (w, h) in CELL_PX units. px = the size actually generated.
SIZE_NOTES = {
    "iron_sword": "user said 256x756; 756 is not a valid latent size -> 768 (= 3 cells x 256)",
    "goblin": "user said 512x386 (landscape); confirmed a slip -> 384x512 portrait (3x4 cells)",
    "goblin_shaman": "same correction as goblin -> 384x512",
}

ASSETS = [
    # --- items: Anime, 256 px per cell -------------------------------------
    dict(id="iron_sword",        kind="item",    tmpl="anime", cells=(1, 3), px=(256, 768),
         subject="iron sword, white background, bold outline"),
    dict(id="iron_shield",       kind="item",    tmpl="anime", cells=(2, 2), px=(512, 512),
         subject="iron shield, white background, bold outline"),
    dict(id="large_iron_shield", kind="item",    tmpl="anime", cells=(2, 3), px=(512, 768),
         subject="large iron shield, white background, bold outline"),
    dict(id="healing_potion",    kind="item",    tmpl="anime", cells=(1, 2), px=(256, 512),
         subject="healing potion, white background, bold outline"),
    # --- monsters: Concept Art (Fantasy), 128 px per cell -------------------
    dict(id="goblin",            kind="monster", tmpl="concept_art_fantasy", cells=(3, 4),
         px=(384, 512), subject="goblin, white background"),
    dict(id="goblin_shaman",     kind="monster", tmpl="concept_art_fantasy", cells=(3, 4),
         px=(384, 512), subject="goblin shaman, white background"),
    dict(id="chimera",           kind="monster", tmpl="concept_art_fantasy", cells=(6, 4),
         px=(768, 512), subject="Chimera, white background"),
    dict(id="ancient_dragon",    kind="monster", tmpl="concept_art_fantasy", cells=(10, 10),
         px=(1280, 1280), subject="Ancient Dragon, white background"),
    # --- units: Anime -------------------------------------------------------
    dict(id="unit_elf",          kind="unit", tmpl="anime", cells=(4, 4), px=(512, 512),
         subject="female elf, portrait, looking at viewer, white background"),
    dict(id="unit_thief",        kind="unit", tmpl="anime", cells=(4, 4), px=(512, 512),
         subject="a female thief, portrait, looking at viewer, white background"),
    dict(id="unit_princess",     kind="unit", tmpl="anime", cells=(4, 4), px=(512, 512),
         subject="a little princess, portrait, looking at viewer, white background"),
    # --- backpack texture: Anime + the REQ-0150 §2 tiling recipe -------------
    dict(id="bpskin_leather",    kind="texture", tmpl="anime", cells=(8, 8), px=(1024, 1024),
         subject="leather texture", tiling=True),
]

# weights-vs-flattened control: does ComfyUI's (x:w) on a Qwen3 encoder do
# anything at all? Two assets, one per template.
PROBES = ["iron_sword", "goblin"]


def wf(prompt, w, h, seed, prefix, tiling=False):
    g = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": G.FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": G.FLUX["clip"],
                                                     "type": "flux2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": G.FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptyFlux2LatentImage",
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": SAMPLER}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": STEPS, "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "13": {"class_type": "CFGGuider", "inputs": {"model": ["1", 0], "positive": ["4", 0],
                                                     "negative": ["5", 0], "cfg": CFG}},
        "14": {"class_type": "SamplerCustomAdvanced",
               "inputs": {"noise": ["9", 0], "guider": ["13", 0], "sampler": ["7", 0],
                          "sigmas": ["8", 0], "latent_image": ["6", 0]}},
    }
    # REQ-0150 §2: CircularVAEDecode is the FLUX seamless-tiling recipe.
    g["15"] = ({"class_type": "CircularVAEDecode",
                "inputs": {"samples": ["14", 0], "vae": ["3", 0], "tiling": "enable"}}
               if tiling else
               {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["3", 0]}})
    g["16"] = {"class_type": "SaveImage", "inputs": {"images": ["15", 0],
                                                     "filename_prefix": prefix}}
    return g


def run(graph, prefix, dst):
    if os.path.exists(dst):
        print(f"SKIP {os.path.basename(dst)} (exists)", flush=True)
        return True
    t0 = time.time()
    pid = G.submit(graph)
    hist = G.wait_done(pid, timeout_s=3600)
    if not hist or hist.get("status", {}).get("status_str") == "error":
        print(f"FAIL {prefix}", flush=True)
        return False
    hits = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, prefix + "*.png")))
    if not hits:
        print(f"FAIL {prefix}: no output", flush=True)
        return False
    shutil.copy(hits[-1], dst)
    print(f"GEN {os.path.basename(dst)} {time.time()-t0:.1f}s", flush=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="content/batches/flux2-parity-0150")
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo, args.out)
    os.makedirs(outdir, exist_ok=True)

    assets = ASSETS
    if args.only:
        keep = {s.strip() for s in args.only.split(",")}
        assets = [a for a in assets if a["id"] in keep]

    manifest = {"req": "REQ-0150 §3 parity batch",
                "art_direction_ratified": "2026-07-13 (user, from InvokeAI CE)",
                "route": "flux2", "unet": G.FLUX["unet"], "clip": G.FLUX["clip"],
                "vae": G.FLUX["vae"], "steps": STEPS, "cfg": CFG, "sampler": SAMPLER,
                "seed": SEED, "cell_px": CELL_PX, "loras": None,
                "invoke_templates": INVOKE_TEMPLATES, "size_notes": SIZE_NOTES,
                "negative_prompt": "DROPPED -- inactive on distilled klein at cfg 1.0",
                "assets": []}

    for a in assets:
        prompt = render(a["tmpl"], a["subject"], weighted=True)
        dst = os.path.join(outdir, f"{a['id']}.png")
        ok = run(wf(prompt, a["px"][0], a["px"][1], SEED, f"p0150_{a['id']}",
                    a.get("tiling", False)), f"p0150_{a['id']}", dst)
        rec = dict(a); rec["prompt_weighted"] = prompt; rec["ok"] = ok
        if a["id"] in PROBES:
            fp = render(a["tmpl"], a["subject"], weighted=False)
            fdst = os.path.join(outdir, f"{a['id']}__flat.png")
            run(wf(fp, a["px"][0], a["px"][1], SEED, f"p0150_{a['id']}_flat"), 
                f"p0150_{a['id']}_flat", fdst)
            rec["prompt_flattened"] = fp
            if os.path.exists(dst) and os.path.exists(fdst):
                import numpy as np
                x = np.asarray(Image.open(dst).convert("RGB"), dtype=np.int16)
                y = np.asarray(Image.open(fdst).convert("RGB"), dtype=np.int16)
                d = np.abs(x - y)
                rec["weighting_probe"] = {"identical": bool(d.max() == 0),
                                          "max_abs_diff": int(d.max()),
                                          "mean_abs_diff": round(float(d.mean()), 2)}
                print(f"PROBE {a['id']}: weighted vs flattened -> "
                      f"identical={rec['weighting_probe']['identical']} "
                      f"mean_diff={rec['weighting_probe']['mean_abs_diff']}", flush=True)
        manifest["assets"].append(rec)

    with open(os.path.join(outdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()

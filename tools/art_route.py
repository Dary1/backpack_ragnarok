#!/usr/bin/env python3
"""THE image-generation route. One file. Everything else imports it.

RATIFIED (user, 2026-07-13, REQ-0150 "Flux2化"): FLUX.2 klein 4B distilled, GGUF
Q8_0, Apache 2.0. There is no other production route. SDXL is retired.

Sampler settings are the USER'S, reached in InvokeAI Community Edition and
ratified 2026-07-13 by looking at the results:

    euler · steps 30 · cfg 1.0 · seed 1 · flux2 VAE · Qwen3-4B text encoder · NO LoRAs

STEPS = 30, not 4. klein is a distilled 4-step model and this pipeline used to
default to 4. The user's verdict was reached at 30. Do not "optimise" it back.

THE NEGATIVE PROMPT DOES NOT EXIST ON THIS ROUTE. Distilled klein samples at
cfg 1.0 and the official graph feeds a ConditioningZeroOut of the POSITIVE in as
the negative. Any negative you pass is discarded. Steer style from the POSITIVE.
`build_txt2img` refuses a negative outright rather than accepting and dropping it.

LoRAs DO NOT LOAD. SDXL/SD1.5 LoRAs are a different architecture. REQ-0150 settled
this: the two the program used (detail_tweaker, cel_shaded_art_style) were generic
style/detail boosters, not identity LoRAs, and are dropped. The user's own ratified
settings independently say "No LoRAs".

SEAMLESS TILING (REQ-0150 §2, measured): pass tiling=True and the decode goes
through CircularVAEDecode. That is the whole recipe on FLUX -- seam ratio 0.76-1.43
(mean 1.00) against a plain-decode control of 0.92-2.73. SeamlessTile, which SDXL
needed, is a NO-OP here: it patches torch.nn.Conv2d and FLUX's denoiser is a DiT
that holds none (proved bit-identical, 4/4). Do not add it back.

BOX (RTX 2080, 8 GB VRAM / 23 GB RAM): FLUX.2 and the Qwen3-4B encoder do not
co-reside in 8 GB, so ComfyUI swaps them per prompt. Measured: the FIRST generation
of a run costs ~450-540 s (cold load); later generations on the SAME prompt cost
2-20 s; a PROMPT CHANGE forces a text-encoder reload, 30-170 s. => BATCH BY PROMPT,
NOT BY SEED, and never judge throughput on the first image.
"""
import json
import os
import time
import urllib.request

COMFY = "http://127.0.0.1:8188"
COMFY_INPUT_DIR = os.path.expanduser("~/ComfyUI/input")
COMFY_OUTPUT_DIR = os.path.expanduser("~/ComfyUI/output")

FLUX = {
    "unet": "flux-2-klein-4b-Q8_0.gguf",     # Apache 2.0, unsloth GGUF Q8_0
    "clip": "qwen_3_4b.safetensors",
    "vae":  "flux2-vae.safetensors",
}
# The user's ratified sampler settings. Not klein's distilled defaults.
STEPS = 30
CFG = 1.0
SAMPLER = "euler"
SEED = 1

# The game grid cell. Generation size must match the intended CELL FOOTPRINT'S
# ASPECT RATIO -- see art_style.gen_size(). Square-then-downscale is retired: it
# is what made a 1x3 sword float in the middle of its own icon.
CELL_PX = 128


def submit(wf):
    data = json.dumps({"prompt": wf}).encode()
    req = urllib.request.Request(COMFY + "/prompt", data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("ComfyUI /prompt rejected the workflow: %s -- %s" % (e, body))
    if "error" in r:
        raise RuntimeError("ComfyUI /prompt error: %s" % r["error"])
    return r["prompt_id"]


def wait_done(pid, timeout_s=1800):
    """timeout_s must clear a COLD LOAD. The first generation of a run costs
    450-540 s on this box (FLUX.2 + the Qwen3-4B encoder do not co-reside in 8 GB,
    so ComfyUI swaps them in from disk). A 300 s timeout -- which is what the copy
    of this function inside gen_item_icons.py used to carry -- fails the first
    image of every batch and then succeeds on the rest, which looks like a flaky
    model and is actually a stopwatch."""
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(2)
        try:
            h = json.load(urllib.request.urlopen(COMFY + "/history/" + pid, timeout=20))
        except Exception:
            continue
        if pid not in h:
            continue
        st = h[pid].get("status", {})
        if st.get("completed"):
            return h[pid]
        # a failed job is completed=False with status_str="error" -- return it
        # rather than spinning out the full timeout.
        if st.get("status_str") == "error":
            return h[pid]
    return None


def build_txt2img(prompt, w, h, seed=SEED, prefix="gen", *, steps=STEPS, cfg=CFG,
                  sampler=SAMPLER, tiling=False, mask_image=None, negative=None,
                  reference_image=None, shape_mask_image=None, mask_init_image=None):
    """The ONLY graph. ComfyUI's official Flux.2-klein-distilled template with
    UNETLoader swapped for UnetLoaderGGUF.

    tiling=True   -> CircularVAEDecode (seamless fill textures; REQ-0150 §2).
    mask_image    -> ConditioningSetMask on the POSITIVE only, as a placement
                     bias. The negative is a zero-out of the UNMASKED positive;
                     zeroing the masked one would leave everything outside the
                     mask unguided.
                     INEFFECTIVE ON THIS ROUTE, and kept only for the legacy
                     gen_item_icons.py caller: REQ-0153 established that
                     ConditioningSetMask rides SDXL cross-attention and does not
                     port to FLUX.2's DiT joint attention. For real shape control
                     use reference_image. Mutually exclusive with it (shared nodes).
    reference_image / shape_mask_image / mask_init_image
                  -> SHAPE CONDITIONING (REQ-0183, wiring the REQ-0153 GREEN recipe).
                     reference_image alone is REQ-0153 "Arm A": the image is
                     VAE-encoded and chained into the POSITIVE as a ReferenceLatent.
                     This is the mechanism klein natively supports -- FLUX.2 unifies
                     t2i and image editing in ONE architecture, so these very weights
                     accept a reference image with no adapter, no ControlNet, no LoRA.
                     Add shape_mask_image + mask_init_image for "Arm C": the init
                     latent becomes mask_init_image under a SetLatentNoiseMask of
                     shape_mask_image, so nothing renders outside the masked region.
                     Arm C @ D=8 is the ratified PO default -- 100% identity-fit
                     feasible with zero deep-overflow, against 28.6% unconditioned.
                     All three default None, leaving the graph byte-identical to the
                     unconditioned route for every existing caller.
                     Cost: reference-latent jobs run ~2-3x slower than plain t2i on
                     the 8 GB card (measured 6.7-6.8 GB peak, no OOM).
    negative      -> REFUSED. It is inactive at cfg 1.0 and accepting it silently
                     is how a style regression hides for a month.
    """
    if negative:
        raise ValueError(
            "build_txt2img: a negative prompt was passed. This route has no "
            "negative -- distilled klein samples at cfg 1.0 and the graph zeroes "
            "the conditioning, so it would be silently discarded. Fold what you "
            "wanted into the POSITIVE prompt instead.")
    if mask_image and reference_image:
        raise ValueError(
            "build_txt2img: mask_image and reference_image are mutually exclusive "
            "-- they occupy the same graph nodes. mask_image's ConditioningSetMask "
            "is a no-op on FLUX.2 anyway (REQ-0153); pass reference_image alone.")
    if (shape_mask_image or mask_init_image) and not reference_image:
        raise ValueError(
            "build_txt2img: shape_mask_image/mask_init_image require reference_image. "
            "The REQ-0153 Arm C recipe masks the init latent that the scaffold's "
            "ReferenceLatent conditions; masking alone was never an arm.")
    if bool(shape_mask_image) != bool(mask_init_image):
        raise ValueError(
            "build_txt2img: shape_mask_image and mask_init_image must be passed "
            "together -- the noise mask needs the latent it masks.")

    wf = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": FLUX["clip"], "type": "flux2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptyFlux2LatentImage",
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": sampler}},
        "8": {"class_type": "Flux2Scheduler",
              "inputs": {"steps": steps, "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
    }
    positive = ["4", 0]
    latent_image = ["6", 0]
    if mask_image:
        wf["10"] = {"class_type": "LoadImage", "inputs": {"image": mask_image}}
        wf["11"] = {"class_type": "ImageToMask",
                    "inputs": {"image": ["10", 0], "channel": "red"}}
        wf["12"] = {"class_type": "ConditioningSetMask",
                    "inputs": {"conditioning": ["4", 0], "mask": ["11", 0],
                               "strength": 1.0, "set_cond_area": "default"}}
        positive = ["12", 0]
    if reference_image:
        # REQ-0153 Arm A: scaffold -> VAEEncode -> ReferenceLatent into the positive.
        wf["10"] = {"class_type": "LoadImage", "inputs": {"image": reference_image}}
        wf["11"] = {"class_type": "VAEEncode",
                    "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}
        wf["12"] = {"class_type": "ReferenceLatent",
                    "inputs": {"conditioning": ["4", 0], "latent": ["11", 0]}}
        positive = ["12", 0]
    if shape_mask_image:
        # REQ-0153 Arm C: sample into a white canvas under a hard noise mask, so
        # nothing can render outside the (dilated) owned cells.
        wf["17"] = {"class_type": "LoadImage", "inputs": {"image": mask_init_image}}
        wf["18"] = {"class_type": "VAEEncode",
                    "inputs": {"pixels": ["17", 0], "vae": ["3", 0]}}
        wf["20"] = {"class_type": "LoadImage", "inputs": {"image": shape_mask_image}}
        wf["21"] = {"class_type": "ImageToMask",
                    "inputs": {"image": ["20", 0], "channel": "red"}}
        wf["22"] = {"class_type": "SetLatentNoiseMask",
                    "inputs": {"samples": ["18", 0], "mask": ["21", 0]}}
        latent_image = ["22", 0]
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": ["1", 0], "positive": positive,
                           "negative": ["5", 0], "cfg": cfg}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0], "sampler": ["7", 0],
                           "sigmas": ["8", 0], "latent_image": latent_image}}
    wf["15"] = ({"class_type": "CircularVAEDecode",
                 "inputs": {"samples": ["14", 0], "vae": ["3", 0], "tiling": "enable"}}
                if tiling else
                {"class_type": "VAEDecode",
                 "inputs": {"samples": ["14", 0], "vae": ["3", 0]}})
    wf["16"] = {"class_type": "SaveImage",
                "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf

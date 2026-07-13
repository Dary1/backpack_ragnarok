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
    return json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]


def wait_done(pid, timeout_s=3600):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(2)
        try:
            h = json.load(urllib.request.urlopen(COMFY + "/history/" + pid, timeout=20))
        except Exception:
            continue
        if pid in h and h[pid].get("status", {}).get("completed"):
            return h[pid]
    return None


def build_txt2img(prompt, w, h, seed=SEED, prefix="gen", *, steps=STEPS, cfg=CFG,
                  sampler=SAMPLER, tiling=False, mask_image=None, negative=None):
    """The ONLY graph. ComfyUI's official Flux.2-klein-distilled template with
    UNETLoader swapped for UnetLoaderGGUF.

    tiling=True   -> CircularVAEDecode (seamless fill textures; REQ-0150 §2).
    mask_image    -> ConditioningSetMask on the POSITIVE only, as a placement
                     bias. The negative is a zero-out of the UNMASKED positive;
                     zeroing the masked one would leave everything outside the
                     mask unguided.
    negative      -> REFUSED. It is inactive at cfg 1.0 and accepting it silently
                     is how a style regression hides for a month.
    """
    if negative:
        raise ValueError(
            "build_txt2img: a negative prompt was passed. This route has no "
            "negative -- distilled klein samples at cfg 1.0 and the graph zeroes "
            "the conditioning, so it would be silently discarded. Fold what you "
            "wanted into the POSITIVE prompt instead.")

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
    if mask_image:
        wf["10"] = {"class_type": "LoadImage", "inputs": {"image": mask_image}}
        wf["11"] = {"class_type": "ImageToMask",
                    "inputs": {"image": ["10", 0], "channel": "red"}}
        wf["12"] = {"class_type": "ConditioningSetMask",
                    "inputs": {"conditioning": ["4", 0], "mask": ["11", 0],
                               "strength": 1.0, "set_cond_area": "default"}}
        positive = ["12", 0]
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": ["1", 0], "positive": positive,
                           "negative": ["5", 0], "cfg": cfg}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0], "sampler": ["7", 0],
                           "sigmas": ["8", 0], "latent_image": ["6", 0]}}
    wf["15"] = ({"class_type": "CircularVAEDecode",
                 "inputs": {"samples": ["14", 0], "vae": ["3", 0], "tiling": "enable"}}
                if tiling else
                {"class_type": "VAEDecode",
                 "inputs": {"samples": ["14", 0], "vae": ["3", 0]}})
    wf["16"] = {"class_type": "SaveImage",
                "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf

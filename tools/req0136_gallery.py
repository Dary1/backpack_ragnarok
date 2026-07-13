#!/usr/bin/env python3
"""REQ-0136 bakeoff gallery builder -> web/preview/bakeoff-0136/index.html

Numbered candidates (verdict keys like `v9-hilt-101`), every candidate at
256 px AND 64 px side by side (golden G4), per-contender header with
sampler config, measured VRAM peak / warm s-per-image, and license line.
Self-contained: images copied next to index.html, relative paths, dark
theme (build_batch003_report.py pattern).
"""
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "content/batches/bakeoff-0136/candidates")
OUT = os.path.join(REPO, "web/preview/bakeoff-0136")

CONTENDERS = ["v9", "dsxl", "flux"]
META = {
    "v9": ("JuggernautXL V9 (control)",
           "photoreal-biased SDXL + anti-photoreal prompting - incumbent. "
           "30 steps / cfg 6.5 / dpmpp_2m-karras.",
           "License: RunDiffusion/Juggernaut terms (incumbent, already adopted)."),
    "dsxl": ("DreamShaperXL Turbo v2.1",
             "stylized/painterly-native SDXL (Lykon). 8 steps / cfg 2.5 / "
             "dpmpp_sde-karras.",
             "License: CreativeML OpenRAIL++-M (HF Lykon/dreamshaper-xl-v2-turbo) "
             "- commercial use of model+outputs permitted w/ standard use "
             "restrictions."),
    "flux": ("FLUX.2 klein 4B distilled (GGUF Q8_0)",
             "4-step rectified-flow, cfg 1.0 euler; negative prompt inactive "
             "at cfg 1 (zeroed conditioning, official template graph).",
             "License: Apache 2.0 (BFL; 'open weights available for "
             "commercial use'). Quant: unsloth/FLUX.2-klein-4B-GGUF."),
}
SUBJECTS = ["hilt", "tower_shield", "unit-elf", "unit-berserker"]
SEEDS = [101, 202, 303, 404]


def main():
    os.makedirs(OUT, exist_ok=True)
    stats = {}
    for c in CONTENDERS:
        p = os.path.join(SRC, "..", f"runstats_{c}.json")
        if os.path.exists(p):
            stats[c] = json.load(open(p))

    rows = []
    for sub in SUBJECTS:
        for seed in SEEDS:
            cells = []
            for c in CONTENDERS:
                b256 = f"{c}_{sub}_s{seed}_256.png"
                b64 = f"{c}_{sub}_s{seed}_64.png"
                braw = f"{c}_{sub}_s{seed}.png"
                srcdir = os.path.join(SRC, c)
                ok = True
                for fn, sfn in ((b256, f"{sub}_s{seed}_256.png"),
                                (b64, f"{sub}_s{seed}_64.png"),
                                (braw, f"{sub}_s{seed}.png")):
                    sp = os.path.join(srcdir, sfn)
                    if os.path.exists(sp):
                        shutil.copy(sp, os.path.join(OUT, fn))
                    else:
                        ok = False
                key = f"{c}-{sub}-{seed}"
                if ok:
                    cells.append(
                        f'<td><div class="key">{key}</div>'
                        f'<a href="{braw}"><img class="i256" src="{b256}"></a>'
                        f'<img class="i64" src="{b64}"></td>')
                else:
                    cells.append(f'<td><div class="key">{key}</div>'
                                 f'<div class="miss">missing</div></td>')
            rows.append(f'<tr><th>{sub} s{seed}</th>{"".join(cells)}</tr>')

    # Clean perf: every contender re-measured back-to-back on a quiet,
    # exclusive box (tools/req0136_perfprobe.py), cold model load discarded.
    # The in-leg timings are NOT usable -- those legs were generated while the
    # box was OOM-thrashing and sharing the GPU with a second runner.
    probe = {}
    pp = os.path.join(SRC, "..", "perfprobe", "perfprobe.json")
    if os.path.exists(pp):
        probe = json.load(open(pp)).get("results", {})

    heads = []
    for c in CONTENDERS:
        name, cfg, lic = META[c]
        pr = probe.get(c, {})
        st = stats.get(c, {})
        if pr.get("warm_median_s"):
            secs = pr["warm_median_s"]
            per48 = secs * 48 / 3600.0     # a 12-unit roster batch x 4 seeds
            perf = (f'<b class="perf">{secs:.0f} s/img</b> warm '
                    f'(median, quiet box) &middot; VRAM peak '
                    f'{pr.get("vram_peak_mib","?")} MiB &middot; a 48-candidate '
                    f'roster batch = <b>{per48:.1f} h</b>')
        else:
            perf = (f'VRAM peak {st.get("vram_peak_mib","?")} MiB &middot; '
                    f'clean s/img pending')
        heads.append(f"<th><b>{name}</b><br><small>{cfg}<br>{perf}<br>"
                     f"{lic}</small></th>")

    html = f"""<!doctype html><meta charset="utf-8">
<title>REQ-0136 icon checkpoint bakeoff</title>
<style>
body{{background:#131820;color:#E9E3D3;font:14px/1.5 system-ui;margin:20px}}
table{{border-collapse:collapse}}
td,th{{border:1px solid #3D434C;padding:8px;vertical-align:top;text-align:left}}
th small{{color:#A8A193;font-weight:400}}
.i256{{width:256px;height:256px;background:
  repeating-conic-gradient(#28313E 0% 25%,#1a2028 0% 50%) 0 0/32px 32px;
  display:block}}
.i64{{width:64px;height:64px;background:
  repeating-conic-gradient(#28313E 0% 25%,#1a2028 0% 50%) 0 0/16px 16px;
  margin-top:6px;display:block;image-rendering:auto}}
.key{{color:#C9A959;font-weight:600;margin-bottom:6px}}
.miss{{color:#E25822}}
.perf{{color:#7FB069}}
h1{{color:#C9A959}}
</style>
<h1>REQ-0136 - icon checkpoint bakeoff</h1>
<p>Same subjects (2 items + 2 unit busts), same seeds (101/202/303/404),
incumbent matte (birefnet-general + border-key fallback). 256 px board view +
64 px cell view per candidate (G4). Verdict by candidate key, e.g.
<b>"dsxl-hilt-202 green"</b>, or by rule ("dsxl all green"). Click 256px
image for the raw 1024px generation.</p>
<p><b>What this bakeoff is for:</b> JuggernautXL V9 is photoreal-biased and is
being prompt-corrected toward painterly output on every generation. Judge the
STYLE first -- which column looks like the game without being argued into it --
and read the speed line as a constraint, not as a vote.</p>
<p><small>Perf re-measured on a quiet, exclusive box after the fact
(<code>tools/req0136_perfprobe.py</code>): the in-leg timings were taken while
the box was OOM-thrashing and are not comparable. Cold model load discarded;
median of 3 warm generations at 1024x1024 on the RTX 2080 (8 GB).</small></p>
<table>
<tr><th>subject / seed</th>{"".join(heads)}</tr>
{chr(10).join(rows)}
</table>
"""
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(html)
    print("gallery:", os.path.join(OUT, "index.html"))


if __name__ == "__main__":
    main()

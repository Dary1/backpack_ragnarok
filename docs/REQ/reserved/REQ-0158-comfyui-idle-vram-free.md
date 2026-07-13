# REQ-0158 -- ComfyUI as a service + idle VRAM free

## Trigger

User report (2026-07-14): pressing **Generate next seed** in the art admin
(`https://backpack-dev.qtie.jp/app/#/artadmin`) returns
`<urlopen error [Errno 111] Connection refused>`.

## Root cause

Not a network/LAN issue -- the error is raised inside the SERVER, in Python:

```
browser -> backpack-web(8801)/tunnel -> backpack-api(8802)
        -> tools/art_job.py -> tools/art_route.py
             COMFY = "http://127.0.0.1:8188"   (art_route.py:42)  <- urlopen here
```

ComfyUI was simply not running on llmlocal: nothing LISTENing on 8188, no ComfyUI
process, GPU (RTX 2080) at 9 MiB used. `backpack-api` / `-web` / `-tunnel` were all
active, so the request reached the API and died at the ComfyUI hop. ComfyUI has
never been service-ified -- it is started by hand
(`docs/llm_managed/art_pipeline.md:59`), so any reboot or forgotten start silently
breaks the whole art-admin generate path with an error message that looks like a
network fault.

## Decision (user, 2026-07-14)

Option **A**: keep ComfyUI up permanently, and cool the GPU down when idle.

- ComfyUI becomes a `systemd --user` service -> 8188 is always LISTENing, so
  ECONNREFUSED cannot recur.
- A watchdog frees VRAM after **10 minutes** of an empty queue (user-set threshold)
  via `POST /free {"unload_models": true, "free_memory": true}`.
- Rejected: (B) restart-on-idle -- costs an ~8 min cold load on the next generate;
  (C) `--disable-smart-memory` -- taxes every run instead of only idle ones.

## Claim audit: "RESTART ComfyUI between routes/legs -- /free is not enough"

`docs/llm_managed/unit_icon_pipeline.md:237` (LLM-authored scratch note, not user
canon) was checked against the ComfyUI 0.26.0 checkout before relying on `/free`.

**The claim is wrong for VRAM and right for host RAM.**

- `POST /free` -> `PromptQueue.set_flag()` -> `not_empty.notify()`
  (`execution.py:1387-1390`) wakes the idle prompt worker immediately; the worker
  then runs `unload_all_models()` and, within one gc interval (~10 s),
  `gc.collect()` + `soft_empty_cache()` (`main.py:383-402`).
  `soft_empty_cache()` calls `torch.cuda.empty_cache()` + `ipc_collect()`
  (`model_management.py:1950`). VRAM **is** returned to the driver, and it works
  while the queue is empty -- which is exactly the idle case this REQ needs.
- The note's own evidence ("weights return to the Python allocator, not the OS",
  "~19 GB RSS", "fills swap", the 8 OOM kills of 2026-07-12 from rembg
  `alpha_matting` overlapping a resident model) is about **host RSS**, not VRAM.
  That part stands: a long-lived process that has served SDXL and then FLUX does
  bloat, and only a restart returns that memory.

Correct statement: *crossing model FAMILIES bloats host RSS, so restart between
routes/legs; VRAM is released fine by /free.* The doc line is amended in this REQ.
With flux2 as the single route (REQ-0150), family-crossing should not occur in the
art-admin path at all; `RSS_RESTART_MB` in the watchdog is the escape hatch if it
ever does (default off).

## Implementation

- `tools/comfyui_idle_free.py` -- watchdog. Polls `GET /prompt`
  (`exec_info.queue_remaining`, which counts pending **and** running) every 30 s.
  Empty for `IDLE_SECONDS` (default 600) and torch holding more than `MIN_FREE_MB`
  (from `GET /system_stats`: `torch_vram_total - torch_vram_free`) -> `POST /free`,
  then log the resulting VRAM. Idempotent: will not re-issue until ComfyUI is busy
  again, so an idle box generates no traffic. ComfyUI unreachable -> reset state and
  keep polling (systemd restarts it).
- `deploy/systemd/comfyui.service` -- `WorkingDirectory=%h/ComfyUI` (mandatory:
  ComfyUI resolves `models/`, `input/`, `output/`, `custom_nodes/` relative to cwd --
  the docs' bare `~/ComfyUI/venv/bin/python main.py` fails from any other cwd),
  `Restart=on-failure`, `TimeoutStartSec=0` (a cold FLUX load must not look like a hang).
- `deploy/systemd/comfyui-idle-free.service` -- `IDLE_SECONDS=600`, `BindsTo=comfyui.service`.

## Gates

- G1 code: `python3 -m py_compile tools/comfyui_idle_free.py` -- OK.
- G2 service up: `systemctl --user start comfyui` -> 8188 LISTEN, `GET /` 200,
  `GET /system_stats` reports cuda:0 RTX 2080. Verified 2026-07-13 22:29 UTC.
- G3 original bug gone: with ComfyUI up, art admin **Generate next seed** submits and
  runs -- `/api/art/queue` shows `running: batch-004-item-icons-flux2:beast_jaw seed 405`
  (renderId 564). No ECONNREFUSED.
- G4 idle free: PENDING -- watch a real generate, then confirm VRAM drops ~10 min later.

## Deployment notes / open items

- Only ONE ComfyUI may own 8188. During G2 a hand-started instance (the user's, from
  the manual start earlier that day) already held the port, and the systemd copy
  exited with `Port 8188 is already in use` + `Could not acquire lock on
  user/comfyui.db`. Harmless (a lock refusal, no corruption), but the manual instance
  must be stopped before systemd takes ownership. Do not kill it mid-job.
- `comfyui-idle-free.service` runs `%h/backpack_ragnarok/tools/comfyui_idle_free.py`
  -- the MAIN checkout, which is HANDS-OFF. Merging this branch to master (and only
  then enabling the watchdog unit) needs a fresh user go-ahead.
- Linger is already on, so both units come back after a reboot.

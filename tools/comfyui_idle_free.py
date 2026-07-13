#!/usr/bin/env python3
"""REQ-0158 -- ComfyUI idle VRAM watchdog.

ComfyUI is now a long-lived systemd --user service (port 8188 always LISTENing,
so the art-admin generate path can never hit ECONNREFUSED again). The cost of an
always-up ComfyUI is that a loaded checkpoint stays resident in VRAM forever on
an 8 GB RTX 2080, starving every other GPU consumer on the box.

This watchdog polls ComfyUI and, after IDLE_SECONDS with an empty queue, issues
POST /free {"unload_models": true, "free_memory": true}. That flag is picked up
immediately -- PromptQueue.set_flag() calls not_empty.notify(), which wakes the
idle prompt worker (main.py) -- and within one gc interval (~10 s) the worker
runs unload_all_models() + gc.collect() + soft_empty_cache(), returning the VRAM
to the driver. Verified against this ComfyUI checkout, not assumed.

Scope note: /free releases VRAM. It does NOT shrink host RSS -- freed weights go
back to the Python/glibc allocator, not the OS. RSS bloat across model FAMILIES
(the SDXL->FLUX 19 GB incident, 2026-07-12) still needs a process restart; that
is what RSS_RESTART_MB is for, and with the flux2-only route (REQ-0150) it should
essentially never trigger.

Idempotent: after a successful free it will not re-issue until ComfyUI is busy
again, so an idle box produces no traffic.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
IDLE_SECONDS = int(os.environ.get("IDLE_SECONDS", "600"))       # 10 min (user decision)
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "30"))
MIN_FREE_MB = int(os.environ.get("MIN_FREE_MB", "512"))         # below this, nothing worth freeing
RSS_RESTART_MB = int(os.environ.get("RSS_RESTART_MB", "0"))     # 0 = disabled
UNIT = os.environ.get("COMFY_UNIT", "comfyui.service")


def log(msg):
    print("[idle-free] " + msg, flush=True)


def get_json(path, timeout=10):
    with urllib.request.urlopen(COMFY + path, timeout=timeout) as r:
        return json.load(r)


def post_free():
    body = json.dumps({"unload_models": True, "free_memory": True}).encode()
    req = urllib.request.Request(COMFY + "/free", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status


def torch_vram_used_mb():
    """VRAM currently held by torch on the primary device (MB)."""
    dev = get_json("/system_stats")["devices"][0]
    used = dev["torch_vram_total"] - dev["torch_vram_free"]
    return used / (1024 * 1024)


def comfy_rss_mb():
    try:
        pid = subprocess.run(["systemctl", "--user", "show", "-p", "MainPID", "--value", UNIT],
                             capture_output=True, text=True, timeout=10).stdout.strip()
        if not pid or pid == "0":
            return 0.0
        with open("/proc/" + pid + "/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return float(line.split()[1]) / 1024.0
    except Exception:
        pass
    return 0.0


def main():
    log("watching %s idle=%ds poll=%ds min_free=%dMB rss_restart=%s"
        % (COMFY, IDLE_SECONDS, POLL_SECONDS, MIN_FREE_MB, RSS_RESTART_MB or "off"))
    last_busy = time.time()
    freed = False
    while True:
        time.sleep(POLL_SECONDS)
        try:
            remaining = get_json("/prompt")["exec_info"]["queue_remaining"]
        except (urllib.error.URLError, OSError, KeyError, ValueError) as e:
            # ComfyUI down or restarting: reset state, systemd brings it back.
            last_busy = time.time()
            freed = False
            log("comfyui unreachable (%s); waiting" % e.__class__.__name__)
            continue

        if remaining > 0:
            last_busy = time.time()
            freed = False
            continue

        idle_for = time.time() - last_busy
        if idle_for < IDLE_SECONDS or freed:
            continue

        try:
            used = torch_vram_used_mb()
        except Exception as e:
            log("system_stats failed (%s); skipping" % e)
            continue

        if used < MIN_FREE_MB:
            freed = True  # nothing resident; nothing to do until the next job
            continue

        log("idle %.1f min, torch VRAM %.0f MB -> POST /free" % (idle_for / 60.0, used))
        try:
            post_free()
        except Exception as e:
            log("/free failed (%s); will retry next poll" % e)
            continue

        time.sleep(15)  # worker unloads + gc within ~10 s
        try:
            log("freed: torch VRAM now %.0f MB" % torch_vram_used_mb())
        except Exception:
            pass
        freed = True

        if RSS_RESTART_MB:
            rss = comfy_rss_mb()
            if rss > RSS_RESTART_MB:
                log("RSS %.0f MB > %d MB -> restarting %s" % (rss, RSS_RESTART_MB, UNIT))
                subprocess.run(["systemctl", "--user", "restart", UNIT], timeout=120)
                last_busy = time.time()
                freed = False


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)

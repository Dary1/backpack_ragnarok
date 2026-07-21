#!/usr/bin/env python3
"""REQ-0274 -- GPU thermal-profile follower (fan-noise governor).

Runs as a root system service. Drives the Alienware ACPI platform_profile from
observed GPU demand so the aggressive "performance" fan curve is engaged ONLY
while the GPU is actually working, and the box falls back to the quiet
"balanced" curve when idle.

Background
----------
gpu-fullpower.service used to pin platform_profile=performance at boot and leave
it there forever. On this Alienware Area-51m the "performance" profile unlocks an
aggressive fan curve: needed to sustain the RTX 2080 Mobile at 180 W under load
(on "balanced" the driver hits its thermal target and applies SW Thermal
Slowdown), but on an idle box it just means the fans howl for nothing. This
service replaces the static pin with demand-following so the fans are loud only
when there is heat to move.

'nvidia-smi -pl' is NOT usable here -- this is a mobile GeForce part and NVML
reports "Changing power management limit is not supported". platform_profile is
the only lever we have, and it is exactly the fan-curve lever we want.

Demand signal (busy := either is true)
--------------------------------------
  1. ComfyUI queue non-empty. GET {COMFY}/prompt -> exec_info.queue_remaining>0.
     This is the primary art-pipeline consumer and it declares its own backlog,
     so we raise to performance the instant a job is enqueued -- before util has
     even ramped.
  2. GPU utilisation >= UTIL_THRESHOLD (%). nvidia-smi utilization.gpu. Catches
     every OTHER GPU consumer on the box (stable-fast-3d, UniRig, forge, ad-hoc
     training) that does not go through ComfyUI's queue. ComfyUI's own steady-
     state generation also shows here, so (2) backstops (1) if ComfyUI is mid-run
     with a momentarily empty queue.

Hysteresis
----------
Rising edge is immediate: the moment busy is observed, go to PERF_PROFILE.
Falling edge waits COOLDOWN_SECONDS of continuous idle before dropping to
IDLE_PROFILE, so a burst of back-to-back jobs does not flap the profile (and the
fans) up and down. Writes are idempotent -- the profile is only written when it
actually needs to change, and every transition is logged.

This service does NOT touch persistence mode; gpu-fullpower.service still owns
'nvidia-smi -pm 1'. It only governs platform_profile.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROFILE_PATH = os.environ.get("PROFILE_PATH", "/sys/firmware/acpi/platform_profile")
COMFY = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
PERF_PROFILE = os.environ.get("PERF_PROFILE", "performance")
IDLE_PROFILE = os.environ.get("IDLE_PROFILE", "balanced")
UTIL_THRESHOLD = int(os.environ.get("UTIL_THRESHOLD", "20"))       # % GPU util => busy
COOLDOWN_SECONDS = int(os.environ.get("COOLDOWN_SECONDS", "120"))  # idle before quiet
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "15"))


def log(msg):
    print("[gpu-follow] " + msg, flush=True)


def read_profile():
    try:
        with open(PROFILE_PATH) as f:
            return f.read().strip()
    except OSError as e:
        log("cannot read %s (%s)" % (PROFILE_PATH, e))
        return None


def write_profile(profile):
    """Write platform_profile only if it differs. Returns True on a change."""
    cur = read_profile()
    if cur == profile:
        return False
    try:
        with open(PROFILE_PATH, "w") as f:
            f.write(profile + "\n")
    except OSError as e:
        log("FAILED to set profile %s -> %s (%s)" % (cur, profile, e))
        return False
    log("profile %s -> %s" % (cur, profile))
    return True


def comfy_busy():
    """True if ComfyUI has anything running or pending. None if unreachable."""
    try:
        with urllib.request.urlopen(COMFY + "/prompt", timeout=5) as r:
            remaining = json.load(r)["exec_info"]["queue_remaining"]
        return remaining > 0
    except (urllib.error.URLError, OSError, KeyError, ValueError):
        return None


def gpu_util():
    """Max GPU utilisation across devices (%), or -1 if nvidia-smi fails."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10)
        if out.returncode != 0:
            return -1
        vals = [int(x) for x in out.stdout.split() if x.strip().isdigit()]
        return max(vals) if vals else -1
    except (OSError, ValueError, subprocess.SubprocessError):
        return -1


def is_busy():
    reasons = []
    cb = comfy_busy()
    if cb is True:
        reasons.append("comfyui-queue")
    util = gpu_util()
    if util >= UTIL_THRESHOLD:
        reasons.append("util=%d%%" % util)
    return (len(reasons) > 0), reasons


def main():
    log("governing %s: perf=%s idle=%s util>=%d%% cooldown=%ds poll=%ds"
        % (PROFILE_PATH, PERF_PROFILE, IDLE_PROFILE, UTIL_THRESHOLD,
           COOLDOWN_SECONDS, POLL_SECONDS))
    if read_profile() is None:
        log("platform_profile not available; exiting")
        return 1

    last_busy = 0.0        # epoch of last observed demand (0 => never this run)
    applied = None         # last profile we wrote / observed as our decision
    while True:
        busy, reasons = is_busy()
        now = time.time()
        if busy:
            last_busy = now
            if applied != PERF_PROFILE:
                write_profile(PERF_PROFILE)
                applied = PERF_PROFILE
                log("busy (%s) -> %s" % (",".join(reasons), PERF_PROFILE))
        else:
            idle_for = now - last_busy if last_busy else COOLDOWN_SECONDS + 1
            if idle_for >= COOLDOWN_SECONDS and applied != IDLE_PROFILE:
                write_profile(IDLE_PROFILE)
                applied = IDLE_PROFILE
                log("idle %.0fs -> %s" % (idle_for, IDLE_PROFILE))
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)

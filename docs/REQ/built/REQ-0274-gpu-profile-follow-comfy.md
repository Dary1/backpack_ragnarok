# REQ-0274 — GPU thermal-profile follower (fan-noise governor)

**Status:** built — implemented, verified live on `llmlocal`, branch UNMERGED.
Was: reserved (2026-07-21). NOT yet merged to master; awaiting user acceptance +
main-checkout merge coordination (PROJECT.md hands-off on `~/backpack_ragnarok`).
**Reserved:** 2026-07-21
**Slug:** gpu-profile-follow-comfy
**Branch / worktree:** `req-0274-gpu-profile-follow-comfy` (server, UNMERGED).
**Base:** branched from master `a8693e9`. master was NOT modified.
**Requested by:** user — "switch the server GPU mode based on whether ComfyUI has
a task; when it's left in the changed mode the fan noise is unbearable."

## Problem

`gpu-fullpower.service` pinned the Alienware ACPI `platform_profile=performance`
at boot and left it there forever. On this Area-51m, `performance` unlocks an
aggressive fan curve that is *required* to sustain the RTX 2080 Mobile at 180 W
under load (on `balanced` the driver hits its thermal target and applies SW
Thermal Slowdown). But on an idle box — which it is the vast majority of the
time — that curve just means the fans howl for no heat. `nvidia-smi -pl` is not a
lever here: mobile GeForce reports "Changing power management limit is not
supported", so `platform_profile` is the only (and correct) fan-curve control.

## What shipped

Demand-follow the profile instead of pinning it: `performance` only while the GPU
is actually working, `balanced` (quiet) when idle.

- **`tools/gpu_profile_follow.py`** — the governor (canonical source). Polls every
  `POLL_SECONDS` (15). `busy` := ComfyUI `/prompt` `exec_info.queue_remaining > 0`
  **OR** `nvidia-smi utilization.gpu >= UTIL_THRESHOLD` (20%). The ComfyUI-queue
  signal raises to `performance` the instant a job is enqueued (before util
  ramps); the util signal backstops it and also catches every non-ComfyUI GPU
  consumer (stable-fast-3d, UniRig, forge, ad-hoc training). Hysteresis: rising
  edge is immediate; falling edge waits `COOLDOWN_SECONDS` (120) of continuous
  idle before dropping to `balanced`, so back-to-back jobs don't flap the fans.
  Writes are idempotent (only on actual change) and every transition is logged.
  On a cold start with an idle box it goes quiet immediately (initial
  `last_busy=0` ⇒ already past cooldown).
- **`deploy/systemd/gpu-profile-follow.service`** — system service (root; writing
  `/sys/firmware/acpi/platform_profile` needs root). `After=/Wants=gpu-fullpower`.
  Tunables in `Environment=`. `ExecStopPost` drops to `balanced` if the governor
  stops, so a crash never leaves the fans pinned.
- **`deploy/systemd/gpu-fullpower.service.d/req-0274-no-perf-pin.conf`** — drop-in
  that clears the boot-time `performance` pin and boots to the quiet `balanced`
  baseline instead. NVIDIA persistence mode (`nvidia-smi -pm 1`) is kept; the
  governor owns only the profile.
- **`deploy/systemd/gpu-fullpower.service`** — provenance copy of the shipped unit.
- **`deploy/systemd/README.md`** — install/tunable notes for all art/GPU units.

Deploy target for the script is `/usr/local/sbin/backpack_gpu_profile_follow.py`
(root-owned, outside the qtie git checkout) — the service runs as root, so it does
NOT run from `%h/backpack_ragnarok` like the `--user` comfyui units.

## Decisions (user, 2026-07-21)

- Idle profile = **balanced** (keeps normal CPU/GPU capacity for pnpm build / e2e).
- Cooldown = **120 s** after the queue drains before going quiet.
- Busy signal **includes non-ComfyUI GPU load** via `nvidia-smi` utilisation.
- Implemented as a **formal REQ** per PROJECT.md.

## Verification (live, `llmlocal`, 2026-07-22)

- `python3 -c ast.parse` clean; detection smoke test: `read_profile=performance`,
  `comfy_busy=False`, `gpu_util=0%`, `is_busy=(False,[])`.
- Install + `systemctl enable --now`: service `active`/`enabled`; drop-in applied
  (effective `gpu-fullpower` ExecStart → `balanced`).
- **Idle path:** on start, profile `performance → balanced`; box quiet. ✓
- **Rising edge** (transient `/run` override `UTIL_THRESHOLD=0`): `balanced →
  performance` within one poll, log `busy (util=0%) -> performance`. ✓
- **Falling edge** (transient override `UTIL_THRESHOLD=99 COOLDOWN=10`): after 11 s
  idle, `performance → balanced`, log `idle 11s -> balanced`. ✓
- Transient overrides removed; live config restored to `COOLDOWN_SECONDS=120
  UTIL_THRESHOLD=20`, profile `balanced`, service `active`.

No client/server/e2e code touched ⇒ ci.sh gates N/A for this change.

## Commits

- `e449ad8` docs: reserve REQ-0274.
- `6145f03` REQ-0274: governor script + deploy/systemd units + README.

## Remaining to reach `done`

1. User acceptance (fans quiet at idle, ramp under art load — confirm in normal use).
2. Merge `req-0274-gpu-profile-follow-comfy` → master (coordinate: main checkout is
   hands-off). The live install already runs from `/usr/local/sbin` + `/etc/systemd`,
   so runtime behaviour will not change on merge; merge only lands the source of truth.

## Rollback

`sudo systemctl disable --now gpu-profile-follow.service` (its `ExecStopPost`
leaves the box on `balanced`), then `sudo rm
/etc/systemd/system/gpu-fullpower.service.d/req-0274-no-perf-pin.conf &&
sudo systemctl daemon-reload` to restore the old boot-time `performance` pin.

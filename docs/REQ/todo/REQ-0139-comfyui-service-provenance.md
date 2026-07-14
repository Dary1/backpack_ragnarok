# REQ-0139 — comfyui-service-provenance

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** comfyui-service-provenance
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/item_content_pipeline.md` (ComfyUI manual start;
Step 8 registry), PROJECT.md HANDS-OFF list (art-session assets).

## Goal

Two ops hardenings for the art route:

1. **ComfyUI as a `systemd --user` unit** (linger is already enabled) so batch
   generation does not depend on a manual `main.py` start. Start-on-demand
   (`systemctl --user start comfyui`), NOT enabled-by-default, so the user's
   own art sessions keep full control of the GPU.
2. **Provenance hardening:** every accepted icon records, in
   `content/registry.json` (or a per-batch provenance file it points to), the
   full ComfyUI workflow JSON, checkpoint name + file hash, sampler settings,
   and seed. Today provenance records the drafting agent; art must be equally
   reproducible.

## Constraints

- `~/ComfyUI` itself is user art-session infrastructure (HANDS-OFF): the unit
  file lives in `~/.config/systemd/user/`, wraps the existing venv/main.py
  invocation, and modifies NOTHING inside the checkout.
- Coordinate GPU scheduling with the user's art sessions before first use;
  the unit must be trivially stoppable (`systemctl --user stop comfyui`).

## Scope

- Unit file + `XDG_RUNTIME_DIR` note; start/stop/status verified.
- Registry schema addition + writer-side change in the gen tooling; backfill
  optional (document if skipped).

## Non-goals

No always-on service; no ComfyUI upgrades/plugins; no queueing system.
(The old rider "REQ-0135 handles its own node install under its own go-ahead" is
dead: REQ-0135b returned NO-GO and the ComfyUI-layerdiffuse node + its 908 MB of
weights were removed on 2026-07-12. ComfyUI currently carries no REQ-0135
plugin. REQ-0135a's incident log — three OOM kills, a false "seq5 DONE" against
a dead ComfyUI, sshd down ~10 min — remains this REQ's evidence base.)

## Gates

- Service start/stop cycles cleanly with zero writes inside `~/ComfyUI`.
- Next accepted batch's registry entries carry workflow JSON + model hash.
- User sign-off on the service policy (on-demand only).

## Obsolescence note (2026-07-14, user ruling)
User ruling (orchestrator session, 2026-07-14): largely obsolete — ComfyUI already
runs as a systemd --user unit (comfyui.service, plus comfyui-idle-free.service via
REQ-0158), and art provenance now lives in the artwork registry (REQ-0151/0152 DB
route). Moved todo -> draft as a retirement candidate; if any provenance gap remains
vs the registry route, a narrowed re-spec is a future user decision.

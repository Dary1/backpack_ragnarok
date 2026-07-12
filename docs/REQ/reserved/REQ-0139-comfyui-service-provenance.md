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

No always-on service; no ComfyUI upgrades/plugins (REQ-0135 handles its own
node install under its own go-ahead); no queueing system.

## Gates

- Service start/stop cycles cleanly with zero writes inside `~/ComfyUI`.
- Next accepted batch's registry entries carry workflow JSON + model hash.
- User sign-off on the service policy (on-demand only).

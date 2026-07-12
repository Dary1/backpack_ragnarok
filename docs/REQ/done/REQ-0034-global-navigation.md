# REQ-0034 — Global Navigation Menu

- **Status**: IN PROGRESS (implement now, user directive)

## Spec (user)
Top bar, next to "backpack_ragnarok": global navigation —
バックパックス (the current edit screen) · スケジュール (placeholder) ·
フレンズ (placeholder) · 図鑑 (Encyclopedia, REQ-0035) · 設定 (placeholder).

## Defaults
- Client-side routing (no page reload; module-store route; URL hash sync e.g.
  #/backpacks, #/schedule, #/friends, #/dex, #/settings so links/reloads work).
- Placeholders: titled empty pages with "coming soon" note (JA/EN).
- Backpacks page = existing boards (Pixi apps stay mounted/hidden to respect the
  one-app lifecycle lesson; verify no GL churn on route switch).
- Active item highlighted; E2E: route switching, boards intact after round-trip.

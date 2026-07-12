# REQ-0035 — Item Encyclopedia (図鑑 → アイテム tab) + Admin Edit Mode

- **Status**: IN PROGRESS (implement now, user directive; "large rework")

## Spec (user)
- 図鑑 (Encyclopedia) with main tab **アイテム** only (other tabs come later).
- Display MAXIMUM detail per item.
- If the viewing user has the **"アイテム管理者" (item_admin) role**, they can switch
  to EDIT MODE and edit item values. The edit view is SEPARATE from the display view.

## Design (orchestrator)
- **Display view**: card/list of all POs + SIs from /api/content. Per item: icon
  (sprite v10 render), name JA/EN, id, tags (with hierarchy path), rarity, shape
  mini-grid, ports (tiles + tag, mini-grid overlay), sockets (type/tags/anchor),
  effects — BOTH rendered text (eff_ja/eff_en) and raw AST, flavor JA/EN,
  part/assembly info, stretch flag, provenance (batch/registry where known),
  search + filters (tag, rarity, type-root).
- **Roles until EOS lands**: server /api/me returns {playerId:'dev', roles:[...]}
  from data/config/dev_user.json (dev mode; default includes item_admin). UI shows
  edit toggle only when role present; server REJECTS admin writes without the role
  header/session (dev-grade guard, hardened at EOS phase).
- **Edit mode (separate view)**: form-based editor for item VALUES: names, flavor,
  rarity, tags, effect numeric ranges [lo,hi] / trigger secs, socket fields, port
  tag, stretch. Shape/port TILES editing = view-only v1 (geometry edits interact
  with fit/art pipeline — deferred, noted in UI).
- **Write path**: PUT /api/admin/item/:id → server validates (closed vocab via
  content/vocab.json trees, [lo,hi] sanity, schema keys) → writes content/live/*.json
  atomically → content cache invalidates (mtime) → clients see it on next fetch.
  NO auto git commit (content edits reviewed/committed at batch cadence; noted in
  server README). Draft/staging items NOT editable here (pipeline owns staging).
- E2E: display renders all items with detail; role off → no edit UI + API 403;
  role on → edit a value → persisted in live file + visible after reload;
  invalid value rejected. Engine/API/existing suites stay green.

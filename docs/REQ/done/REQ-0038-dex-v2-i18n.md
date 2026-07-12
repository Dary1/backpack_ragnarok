# REQ-0038 — Dex v2 (shape-mounted icons, diagram layout) + formal i18n

- **Status**: DONE + user feedback round 2 OPEN (2026-07-05)

## Feedback round 2 (user, with screenshot — icons stuck in first cell)
1. Dex dev(edit) mode: icons all render in the TOP-LEFT (first cell) of the shape.
   Do NOT invent a new display algorithm — reuse the EXISTING display system via a
   LOOSELY-COUPLED shared implementation.
2. Same bug in the general view mode — reuse the display algorithm there too.
3. Make the 図解 (diagram) ~5× larger; split the detail panel LEFT/RIGHT.
Fix = extract the board renderer's proven item-on-shape composition (texture +
fitSpriteToBox over the full [row,col] footprint) into one shared pure module;
dex catalog, edit list, and diagram all consume it. More feedback to follow
("他の件については、追ってフィードバック").

## User spec (verbatim intent)
Display:
1. Catalog list: render each item ON its cell shape (icon mounted on the shape grid),
   not as a bare icon.
2. Detail view: show cell shape + ALL Connection Ports, and DIAGRAM the sockets etc.
   in detail (図解).
3. Detail screen splits into two big divs: the DIAGRAM uses the large LEFT space;
   the item LIST moves to the RIGHT side.
Edit mode:
1. Buttons to ADD and DELETE whole Effects (not just edit values).
2. Multilingual fields (Name etc.): show ONLY the currently selected language mode,
   not one input per language.
3. If the data model has per-language fields, adopt FORMAL i18n: standard practice,
   English-based keys, general i18n implementation manner.
4. Edit-mode list also shows small thumbnail icons.

## Design notes (orchestrator)
- Diagram (left pane): large shape grid with the icon composited on it, port tiles
  drawn outside the shape with tag chips + arrows, sockets marked at their ax/ay
  anchors with type/tags callouts, per-cell coordinates labeled; JA/EN respects the
  global language mode.
- i18n formalization: content keeps EN as base fields (name, flavor = English) plus
  an `i18n` map keyed by locale (e.g. {"ja": {name, flavor}}) — migrate current
  name_ja/flavor_ja into it (migration script; tools + server renderer + client read
  the new shape; eff_render locales unchanged as they're generated). Client UI strings
  move to a locale dictionary module (en base keys, ja translations) — standard
  t('key') pattern; language toggle drives both content and chrome.
- Edit view: fields shown for the ACTIVE locale only (locale switcher inside editor);
  effects list with add (template picker per trigger/verb from vocab) and delete;
  server admin validation extended for i18n map + effects add/remove (re-render gate
  stays). Thumbnails in edit list via existing sprite textures.
- E2E: catalog shows shape-mounted entries; detail two-pane layout; effect add/delete
  round-trip (restore after); locale-only fields; i18n content migration integrity
  (JA names preserved byte-identical through migration).

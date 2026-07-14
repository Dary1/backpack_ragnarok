# REQ-0176 — registry-adoption-writes-live

**Status:** draft — raised 2026-07-14 when the user asked the question nobody had asked out
loud: *「つまり、コンテンツ台帳と、実際のライブコンテンツには何の繋がりがないということですか？」*
**The answer is yes. This REQ exists to make that false.**
**Reserved:** 2026-07-14
**Slug:** registry-adoption-writes-live
**Blocks (in spirit):** every content REQ that says "managed in the content admin" — REQ-0155,
0157, 0160, 0161, 0164, 0171, 0173. Each of them is true about the LEDGER and silent about the GAME.

## 1. The finding, stated exactly (source-verified, 2026-07-14)

| | |
|---|---|
| What adoption writes | `content/registry_exports/<kind>/<system_name>.json` — **and nothing else** (`server/services/content_export.cjs` `exportAdopted()`). |
| Who reads `content/registry_exports/` | **Nothing.** `grep -rn registry_exports` across server/client/tools/shared/sim/mock-src returns only the module that writes it. On master today it holds 3 files, all e2e leftovers. |
| Who reads `content/live/*.json` | The game: `server/lib/content.cjs` (`/api/content`) and `server/services/core.cjs` (`getScheduleContent`), both mtime-cached. |
| Who WRITES `content/live/*.json` | **`server/admin.cjs applyAdminEdit()`** — the OLD Dex admin edit (`PUT /api/admin/item/:id`). It writes `live_items.json` / `live_sis.json` directly, bypasses the ledger completely (no def, no variant, no machine checks, no adoption), and covers **po/si only**. |
| `git_committed` in the export record | Read straight off `process.env.CONTENT_EXPORT_GIT`. **There is no git code in that module at all.** The field reports an intention, not an event — and a field that names something it never does is worse than a missing feature. |

So there are **two disconnected write paths**: the ledger (adjudicated, versioned, checked —
reaches nothing) and the legacy admin PUT (unchecked, unversioned, item/si only — reaches the
game). The registry is a beautifully-kept book about a game it cannot touch.

This was ALWAYS the honest state — REQ-0155 called the live-file merge its own S7 step and
never claimed to have done it. What changed is that REQ-0171 put a THIRD kind (gacha_pack) on
the shelf, and the gap stopped being theoretical: an operator can now retune a gacha pool in
the admin, see every check go green, adopt it — and the Workshop keeps rolling the old odds.

## 2. Goal

**Adoption of a variant becomes the act that changes the game.** One path, all kinds.

## 3. Scope (to be specced when picked up)

- `exportAdopted()` (or a sibling `publishAdopted()`) MERGES the adopted variant into its live
  target, per kind:
  `po_def → live_items.json` (+ `dungeon/items.json` — a kind with TWO targets: the entry's
  `provenance.origin_file` is the tie-break, and it is already recorded), `si_def → live_sis.json`,
  `tm_def → live_tms.json`, `unit_def → live_units.json`, `gacha_pack → live_packs.json`,
  `monster_def → dungeon/enemies.json`, `skill_def → dungeon/skills.json`.
- Write discipline = the one already proven in `storage/profiles.cjs`: tmp file + atomic rename,
  never a partial live file. The mtime cache then picks it up on the next read — **no restart**.
- **Deletion/removal semantics.** Adoption is an upsert. What removes an entry from live? (A def
  with no adopted variant? An explicit retire? Today nothing.) **Needs a ruling.**
- **The legacy path must go.** `PUT /api/admin/item/:id` writing live directly is now the
  competing writer — two writers on one file is how a file gets silently clobbered. Either it
  is retired (the Dex edit form posts a variant instead), or it is kept and documented as
  authoritative-over-the-ledger. It cannot be both. **Needs a ruling.**
- **Git.** Live files are tracked. Does a publish commit? (`CONTENT_EXPORT_GIT` was written as
  if it would.) An uncommitted live edit on the box is a divergence between master and the
  running game — which is exactly what REQ-0170's own deploy had to reconcile by hand.
- Gate: a machine-check FAIL must never reach live. Adopting a FAILing variant is already
  possible behind an explicit override — publishing one must be a separate, louder decision.

## 4. Non-goals

- New kinds; new checks; the admin UX.
- The artwork registry's own export (`content/art/`), which has the SAME shape of gap but a
  different consumer (`/api/art/<name>.png` serves from the DB, so art ALREADY reaches the game
  — the export is a mirror, not the channel). Art is fine; data is not.

## 5. Why this is one REQ and not seven

Every kind has the same gap for the same reason. Fixing it per-kind would mean seven merge
functions, seven conflict rules and seven chances to disagree about what "adopted" means.

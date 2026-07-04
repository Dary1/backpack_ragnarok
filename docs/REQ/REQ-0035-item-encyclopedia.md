# REQ-0035 -- Item Encyclopedia (図鑑) + Admin Edit Mode

Status: spec, written before implementation (see REQ-0034's status note;
same convention).

## Goal

A reference/wiki view of every item (POs from `live_items.json` + SIs
from `live_sis.json`) reachable at `#/dex` (REQ-0034's nav), plus a
dev-grade admin edit mode gated by a role check.

## Server: GET /api/me

Returns the current dev "session" identity, read from
`data/config/dev_user.json` (repo-relative `~/backpack_ragnarok/data/...`
-- `data/` is already gitignored, confirmed via `.gitignore`, so this
file never enters version control, matching `data/profiles/`'s existing
treatment). If the file does not exist at server boot, it is created with
`{"playerId":"dev","name":"Developer","roles":["item_admin"]}`.

Contract: `GET /api/me` -> `200 {playerId, name, roles}` (exactly the file
contents, no wrapping). No auth on this endpoint itself -- it always
answers as "the local dev user" (there is no login/session system yet;
this whole feature is explicitly dev-grade per the task, with hardening
deferred to the EOS/auth phase, same posture as the existing profile PUT
"accepted dev risk" note in `server/README.md`).

## Server: PUT /api/admin/item/:id

Auth guard: request must carry header `X-Player-Id` matching a user in
`dev_user.json` whose `roles` includes `item_admin`. Today's
`dev_user.json` models exactly one user, so in practice this means "the
header's value equals the file's `playerId` AND that user has the role" --
written as a general lookup (not a single-value string compare) so it
keeps working unchanged if `dev_user.json` ever grows a list of users.
Missing header, unknown player id, or a known player id without the role
-> `403`. **This is intentionally dev-grade** (a client-supplied header is
not real authentication) -- hardening (real sessions/tokens) is deferred
to the EOS/auth phase, same as the profile-PUT accepted-risk note.

Path param: `:id` must exist in `content/live/live_items.json` or
`content/live/live_sis.json`. There is currently no `content/staging/` or
`content/draft/` directory in this repo (confirmed by listing `content/`)
-- so today this rule is enforced simply as "reject if `:id` is not found
in either live file", which is already correct: it can never accidentally
match a draft/staging id because none exist yet, and the check is written
against "is it in the live set", not "is it NOT in some staging set", so
it remains correct if/when a staging directory is introduced later
(a staging-only id still fails the live lookup and gets rejected).

Request body: JSON object, key allowlist depends on whether `:id` resolves
to a PO (`live_items.json`) or an SI (`live_sis.json`):

- Common editable keys: `name`, `name_ja`, `flavor`, `flavor_ja`, `rarity`,
  `tags` (PO only -- SIs have no `tags` field in the current schema),
  `effects`, `sockets` (PO only, per schema `po/2`), `stretch` (PO only).
- Any other top-level key in the body -> `400` (schema allowlist,
  "reject unknown/extra keys").
- Fields not sent are left unchanged (PATCH-like partial update semantics
  applied via PUT, matching the task's form-editor scope -- shape/ports
  are never sent since the client never offers them for edit).

Validation (ALL server-side, never trust the client):

1. `rarity` (if present) must be one of `vocab.json`'s `rarities` array.
2. `tags` (if present, PO only): every tag must be a key in
   `vocab.json`'s `po_tags` tree; `tags[0]` is the type root by this
   project's existing convention (see every live item entry -- `tags[0]`
   is always the top-level po_tag with a `null` parent, e.g. `Weapon`,
   `Shield`, `Rune`; the client UI must label this constraint, the server
   does not further enforce "must be a root" beyond "must be a known tag"
   since the vocab tree itself does not mark which keys are roots except
   by their `null` parent value -- the server DOES check that, since it's
   free: `vocab.po_tags[tags[0]] === null` or reject).
3. `effects` (if present): each effect's `trigger.t` must be one of
   `vocab.triggers`; each effect's `verb.t` must be one of `vocab.verbs`;
   any `status` field (on `apply_status`/`add_on_hit_status`/`amp_status`)
   must be one of `vocab.statuses`. Any `[lo,hi]` numeric range anywhere in
   an effect (`trigger.s`, `verb.n`) must satisfy `lo <= hi` and both
   values `> 0` -- reject otherwise (rejects `[5,2]`, `[0,4]`, `[-1,3]`).
4. `sockets` (if present, PO only): each socket's `t` must be one of
   `vocab.socket_tags` keys; each socket's `tags` entries must also be
   known `socket_tags` keys; `ax`/`ay` if present must be finite numbers.
5. After applying the edit (in-memory, on a clone of the live entry, never
   partially applied to the on-disk file), the merged entry's `effects`
   array is re-rendered through `tools/eff_render.cjs`'s `render()` for
   both `en` and `ja` locales. If rendering throws for ANY effect, the
   whole write is rejected (`400`) and NOTHING is persisted -- this is
   the same re-render-and-verify step `server/api.cjs`'s `/api/content`
   already performs on every read, just moved to write-time as a
   pre-commit gate.

On success: atomic write (temp file in the same directory + `fs.renameSync`,
same pattern as `server/storage.cjs`'s `writeProfile`) to whichever of
`content/live/live_items.json` / `content/live/live_sis.json` the id
belongs to. No other file is touched. The admin endpoint never invokes
git -- content edits are reviewed and committed at batch cadence by a
human/orchestrator (documented in `server/README.md`).

Cache invalidation: `server/api.cjs`'s `/api/content` cache is already
mtime-checked (`getContent()` compares `statSync(...).mtimeMs` against the
cached values on every request) -- `fs.renameSync` updates the destination
file's mtime, so the very next `/api/content` request after a successful
admin write naturally sees the change with no server restart and no new
cache-invalidation code needed. Confirmed by reading `server/api.cjs`
before writing any code (task instruction).

## Client: dex display view (`#/dex`)

Route renders a tab row with only アイテム (Items) active; additional
tabs (reserved for future SI-only/BP-only/search-preset views, etc.) are
visually present but disabled, per the task spec's "other tabs visually
present but disabled/reserved for later" instruction -- this repo has no
existing multi-tab-row precedent to match beyond `Tabs.tsx`/`PresetTabs.tsx`
(inventory pages / canvas presets), so the same button-row visual language
is reused with a `disabled` attribute + dimmed style for the reserved tabs.

Item source: `GET /api/content`, combining `items` (POs) + `sis` (SIs) --
same payload the board already consumes, no new endpoint needed for
reading.

Per-item card (maximum detail, per task spec):
- Icon: reuses `board/sprites.ts`'s `loadSpriteTextures()`/symbol
  rasterization pipeline (already solves the multi-root-SVG-sheet parsing
  problem, see that file's module comment) -- rendered here as a `<canvas>`
  snapshot of the same rasterized texture (simplest path that reuses the
  existing, already-tested pipeline verbatim, no new SVG `<use>` fork).
- Name JA + EN, id, rarity.
- Tags with full ancestry: walks `vocab.json`'s `po_tags` tree from each
  tag up to its `null`-parented root (SIs have no tags field, so this
  section is PO-only, matching the schema).
- Shape as a mini-grid: renders `shape: Array<[row,col]>` respecting the
  **[row,col], not [col,row]** convention (cited in `mock-src/engine.js`,
  e.g. "coordinates are [row,col], SAME convention" at engine.js:447) --
  the grid's rows come from each cell's first element, columns from the
  second, matching the engine 1:1 with no transposition.
- Ports: tile mini-grid overlay (same [row,col] cells, offsets relative to
  the item's own shape) + tag chip.
- Sockets: type/tags/anchor (`ax`/`ay`).
- Effects: BOTH the rendered human text (`eff_ja`/`eff_en`, already on the
  `/api/content` payload -- REQ-0024 gap closure) AND a collapsible raw
  AST JSON (`<details>`/`<pre>`, no library needed).
- Flavor JA + EN.
- Part/assembly info (`part.assembles`/`part.role`, PO-only).
- `stretch` flag.
- Provenance: resolved from `content/registry.json` where possible --
  today's registry only records batch-level provenance (`content/
  registry.json`'s `batches[]`, keyed by batch id, not by item id), so
  per-item provenance display shows the batch info directly (`drafted_by`/
  `icons_by`/`date`/`status`) for whichever entry matches, with an honest
  "no per-item mapping available" fallback when the registry can't be
  resolved to a specific item -- this repo's registry schema does not yet
  carry a batch->item-id list, so exact per-item resolution is out of
  scope here (documented as a judgment call, not silently guessed).

Search: matches name (EN or JA) or id, case-insensitive substring.
Filters: rarity (dropdown), tag (dropdown, PO tag vocabulary).

## Client: edit mode

Separate view/layout (not overlaid on the display cards) -- entered via a
toggle visible ONLY when `GET /api/me`'s `roles` includes `item_admin`.
Selecting an item in edit mode opens a form:

- Names (JA+EN), flavor (JA+EN): free text.
- Rarity: dropdown from `vocab.rarities`.
- Tags (PO only): multi-select from the `po_tags` tree; `tags[0]` is
  explicitly labeled as the type root in the UI (a fixed "type" slot,
  not just first-in-list) -- the editor does not let users freely reorder
  into any position without the constraint being visible.
- Effects: per effect, trigger-type dropdown (`vocab.triggers`) + secs
  `[lo,hi]` two numeric inputs (only meaningful for `every_secs`), verb
  dropdown (`vocab.verbs`) + `n` `[lo,hi]` two numeric inputs, plus
  status/mult fields shown conditionally when the selected verb uses them
  (`apply_status`/`add_on_hit_status`/`amp_status` -> status dropdown from
  `vocab.statuses` [+ mult for `amp_status`]).
- Sockets (PO only): `t` (socket type dropdown from `vocab.socket_tags`),
  `tags` (multi-select from the same tree), `ax`/`ay` numeric anchor
  inputs.
- Port tag: view-only. Tiles: view-only.
- `stretch`: checkbox.
- Shape and port TILES are view-only with a visible bilingual note:
  "geometry editing comes later (fit/art pipeline)" / "形状編集は今後対応
  予定（fit/アートパイプライン）" -- matching the project's bilingual-UI
  convention (inline JA/EN strings keyed off `locale`, same as every other
  component).

Save -> `PUT /api/admin/item/:id`, header `X-Player-Id` set to the current
`/api/me` `playerId`. Server validation errors (400/403) are surfaced
in the form (not swallowed).

## Deferred (explicitly out of scope here, per task + judgment calls above)

- Shape/port geometry editing -- "comes later (fit/art pipeline)" per the
  task's own instruction; the view-only note above documents this in the
  UI itself.
- Real authentication/session hardening for the admin endpoint -- explicit
  dev-grade posture, deferred to the EOS/auth phase (same posture as the
  existing profile-PUT accepted-risk note).
- Per-item provenance resolution beyond batch-level -- `content/
  registry.json`'s current schema has no item-id list per batch; adding
  one is a content-pipeline change outside this REQ's scope.
- Additional dex tabs beyond アイテム (Items) -- reserved/disabled per
  spec, no behavior defined yet.

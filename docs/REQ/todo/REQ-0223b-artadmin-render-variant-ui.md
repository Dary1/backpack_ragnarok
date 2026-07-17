# REQ-0223b — artadmin-render-variant-ui: the lightbox A/B strip over same-seed twins

**Split from REQ-0223** on 2026-07-17 under PROJECT.md's multi-phase rule (phases that can
hold different statuses become independent files). REQ-0223a landed the schema, storage and
routes and is `built/`; this file carries the client half, which is untouched by it and can
sit in `todo/` on its own.
**Ratified:** shape (c), owner 2026-07-17 — see REQ-0223a for the decision and its record.

## Why this is a separate phase, not an afterthought

0223a made same-seed twins REPRESENTABLE and reachable over HTTP. It did not make them
VISIBLE. Today an operator who takes a one-shot lock override twice on one seed gets two
rows the artadmin UI will render as two cards that both say "seed 42" and are otherwise
indistinguishable — worse than the DUPLICATE_SEED error it replaced, because it looks like
a duplicate bug rather than a feature. Until this REQ lands, twins are an API capability
with a misleading UI, so 0223a is deliberately NOT `done`: it is complete, but the workflow
it exists to serve is not yet usable from the screen.

## The actual work (and why it is bigger than it sounds)

The artadmin client is keyed on a bare seed in three components, because until 0223a a seed
WAS a render's identity:

- `ArtAdminPage.tsx` — `ConfirmState { seed }`, `LightboxState { seed, compareWith }`,
  `comparePicks: number[]`, `okSeeds`, and every `do*(seed)` action.
- `Workspace.tsx` — one card per `r.seed`, keyed `render-<seed>`, with `adopt-<seed>`,
  `delete-<seed>`, `pick-<seed>`, `retry-<seed>`, `repack-<seed>` testids.
- `Lightbox.tsx` — `seeds: number[]` nav ring, `fitBySeed`, `adoptedSeed`, `onAdopt(seed)`,
  and the existing 2-up compare, which takes two SEEDS.

Each of those must widen to a render ref `(seed, variant)`. The 2-up compare is the one that
matters: it is REQ-0186's V4 loop, and it currently cannot express "this seed's two locks"
because both halves would name the same number.

## Shape to implement
- `RenderDto` gains `variant` (0223a's API already returns it).
- `artRenderUrl(name, seed, variant)` appends `?variant=N` only when N > 0 — 0223a's routes
  read exactly that, and a bare URL still means variant 0.
- Ref-key the three components: `(seed, variant)`, keyed `s + '/' + v` where a map is needed.
- Lightbox groups renders sharing a seed into an A/B strip, adjacent and in slot order
  (0223a's `listRenders` already returns them that way, so the grouping is a fold, not a
  re-sort). Adopting from either half is `adopt {seed, variant}`.
- `twin: true` / one-shot-override generate is surfaced so the operator can ASK for the twin
  (0223a auto-picks it whenever a one-shot override rides along, so the common path already
  works headlessly).

**Testid compatibility — deliberate.** Keep `render-<seed>` et al EXACTLY as they are for
variant 0 and suffix only twins (`render-<seed>-v<N>`). Five e2e specs (artadmin,
artinspect, dex-admin, contentadmin, reference-model) address renders through those ids, and
variant 0 is the render they have always meant. This mirrors 0223a's DB/route hinge — absent
means 0 — so the specs stay green without edits, and the diff stays about twins.

## Gate results — GREEN

- **`artadmin` e2e: 8 passed, 0 failed** (1.7 min), including the new
  **'REQ-0223 same-seed A/B: one seed at two locks -> two cards -> lightbox strip -> adopt the
  twin'**. The seven pre-existing specs pass UNEDITED, which is the testid-compatibility claim
  above holding in practice rather than in theory.
- **V4 compare loop re-run, through the UI** — the demonstration REQ-0187 could not produce.
  Driven through the real controls (`art-seed` 42, `art-gen-lock` strict -> generate; then the
  SAME seed at lock `off` -> generate), the spec asserts against the API that the pair is a
  TRUE A/B: `rows.filter(seed === 42).length === 2`, `params.shape_lock` strict vs off,
  `a.params.seed === b.params.seed` (the seed is HELD, not burned), and the edit-instruction
  delta present in A and absent in B. Then: both cards visible, the twin labelled `·v1`, the
  lightbox strip offering `lightbox-strip-42` + `lightbox-strip-42-v1`, the two-up captioned
  `same seed`, adoption landing on the twin (`render-42-v1` ADOPTED, `render-42` not), the
  adopted twin undeletable, its sibling deletable without touching it.
- **Rebased onto master** (REQ-0236 disposition for an open REQ: rebase onto >= bc6c012 +
  re-provision pnpm in `.`, `client/`, `server/`). Post-rebase `artwork_test`: **16 passed, 0
  failed**. No conflicts.
- **`ART_FAMILY_BARRIER=0` was needed to get a trustworthy run** — NOT a property of this REQ.
  REQ-0233's family barrier restarts the real `comfyui.service` from a `ART_ROUTE_MOCK=1`
  harness; caught mid-restart, it dragged this suite past 9 min (killed) vs 1.7 min green with
  REQ-0233's own documented unit-test seam. Filed as **REQ-0246**; once that lands the seam
  belongs in the harness and this note can go.

### Two findings worth keeping

1. **`artwork_test` never covered the route-level auto-twin.** Its A/B spec calls
   `storage.createRender(.., {twin:true})` directly, so REQ-0223a's actual fix — a one-shot
   lock override INFERRING the twin in `hGenerate` — first executed in this e2e. A green unit
   suite said nothing about it. That is the gap the e2e closed.
2. **An unbuilt `web/app` silently tests the WRONG client.** The harness serves the docroot
   straight from the worktree (`python3 -m http.server --directory "$WT/web"`), so after the
   rebase discarded the stale dist, the browser ran MASTER's bundle against this branch's
   server. The twin row was created correctly and the old bundle keyed both cards on the bare
   seed, so `render-42-v1` never existed — a failure that reads as "my feature is broken" and
   is actually "you shipped the wrong JS to the test". `deploy: rebuild client dist` is a gate
   step, not bookkeeping.

## Out of scope## Out of scope
- Any schema change (0223a is the schema; reopen it, don't fork it here).
- Bulk regeneration tooling; generation-recipe changes.
- Retiring the derived-seed convention (`seed + 100000`, REQ-0192 repack / REQ-0193 cutout).
  It overlaps conceptually with twins — both mean "a variant of this render" — but it is a
  SEPARATE render with its own provenance, it works, and collapsing the two is its own REQ
  with its own migration. Note the overlap; do not act on it here.

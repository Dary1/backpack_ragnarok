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

## Gates
- artadmin e2e green including a NEW same-seed A/B spec: generate a seed, generate the SAME
  seed at a second lock, both appear as distinct cards, the lightbox opens them as an A/B
  strip, adopting the twin adopts the twin (not its sibling).
- The V4 compare loop from REQ-0187 re-runs THROUGH THE UI with a TRUE same-seed pair and is
  recorded here as the demonstration. (0223a's `artwork_test` already proves the pair at the
  storage/queue level: 'REQ-0223 TRUE same-seed A/B'. This gate is about the operator loop.)
- e2e ports derive from `source tools/e2e_ports.sh 0223` → 2230/2231/2232. The 0223 decade is
  claimed by THIS harness only; 0223a ships no harness, so the a/b split does not put two
  harnesses in one decade (`tools/check_e2e_ports.cjs` step [0/8] enforces it).

## Out of scope
- Any schema change (0223a is the schema; reopen it, don't fork it here).
- Bulk regeneration tooling; generation-recipe changes.
- Retiring the derived-seed convention (`seed + 100000`, REQ-0192 repack / REQ-0193 cutout).
  It overlaps conceptually with twins — both mean "a variant of this render" — but it is a
  SEPARATE render with its own provenance, it works, and collapsing the two is its own REQ
  with its own migration. Note the overlap; do not act on it here.

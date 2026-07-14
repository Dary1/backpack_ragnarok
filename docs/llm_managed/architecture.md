> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# backpack_ragnarok — Architecture & Framework Design

Audience: any developer (human or agent) joining this codebase. This is
the big-picture map; per-directory READMEs (`server/`, `sim/`, `client/`)
carry the fine detail, and `docs/REQ-*.md` carry per-change rationale.
Status: post REQ-0047 rework. ~31k LOC hand-written.

## 1. What this is

A browser game (backpack-management RPG) plus its own content pipeline,
built solo-scale but with production discipline. One repo, one server
box, no external CI/CD — quality is enforced by a single local gate
(`tools/ci.sh`) and by frozen executable contracts (tests + goldens).

## 2. Runtime topology

```
browser ── Cloudflare Tunnel ──> :8801  backpack-web  (static, serves web/ as-is:
                                        /app  = committed client dist
                                        /mock = legacy mock UI
                                        /preview = content previews)
                                 :8802  backpack-api  (systemd --user unit,
                                        ExecStart: node server/api.cjs,
                                        env from server/.env)
                                          │
                                          ├─ sim/ (combat simulator, in-process)
                                          ├─ mock-src/engine.js (game engine, in-process)
                                          └─ storage seam (STORAGE_BACKEND)
                                               ├─ 'files' → data/*.json (dev/test default)
                                               └─ 'pg'    → Supabase Postgres via
                                                  Supavisor pooler 127.0.0.1:6543
                                                  (PROD since REQ-0040; sync bridge
                                                  = server/pg_sync.cjs Atomics worker)
```

Both ports bind 127.0.0.1 only; the tunnel is the sole ingress.

## 3. The five load-bearing design rules

1. **The engine is consumed AS-IS.** `mock-src/engine.js` (hand-written
   UMD JS) is the single source of truth for game-state math. Three
   consumers, none may fork or modify it: the client (raw-source CJS shim
   in `client/src/engine/adapter.ts`), the sim (read-only interop — never
   calls a mutator, deep-copies every snapshot), and the legacy mock UI.
   Its typed surface lives in `shared/engine.d.ts` and is mechanically
   verified against the runtime by `tools/check_engine_types.cjs`.
2. **Combat is a deterministic pure function.** Same (snapshot, defs,
   seed) ⇒ byte-identical replay JSONL, always. Seeded RNG with named
   sub-streams, event heap with (t,seq) tie-break, compile-then-simulate
   boundary. Frozen by `sim/tests/goldens.cjs` (12-case sha256 matrix) —
   if a refactor changes any hash, the refactor is wrong.
3. **Facades are frozen API.** `sim/combat.cjs`, `sim/dungen.cjs` and
   `server/schedule.cjs` re-export their decomposed internals name-for-
   name. Consumers require the facade, never `lib/`/`services/` directly.
   Add new exports at the facade deliberately.
4. **All persistence goes through the storage seam.** `server/storage.cjs`
   (+ `players.cjs`) own every read/write; backend chosen by env var.
   Both backends must pass the same api_test suite. Never touch
   `data/` or Postgres from anywhere else.
5. **The client's auto-save PUT is the ONE profile writer.** Server
   routes never write a player's canvas as a side effect. Anything that
   grants items uses the two-phase pattern (REQ-0041/0042): server flips
   a warehouse/gacha row to pending → client places it via the engine →
   the debounced auto-save PUT persists → the PUT handler finalizes the
   pending row (best-effort, lazy-timeout reverts abandoned claims).

## 4. Directory map

| Path | What it is |
|---|---|
| `mock-src/engine.js` | THE game engine (rule 1). `mock-src/tests/run.cjs` = its suite. |
| `sim/` | Combat simulator. `combat.cjs`/`dungen.cjs` facades over `sim/lib/{core,rng,heap,geometry,formation,status,compile,entry,ray,field,replay,skills,packs,encounter,dungeon}.cjs` (acyclic). Dependency-free by invariant. |
| `server/` | Framework-free `node:http` API. `api.cjs` (entry) → `router.cjs` (load-bearing dispatch order) → `routes/{public,me,admin,profile,schedule,warehouse,workshop,market,ragnarok,dex,dismantle,art,content}.cjs` (REQ-0145a: the combined schedule module split into schedule/warehouse/workshop, dispatched consecutively in its old slot; shared caller preamble in `lib/route_auth.cjs`) → business logic behind name-for-name facades (rule 3): `schedule.cjs` over `services/{core,rooms,squads,runs,warehouse,gacha}.cjs`, `services/market.cjs` over `services/market/{lib,listings,views,trade,furnace}.cjs`, `services/ragnarok.cjs` over `services/ragnarok/{lib,seasons,einherjar,order,snapshot,devotion}.cjs` (`deployedUidSet` lives in `services/squads.cjs`, its true domain); plumbing in `lib/{content,content_files,http_util,humanize,meta,route_auth}.cjs`; persistence behind the `storage.cjs` facade (rule 4) over `storage/{lib,profiles,rooms,runs,warehouse,gacha,dismantle,market,ragnarok}.cjs` + `storage_art`/`storage_content` subsystems + `players.cjs`/`pg_sync`; auth in `admin.cjs`; operator CLI `cli_invite.cjs`. |
| `shared/` | Cross-package contract surface: `engine.d.ts` (engine types), `dto.ts` (30 HTTP wire-shape types), `content_validate.cjs` (admin-edit validator). Dependencies point INTO shared, never out. |
| `client/` | Vite + React 19 + PixiJS 8 + TS. Store = module-level pub-sub (`src/store.ts` barrel over `src/store/*`), board renderer class + extracted `board/{geom,commits,ghosts}.ts`, typed API client `src/api.ts` (barrel over `src/api/` domain modules, re-exports shared DTOs; i18n + index.css are likewise barrels over `src/i18n/` + `src/styles/` since REQ-0145b), shared page-lib `src/lib/` (item-content resolution, time formatting, tab pulse, first-fit placement variants, poll/load hook, content cache — REQ-0145b) with cross-package numeric constants in `shared/constants.json`. Builds into committed `web/app/`. |
| `content/` | Game content: `vocab.json` (closed vocabulary), `live/` (single source served by /api/content), `batches/` (authored + generated content, incl. batch-002 the sim test fixture). |
| `tools/` | ci.sh / release.sh / check_engine_types.cjs + the Python art/content pipeline (`gen_monster_art.py`, fit checks, `eff_render.cjs` shared effect-text renderer). |
| `web/` | The static docroot, served verbatim (committed dist model). |
| `data/` | files-backend storage roots (gitignored). Prod uses pg. |
| `types/`, `tsconfig.server.json` | checkJs program for server+sim+shared (`Error.code` convention typing). |

## 5. Contracts & type system

- **HTTP contract**: `server/tests/api_test.cjs` — the thin entry point
  over `server/tests/api/*.cjs` (REQ-0145a: harness + 11 suite files,
  run in the old monolith's own fixed order; 157 tests / 1213 executed
  assertions per backend, tallied by the harness as a parity gate).
  Drives the exported `handle()` directly; runs in files AND pg modes.
  Endpoint shapes, status codes, auth matrices and even 400 wordings
  are asserted — treat its assertions as the spec.
- **Error convention**: services throw `Error` with `.code`
  ('NOT_FOUND'|'CONFLICT'|'BAD_REQUEST'|'TOO_LARGE'), optional
  structured `.reason`; routes map code → HTTP status.
- **Auth**: `X-Auth-Token` header; tokens minted by `cli_invite.cjs`
  (never regenerated); `dev_mode` no-token fallback resolves the dev
  player and additionally gates the test-control seams (`dev/backdate*`,
  `genSeed`). Roles: `item_admin` gates admin routes.
- **Content root**: every server-side content-file path resolves through
  `server/lib/content_files.cjs` (REQ-0145a): `CONTENT_ROOT` env
  override, default `~/backpack_ragnarok/content` (byte-equivalent to
  the old per-module `os.homedir()` anchoring) — a worktree-launched
  server can point at its own tree's content. Exception: dungeon-domain
  paths come from `sim/dungen.cjs`'s `liveDungeonDir()` (sim is frozen
  — see §9).
- **Types**: client is strict TS; server/sim are CJS under
  `tsc --checkJs` (no build step — the runtime bytes are the reviewed
  bytes); the engine stays untyped JS internally but its declared surface
  is drift-checked in CI (49 members).

## 6. Quality gates & dev workflow

```
pnpm run test:quick   # sim + goldens + mock + typecheck + drift + api(files)  (~20s)
pnpm test            # = tools/ci.sh: adds api(pg), client build, e2e (~10min, needs server/.env)
bash tools/release.sh# full gate → rebuild dist → commit web/app if changed
(cd client && pnpm run dev)  # Vite dev server against the live API
node server/tests/api_test.cjs / sim/tests/run.cjs / mock-src/tests/run.cjs  # individually
node sim/tests/goldens.cjs gen  # ONLY when a behavior change is intended & reviewed
```
**CI GREEN means literally green (REQ-0159).** There is no accounted /
remembered e2e failure set, and re-introducing one is not allowed. If
`tools/ci.sh` prints `CI GREEN`, every gate it ran passed; if it does not, the
run is red and something is actually wrong. (This paragraph used to list "the
two REQ-0043 tests" as known-failing and told you to eyeball the failure set
before shipping — those tests pass, and that convention is retired. REQ-0159
cleared the 11 standing reds the default suite had accumulated: 3 stale specs
still asserting on DOM that REQ-0097/0108/0120 deleted, 1 cross-test leak where
a schedule spec left an ACTIVE room behind and 409'd its neighbours out of
deploying, and 7 admin tests that belong to the isolated harnesses, not here.)

**Suite membership.** `artadmin` / `artinspect` / `contentadmin` are
`testIgnore`d out of the default suite (`client/playwright.config.ts`) and run
ONLY via `tools/{artadmin,art_inspect,content_admin}_e2e.sh`, which `ci.sh`
invokes as its own step `[6.5/8]`. They need the HOME-remap isolation, and their
opening `dev/clear-all` is 403'd in any live-namespace run by REQ-0156's
`ALLOW_DEV_CLEAR` gate — the hardening that closed the 2026-07-13 live-registry
wipe. Never re-admit them to the default suite, and never open that gate to make
them pass. Full rationale: server/README.md, "Suite membership".

## 7. Deploy & parallel work

- Deployed artifact = the repo itself on the server box. Client ships as
  committed `web/app/` (rebuild via release.sh); server code is picked up
  by `systemctl --user restart backpack-api` (no build step).
- The repo accepts direct pushes (`receive.denyCurrentBranch=
  updateInstead`) BUT refuses while any collaborator has uncommitted
  edits in the worktree (e.g. the designer working in `web/redesign/`).
  Standard path: push to `refacting-inbox`-style plain branch → server-
  side `git merge --ff-only <inbox>`. Never commit or checkout over a
  collaborator's uncommitted files.
- `server/.env` (gitignored) carries STORAGE_BACKEND/DATABASE_URL; the
  systemd user unit loads it via EnvironmentFile.

## 8. Conventions

- Work items are REQ-numbered. Commits: `REQ-NNNN (x): summary`. Every
  REQ leaves a doc in `docs/` (plan + execution log, amendments recorded
  honestly — see REQ-0047 for the template).
- READMEs are load-bearing documentation and updated in the same commit
  as the change they describe.
- No frameworks on the server, no runtime deps in sim, no workspace
  hoisting at the root — each is a recorded decision; revisit via REQ,
  not drive-by.

## 9. Known debt (deliberate, tracked)

- `BoardRenderer.render()` (~690 LOC) — left for the upcoming UI rework.
- `engine.js` (2211 LOC) is protected by rule 1, not by decomposition.
- `sim/dungen.cjs`'s `liveDungeonDir()` still anchors the dungeon
  content dir on `os.homedir()` (sim/ is replay-frozen, so REQ-0145a
  left it): a `CONTENT_ROOT`-overridden server still reads DUNGEON
  content from the main checkout.

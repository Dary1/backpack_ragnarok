# REQ-0047 — Internal Architecture Rework ("refacting")

Branch: `refacting` / Status: **PROPOSED — awaiting owner approval**
Scope class: internal-only. External behavior is frozen (see §2).

## 日本語サマリ

本リポジトリは REQ 単位の積み上げで成長した約 31k 行(client 11.6k TS / server 6.3k CJS / sim 3k CJS / mock-src 5.2k JS / tools 5.1k py)のソロ開発プロジェクト。品質は高い(決定論 sim、契約テスト 2.2k 行、README 規約)が、基盤が規模に追いついていない: ルート manifest なし、CJS/ESM/TS が分裂、神モジュール4本(engine 2211 / api_test 2257 / BoardRenderer 1962 / schedule 1479 / combat 1549)、手書き型宣言のドリフト、テスト実行が個別コマンド4系統。

本 REQ は外部仕様(HTTP API・UI挙動・リプレイ決定論・CLI・URL・データ形式)を一切変えず、内部を「型付きモジュラーモノリス + 単一品質ゲート」へ全面リワークする。8フェーズ (a)〜(h)、各フェーズ後に全テスト緑を維持。安全網はゴールデン(リプレイログの sha256 固定)と既存契約テスト。(g) の Postgres 切替のみ実施前に個別承認を求める。

---

## 1. Current state (evidence-based)

| Area | Facts |
|---|---|
| client/ | Vite + React 19 + PixiJS 8 + TS, 11.6k LOC. Builds into committed `web/app/`. Playwright e2e. `BoardRenderer.ts` 1962 LOC. Hand-written `engine.d.ts` (768) shadows `mock-src/engine.js`. |
| server/ | Framework-free `node:http` CJS, 6.3k LOC. `api.cjs` (1031) routes on `url.pathname` in one function; `schedule.cjs` (1479) holds rooms+runs+warehouse+gacha business logic; `storage.cjs` already has a `files|pg` seam (`STORAGE_BACKEND`). Contract test `tests/api_test.cjs` (2257) runs in both backends. |
| sim/ | `combat.cjs` — 1549 LOC single file, dependency-free, deterministic (seeded RNG, event heap, replay JSONL). `dungen.cjs` (457). Bespoke test harness (1017). Consumed by `server/schedule.cjs`. |
| mock-src/ | `engine.js` (2211) is the REAL core engine consumed by 3 parties: client (via adapter, "never forked"), sim (read-only interop invariant), mock UI. Untyped JS. Own tests (`run.cjs`, 1725). |
| tools/ | 5.1k py + cjs content pipeline; `eff_render.cjs` shared by server and bake step. |
| repo-level | No root `package.json`, no `docs/`, no unified test entry, no lint/typecheck outside client. REQ briefs live outside the repo; commits reference `REQ-NNNN (x)`. Dist (`web/app/`) committed per REQ ("dist rebuild" commits). Supabase Postgres runs on the host; prod currently uses `files` backend (`data/*.json`). |

The pain is not code quality — it is **foundation shape**: four god-files, three module systems, duplicate hand-maintained types, and no single command that answers "is everything still correct?".

## 2. Frozen external contract (MUST NOT change)

1. **HTTP API**: every path/verb/status/JSON shape exactly as encoded in `server/tests/api_test.cjs` (files AND pg modes green).
2. **Replay determinism**: `runEncounter`/`runDungeon` produce byte-identical JSONL for identical (snapshot, defs, seed) — before vs. after every phase. Verified by new golden hashes (§4a).
3. **UI/UX**: zero behavioral or visual change; Playwright e2e green; app still served from committed `web/app/` at `/app/`, mock at `/mock`, previews at `/preview`.
4. **Ops surface**: systemd entry commands (`server/api.cjs`), `cli_invite.cjs` CLI, ports 8801/8802, tunnel hostnames — unchanged.
5. **Data formats**: `content/**` schemas and `data/**` file layouts unchanged. ((g) migrates the *backing store* only after separate approval; `files` mode remains functional regardless.)
6. **Engine invariants**: `mock-src/engine.js` consumed unmodified; sim keeps its read-only, no-mutator, deep-copy interop rules; sim stays runtime-dependency-free.

## 3. Target architecture

npm-workspaces modular monolith; TypeScript everywhere except `mock-src/engine.js` (kept JS by invariant, typed via checked JSDoc on exports):

```
package.json            # workspaces + root scripts: lint / typecheck / test / ci
docs/                   # REQ docs live in-repo from now on (this file)
shared/                 # NEW: single source of types & schemas
  src/dto/              #   API request/response types (server+client both import)
  src/content-schema/   #   JSON Schema for vocab/live_items/live_sis + generated TS types + one runtime validator
sim/
  src/*.ts              # rng / heap / geometry / formation / status / compile /
                        #   entry / ray / skills / packs / encounter / dungeon / replay
  combat.cjs, dungen.cjs# thin generated facades — public require() surface IDENTICAL
server/
  src/                  # TS: router.ts + routes/{content,me,profile,admin,schedule,workshop}.ts
                        #     services/{rooms,runs,warehouse,gacha}.ts  (split of schedule.cjs)
                        #     storage/{seam,files,pg}.ts   players.ts  auth.ts
  api.cjs               # 3-line shim requiring built output — systemd unit untouched
client/src/             # internal reshape only: board/ split into stages, store slices,
                        #   api.ts consumes shared/dto, engine types generated not hand-written
tools/ci.sh             # the ONE quality gate (see §4a)
```

Deliberate non-goals: no HTTP framework (node:http stays), no ESM flip of server entry, no engine rewrite, no UI redesign, no new sim runtime deps, no CI service (a local `ci.sh` fits solo scale).

## 4. Phases

Each phase = one lettered commit series `REQ-0047 (x)`, ends with `tools/ci.sh` fully green. Order chosen so the safety net exists before anything moves.

**(a) Safety net + workspace root.** Root `package.json` (workspaces), `tools/ci.sh` orchestrating: sim tests, mock-src tests, api_test (files + pg), client `tsc -b` + build + e2e smoke, lint. NEW `sim/tests/goldens/`: replay-JSONL sha256 for a matrix of seeds × scenarios (encounters + full dungeons, both dungen types) — the determinism oracle every later phase must satisfy. `docs/` created with this REQ.

**(b) `shared/` package.** JSON Schemas for content files + generated TS types + a single runtime validator; DTO types for every API payload. `admin.cjs` validation rewired to the schema validator with an accept/reject matrix proven identical by api_test. Client `api.ts` types aliased to `shared/dto` (compile-time only).

**(c) Server decomposition → TS.** Mechanical split first (CJS, move-only, api_test green), then TS conversion: `router.ts` (tiny exact-match/prefix table replicating current pathname logic), route modules, `schedule.cjs` split into 4 services, typed storage seam. `api.cjs` becomes a shim. `tsc` strict, ES2022, CJS output.

**(d) Sim decomposition → TS.** Same two-step discipline behind unchanged `combat.cjs`/`dungen.cjs` facades. Move-only commits may not alter RNG call order or float arithmetic; goldens from (a) are the proof. `server/schedule.cjs`'s `require('../sim/combat.cjs')` keeps working verbatim.

**(e) Engine typing without forking.** JSDoc annotations on `engine.js` exported surface only + `tsc --checkJs` emitting `engine.gen.d.ts`; client's hand-written `engine.d.ts` (768 LOC) deleted in favor of the generated one. Engine runtime bytes: byte-identical (comments only). mock-src tests + client build prove it.

**(f) Client internal reshape.** `BoardRenderer.ts` (1962) → `board/render/{grid,bp,po,beams,ports,layers,viewport}.ts` behind the existing `BoardRenderer` class API; `store.ts` (798) → typed slices with the same hook surface; delete dead code found by oxlint. e2e green; no visual diff on the e2e screenshot fixtures.

**(g) Storage cutover to Postgres — SEPARATE GO/NO-GO.** The `pg` backend already exists and is tested; this phase writes `tools/migrate_data.cjs` (files → pg import, row-count + content-hash verification, `data/` tarball backup first) and flips `STORAGE_BACKEND=pg` in the service environment. Fully reversible (flip env back; files stay on disk). **Will not be executed without explicit owner approval at that point.**

**(h) Docs + release discipline.** All four READMEs rewritten for the new layout; `docs/architecture.md`; `tools/release.sh` = ci.sh → client build → dist commit, making every future "dist rebuild" commit uniform and test-gated. Final dist rebuild.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Behavior drift while splitting combat.cjs (RNG order, float assoc.) | Golden replay hashes (a); move-only commits separated from TS-conversion commits; no expression rewrites in move commits. |
| TS transpile semantics vs. hand CJS | `target ES2022`, no downlevel; output diff-reviewed; api_test/goldens as oracle. |
| Hidden consumers of `schedule.cjs`/`combat.cjs` internals | `grep -rn require` audit before each split; facades re-export the full previous surface. |
| pg cutover data issues | (g) gated on approval; dry-run verify + backup + instant env-var rollback. |
| Committed-dist merge noise during long-lived branch | `refacting` touches `web/app/` only in (h), once. |

## 6. Acceptance criteria (whole REQ)

- `tools/ci.sh` green: sim goldens byte-identical, mock tests, api_test files+pg, client typecheck/build/e2e, lint.
- `git grep -c "require('../sim/combat.cjs')"` consumers unchanged and working.
- No diff in: endpoint table, replay JSONL for golden matrix, e2e behavior, CLI, ports, data formats.
- LOC of largest hand-written module < ~600; zero hand-maintained duplicate type surfaces.

---

## Execution log & amendments (written during implementation)

Commits: `(a)` f67c8c1, `(b)` 5e0c044, `(c)` fc04c4c, `(d)` 48919a3, `(e)` bd52613, `(h)` this commit.

1. **TS delivery re-scoped to strict decomposition + checkJs (affects (c)/(d)).** Server and sim were decomposed as planned, but stay `.cjs` checked by `tsc --checkJs` (`tsconfig.server.json` + `types/coded-error.d.ts`) instead of being transpiled `.ts`. Rationale: zero build step means the runtime bytes ARE the reviewed bytes (no transpile-drift risk against the determinism goldens), and the systemd entry stays `node server/api.cjs` with no toolchain on the deploy path. Full `.ts` migration remains possible later per-module behind the same facades.
2. **(e) replaced generate-d.ts-from-JSDoc with a runtime drift detector.** The hand-written `engine.d.ts` is far richer than JSDoc inference would produce; the real risk was silent drift, now covered mechanically by `tools/check_engine_types.cjs` (49 members verified in CI). `mock-src/engine.js` remains byte-level unmodified except a documented `@ts-nocheck` pragma comment.
3. **(b) DTO consolidation deferred into (f).** `Api*` types are entangled with engine types; moving them before (e) would have created a `shared -> client` dependency, violating shared/'s own rule. `shared/` shipped with the runtime validator (the higher-value single-source win).
4. **(g) was already done.** REQ-0040 flipped production storage to Postgres (supavisor pooler, `server/.env`, `pg_sync.cjs` sync bridge) before this REQ; `data/*.json` are the files-mode fixtures/legacy. (g) therefore re-scoped to: prove the reworked server against the pg backend (api_test pg mode in server-side CI) and roll out via service restart. No data migration needed or performed.
5. **Workspaces dropped for a zero-hoisting root manifest.** Root `package.json` carries orchestration scripts + dev tooling only; `server/` and `client/` keep their own `node_modules` exactly as deployed today. Rationale: npm workspace hoisting would silently change prod module resolution for a running service — all of the orchestration value, none of the risk.
6. **(f) partial in this pass.** Done: engine type surface (drift-proofed), client build kept green against every change. Deferred to a follow-up commit series (`REQ-0047 (f2)`): `BoardRenderer.ts` (1962) stage split, `store.ts` (798) slice split, `Api*` DTO move into `shared/`. These touch the highest-external-risk surface (the UI) and were sequenced after (g)/(h) so the validated rollout would not wait on them.

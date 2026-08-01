# REQ-0349 — Unify the route request preamble (`lib/route_kit.cjs`)

**Status:** Todo (decisions resolved 2026-07-30; cleared to implement)
**Reserved:** 2026-07-30
**Slug:** route-kit-preamble-unify
**Origin:** API code audit, 2026-07-30 (whole-`server/` review; no prior REQ)
**Depends on:** nothing. **Blocks:** nothing. Sibling: REQ-0348 (independent —
different files, no overlap; either may land first).

---

## 1. Problem

`server/lib/route_auth.cjs` (REQ-0145a) already extracts the caller-resolution
preamble, but only four route families use it. Every other family re-implements
the same three steps inline: **resolve caller or 401 -> read/parse the JSON body
or 4xx -> map a domain error code to a status**. `routes/` is 3,372 lines across
17 files and a large share of it is this.

### 1.1 Caller resolution: 4 families share it, 10 copy it

Uses `resolveCallerOr401` (`lib/route_auth.cjs:31`): `routes/schedule.cjs:53`,
`routes/warehouse.cjs:23`, `routes/workshop.cjs:17`, `routes/starter.cjs:31,41`.

Re-implements it inline (`const resolved = admin.resolveAuthFromRequest(req)`
then the same `401 'unauthorized: ' + resolved.reason`): `routes/admin.cjs:139,170`,
`routes/bio.cjs:61,78`, `routes/dex.cjs:81`, `routes/dismantle.cjs:51`,
`routes/market.cjs:61`, `routes/me.cjs:15`, `routes/notifications.cjs:20,30`,
`routes/profile.cjs:17`, `routes/ragnarok.cjs:73`, `routes/skins.cjs:50` —
**13 sites, 10 files**.

Not accidental drift: `routes/market.cjs:47-48` and `routes/ragnarok.cjs:61-62`
both say *"resolve the caller EXACTLY like schedule/warehouse
(`lib/route_auth.cjs`'s `resolveCallerOr401`)"* — and then open-code it instead of
calling it. The `callerIsDevFallback` computation
(`!token && resolved.viaDevFallback === true`, REQ-0214) is likewise duplicated
verbatim in `route_auth.cjs`, `market.cjs` and `ragnarok.cjs`.

**Why it matters beyond tidiness.** REQ-0199 had to fix one JWT-precedence bug
(the X-Auth-Token-only resolver mis-resolving a Bearer-JWT caller to the dev
fallback, so the route acted as the **wrong player** — live symptom: every market
sell 404'd) separately in `market.cjs`, `ragnarok.cjs`, `dismantle.cjs` and
`dex.cjs`. Each copy is a place the next auth fix must be remembered. REQ-0214
(`viaDevFallback`) and REQ-0217 (e2e profile redirect) each had the same shape.

### 1.2 Domain-error mapping: 4 copies, and they disagree

| site | NOT_FOUND | CONFLICT | BAD_REQUEST | FORBIDDEN |
|---|---|---|---|---|
| `lib/route_auth.cjs:79` `scheduleErrToStatus` | 404 | 409 | 400 | **403** |
| `routes/market.cjs:82` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |
| `routes/ragnarok.cjs:95` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |
| `routes/dismantle.cjs:27` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |

The paired `sendScheduleError` / `sendMarketError` / `sendRagnarokError` /
`sendDismantleError` bodies are otherwise identical (`{ok:false,error}` plus the
REQ-0041 structured `reason` when present).

**Verified 2026-07-30:** the only `FORBIDDEN` throwers in the whole server are
`services/seals.cjs:239,264,268` (REQ-0058 seal visibility / participant gate),
reached exclusively through the **schedule** family — which uses the copy that
*has* the 403 mapping. So the market / ragnarok / dismantle gap is **inert
today**: no live status-code bug, but three files that would silently answer 500
the first time one of their services throws `FORBIDDEN`.

### 1.3 Body handling: 20 sites, 4+ wordings

`readBody -> TOO_LARGE -> JSON.parse` appears at 20 sites
(`admin.cjs:50,107`, `dismantle.cjs:76`, `market.cjs:126,152`,
`profile.cjs:58,93`, `schedule.cjs:120,166,226,246,330,378,469,502`,
`skins.cjs:82`, `starter.cjs:46`, `warehouse.cjs:45,104`, `workshop.cjs:36`)
in two shapes — the one-liner `err.code === 'TOO_LARGE' ? 413 : 400` and the
expanded block — producing these 413/400 wordings:

- `'request body exceeds ' + MAX_BODY_BYTES + ' bytes'` (4x)
- `'request body exceeds ' + MAX_SKINS_BODY_BYTES + ' bytes'` (1x)
- `'request body too large'` (1x, `skins.cjs:82`)
- `'body read failed: ' + err.message` (3x)
- raw `err.message` passed through (12x, the one-liner shape)

and two JSON-parse wordings: `'invalid JSON body'` (18x) vs
`'malformed JSON body'` (1x, `dismantle.cjs`).

### 1.4 Remaining hand-rolled surface

`'method not allowed'` 405 literal: **49** sites. `sendJSON(res, 400, ...)`:
**61** sites. Inline `typeof x !== 'string'` / `Number.isInteger` /
`Number.isFinite` validation: **17** sites, no shared validator anywhere in
`lib/` (`content`, `content_files`, `http_util`, `humanize`, `meta`,
`route_auth`, `supabase_auth` — none validate request shapes).

## 2. Goal

Promote `lib/route_auth.cjs` into `lib/route_kit.cjs`: one module holding the
whole request preamble, used by **every** route family. No route file open-codes
caller resolution, body reading, error-code mapping, or the 405 guard again.

## 3. Proposed surface

```
resolveCallerOr401(req, res)            // kept, unchanged, now used by all 17 families
methodGuard(req, res, allowed[])        // 405 + the one canonical wording
withJsonBody(req, res, opts, cb)        // readBody + cap + parse, one wording set
                                        //   opts: { maxBytes }  (skins' own cap)
sendDomainError(res, e)                 // ONE code->status table incl. FORBIDDEN->403
                                        //   + REQ-0041 structured `reason` threading
requireString(v, name) / requireInt(v, name, {min,max}) / requireEnum(v, name, allowed)
                                        // the §1.4 inline checks, throwing BAD_REQUEST
loadOwnCanvas / requireOwnCanvas        // kept as-is from route_auth.cjs
```

`lib/route_auth.cjs` stays as a thin re-export shim so no call site breaks in the
same commit — the facade technique `storage.cjs` (REQ-0145a sb) and
`schedule.cjs` (REQ-0047 c) already use. The shim is deleted in the final commit
once no requirer remains.

## 4. Migration order (one commit per family, each individually green)

`dismantle` -> `dex` -> `notifications` -> `bio` -> `skins` -> `profile` -> `me`
-> `starter` -> `workshop` -> `warehouse` -> `market` -> `ragnarok` ->
`schedule` -> `admin` -> `art` -> `content` -> `public`.

Smallest and least-coupled first; `schedule.cjs` (565 lines, 9 body readers, 17
method guards) only after the kit has been exercised by a dozen simpler families;
`art` / `content` last because they are the two files with no service layer
(30 and 27 direct `storage.*` calls) and will read worst — their real fix is a
separate REQ.

## 5. Scope

**In:** all 17 `server/routes/*.cjs`, `server/lib/route_auth.cjs` ->
`lib/route_kit.cjs`, `server/tests/api/*`. **Out:** `admin.cjs`'s auth/domain
split (audit item P3 — 15 modules require it for auth alone; own REQ), the
`routes/art.cjs` + `routes/content.cjs` service-layer extraction (own REQ), route
dispatch order in `router.cjs` (load-bearing, untouched), REQ-0348's content
work.

## 6. Decisions — RESOLVED 2026-07-30

- **D1 — RESOLVED: unify the wordings, in this REQ.** The original draft
  recommended preserving each family's strings to guarantee a zero-byte-change
  migration, on the assumption that the client substring-matches error messages.
  **That assumption was checked and does not apply here.**
  `client/src/schedule/errors.ts:56-58` is the only substring-matching site in the
  client, and it matches **domain** text only — `'active schedule'`,
  `'no space in inventory'`, `'empty squad'`, `'no Backpack'`. None of the
  §1.3 body-handling wordings is matched anywhere in `client/src`, and
  `client/src/api/http.ts:66-78` reads the structured `reason` field first by
  design. So unifying 413 / body-read-failure / bad-JSON costs one pass over
  `tests/api/*` assertions and nothing else. Preserving five spellings of the
  same 413 to protect a contract that does not exist would be the worse choice.
  **Domain messages are still frozen** — `sendDomainError` passes `e.message`
  through untouched, so the three matched strings above are unaffected.
- **D2 — RESOLVED: fold `FORBIDDEN -> 403` into this REQ.** Verified inert (§1.2):
  nothing in market / ragnarok / dismantle throws `FORBIDDEN` today, so this
  changes zero current responses and needs no separate deploy-and-verify. Its
  whole value is that the divergence cannot reappear once there is one table.
- **D3 — RESOLVED: include the three validation helpers (`requireString`,
  `requireInt`, `requireEnum`), and nothing more.** The original draft leaned
  toward excluding them. Reversed: the §1.4 checks are 17 sites of the same three
  shapes, and folding them in is what turns "the preamble is shared" into "the
  preamble is *entirely* shared". What stays out is a **schema framework**
  (declarative per-route request schemas) — that is a design decision, and
  attaching it to a mechanical migration is how a low-risk refactor stalls. Three
  throwing helpers over `sendDomainError`'s existing `BAD_REQUEST -> 400` need no
  new concepts.

## 7. Gates

1. `cd server && node tests/api_test.cjs` — baseline captured 2026-07-30 at
   `master` `e4b24dd0`: **229 passed, 0 failed, 1,950 assertions**. Must stay
   green after **every** per-family commit, not just at the end.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs`.
3. Per-family: the matching `tests/api/<family>.cjs` must be green before the
   next family is touched. `tests/api/harness.cjs` also asserts the
   "REQ-0145a sf parity gate" assertion count — expect to update it deliberately,
   never by loosening it.
4. `tools/ci.sh` full run.
5. Scoped e2e per PROJECT.md's test-game note (`source tools/e2e_ports.sh`,
   `E2E_PARALLEL=4 pnpm exec playwright test`) — the client's error handling is
   only exercised there, and D1 changes error text.
6. Wording change is its own commit, separate from the mechanical migration, so a
   surprise in gate 5 reverts the text without unwinding the refactor.
7. Grep gate at the end: zero remaining `admin.resolveAuthFromRequest` in
   `routes/`, zero local `errToStatus`, zero literal `'method not allowed'`
   outside `route_kit.cjs`.

## 8. Result (implemented 2026-07-30)

19 commits on `req-0349-route-kit-preamble-unify`, one per family plus the three
separable decisions. `lib/route_auth.cjs` deleted; `lib/route_kit.cjs` is the one
request preamble.

| | before | after |
|---|---|---|
| inline auth preambles in `routes/` | 13 (10 files) | 0 |
| `errToStatus` copies | 4, disagreeing on FORBIDDEN | 1 |
| `readBody`+parse blocks | 20 | 0 (2 remain in art/content, out of scope) |
| literal `'method not allowed'` | 49 | 1 (in the kit) |
| 413 / body-read / bad-JSON wordings | 9 spellings | 3 constants |
| `routes/` CODE lines (comments+blanks excluded) | 2,211 | 2,037 (**-174**) |
| preamble module CODE lines | 40 (`route_auth`) | 110 (`route_kit`) |

**The line-count prediction in the original spec was wrong and is corrected
here.** It said "-300 to -400 lines in `routes/`"; the real figure is **-174 code
lines**, and RAW total `routes/` line count fell only 3,372 -> 3,296 because ~100
comment lines were added recording why each family's remaining oddity is
deliberate (skins' tail-405 ordering, warehouse's two endpoints that genuinely
differ on empty bodies, me.cjs's intentionally non-kit link resolver, art/content's
superset error table). That trade is in keeping with this codebase's convention of
recording decisions in place, but the spec should not have implied a large raw
reduction: the win is that 13+4+20+49 duplicated decision points became 1 each,
not that the tree got smaller.

The next REQ-0199-class auth fix is now a one-file change.

### Deliberately NOT done (recorded so it is not re-derived)

- **`routes/art.cjs` / `routes/content.cjs` took only `methodGuard`.** Their body
  reader is promise-based (async handlers), their `httpForCode` table is a strict
  superset of the kit's (`DUPLICATE`, `DUPLICATE_SEED`, `ADOPTED_UNDELETABLE`,
  `NO_ADOPTED`, `NOT_OK`, `BAD_SHAPE`, `BAD_JSON`), and their auth is an
  item_admin ROLE gate. Reasons are in both files.
- **`requireInt` was written then deleted** -- zero callers after the conversions.
  Only 3 of the 17 inline checks sit in handlers with the try/catch seam the
  validators throw into; the others are in `admin.cjs` (interleaved with two
  different 500 wrappers) or are `public.cjs`/`schedule.cjs` query-param
  coercions that return null and are not 400 sites at all. A partial reversal of
  D3 as specced, on the evidence.
- **`routes/public.cjs` needed no commit** -- no 405, no body reader, no auth
  preamble. It was on the migration list in error.
- **Wrong-method status codes were not touched.** `bio` and `dex` answer 404 for
  a wrong method where everyone else answers 405. That is a real inconsistency
  and a candidate REQ, but REQ-0349 changed no status codes.

### Incidental finding: the parity-gate assertion count is not deterministic

`api_test`'s "executed assertions: N (REQ-0145a sf parity gate)" line reported
1947 / 1948 / 1949 / 1950 across otherwise identical runs of an unchanged tree --
it settles at 1950 but the first runs after a `pnpm install` or a file touch come
in lower. `229 passed, 0 failed` was stable throughout. Anything treating that
assertion count as an invariant is treating a flaky number as a gate; worth its
own small REQ.

## 9. Status log

- 2026-07-30 — reserved (`7e15078e`); first spec written and moved
  `reserved -> draft` (`a7299be7`) pending D1/D2.
- 2026-07-30 — client substring-match sites enumerated and `FORBIDDEN` throwers
  greped; D1 reversed to "unify" on that evidence, D2 folded in, D3 reversed to
  "include the three helpers", migration order added, moved `draft -> todo`.
  Evidence gathered at `master` `e4b24dd0`.
- 2026-07-30 — IMPLEMENTED on branch `req-0349-route-kit-preamble-unify` off
  `master` `e4b24dd0`, 19 commits, `3d916bd1`..`a2156a07`. `api_test` green after
  every single commit (229 passed / 0 failed), never once red mid-migration.
  Final gates:
  - `node tests/api_test.cjs` (files backend): **229 passed, 0 failed**
  - `STORAGE_BACKEND=pg node tests/api_test.cjs`: **229 passed, 0 failed**, 1950
    assertions
  - `tools/ci.sh` full gate incl. the scoped hermetic e2e run: **CI GREEN**, 341s
  - grep gate: zero `admin.resolveAuthFromRequest` in `routes/` code, zero local
    `errToStatus`, zero literal `'method not allowed'` outside `route_kit.cjs`,
    zero requires of the deleted `route_auth.cjs`
  Moved `todo -> built`: code complete and green, NOT merged or deployed.

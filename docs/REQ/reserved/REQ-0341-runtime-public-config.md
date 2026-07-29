# REQ-0341 — Serve the public Supabase config from the API; delete the machinery that compensated for baking it

## Status
built — 2026-07-29. Awaiting user acceptance / merge.
**Merging this REQ has a deploy prerequisite. See section 7.**

REQ-0340 repaired the tripwire and stated its own scope limit in section 6:
*"This repairs the gate. It does not remove the underlying defect."* This is
that removal.

---

## 1. The root defect, stated once

**A tracked artifact varied with an untracked input.**

`web/app` is committed and is what the static service serves. Vite inlines
`VITE_*` at build time, and `client/src/auth/client.ts` read
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — supplied by
`client/.env.local`, which is **gitignored** and therefore existed only in the
main checkout. So the bytes of a tracked file depended on which directory the
build ran in. A build anywhere else baked an env-LESS bundle and sign-in
silently degraded to "not configured" (REQ-0118c).

| | |
|---|---|
| REQ-0266 | shipped an env-less bundle; fixed by rebuilding on main (`42238f8`) |
| REQ-0278 | built the countermeasures: `provision_worktree_env.sh` + `check_bundle_env.sh` |
| REQ-0337 | **shipped it again** (`2517c83`), hotfixed by `e8f2b77`, with the tripwire in place |
| REQ-0340 | found the tripwire was a free pass at exactly the accident condition; repaired it |

Three pieces of machinery existed for no other purpose than to survive this.
None of them addressed it: provisioning copied the untracked input around, and
the tripwire inspected the output. Both accept the premise.

The premise is wrong, and cheaply so, because **neither value is secret**.
`client/.env.example` said so in its own first line; the anon key is a
client-side credential designed to be shipped to a browser. They were
gitignored by a blanket policy, not because they need protection. Anything a
user can download from `/app/` they can already read.

## 2. What now happens

**Server** — `GET /api/config`, no auth, in `server/routes/public.cjs:45`
alongside `/api/health` and `/api/content`, returning
`{supabaseUrl, supabaseAnonKey}` read from this process's environment
(`publicClientConfig()`, public.cjs:27). `server/lib/http_util.cjs:13`'s
`sendJSON` gained an optional fourth header-bag argument so the response can
carry `Cache-Control: no-store`; every existing three-argument call is
untouched.

Absent or blank ⇒ **nulls with a 200, never a 500** (public.cjs:20's
`envOrNull` trims, so the realistic half-provisioned `SUPABASE_ANON_KEY=`
reads as absent rather than as a truthy empty string). A 500 would have been
the wrong answer: the client's contract is to degrade to the REQ-0118c "not
configured" sign-in note, which is what it already did when the build had no
env — not to fail boot.

**Client** — `createSupabaseClient()` (`client/src/auth/client.ts:86`) is now
async and builds the client from that response. It is bounded by an 8 s
`AbortController` timeout (client.ts:40) because `boot()` awaits it: an
unbounded wait on a hung or black-holed API would wedge boot forever, which is
the REQ-0336 "eternal spinner with nobody underneath it" failure shape. Every
failure mode — timeout, rejection, 404 from an older server, non-JSON body,
half-configured response — collapses to the same `null` the missing-env case
used to produce.

The config promise is memoised (client.ts:71), so N callers cost one request.

## 3. The ordering constraint, and why an extra round-trip is safe

This is the part REQ-0340 flagged as the reason to do it separately, and it is
the only real design question here.

`createClient` is configured `detectSessionInUrl: true, flowType: 'pkce'`
(client.ts:90). Before this REQ the client was constructed **synchronously**:
`boot()` is called at `client/src/main.tsx:25` and `bootInner()` ran straight to
the `createSupabaseClient()` argument with no `await` in front of it, so the
client existed inside the module-load task, before any React effect could run.
Now there is a network round-trip in that gap. The question is whether anything
can destroy the OAuth callback parameters during it.

**It cannot, and the reason is specific rather than probabilistic:**

1. **The PKCE callback rides in the QUERY STRING, not the fragment.**
   auth-js 2.110.2 parses `window.location.href`
   (`GoTrueClient.js:378`) and only treats the URL as a PKCE callback when
   `params.code` **and** a stored `code-verifier` are both present
   (`_isPKCECallback`, `GoTrueClient.js:3305-3307`). Both survive a delay: the
   verifier is in localStorage, and `?code=` is removed by **auth-js itself**,
   at `GoTrueClient.js:3236` (`url.searchParams.delete('code')` +
   `history.replaceState`), i.e. only after the exchange has succeeded.

2. **Nothing in this app ever writes `location.search`.** `setRoute()` writes
   only `location.hash` (`client/src/store/routing.ts:16`).
   `setRouteReplacingHash()` rebuilds the URL as
   `location.pathname + location.search + '#/...'` (routing.ts:122), preserving
   the query verbatim, and ContentAdminPage's deep-link rewrite does the same
   (`ContentAdminPage.tsx:187`). `initRouting()` (routing.ts:153-178) only
   *reads* the hash on load; the one branch that writes is the invite handler,
   which requires `#/invite/<token>`. Every other `setRoute` call site is an
   `onClick`. So `?code=` survives an arbitrary delay.

3. **The await is still before the first `/api/me`.** `boot.ts:170` is
   `await initSupabaseAuth(await createSupabaseClient())`, unchanged in
   position; `initSupabaseAuth` awaits `getSession()`
   (`client/src/auth/session.ts:88`), which awaits auth-js's `initializePromise`
   and therefore the URL detection itself. The REQ-0118c property "a signed-in
   player's first request already carries the Bearer JWT" is preserved.

**Honest limit of this argument.** It is derived from reading auth-js 2.110.2's
compiled source and this app's URL writes. It is *not* an observation: no test
here drives a real Discord OAuth round-trip against a live GoTrue, and none
existed before either. The implicit-grant path — which auth-js clears by
`window.location.hash = ''` (`GoTrueClient.js:3278`) and which *would* be
delay-sensitive if any code wrote the hash first — is not reachable from this
client: `flowType: 'pkce'` makes auth-js reject an implicit callback outright
("Not a valid PKCE flow url", GoTrueClient.js:3216). If the flow type is ever
changed to `implicit`, this analysis must be redone.

**Considered and rejected:** blocking `createRoot().render()` in `main.tsx` on
the config fetch. It would make the ordering question moot by construction, but
it puts first paint behind a network round-trip and turns a slow `/api/config`
into a blank page. Given (2), it buys nothing.

## 4. No build-time fallback — the one place the brief was overruled

The task allowed keeping `import.meta.env` as a last resort for local dev
"if and only if it does not reintroduce the coupling". It does reintroduce it,
so it is gone.

With a fallback, `web/app`'s bytes would still differ between a tree that has
`client/.env.local` and one that does not. Nothing would *break* — the server
value takes precedence — but the stated goal, *`web/app` becomes a pure
function of `client/src`*, would be false, and the central assertion ("an
env-less bundle works") would only be checkable in trees that happen to lack
the file. A property you cannot assert everywhere is a property you do not
have.

The cost of dropping it was checked, not assumed: **`client/vite.config.ts`
declares no `server.proxy`.** `pnpm run dev` therefore cannot reach any backend
at all — `/api/content`, `/api/me` and everything else 404 against the Vite dev
server — so `vite dev` was never a working path for this app, with or without
Supabase env. Nothing real is lost.

Also rejected: injecting the values into `web/app/index.html` at deploy time.
`index.html` is itself a tracked build artifact; that is the same defect in a
new file. And: caching the fetched config in localStorage — it would defeat
the rotation upside and add a stale-key failure mode for no gain.

## 5. What was deleted, and why that is safe now

| deleted | why it existed | why it is safe to delete |
|---|---|---|
| `tools/provision_worktree_env.sh` (REQ-0278) | copied `client/.env.local` into a worktree | there is no env to provision |
| `tools/check_bundle_env.sh` (REQ-0278, repaired REQ-0340) | asserted a built bundle carried `VITE_SUPABASE_*` | its subject is now always "no", by design |
| `tools/ci.sh` stage `[6.1/7]` | ran the above | — |
| `client/.env.example` | documented a file nothing reads any more | — |

`client/.gitignore`'s `.env.local` line **stays** — ordinary Vite hygiene, and
cheap insurance against someone committing one later.

Callers were grepped for: none outside `ci.sh [6.1/7]` and prose
(`client/README.md`, `docs/llm_managed/architecture.md`, both updated).
`tools/ci_scope.sh`'s classification table names no deleted file — its
self-check enumerates top-level entries, `client/src/*` and `server/routes/*`,
none of which changed — and `tools/ci_scope.sh --selftest` is green (S1a–S6).

### What replaced them is a different kind of check

A gate that inspects the *output* could only ever ask "did this build carry
env?". The right question now is "**can** this build carry env?", and that is a
question about the source:

- `client/scripts/check_auth.mjs:168` — no file under `client/src/` may contain
  `VITE_SUPABASE`. Runs in every tree, needs no env, and is `ci.sh [5.9/7]`.
- `client/e2e/runtime-config.spec.ts` — the same assertion against the actually
  served bundle, in a real browser, plus the configured sign-in UI.

> **Worth recording, because it is the exact trap REQ-0340 §3 documented.**
> That plain substring check was **useless** as a gate before this REQ:
> `client.ts` called `readEnv('VITE_SUPABASE_URL')`, so the literal survived
> into an env-LESS bundle as a function argument and any such grep passed
> either way. REQ-0340 called it out as a guard that "would have reproduced the
> free pass in a new place". Deleting the read is precisely what converts it
> from a free pass into a real gate. Same string, opposite meaning — the
> difference is entirely in what the code does.

## 6. Tests, and each one watched failing

**Server** — four cases in `server/tests/api/public.cjs`, following the file's
`T()` + `mockReq`/`mockRes` convention, driving `process.env` around the call
(the route reads it per request, so no module eviction is needed): configured
(asserting the body **and** `Cache-Control: no-store`), unconfigured (nulls with
**200**, the degrade contract), blank-value, and non-GET falling through.

**Client** — seven cases appended to `check_auth.mjs`, running the real
`client/src/auth/client.ts` through the existing vite-ssrLoadModule rig against
a stubbed `fetch`: the request path, a real client built from server values, an
unconfigured server ⇒ null, a half-configured server ⇒ null, a 404 ⇒ null, a
rejected fetch ⇒ null, and memoisation. Plus the source tripwire above.

**E2E** — `client/e2e/runtime-config.spec.ts`, two tests. `tools/e2e_fleet.cjs:110`
gives every fleet backend **synthetic** values (`https://e2e-supabase.invalid`,
`e2e-fleet-anon-key`) unconditionally, never inherited from the ambient
environment: the run stays hermetic (REQ-0217), no live credential is ever
inside an e2e process, and the spec can assert exact values that no bundle
could possibly have baked.

1. `GET /api/config` returns those values with `cache-control: no-store`.
2. On the built bundle: every loaded `.js` chunk is fetched and asserted to
   contain no `VITE_SUPABASE`; the page is observed issuing `GET /api/config`
   during boot; and the Settings sign-in block shows
   `settings-continue-discord` + `settings-play-guest` with zero
   `settings-signin-unconfigured` (`client/src/Settings.tsx:54,73`) — the
   absence of that exact note being the symptom REQ-0266 and REQ-0337 shipped.

### Negative controls (a gate nobody has seen fail is a claim)

| control | result |
|---|---|
| append a `VITE_SUPABASE_URL` read to `client/src/auth/session.ts`, run `check_auth.mjs` | **exit 1**, `FAIL … -- src/auth/session.ts`; restored ⇒ exit 0 |
| set the fleet's `SUPABASE_URL`/`SUPABASE_ANON_KEY` to `''`, run the spec | **2 failed** — `getByTestId('settings-continue-discord')` not found, i.e. the app fell back to "not configured" exactly as the accident does |

The second is the important one: it proves the e2e assertion is load-bearing
and not passing for an unrelated reason.

## 7. The one real downside: a deploy dependency moved from build time to server config

Stated plainly, because it is a genuine trade and not a detail.

Before, the two values travelled inside the committed `web/app`, so deploying
the client deployed its config. Now **`server/.env` must carry `SUPABASE_URL`
and `SUPABASE_ANON_KEY`**, and systemd reads `EnvironmentFile` at **start** —
so `systemctl --user restart backpack-api` is required for a change there to
take effect. A server missing them serves nulls and every client shows "not
configured".

- Both keys were **added to `~/backpack_ragnarok/server/.env` on llmlocal**
  during this REQ (values read from the main checkout's `client/.env.local`,
  never printed; a `server/.env.req0341.bak` backup was written). That file is
  gitignored and is not part of this branch.
- `server/.env.example` (tracked) now documents both, marked as an operational
  requirement, so a future operator meets it where they would look.
- **NOT DONE, deliberately: the live `backpack-api` was not restarted** (this
  REQ stops at `built/`; restarting live services needs a fresh go-ahead). The
  running service therefore does **not** yet serve `/api/config`. Nothing is
  broken meanwhile — master's deployed bundle still carries baked env — but
  **the restart must happen as part of merging this branch**, otherwise the
  newly deployed env-less bundle will find no config and sign-in goes dark.
  That is the same failure REQ-0266/0337 produced, arriving from the other
  side, and it is the one way to get it wrong from here.

### The upside on the same axis

Rotating the Supabase anon key stops being a client rebuild + `web/app` commit
+ static redeploy, and becomes an edit to `server/.env` plus an API restart.
The old shape is why `42238f8` ("rebuild web/app on main at deploy") existed at
all. `web/app` is now a pure function of `client/src`, so every tree — main
checkout, any worktree, any future CI runner that never had the secret —
produces the same bytes.

## 8. Files

| file | |
|---|---|
| `server/routes/public.cjs` | + `GET /api/config`, `publicClientConfig()`, `envOrNull()` |
| `server/lib/http_util.cjs` | `sendJSON` gains an optional 4th header-bag arg (for `no-store`) |
| `server/tests/api/public.cjs` | + 4 route tests |
| `server/.env.example` | + `SUPABASE_URL` / `SUPABASE_ANON_KEY` with the operational note |
| `client/src/auth/client.ts` | rewritten: runtime fetch, memoised, timeout-bounded, no `import.meta.env` |
| `client/src/store/boot.ts` | `await createSupabaseClient()`; the ordering argument lives at the call site |
| `client/scripts/check_auth.mjs` | + 7 runtime-config cases + the source-level tripwire; explicit `process.exit(0)` (supabase-js's auto-refresh interval keeps the loop alive) |
| `client/e2e/runtime-config.spec.ts` | **new** — the regression test |
| `tools/e2e_fleet.cjs` | fleet backends get synthetic public config |
| `tools/ci.sh` | `[6.1/7]` removed; the `[6/7]` comment explains what replaced it |
| `client/README.md`, `docs/llm_managed/architecture.md` | rewritten sections |
| `tools/provision_worktree_env.sh`, `tools/check_bundle_env.sh`, `client/.env.example` | **deleted** |

## Log
- 2026-07-29 reserved as REQ-0341 on branch `req-0341-runtime-public-config`
  (off master, after REQ-0340 landed).
- 2026-07-29 implemented (`398325d`), machinery deleted (`4f99da9`),
  `client/.env.local` removed from the worktree so the gate builds and tests an
  env-LESS bundle. reserved -> built.

## Gate results (2026-07-29)
`tools/release.sh` (full gate, `CI_SCOPE=both` forced by release.sh) — **CI GREEN**.
`CI_WALL 502.46` s wall (ci.sh's own stage total 494.5 s).

| | |
|---|---|
| client e2e (default suite) | **206 passed / 0 failed / 1 skipped** (3.5 m) — baseline 204/0/1 plus this REQ's two |
| admin trio (artadmin / artinspect / contentadmin) | **8 / 1 / 28** — baseline |
| registry-first serving e2e | **4 / 4** — baseline |
| `[0.5/7]` ci_scope self-check | GREEN (S1a–S6) — no rule named a deleted file |
| `[4/7]` server api tests (files) | 227 passed, 0 failed (223 + this REQ's 4) |
| `[5.9/7]` `check_auth.mjs` | all assertions pass, including the 7 new runtime-config cases and the source tripwire |
| `[6.1/7]` | **gone** — the run goes `[6/7]` -> `[6.5/8]` |

`tools/release.sh` then rebuilt and committed the dist itself
(`146c290 dist rebuild (web/app/) via tools/release.sh -- CI green`, 6 files,
12 insertions / 12 deletions — the asset hashes moved and `index.html` follows).
That committed bundle is env-less: it was built in a tree with no
`client/.env.local`, and it is the bundle the e2e suite had just proved
reaches a configured Supabase client.

## Env-less-build proof — exactly how it was demonstrated
1. `rm client/.env.local` in the worktree, then `pnpm run build`.
2. `grep -rl VITE_SUPABASE web/app` ⇒ **0 files**; `grep -rl /api/config web/app/assets` ⇒ **1**.
3. `client/e2e/runtime-config.spec.ts` run against that bundle through the
   sanctioned hermetic harness (`pnpm run e2e runtime-config.spec.ts`,
   `E2E_GPU=1`): **2 passed**. It re-fetches every loaded chunk and asserts no
   `VITE_SUPABASE`, observes the boot-time `GET /api/config`, and asserts the
   Settings sign-in block is the CONFIGURED variant.
4. Negative control (section 6): with the fleet's config blanked, the same spec
   **fails** on `settings-continue-discord` — i.e. the bundle really has no
   other source of config, and the assertion is not passing for free.
5. The bundle committed by `tools/release.sh` at the end of the gate is that
   same env-less bundle.

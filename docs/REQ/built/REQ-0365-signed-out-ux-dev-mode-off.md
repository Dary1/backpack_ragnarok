# REQ-0365 - Signed-out UX + dev_mode off (the Continue button that still worked)

**Slug:** signed-out-ux-dev-mode-off
**Reserved:** 2026-08-03

- Origin: user report in chat 2026-08-03, immediately after REQ-0362 shipped --
  "TOP に戻りましたが、continue ボタンが押せてしまいます。これは、サインアウトした
  事になってないのでは？". It is not. Sign-out worked; there was nothing to be
  signed out OF.

## Investigation (all measured, not reasoned)

`server/admin.cjs`'s `resolveAuth()` falls back to the dev player whenever no
credential is presented AND `dev_mode` is true. `readDevUser()` defaults a
MISSING `dev_mode` key to `true` (line 71, "absent means not yet turned off"),
and the live box's `data/config/dev_user.json` has no such key. So:

```
$ curl https://backpack-dev.qtie.jp/api/me          # no credentials
{"playerId":"dev","name":"Developer","roles":["item_admin"]}
```

Two consequences, one of them worse than the reported one:

1. Sign-out drops the caller from their Discord player to the DEV player -- a
   full account. The landing's Continue is a plain `setRoute('backpacks')` with
   no gate anywhere (`Settings.tsx` is the ONLY file in the client that reads
   `getAuthState()`), so it works, because the app is genuinely still usable.
2. That dev identity carries `roles:['item_admin']`, and backpack-dev is public
   through the Cloudflare tunnel. Anyone with the URL was an item_admin.

### The trap that shaped the fix

A scratch `dev_mode:false` api (2026-08-03) answers:

| request (no credentials)      | status |
|---|---|
| `/api/health`                 | 200 |
| `/api/config`                 | 200 |
| `/api/content`                | 200 |
| `/api/me`                     | **401** |
| `/api/profile/default/canvas` | **401** |
| `PUT /api/admin/item/<x>`     | **403** |

`/api/content` 200s while the canvas 401s, and `resolveGameData` swallows the
canvas failure (`fetchCanvas(profileId).catch(() => null)`), reporting
`source:'live'`, `isFreshProfile:true`. So simply turning dev_mode off would
have made `boot()` **succeed** into a pristine scenario board that looks
completely normal and whose every auto-save 401s in silence. The signed-out
branch therefore has to be taken BEFORE `resolveGameData`, not after: once the
scenario board exists nothing distinguishes it from a real one.

### Why a client-only gate was not an option

The first plan was a client gate on "no Supabase session". It cannot work:
`tools/e2e_fleet.cjs:110` hands EVERY fleet worker
`SUPABASE_URL: 'https://e2e-supabase.invalid'`, so `auth.configured` is true in
e2e too, and 35 of the 45 spec files boot with no credential at all. Gating on
"not signed in" would have failed most of the suite, and the only way around it
would have been a test-only bypass in production code.

What makes the real fix safe instead: `data/` is gitignored, so `dev_mode` is
per-box runtime config, and the fleet seeds its own
`client/e2e/fixtures/config/dev_user.json`. Live can therefore go
`dev_mode:false` while every e2e worker stays `true`. No bypass.

## Changes

- `client/src/store/core.ts`: `status` gains a fourth value, `'signed_out'`.
  A status rather than a flag beside `status:'ready'` -- every board and panel
  already guards on `status !== 'ready'`, so they all stay unmounted for free.
- `client/src/store/boot.ts`: `fetchMeWithRetry` rethrows a 401 instead of
  retrying it (it is an answer, not a failure); `bootInner` catches that and
  sets `status:'signed_out'` and RETURNS -- before `resolveGameData`.
- `client/src/App.tsx`: when signed out, every route except `landing` and
  `settings` is sent to the landing. Settings is exempt: sign-in lives there.
- `client/src/landing/LandingPage.tsx`: the three deep-link entries are really
  `disabled` (not routed-then-bounced -- a bounce is the same lie with extra
  steps), and the savechip is replaced by a sign-in CTA.
- `client/src/Settings.tsx`: a 401 from its own `fetchMe()` renders
  "not signed in", not `accountLoadError`.
- i18n (`landing.signInRequired` / `landing.signIn` / `settings.notSignedIn`),
  `landing.css`, `styles/base.css`. `landing.menu.settingsNote` retired the
  stale "logout" wording REQ-0362 left behind.
- `tools/e2e_fleet.cjs`: `E2E_DEV_MODE_OFF=<csv>` seeds those workers
  `dev_mode:false`. Default off, so the other 45 spec files are untouched.
- `client/signedout.config.ts` + `tools/signed_out_e2e.sh` +
  `client/e2e/signed-out.spec.ts`: the new harness. The config sits beside
  `playwright.config.ts`, not in `e2e/`, because it SPREADS the base config and
  every relative path in it (`testDir`, `globalSetup`, the webServer command)
  resolves against the config file's own directory.
- `client/playwright.config.ts`: `signed-out.spec.ts` added to `testIgnore`.
- `tools/ci.sh`: new `[6.7/8]` stage, public scope, no pg.

## Gates

`CI_SCOPE=both tools/ci.sh`: **CI GREEN**, 390s. Receipt tree
`b8d5db5c0c80aaec304fba919cbd6ffbaef16cb3`; the run was against a dirty tree and
the dist commit reproduces that hash exactly (`git rev-parse HEAD^{tree}`).

- `[0.5/7]` ci_scope self-check: GREEN, including the new S5b and the rewritten
  S5/S6. It went RED first, correctly: S5 encoded "testIgnore set == admin
  specs", and signed-out.spec.ts is testIgnore'd while being public. The
  invariant was widened with a DECLARED third category
  (`KNOWN_HARNESS_ONLY_PUBLIC_SPECS`) rather than by mislabelling the spec
  admin -- which would have inverted its scope (an admin-only diff would run it;
  a public-only diff would not).
- `[6/7]` client typecheck + build: clean.
- `[6.5/8]` + `[6.6/8]` admin harnesses: green (forced by CI_SCOPE=both).
- `[6.7/8]` signed-out e2e (NEW): 5 passed.
- `[7/7]` client e2e: 212 passed -- the whole existing suite, unchanged, on
  dev_mode:true workers. That number not moving is the point of the
  `E2E_DEV_MODE_OFF` default-off knob.
- `oxlint`: 45 warnings / 0 errors, identical to the master baseline; none in a
  file this REQ touched.

### Negative control (the gate was verified to FAIL, not just to pass)

`client/src/store/boot.ts`'s 401 branch was made unreachable (`e.status === 401`
-> `499`, a status that never occurs -- chosen over `if (false && ...)`, which
does not typecheck and therefore left the OLD bundle in place and produced a
false green on the first attempt). Rebuilt, re-ran `tools/signed_out_e2e.sh`:

    2 failed, 3 passed
      x  the landing locks its deep-link entries and offers sign-in instead
      x  boot does NOT fall through to an unsaveable scenario board

Exactly the two client-gate assertions, and only those. Tests 1/2 (server-side)
and 5 (Settings, which has its own independent 401 handling) correctly stayed
green -- confirming the three mechanisms are separately covered rather than one
assertion wearing three hats.

## Outcome

Merged to master (rebased onto REQ-0288/REQ-0290, which landed mid-flight; the
stale dist-rebuild commit was dropped in the rebase and regenerated by
release.sh). `tools/release.sh`: CI GREEN, scope=both, 645s -- 222 default e2e
+ 5 signed-out + the admin trio. Pushed as 082c3e76, receipt tree
`8ee3909b4c010fb8fbe84af46c77439b85f3332c`.

Live client bundle `index-CO_qa8Fb.js` verified to carry the new paths
(`landing-signed-out`, `landing-mi-locked`, `settings-account-signedout`,
`signed_out`, both JA strings).

### The live flip, and what it measured

`data/config/dev_user.json` on the main checkout gained `"dev_mode": false`.
No restart was needed and none was done: `readDevUser()` re-reads the file on
every auth resolution, which the before/after below confirms rather than
assumes.

| request to backpack-dev.qtie.jp (no credentials) | before | after |
|---|---|---|
| `/api/me`                     | 200 `{"playerId":"dev","roles":["item_admin"]}` | **401** |
| `PUT /api/admin/item/<x>`     | (would have passed the item_admin gate) | **403** |
| `/api/config`                 | 200 | 200 |
| `/api/content`                | 200 | 200 |
| `/api/profile/default/canvas` | 200 | **401** |

That closes the REQ-0362 review finding: the tunnel is public, and until this
flip anyone who knew the URL resolved to a player holding `item_admin`.

### Operational note -- this setting is NOT in git

`data/` is gitignored, so `dev_mode:false` lives only on this box's filesystem.
A rebuilt box, a restored home, or a `data/` wipe silently returns to
`dev_mode:true` -- `readDevUser()` treats an ABSENT key as true by design
(server/admin.cjs's "absent means not yet turned off"). Nothing in the tree
will notice. The backup of the previous file is at /tmp/dev_user.backup.json
for this session only.

This is the one loose end this REQ does not close, and it is deliberately not
closed by inventing a second source of truth (an env var in the systemd unit
would let the box be in dev_mode two ways with no way to tell which won).
Raised with the user 2026-08-03.

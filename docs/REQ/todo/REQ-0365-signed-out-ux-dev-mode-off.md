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

<pending>

## Outcome

<pending>

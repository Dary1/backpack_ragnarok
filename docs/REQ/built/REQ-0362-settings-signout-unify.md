# REQ-0362 - Settings sign-out unify (dead Logout button)

**Slug:** settings-signout-unify
**Reserved:** 2026-08-03

- Origin: user report in chat 2026-08-03 -- "on https://backpack-dev.qtie.jp/app/#/settings
  the Logout button does nothing". Root-caused in the same chat; design ratified
  by the user there (see Decisions).

## Defect

`client/src/Settings.tsx`'s account block renders a Logout button wired to
`logout()` in `client/src/store/routing.ts`:

```ts
export function logout(): void {
  clearStoredToken();                 // REQ-0037 invite token ONLY
  if (typeof location !== 'undefined') location.reload();
}
```

`clearStoredToken()` (`client/src/api/http.ts`) removes exactly one key,
`backpack_ragnarok:auth_token` -- the REQ-0037 invite token. It does not touch
the REQ-0118c Supabase session, which `createSupabaseClient()`
(`client/src/auth/client.ts`) creates with `persistSession: true`, so supabase-js
holds its own `sb-*-auth-token` entry in localStorage.

On backpack-dev, where auth is Supabase (Discord or anonymous guest), the button
therefore: clears a key that is usually not even set, reloads, and
`initSupabaseAuth()` (`client/src/auth/session.ts`) restores the identical
session from localStorage. The hash is still `#/settings`, so the page comes back
byte-identical -- the reload is invisible and the button reads as inert.

Two adjacent problems fall out of the same root:

- The `auth.status === 'anonymous'` branch of `AuthBlock` has NO sign-out control
  at all, only "Continue with Discord". A guest had no working way to sign out
  anywhere in the app.
- `.settings-signout-btn` (the AuthBlock button that DOES work) has no CSS rule;
  all of the sign-out styling in `client/src/styles/base.css` sits on
  `.settings-logout-btn`, the dead one. The working control was the
  unstyled-looking one.

Deployed bundle `web/app/assets/index-BZ0RK0nt.js` was decompiled and matches
source (`Kp(){...localStorage.removeItem(Up)...}`), so this is a source defect,
not a stale build artifact.

## Decisions (user, chat 2026-08-03)

1. Unify on `AuthBlock`: delete the account block's Logout button and store's
   `logout()`; `AuthBlock` becomes the app's single sign-out control.
2. Sign-out returns the user to the landing route (`#/`), not back to
   `#/settings`. Staying put is what made the old button read as inert.

## Changes

- `client/src/Settings.tsx`
  - Account block: Logout button removed; `logout` import dropped.
  - `AuthBlock`: one `signOutEverything()` -- `await signOutSupabase()` (a no-op
    when Supabase is unconfigured) then `clearStoredToken()` then reload to `#/`.
  - The sign-out button now renders in every state that HAS something to sign
    out of: `discord`/`other`, `anonymous` (new), and -- critically -- the
    unconfigured and `signed_out` states WHEN an invite token is stored.
    Rationale: an env-less CI/e2e build has no Supabase client at all, so the
    REQ-0037 invite path is the ONLY auth path there; gating sign-out on
    `auth.configured` would have deleted its only exit and regressed
    `client/e2e/guest-auth.spec.ts`'s logout coverage.
  - `hasInviteToken` is read ONCE at mount (`useState` initialiser). The only
    writer during the page's life is `signOutEverything()`, which reloads, so it
    cannot go stale.
- `client/src/store/routing.ts`: `logout()` deleted; `clearStoredToken` dropped
  from the `../api` import (it had no other caller in this module).
- `client/src/i18n/settings.ts`: `settings.logout` removed;
  `settings.signOutDiscord` -> `settings.signOut` with a provider-neutral label
  (the one button now ends guest and invite sessions too, so "Sign out of
  Discord" would be wrong in two of its four states); `settings.signedInWithInvite`
  added.
- `client/src/styles/base.css`: `.settings-logout-btn` rules renamed to
  `.settings-signout-btn`, moving the styling onto the surviving button.
- `client/e2e/guest-auth.spec.ts`: both tests retargeted from
  `.settings-logout-btn` to `[data-testid="settings-signout"]`; the logout test
  now also asserts the post-sign-out landing on `#/`.

## Gates

`tools/ci.sh` on this worktree: **CI GREEN**, 235s, ci-scope `public`
(diff = 17 paths, 0 admin -> [6.5]/[6.6] admin harnesses correctly skipped).
Receipt tree `5ceea596568116d228669bf2cff4c4f36fe3eb2a` written to
`/srv/bpkgit/backpack_ragnarok.git/ci-receipts/`; the run was against a dirty
tree, and commit 17e591cf reproduces that tree hash EXACTLY (verified with
`git rev-parse HEAD^{tree}`), so the push gate has the matching receipt.

- `[6/7]` client typecheck + build: clean (7.0s).
- `[7/7]` client e2e, SCOPED hermetic run (port desk decade 9000-9009):
  **212 passed**, including the rewritten
  `guest-auth.spec.ts › sign out › sign out clears the stored token and returns
  to the landing in the dev-mode/default state`.
- `client/scripts/check_auth.mjs`: all assertions pass -- covers
  `signOutSupabase -> signOut called + token cleared`.
- `oxlint`: 45 warnings / 0 errors, byte-identical to the master baseline
  measured in `~/backpack_ragnarok/client`; none of the 45 fall in a file this
  REQ touched.
- Post-patch sweep: no live reference to `settings-logout-btn`,
  `settings.logout`, `signOutDiscord`, or store's `logout` survives. The four
  remaining string hits are a CSS rename comment, an e2e comment, and two
  NEGATIVE assertions (`toHaveCount(0)`) that pin the deletion.
- Bundle provenance: the deployed `web/app/assets/index-BZ0RK0nt.js` was
  decompiled before any edit and matched source, ruling out a stale-artifact
  explanation for the reported defect.

### Coverage limitation -- read before accepting

The e2e fleet builds ENV-LESS (no Supabase config), so `[7/7]` exercises the
new button only in its **invite-token** branch. The `discord` / `anonymous`
branches are unreachable without a configured server, and `signOutSupabase()`
is proven only at unit level by `check_auth.mjs`. The user-reported symptom is
in the Supabase path, so acceptance needs a LIVE check after deploy:

1. `#/settings` on backpack-dev, signed in with Discord -> Sign out -> lands on
   the landing (`#/`) and `sb-*-auth-token` is gone from localStorage.
2. Same as an anonymous guest -- the branch that had no sign-out control at all.

## Outcome

Built, NOT merged. `~/backpack_ragnarok` @ master IS live (backpack-api mtime
hot-reload), so the merge is a deploy and needs the user's go-ahead. The live
check above is the acceptance criterion.

# Social Login Platform — Research & Selection

Status: **LLM research memo** (not a golden, not a ratified REQ). Requested 2026-07-09.
Scope: pick the social-login platform that best fits `backpack_ragnarok` for the three
target storefronts: **Steam · Google Play · Apple App Store**.

## TL;DR — Recommendation

**Use Supabase Auth as the single social-login platform**, with this provider set:

| Provider | Why | Support in Supabase |
|---|---|---|
| **Google** | Default identity on Android / Google Play; ubiquitous on desktop web too | Built-in |
| **Sign in with Apple** | **Mandatory** on iOS once any third-party login is offered (App Store Guideline 4.8) | Built-in |
| **Discord** | Highest-value social identity for an indie PC/community game; friends already have accounts | Built-in |
| **Steam** | Native storefront identity on desktop; the only gap — no native Supabase support | **Custom server bridge** (see §5) |
| **Anonymous / guest** | Preserve today's zero-friction onboarding; upgradeable to a real account later | Built-in (`signInAnonymously`) |

Rationale in one line: the project **already runs self-hosted Supabase in production**
(REQ-0040, Postgres is the prod storage backend), so Supabase Auth adds the two
store-mandated providers (Google, Apple) plus Discord with **zero new vendor, zero
lock-in, and no extra hosting cost** — and Steam, the one thing it can't do natively,
is a small, well-trodden server-side add-on that fits our existing `server/api.cjs`.

## 1. Project context that drives the choice

- **Backend is already Supabase.** Self-hosted on `llmlocal`; Postgres is the production
  storage backend via the storage seam (REQ-0040, `STORAGE_BACKEND=pg`). Auth vs. guest
  tokens was *explicitly deferred* in REQ-0040 Phase 3 — this memo answers that.
- **Current auth = guest invite tokens** (REQ-0037): `X-Auth-Token` header, no password,
  no email, per-player profiles. Low-friction is a deliberate value.
- **EOS was already rejected** (REQ-0037): friends lacked Epic accounts. Lesson: do not
  force players into an unfamiliar ecosystem account. This rules EOS back out and argues
  for *familiar* providers (Google/Apple/Discord/Steam) + keeping a guest path.
- **Client is a web app** (Vite + React + TS + PixiJS). For the storefronts it will be
  wrapped: desktop (Electron/Tauri) for Steam, Capacitor for Google Play / App Store.
  Auth therefore must work as web-redirect *and* native flows — Supabase's JS SDK does.
- **Constraints revealed by the codebase:** solo-scale, cost-conscious, self-hosted,
  no public exposure beyond the tunnel, English docs. Favors self-hostable + free +
  no-lock-in over a managed game-backend suite.

## 2. Per-store login requirements (verified 2026-07)

- **Steam** — Two mechanisms. (a) **OpenID 2.0** on web: "Sign in through Steam" button
  redirects to Steam, returns the 64-bit SteamID (cannot run in an iframe). (b) inside a
  packaged Steam build, the **Steamworks SDK Session Ticket** identifies the user and
  verifies game ownership. No mainstream auth SaaS supports Steam natively *except*
  PlayFab. Integration is always partly DIY.
- **Google Play** — Google Sign-In and/or **Play Games Services v2** (silent sign-in at
  launch). Google OAuth covers login universally; Play Games Services is an optional
  extra for achievements/leaderboards and is Firebase/Android-native.
- **Apple App Store** — **Guideline 4.8**: if the app offers *any* third-party or social
  login, it **must also offer an equivalent privacy-focused option — in practice Sign in
  with Apple** (limit data to name+email, allow private-relay email). Skippable only if
  you offer *only* your own email/password or are a single-service client. Because we
  will offer Google on iOS, **Apple is required.**

## 3. Platform options compared

| Option | Steam | Google | Apple | Discord | Self-host / cost | Lock-in | Fit here |
|---|---|---|---|---|---|---|---|
| **Supabase Auth** | Custom bridge | ✅ | ✅ | ✅ | ✅ self-host, free | None | **Best — already in the stack** |
| Firebase Auth | Custom (OIDC) | ✅ (+Play Games) | ✅ (+Game Center) | ✅ | ❌ managed; free ≤50k MAU | Google | Redundant 2nd backend + lock-in |
| PlayFab | ✅ native | ✅ | ✅ | ❌ | ❌ managed; free dev ≤1k accts | Microsoft | Strong for Steam-first, but overlaps Supabase |
| Epic Online Services | ✅ | ✅ | ✅ | — | free | Epic | **Already rejected** (REQ-0037) |
| Auth0 / Okta | Custom | ✅ | ✅ | ✅ | ❌ managed; paid scales fast | Okta | Overkill, cost |

Read: only **PlayFab** removes the Steam DIY step, but it does so by adding a *second*
backend (identity + economy + LiveOps) that duplicates what our Supabase Postgres
already owns, plus Microsoft lock-in. **Firebase** is the mobile-native pick but it's a
redundant backend next to Supabase and still can't do Steam natively. Neither advantage
outweighs "we already operate Supabase."

## 4. Why Supabase Auth wins for this project

1. **Already deployed and self-hosted** — no new infra, no new bill, no vendor lock-in;
   consistent with the self-hosted, no-public-exposure posture.
2. **Covers the two mandated providers out of the box** — Google (Play) and Sign in with
   Apple (satisfies Guideline 4.8) are built-in.
3. **Identities land in our own Postgres** — one user model, RLS available (flagged in
   REQ-0040 Phase 3), no data split across a game-SaaS.
4. **Keeps the guest path** — `signInAnonymously()` preserves REQ-0037's zero-friction
   onboarding and lets a guest later *link* Google/Apple/Steam without losing progress.
5. **Works across all three wrappers** — web redirect; Electron/Tauri via loopback or
   custom-scheme redirect; Capacitor via a native plugin
   (`@capgo/capacitor-social-login`, documented to pair with Supabase) for real
   Google/Apple native sheets on iOS/Android.

## 5. The one gap — Steam — and how to close it

Steam is not a native Supabase provider and Steam uses **OpenID 2.0**, which is *not*
OIDC, so it cannot be added via Supabase's "custom OIDC provider" path. Use a small
server-side bridge (this is the established community pattern):

- **Web / launcher build:** `server/api.cjs` gets a `/auth/steam` route that runs the
  Steam OpenID 2.0 handshake, receives the verified SteamID, then **mints a Supabase
  session** for a user keyed on that SteamID — either via the Admin API
  (`admin.createUser` / generate a magic link) or by issuing our own signed token that
  maps to the Supabase user. (Ref: Supabase discussion #15118.)
- **Packaged Steam build:** obtain a **Steamworks Session Ticket** client-side, POST it
  to the same route, verify it with the Steam Web API (`AuthenticateUserTicket` +
  ownership check), then mint the session. This also gives ownership/anti-piracy checks
  for free.
- Effort estimate: one server route + Steam Web API key + a client button. Small, and it
  reuses our existing auth/storage seam. Worth its own REQ.

## 6. Rollout shape (suggested, not ratified)

1. Enable Supabase Auth providers: Google, Apple, Discord; turn on Anonymous sign-in.
2. Bridge guest → Supabase: let a current guest-token player link a real identity so no
   profile is lost (respects REQ-0037 profiles + REQ-0089 save reliability).
3. Add the Steam bridge route (§5) as a dedicated REQ.
4. Wrappers: Capacitor social-login plugin for mobile; Electron/Tauri redirect handling
   for the Steam desktop build.
5. iOS compliance gate: ship **Sign in with Apple** alongside Google before any App Store
   submission (Guideline 4.8).

## 7. When to revisit this decision

Choose **PlayFab** instead only if the game pivots to *Steam-desktop-first with a
full live-ops/economy/leaderboard backend* and the team accepts a second backend +
Microsoft lock-in. As long as Supabase remains our system of record, Supabase Auth is
the correct choice.

## 8. Open questions for the user

- Launch priority order among Steam / Google Play / App Store? (Affects what to build
  first, not the platform choice.)
- Desktop wrapper: Electron or Tauri? (Affects the Steam redirect mechanics only.)
- Should this memo be promoted to a REQ (Steam bridge + Supabase Auth cutover)? If yes,
  reserve a number with `python3 tools/touch_next_req_reserved.py <slug>`.

## Sources

- Apple Guideline 4.8 / Sign in with Apple mandate — https://developer.apple.com/news/?id=7j1f99yf , https://workos.com/blog/apple-app-store-authentication-sign-in-with-apple-2025
- Steam OpenID / Steamworks auth — https://partner.steamgames.com/doc/features/auth
- Supabase social providers list & anonymous sign-in — https://supabase.com/docs/guides/auth/social-login , https://supabase.com/docs/guides/auth/auth-anonymous
- Supabase + Steam workaround — https://github.com/orgs/supabase/discussions/15118
- Supabase custom OAuth/OIDC providers — https://supabase.com/docs/guides/auth/custom-oauth-providers
- Firebase Auth providers & pricing — https://firebase.google.com/docs/auth , https://firebase.google.com/pricing
- PlayFab authentication & pricing — https://learn.microsoft.com/en-us/rest/api/playfab/client/authentication/login-with-steam , https://learn.microsoft.com/en-us/gaming/playfab/pricing/pricing-overview
- Google Play Games Services sign-in — https://developer.android.com/games/pgs/signin
- Capacitor social login (Supabase-compatible) — https://github.com/Cap-go/capacitor-social-login , https://capgo.app/blog/setup-supabase-with-capacitor-social-login/

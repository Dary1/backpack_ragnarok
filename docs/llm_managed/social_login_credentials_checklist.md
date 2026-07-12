# Social Login — credentials YOU must obtain (for REQ-0118a / 0118b)

Purpose: the external accounts, keys, and secrets that only you can register (they are
tied to your identity / payment). I cannot fetch these. For each item: what it is, where
to get it, cost, and **what value to hand back** (place secrets in `server/.env` on the
server — never paste in chat, never commit). Ordered Google-first per your priority.

Verified 2026-07-09 (see Sources).

> **CURRENT DECISION (2026-07-09): Discord only + guest, distributed off-store to keep
> cost $0.** So right now ONLY **Section C (Discord)** and **STEP 0 (callback domain)**
> apply. Sections A (Google), B (Apple), D→E (Steam) and their fees are **deferred** —
> keep them here as reference for if/when paid stores are targeted later. Note: on iOS,
> App Store Guideline 4.8 will require adding Sign in with Apple (Section B) before any
> App Store submission.

---

## STEP 0 — Decide the public auth callback URL (do this first)

Every provider below asks for an exact **redirect/callback URL** during setup, so this
must be fixed before you register anything.

- Standard OAuth requires a **public HTTPS** callback; `http://` is rejected (localhost
  only). Our self-hosted Supabase is currently **localhost-only** (REQ-0040, no public
  exposure). So we must expose the Supabase auth endpoint publicly over HTTPS — cleanest
  is to route Kong `/auth/v1/*` through the **existing Cloudflare tunnel**.
- Pick the domain (e.g. reuse `backpack-dev.qtie.jp`, or a dedicated `auth.qtie.jp`).
- **The callback URL every provider needs = `https://<that-domain>/auth/v1/callback`.**
- Decision needed from you: which domain. (Infra wiring is my side.)

---

## A. Google  ← priority (Google Play track)

### A1. Google Play Console developer account
- Where: play.google.com/console — register as developer.
- Cost: **$25 one-time** (no annual fee).
- Needed to publish the Android app (and for Play Games Services later). Not an API key,
  but a prerequisite for the store.

### A2. Google OAuth credentials (for Supabase login)
- Where: Google Cloud Console → create a project → configure the **OAuth consent screen**
  (External; scopes: `openid`, `email`, `profile`).
- Create an OAuth client of type **Web application**:
  - Authorized redirect URI = the STEP 0 callback URL.
  - Authorized JavaScript origins = your app URL(s).
- (Android native, needed later for the Capacitor build, not for first web tests) create
  an **Android** OAuth client — needs the app **package name** + **SHA-1** of the signing
  keystore. I can generate the SHA-1 with you once the keystore exists.
- Cost: free.
- **Give me:** Web **Client ID** + Web **Client Secret**.

---

## B. Sign in with Apple  ← required before any iOS / App Store submission (Guideline 4.8)

- Requires the **Apple Developer Program**: **$99 / year**. Enroll at developer.apple.com.
- In the Apple Developer console, create/collect:
  1. **Team ID** (10-char, shown in Membership).
  2. An **App ID** with the "Sign In with Apple" capability enabled.
  3. A **Services ID** — this becomes the OAuth **Client ID**; set its Return URL to the
     STEP 0 callback URL and register the domain.
  4. A **Key** with "Sign In with Apple" enabled → download **`AuthKey_XXXXXXXXXX.p8`**
     (downloadable ONCE — store safely) and note its **Key ID**.
- Note: the actual client secret is a JWT that Supabase regenerates from your .p8 + IDs;
  it expires every 6 months but is handled automatically once configured.
- **Give me:** Team ID, Services ID, Key ID, and the **.p8 file** (as a server secret —
  never commit; reference by path).

---

## C. Discord  ← community login (nice-to-have, cheap)

- Where: discord.com/developers → New Application → **OAuth2**.
- Add a redirect = the STEP 0 callback URL; copy credentials.
- Cost: free.
- **Give me:** Discord **Client ID** + **Client Secret**.

---

## D. Anonymous / guest

- Nothing to obtain. Built into Supabase; I just enable it in config. Preserves the
  current no-login onboarding (REQ-0037) and links to a real account later.

---

## E. Steam  ← REQ-0118b, LATER (not needed for the Google Play launch)

- **Dev/testing:** a **Steam Web API key** — steamcommunity.com/dev. Free; needs a Steam
  account + a domain + accepting the API Terms.
- **To actually ship on Steam:** a **Steamworks partner account** + the **Steam Direct
  fee = $100 per app** (non-refundable, recoupable after $1,000 revenue). Then create a
  **publisher Web API key** and note your **App ID (appid)**.
- **Give me (later):** Steam Web API key + appid.

---

## F. Supabase values — already yours (nothing new to fetch)

From the self-hosted stack (REQ-0040), already in `server/.env`: the project URL
(`API_EXTERNAL_URL`), the **anon key**, and the **service_role key** (secret — used
server-side to mint sessions, incl. the Steam bridge). I read these from the server;
you don't need to obtain anything.

---

## Minimum set to start the Google Play track
1. STEP 0 domain decision.
2. Google Cloud **Web** OAuth Client ID + Secret (A2).
3. Google Play Console account ($25) (A1) — before Android release.
4. Apple (B) before the iOS build; Discord (C) any time; Steam (E) with REQ-0118b.

## How to hand secrets over safely
- Put secret values into `server/.env` on llmlocal (gitignored) yourself, or share via
  your secure channel — **do not paste secrets into chat and do not commit them.**
- Public identifiers (Client IDs, Team ID, Services ID, Key ID, appid) are lower risk but
  still keep them in `.env`. The Apple `.p8` is a secret file.

## Sources
- Apple: SIWA + Supabase setup — https://supabase.com/docs/guides/auth/social-login/auth-apple ; Program fee $99 — https://developer.apple.com/programs/
- Google: Supabase provider — https://supabase.com/docs/guides/auth/social-login/auth-google ; Play Console $25 — https://splitmetrics.com/blog/google-play-apple-app-store-fees/ ; Android SHA-1 — https://developers.google.com/android/guides/client-auth
- Discord: https://supabase.com/docs/guides/auth/social-login/auth-discord
- Self-hosted redirect/HTTPS — https://supabase.com/docs/guides/self-hosting/self-hosted-oauth ; https://supabase.com/docs/guides/auth/redirect-urls
- Steam Web API key — https://steamcommunity.com/dev ; Steam Direct $100 — https://partner.steamgames.com/doc/gettingstarted/appfee

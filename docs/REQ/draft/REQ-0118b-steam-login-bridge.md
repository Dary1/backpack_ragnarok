# REQ-0118b — Steam login bridge (OpenID 2.0 + Steamworks session ticket)

- **Status**: DRAFT / deferred. User set Google Play as the priority storefront
  (2026-07-09), so Steam comes after REQ-0118a. Blocked on the desktop wrapper decision
  (Electron vs Tauri) before implementation may start.
- **Decision basis**: see `docs/llm_managed/research/social_login_platform_selection.md`.

## Problem
Steam is not a native Supabase provider, and Steam uses **OpenID 2.0** (not OIDC), so it
cannot be wired through Supabase's custom-OIDC path. It requires a small server-side
bridge that ends by minting a Supabase session — keeping Supabase (REQ-0118a) as the
single identity store.

## Design (proposed)
- Add `server/api.cjs` route `POST /auth/steam`.
  - **Web / launcher build**: run the Steam OpenID 2.0 handshake ("Sign in through
    Steam" — not in an iframe) → receive the verified 64-bit SteamID → mint a Supabase
    session for a user keyed on that SteamID (Admin API `createUser` / magic link, or a
    signed token mapped to a Supabase user).
  - **Packaged Steam build**: client obtains a Steamworks **Session Ticket** → POST it →
    verify server-side via the Steam Web API (`AuthenticateUserTicket` + ownership /
    anti-piracy check) → mint the same Supabase session.
  - Reference pattern: Supabase discussion #15118.
- Reuses the REQ-0118a auth→player mapping and the `storage.cjs` chokepoint.

## Needs / prerequisites
- Steam Web API key + Steam partner appid (secrets → server/.env, never committed).
- **Desktop wrapper decision (Electron vs Tauri)** — determines the OAuth/loopback
  redirect mechanics; this REQ is blocked until that is made.

## Gate
- Steam login on the desktop build yields a Supabase session mapped to a stable player.
- Ownership check enforced for packaged builds.
- Existing server tests + E2E green.

## Relationships
- Blocked by: desktop wrapper decision; sequenced after REQ-0118a.
- Related: REQ-0118a (Supabase Auth adoption), REQ-0040 (Supabase infra).

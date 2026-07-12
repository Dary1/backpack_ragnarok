# REQ-0118a — Supabase Auth backend/infra: Discord + guest (BUILT)

- **Status**: BUILT. Backend/infra complete, applied & verified live on the server
  2026-07-09. The capability is live on Supabase + tunnel, but the feature is NOT
  user-facing until the app integration (REQ-0118c) ships and is accepted — so this is
  tracked as `built`, not `done`, per the user's instruction.
- Ratified by user 2026-07-09: Supabase Auth; **Discord + guest only**; off-store; $0.
  Implements REQ-0040 Phase 3 (Auth decision).
- **Numbering**: drafted as REQ-0115a; renumbered to 0118a (0115–0117 already claimed by
  server branches; FS docs board was stale — see workflow note to user).
- **Split**: app-side integration → REQ-0118c (todo). Steam bridge → REQ-0118b (draft).
  This file covers backend/infra only.
- **Decision basis**: `docs/llm_managed/research/social_login_platform_selection.md`.

## What was done (backend / infra)
- Supabase Auth (self-hosted GoTrue) configured for **Discord + anonymous**:
  - Discord Client ID/Secret in `~/supabase/docker/.env` (secret, untracked); enabled via a
    NON-invasive `docker-compose.override.yml` so the upstream supabase checkout's tracked
    files stay unmodified.
  - `API_EXTERNAL_URL=https://auth.qtie.jp`, `SITE_URL=https://backpack-dev.qtie.jp/app`,
    `ADDITIONAL_REDIRECT_URLS` set; `ENABLE_ANONYMOUS_USERS=true`.
  - `supabase-auth` container recreated, healthy.
- Public exposure via the existing Cloudflare tunnel: `auth.qtie.jp` routes **ONLY
  `/auth/v1/*`** → Kong:54321; every other path → 404; REST/Storage/Studio stay private;
  `backpack-dev.qtie.jp` unaffected. Proxied DNS CNAME added.

## Gate results (verified live over public HTTPS, 2026-07-09)
- `/auth/v1/settings` → discord=true, email=true.
- `/auth/v1/authorize?provider=discord` → 302 to discord.com (client wired).
- `POST /auth/v1/signup` (anonymous) → access_token returned, is_anonymous=true.
- Regression: `backpack-dev.qtie.jp` web + `/api` reachable; `auth.qtie.jp/rest/v1` → 404.
- Rollback points: `~/.cf_tunnel_backup.json`; `~/supabase/docker/.env.bak.reqauth.*`.

## Notes
- Not deployed to the app yet (client still uses REQ-0037 tokens) — see REQ-0118c.
- Secrets never committed; `.env` + override are gitignored in the supabase checkout.
- Future (paid stores only): Google + Sign in with Apple (App Store Guideline 4.8).

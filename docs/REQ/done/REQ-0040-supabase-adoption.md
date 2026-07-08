# REQ-0040 — Supabase Adoption (backend DB; user-approved)

- **Status**: IN PROGRESS (user: "SupabaseでOK"; sudo password provided at server
  `~/sudo_pwd` — SECRET, never print/echo; use via `sudo -S` stdin only)

## Interpretation
Self-hosted Supabase on llmlocal (user provided sudo precisely for installs).
If the user meant supabase.com cloud, they will say so — flag in report.

## Phases
1. **Infra**: install Docker Engine (apt, via sudo -S), self-hosted Supabase
   (official docker-compose) under ~/supabase, bound to LOCALHOST ports only
   (no public exposure; tunnel NOT extended to Studio for now), restart policy,
   secrets in .env (gitignored, never printed). Verify Postgres reachable +
   Studio on localhost + survives docker restart.
2. **Persistence swap**: storage.cjs (the ONE chokepoint) gains a Postgres backend
   (pg client) for profiles + players; JSON files remain as automatic fallback/
   export; migration script imports existing data/profiles + data/players.
   API behavior identical (all 46 server tests green unchanged).
3. **Later (separate decisions)**: Supabase Auth vs current guest tokens; Realtime
   for run monitors (REQ-0036); RLS when multi-tenant matters.

## Gate
Docker + Supabase up (systemd-independent, docker restart policy); psql roundtrip;
storage.cjs Postgres mode passes all server tests + E2E unchanged; fallback mode
still works (env switch); data migrated + byte-equivalent export proven; nothing
public-facing changed; secrets uncommitted.

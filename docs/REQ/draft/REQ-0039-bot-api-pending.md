# REQ-0039 — Bot API (API key / OAuth mode) — PENDING

- **Status**: PENDING (user: placeholder in Settings + this REQ only, for now)

## Concept (user)
Players may delegate schedule management and canvas decisions to programs/LLMs
(bot mode). Useful for the user+friends to play with "virtual players". Publishing
the API from the START eliminates the need for anti-bot countermeasures.

## Orchestrator position (shared with user)
Agree. The game is offline-first auto-battle — automation doesn't create the
fairness problems of action games, and the client already speaks pure JSON to the
server, so the API is 90% built by construction. Design as first-class at REQ-0036
implementation time.
Cautions to design in: per-player API keys with SCOPES (read / canvas / schedule /
trade), rate limits per key, audit log; economy endpoints (trade/market) are where
bots can distort — tightest limits there; OAuth only if third-party apps emerge
(keys suffice for personal bots); document the API (OpenAPI) once schedule endpoints
land. Virtual-player fixtures double as load/e2e test actors.

## Now
Settings page: "API / Bot mode — coming soon" placeholder block (JA/EN). Nothing else.

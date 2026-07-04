# REQ-0039 -- Bot API (Pending) / Settings Placeholder (Now)

Status: spec, written before implementation. Split into two horizons: a
"Now" slice (a Settings placeholder block only, delivered as part of
REQ-0037's client work) and a "Pending" slice (the actual bot/API-key
surface, NOT built yet -- do not implement anything from the Pending
section until a follow-up REQ explicitly picks it up).

## Now

`#/settings` gains a small placeholder block (alongside REQ-0037's
account block) announcing that a bot/API mode is planned:

- Bilingual copy, matching this app's existing inline locale-ternary
  convention (no i18n library anywhere in this codebase): "API / Bot mode
  -- coming soon" / "API・ボットモード — 近日公開予定".
  A short one-line elaboration is fine (e.g. "Programmatic access for
  bots/automation will land in a future update." /
  「ボットや自動化向けのプログラム的アクセスは今後追加予定です。」) but
  nothing interactive -- no input fields, no buttons, no key generation.
  This block has NO behavior: it renders static bilingual text and
  nothing else.

## Pending (explicitly NOT built by REQ-0037 or this doc)

Everything below is future scope, recorded here for continuity but
deliberately unimplemented until a dedicated REQ picks it up:

- API keys/scopes distinct from a player's guest login token (REQ-0037's
  token is a session credential for a human via a browser; a bot
  credential would need its own scoped-permissions model).
- Any programmatic/bot-facing HTTP surface beyond the existing
  `/api/*` routes that already exist for the web client.
- Key issuance/rotation/revocation UI.
- Rate limiting or usage accounting for bot traffic.

## Deferred (out of scope for the "Now" slice specifically)

- Any of the "Pending" items above.
- Settings page content beyond the account block (REQ-0037) + this
  placeholder block -- no other settings exist yet.

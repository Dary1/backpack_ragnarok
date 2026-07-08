# REQ-0018 — Orchestrator Gen2 Takeover + SSH Re-key

Date: 2026-07-03
Status: DONE (2026-07-03 — connectivity + services verified)

## Context
- User reset the gen1 orchestrator; this instance (gen2) takes over.
- A contaminated era snapshot exists at `_quarantine_contaminated_era/` (PROJECT.md.CONTAMINATED + docs).
  Rule: never read or reuse its contents. Live `PROJECT.md` + `docs/` are treated as clean.
- User will hand the (new/updated) golden after the environment is re-confirmed.

## Objective
Re-establish orchestrator access to the server llmlocal (ssh.qtie.jp / 192.168.0.6, user qtie) with a fresh key.

## Actions (done)
1. Retired gen1 keypair → `.keys/retired/id_ed25519{,.pub}`.
2. Generated new ed25519 keypair (no passphrase), comment `backpack-orchestrator-gen2`:
   - Private: `.keys/id_ed25519` (mode 600)
   - Public: `.keys/id_ed25519.pub`
3. Handed the user the pubkey + authorized_keys append command, plus optional
   `sed` line to revoke the gen1 key (matches comment `claude-orchestrator@backpack_ragnarok`).

## Verification (2026-07-03)
- [x] SSH login OK: host `llmlocal`, user `qtie` (via direct IP 192.168.0.6).
- [x] `systemctl --user`: backpack-tunnel.service **active**, backpack-web.service **active**.
- [x] HTTP: 127.0.0.1:8801 → 200 · https://backpack-dev.qtie.jp/mock/ → 200.
- [x] Server tree intact: `~/backpack_ragnarok/{content,mock-src,tools,web}`.

## Result
Environment READY. Next: receive golden from user.

# REQ-0001: Environment Setup (SSH Key Issuance)

- **Status**: Completed
- **Date**: 2026-07-02
- **Owner**: orchestrator (no subagent — task too small)

## Request
Issue an SSH key for operating ssh.qtie.jp (work / test / public web server) and
provide the user with the exact command to add it on the server side.

## Work Done
1. Generated ed25519 key pair → `.keys/id_ed25519` / `.keys/id_ed25519.pub`
2. Provided the public key and the `authorized_keys` registration command to the user.
3. Pre-flight connectivity checks:
   - ssh.qtie.jp:22 → unreachable (DNS is Cloudflare-proxied: 104.21.86.65 / 172.67.216.88)
   - github.com:22 → reachable (sandbox outbound port 22 itself is fine)
   - ssh.qtie.jp:443 → reachable (Cloudflare edge)
4. User registered the key and provided: user `qtie`, direct LAN IP `192.168.0.6`.
5. SSH connectivity verified (host llmlocal, Ubuntu 26.04).

## Outcome
Full SSH access as qtie@192.168.0.6 using `.keys/id_ed25519`. Continued in REQ-0002.

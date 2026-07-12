# REQ-0002: backpack-dev.qtie.jp Tunnel + Dev Web Server

- **Status**: Completed
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Request
Using the Cloudflare API, expose backpack-dev.qtie.jp via a tunnel and stand up a dev
web server. Code lives directly on the server; the FS folder holds documents only.

## Work Done
1. Verified SSH access: qtie@192.168.0.6 (llmlocal, Ubuntu 26.04).
2. Used the user-provided grant token to issue a scoped working CF API token
   (Tunnel R/W, Zone Read, DNS R/W) → `.keys/cloudflare_api_token`.
3. Created tunnel `backpack-dev` (id: 0a6a37c0-e191-44cb-af3c-96e2c28551dd, remote-managed).
4. Ingress config: backpack-dev.qtie.jp → http://localhost:8801.
5. DNS: CNAME backpack-dev.qtie.jp → 0a6a37c0-....cfargotunnel.com (proxied).
6. Server side (user systemd, no sudo, linger=yes):
   - `backpack-tunnel.service`: cloudflared tunnel run (TUNNEL_TOKEN via
     ~/backpack_ragnarok/.secrets/tunnel.env)
   - `backpack-web.service`: python3 http.server on 127.0.0.1:8801,
     docroot ~/backpack_ragnarok/web/ (placeholder index.html deployed)
7. External check: https://backpack-dev.qtie.jp → HTTP 200.
8. Installed Node LTS v24.18.0 (npm 11.16.0) via nvm.

## Notes
- Do NOT touch the existing root cloudflared.service (tunnel "llmlocal": ssh.qtie.jp etc.).
- python http.server is interim; replace with a proper dev setup (e.g. Vite) after the
  golden is reviewed.
- When changing the web server port, update BOTH the CF API tunnel configuration (PUT)
  and the systemd unit.

## Next Actions
- Receive the golden → analyze → decide tech stack (React yes/no) → draft REQ-0003+.

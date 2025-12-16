# myTools

## What is myTools?

myTools is a site hosting a variety of useful tools.
Site doesn't require login, and it's self-hostable.
Made 99% by AI, since i have skill issue.

### Projects

- `myHealth/` – mental and physical health tracker (`/myhealth`).
- `myMoney/` – money/investment tracker (`/mymoney`).

### Self-hosting

- Login + JSON data now live in a local SQLite DB at `data/mytools.sqlite` (auto-created). Override path with `LOCAL_DB_PATH=...` in `.env`.
- Optional `.env` is still read for things like `ALLOWED_ORIGINS` or a custom DB path.
- PHP needs the sqlite/pdo_sqlite extension enabled (bundled in most installs).
- Sessions default to local files in `./sessions`, but will auto-use Redis when the `redis` PHP extension is present and a server is reachable (defaults to `127.0.0.1:6379`). Control it with `SESSION_SAVE_HANDLER=auto|redis|files`, `SESSION_REDIS_HOST/PORT/PASSWORD` (or `SESSION_REDIS_URL`), and `SESSION_LIFETIME` seconds (default: 30 days).
- Signup is enabled; new users can register directly.
- Start the unified server from repo root: `./run.sh`
  - Hub at `http://127.0.0.1:8000/` by default; set `HOST=0.0.0.0` to expose on your LAN.

### Running at liukscot.com (recommended approach)

- What you do:
  - DNS: point `liukscot.com` and `www.liukscot.com` A/AAAA records to your server.
  - Reverse proxy with TLS: install Caddy **or** nginx and proxy to `127.0.0.1:8000`.
    - Caddy (auto-HTTPS):  
      ```
      liukscot.com, www.liukscot.com {
        reverse_proxy 127.0.0.1:8000
      }
      ```
    - nginx (concept): listen on 80→301 to 443; on 443 `proxy_pass http://127.0.0.1:8000;` and use certbot for TLS.
  - Firewall: allow 80/443; keep 8000 closed externally.
  - Env: set `ALLOWED_ORIGINS=https://liukscot.com,https://www.liukscot.com` in `.env` (add LAN origins while testing if needed).
- What the repo does:
  - `./run.sh` starts PHP on `HOST`/`PORT` (defaults: `127.0.0.1:8000`; override with `HOST=0.0.0.0` and/or `PORT=...`).
  - APIs auto-create `data/mytools.sqlite` and tables on first write.
  - Signup is enabled by default; disable by toggling `$ALLOW_SIGNUP` in both APIs if you want invite-only.

### Docker

1) Build the image from repo root:
   - `docker build -t mytools .`
2) Easiest run (short): `docker compose up -d`  
   - Ports/env can be overridden: `PORT=9000 docker compose up`  
   - Uses `docker-compose.yml` volumes to persist SQLite + sessions to `./data`, `./myHealth/sessions`, `./myMoney/sessions`.
   - Redis extension is baked into the image; point `SESSION_REDIS_HOST=host.docker.internal` (and `SESSION_SAVE_HANDLER=redis`) to use a host Redis, or add a Redis service to the compose file if you want everything in containers.
   - Hub: `http://localhost:8000` (or your chosen port; myHealth at `/myhealth`, myMoney at `/mymoney`)
3) Optional: one-liner without compose (if you prefer):  
   - `docker run --name mytools -p 8000:8000 -v "$(pwd)/data:/app/data" -v "$(pwd)/myHealth/sessions:/app/myHealth/sessions" -v "$(pwd)/myMoney/sessions:/app/myMoney/sessions" --env-file .env mytools`
4) Env: set `ALLOWED_ORIGINS`, `LOCAL_DB_PATH` (custom DB path), or override `PORT` as needed (container default `HOST=0.0.0.0`, `PORT=8000`). Compose does not require a `.env`; export vars inline (`ALLOWED_ORIGINS=... docker compose up`) or create a `.env` and run `docker compose --env-file .env up`.

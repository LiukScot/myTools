# myTools

Personal site stack for `liukscot.com`, housing multiple sub-apps.

## Projects
- `hub/` – root landing page on `liukscot.com` that links to myHealth and myMoney.
- `myHealth/` – health tracker static frontend + PHP file API (`/myhealth`).
- `myMoney/` – money/investment tracker with login + PHP file API (`/mymoney`).

## Guidelines for developers
- Keep frontend JS in small modules instead of inline `<script>` tags. Each app now loads a top-level module (`/myhealth/js/app.js`, `/mymoney/js/app.js`) plus helper modules (e.g. `api.js`, `utils.js`). Add new helpers there rather than growing a single file.
- Prefer separating concerns: API/fetch helpers, state/load/save, and UI wiring/rendering should live in distinct modules to ease debugging and testing.
- Keep sensitive artifacts (sessions, .env) out of the webroot and under `.gitignore` (already configured).

## Local dev (one runner)
- Put DB creds in the repo root `.env` (DB_HOST, DB_USER, DB_PASS, DB_NAME).
- Start the unified server from repo root: `./testing/run.sh`
  - Hub at `http://127.0.0.1:8000/`
  - myHealth at `http://127.0.0.1:8000/myhealth`
  - myMoney at `http://127.0.0.1:8000/mymoney`

## Deploy (shared script)
- Use `deploy.sh` from repo root to push hub + myHealth + myMoney in one go:
  - `FTP_HOST=... FTP_USER=... FTP_PASS=... ./deploy.sh`
  - Optional overrides: `BASE_REMOTE=/public_html`, `REMOTE_HUB=/public_html`, `REMOTE_HEALTH=/public_html/myhealth`, `REMOTE_MONEY=/public_html/mymoney`.

## Notes
- Both apps share the same DB and FTP credentials; `.env` at repo root is the single source for local dev.
- Legacy per-app run scripts now delegate to the unified runner for convenience.

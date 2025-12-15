# myTools

## What is myTools?

myTools is a site hosting a variety of useful tools.
Site doesn't require login, and it's self-hostable.
Made 99% by AI, since i have skill issue.

### Projects

- `myHealth/` – mental and physical health tracker (`/myhealth`).
- `myMoney/` – money/investment tracker (`/mymoney`).

## Guidelines for AI agents

- Keep frontend JS in small modules instead of inline `<script>` tags. Each app now loads a top-level module (`/myhealth/js/app.js`, `/mymoney/js/app.js`) plus helper modules (e.g. `api.js`, `utils.js`). Add new helpers there rather than growing a single file.
- Prefer separating concerns: API/fetch helpers, state/load/save, and UI wiring/rendering should live in distinct modules to ease debugging and testing.
- Keep sensitive artifacts (sessions, .env) out of the webroot and under `.gitignore` (already configured).
- CSS naming/scoping: each app is namespaced via `body.mh-app` (myHealth) and `body.mm-app` (myMoney); prefer scoping selectors under those roots and using prefixed BEM-style class names (`mh-card__title`, `mm-nav__button--active`). Avoid bare element selectors;

### If you self-host and use online db and webhosting solutions

- Put DB creds in the repo root `.env` (DB_HOST, DB_USER, DB_PASS, DB_NAME).
- Start the unified server from repo root: `./testing/run.sh`
  - Hub at `http://127.0.0.1:8000/`

- Use `deploy.sh` from repo root to push hub + myHealth + myMoney in one go:
  - `FTP_HOST=... FTP_USER=... FTP_PASS=... ./deploy.sh`
  - Optional overrides: `BASE_REMOTE=/public_html`, `REMOTE_HUB=/public_html`, `REMOTE_HEALTH=/public_html/myhealth`, `REMOTE_MONEY=/public_html/mymoney`.

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
- CSS naming/scoping: each app is namespaced via `body.mh-app` (myHealth) and `body.mm-app` (myMoney); prefer scoping selectors under those roots and using prefixed BEM-style class names (`mh-card__title`, `mm-nav__button--active`). Avoid bare element selectors; legacy global buttons/nav/quick styles have been removed.
- New BEM-style helpers: myHealth nav/auth/filters now expose `mh-nav__*`, `mh-entry-*`, `mh-quick-*`, `mh-auth__*`; myMoney nav/auth has `mm-nav__*`, `mm-auth__*`. Use these instead of generic `.quick-btn`/`.auth-row` (no longer present).
- myHealth buttons use namespaced helpers (`mh-btn-primary`, `mh-btn-muted`, `mh-btn-plain`); avoid legacy `.btn-*`.
- myMoney buttons use namespaced helpers (`mm-btn-primary`, `mm-btn-plain`, `mm-btn-accent`); legacy `.btn-*` styles are removed.
- Tables: myMoney tables now have `mm-table` and scroll wrappers `mm-table-scroll`; prefer targeting these over bare `table`/`.table-scroll` when adjusting styles.
- myMoney quick filters/buttons now have namespaced helpers (`mm-quick-filters`, `mm-quick-btn`) and primary/accent buttons (`mm-btn-primary`, `mm-btn-accent`) on all save/cancel actions.
- Status/hint: both apps now expose `mh-status`/`mm-status` and `mh-hint`/`mm-hint`; use these instead of styling `.status`/`.hint` directly.
- Forms/layout: myMoney forms use `mm-form-grid`, `mm-form-card`, `mm-field-group`, `mm-inline-row`, `mm-stacked-fields`, `mm-group-box`; myHealth forms use `mh-field-group`, `mh-group-box`, `mh-inline-row`, `mh-stacked-fields`. Keep legacy classes for JS hooks until you update selectors.

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
- Shared styling: both apps import `shared/base.css` (includes Open Props via CDN) and override accent colors in their own `style.css`. If CSS looks missing, ensure the web server exposes `shared/` so the `@import "../../shared/base.css";` in `myhealth/web/style.css` and `mymoney/web/style.css` can load. Prefer adding cross-app layout/styling changes in `shared/base.css` first, then apply app-specific tweaks only when necessary to avoid divergence.

# myTools

Personal site stack for `liukscot.com`, housing multiple sub-apps.

## Projects
- `hub/` – root landing page on `liukscot.com` that links to myHealth and myMoney.
- `myHealth/` – health tracker static frontend + PHP file API (`/myhealth`).
- `myMoney/` – money/investment tracker with login + PHP file API (`/mymoney`).

## Local dev (one runner)
- Put DB creds in the repo root `.env` (DB_HOST, DB_USER, DB_PASS, DB_NAME).
- Start the unified server from repo root: `./testing/run.sh`
  - Hub at `http://127.0.0.1:8000/`
  - myHealth at `http://127.0.0.1:8000/myhealth`
  - myMoney at `http://127.0.0.1:8000/mymoney`

## Deploy (shared script)
- Use `deploy.sh` from repo root with `APP` set:
  - Hub: `APP=hub FTP_HOST=... FTP_USER=... FTP_PASS=... ./deploy.sh`
  - myHealth: `APP=myhealth FTP_HOST=... FTP_USER=... FTP_PASS=... ./deploy.sh`
  - myMoney: `APP=mymoney FTP_HOST=... FTP_USER=... FTP_PASS=... ./deploy.sh`

## Notes
- Both apps share the same DB and FTP credentials; `.env` at repo root is the single source for local dev.
- Legacy per-app run scripts now delegate to the unified runner for convenience.

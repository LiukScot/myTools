# myTools

Personal site stack for `liukscot.com`, housing multiple sub-apps.

## Projects
- `myHealth/` – health tracker static frontend + PHP file API (served at `liukscot.com/myhealth`). Sample JSON lives in `myHealth/data/`; see `myHealth/README.md` for auth, API, and deploy details.
- `myMoney/` – money tracker (served at `liukscot.com/money`). Currently the legacy HTML/Python prototype.

## Quickstart (myHealth)
- Local dev from repo root: `php -S 127.0.0.1:8000 -t myHealth/web`
- Deploy via script: `FTP_HOST=... FTP_USER=... FTP_PASS=... ./myHealth/deploy.sh`
- CI deploy: configure FTP secrets and run the `Deploy myHealth (FTP)` workflow (`.github/workflows/deploy.yml`).

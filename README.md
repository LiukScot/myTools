# myTools

Shared workspace for personal sites.

## Projects
- `myHealth/` – static frontend + PHP file API (lives at `liukscot.com/myhealth`). Sample JSON lives in `myHealth/data/`. See `myHealth/README.md` for details.
- `myMoney/` – money tracker (lives at `liukscot.com/money`). Currently contains the legacy HTML/Python prototype.

## Quickstart (myHealth)
- Local dev from repo root: `php -S 127.0.0.1:8000 -t myHealth/web`
- Deploy via script: `FTP_HOST=... FTP_USER=... FTP_PASS=... ./myHealth/deploy.sh`
- CI deploy: configure FTP secrets in the repo and run the `Deploy myHealth (FTP)` workflow (`.github/workflows/deploy.yml`).

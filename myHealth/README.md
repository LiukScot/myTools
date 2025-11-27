# myHealth (PHP + static frontend)

This lives under `myTools/myHealth` and ships as a static frontend (`web/index.html`) with a PHP API in `web/api/files/`. The old Python server has been removed.

## Local testing (recommended before deploy)

1) Install PHP 8.x.
2) Copy `myHealth/.env.example` to `myHealth/.env` and fill in `DB_HOST`, `DB_USER`, `DB_PASS`, and `DB_NAME` so the PHP API can connect to your DB.
3) From the repo root, run either:
   ```bash
   ./myHealth/testing/run.sh
   ```
   (auto-loads `.env` and uses the router for `/api/files/...`) or the raw PHP command:
   ```bash
   php -S 127.0.0.1:8000 -t myHealth/web
   ```
   If you need rewrites for `/api/files/...`, add a simple router (see comments in `myHealth/web/api/files/.htaccess`) or call `myHealth/web/api/files/index.php` directly.
4) Open `http://127.0.0.1:8000` in the browser. Log in with a user that exists in your DB (same shape as production: table `users`, fields `email`, `password_hash`, etc.).

## Deploy

- Use `myHealth/deploy.sh` (lftp-based mirror) to push `myHealth/web/` to `public_html/myhealth/` on Hetzner. Credentials are passed via env vars:
  ```bash
  FTP_HOST=your-host FTP_USER=your-user FTP_PASS='your-pass' ./myHealth/deploy.sh
  ```
  This places:
  ```
  public_html/myhealth/index.html
  public_html/myhealth/api/files/index.php
  public_html/myhealth/api/files/.htaccess
  ```

## API endpoints (PHP)

- `POST /api/files/login` – body `{"email": "...", "password": "..."}`; sets session.
- `POST /api/files/logout` – clears session.
- `GET /api/files` – list stored JSON files.
- `GET /api/files/{name}.json` – fetch file.
- `PUT /api/files/{name}.json` – save/replace JSON payload.

Authentication is session-based; the frontend uses `credentials: "include"` on fetch.

## Data format

Files like `diary.json` / `pain.json` (samples now live in `myHealth/data/`) are stored in the DB `files` table as JSON blobs shaped:
```json
{
  "headers": ["date", "hour", "..."],
  "rows": [ { "date": "...", "hour": "...", ... } ]
}
```

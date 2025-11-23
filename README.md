# myHealth

Local Python server that watches JSON files and streams updates in real time (similar to the myMoney workflow).

## Getting started

1) Install deps: `pip install -r requirements.txt`
2) Start the server from a terminal so you can see logs/errors:
   - `python start.py --host 127.0.0.1 --port 8000 --data-dir data` (or `python launch.py ...`)
   - Or mark executable: `chmod +x start.py` then `./start.py --data-dir data`
3) Edit any `.json` inside the data directory (example: `data/health.json`); connected clients get updates immediately over WebSocket.

## API quick reference

- `GET /api/files` – list available JSON files with size and timestamp.
- `GET /api/files/{name}` – return the JSON payload for a file (name or name.json).
- `PUT /api/files/{name}` – replace the JSON payload for a file; body is the new JSON.
- `WS /ws` – receive `{type:"snapshot", files:[...]}` on connect, then `{type:"updated"|"deleted"}` events on changes.

WebSocket examples:

- Snapshot: `{"type":"snapshot","files":[{"name":"health.json","updated_at":"2024-11-23T12:00:00Z","data":{...}}]}`
- Update: `{"type":"updated","file":"health.json","updated_at":"2024-11-23T12:05:00Z","data":{...}}`
- Delete: `{"type":"deleted","file":"health.json"}`

The default data folder is `./data`; change it with `--data-dir` when launching. The server also exposes `/healthz` for a simple status check.

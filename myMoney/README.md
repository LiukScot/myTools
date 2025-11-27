# myMoney

Local investments dashboard.

## Quick start (macOS/Windows/Linux)

- Run `python start.py` (or `./start.sh` on Unix, `start.bat` on Windows).
- The script starts the local server and opens `http://127.0.0.1:8000/myMoney.html`.
- Use `--no-browser` to skip auto-opening, and `--port/--host` to override defaults.

## Run with the local Python server

1) Start the server: `python server.py --port 8000` (default host: 127.0.0.1).  
2) Open the app at `http://127.0.0.1:8000/myMoney.html`.  
3) Data auto-saves to `data/state.json` on every edit and is also mirrored in the browser `localStorage` for offline use.  
4) If the server is not running, the app continues to work only with `localStorage` and will sync again once the API is reachable.  
5) Import/export from the UI still works for backups (`import / backup` tab).

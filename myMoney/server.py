#!/usr/bin/env python3
"""
Local server for the myMoney dashboard.

- Serves the static app (http://localhost:8000/myMoney.html)
- Persists data to data/state.json through a tiny JSON API at /api/data
"""

from __future__ import annotations

import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "state.json"


def default_state() -> Dict[str, Any]:
    return {
        "transactions": [],
        "monthlyMovements": [],
        "monthlySnapshots": [],
        "preferences": {"showZeroAssets": True},
    }


def normalize_state(data: Any) -> Dict[str, Any]:
    state = default_state()
    if isinstance(data, list):
        state["transactions"] = data
        return state

    if isinstance(data, dict):
        if isinstance(data.get("transactions"), list):
            state["transactions"] = data["transactions"]
        if isinstance(data.get("monthlyMovements"), list):
            state["monthlyMovements"] = data["monthlyMovements"]
        if isinstance(data.get("monthlySnapshots"), list):
            state["monthlySnapshots"] = data["monthlySnapshots"]
        prefs = data.get("preferences")
        if isinstance(prefs, dict):
            merged = {**state["preferences"], **prefs}
            merged["showZeroAssets"] = bool(merged.get("showZeroAssets", True))
            state["preferences"] = merged
    return state


def load_state() -> Dict[str, Any]:
    if DATA_FILE.exists():
        try:
            parsed = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            return normalize_state(parsed)
        except Exception as exc:  # pragma: no cover - simple console log
            print(f"[warn] could not read {DATA_FILE}: {exc}")
            return default_state()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(default_state(), indent=2), encoding="utf-8")
    return default_state()


def save_state(payload: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:  # pragma: no cover - console only
        print(fmt % args)

    def _handle_options(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # pragma: no cover - simple network plumbing
        if urlparse(self.path).path.startswith("/api/"):
            return self._handle_options()
        return super().do_OPTIONS()

    def do_GET(self) -> None:  # pragma: no cover - runtime behavior
        path = urlparse(self.path).path
        if path == "/":
            self.path = "/myMoney.html"
            return super().do_GET()
        if path == "/api/data":
            data = load_state()
            return self._send_json(data)
        return super().do_GET()

    def do_POST(self) -> None:  # pragma: no cover - runtime behavior
        path = urlparse(self.path).path
        if path != "/api/data":
            self.send_error(404, "Not Found")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            incoming = json.loads(raw_body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._send_json({"error": "Invalid JSON"}, status=400)

        normalized = normalize_state(incoming)
        save_state(normalized)
        return self._send_json({"status": "ok"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the myMoney local server.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.exists():
        DATA_FILE.write_text(json.dumps(default_state(), indent=2), encoding="utf-8")

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Serving myMoney on http://{args.host}:{args.port}/myMoney.html")
    print(f"Data persists to {DATA_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")


if __name__ == "__main__":
    main()

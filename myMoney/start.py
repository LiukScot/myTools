#!/usr/bin/env python3
"""Cross-platform launcher for the myMoney server and app."""

from __future__ import annotations

import argparse
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parent


def wait_for_port(host: str, port: int, proc: subprocess.Popen, timeout: float = 10.0) -> bool:
    """Return True when the port becomes reachable before timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def launch_server(host: str, port: int) -> subprocess.Popen:
    cmd = [sys.executable, str(ROOT / "server.py"), "--host", host, "--port", str(port)]
    return subprocess.Popen(cmd, cwd=ROOT)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start the myMoney server and open the app.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Skip opening the browser automatically.")
    args = parser.parse_args(argv)

    url = f"http://{args.host}:{args.port}/myMoney.html"
    print(f"Launching server at {url}")

    server_proc = launch_server(args.host, args.port)

    try:
        if wait_for_port(args.host, args.port, server_proc):
            if not args.no_browser:
                opened = webbrowser.open(url, new=2)
                status = "Opened browser." if opened else "Browser may not have opened automatically."
                print(status)
        else:
            if server_proc.poll() is not None:
                code = server_proc.returncode
                print(f"Server exited immediately with code {code}. See output above for details.")
            else:
                print("Server did not become ready. Check for port conflicts or errors.")

        server_proc.wait()
        return server_proc.returncode or 0
    except KeyboardInterrupt:
        print("\nStopping server...")
        return 0
    finally:
        if server_proc.poll() is None:
            server_proc.terminate()
            try:
                server_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_proc.kill()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

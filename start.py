#!/usr/bin/env python3

import argparse
import sys
from pathlib import Path
import webbrowser


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch the myHealth local JSON sync server.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind.")
    parser.add_argument("--port", type=int, default=8000, help="TCP port to listen on.")
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Directory containing JSON files to watch and sync. Defaults to ./data.",
    )
    return parser.parse_args()


def main() -> None:
    try:
        import uvicorn  # type: ignore
    except ModuleNotFoundError:
        print("Missing dependency 'uvicorn'. Run `pip install -r requirements.txt` and try again.")
        sys.exit(1)

    try:
        from server import create_app
    except ModuleNotFoundError as exc:
        missing = exc.name
        print(f"Missing dependency '{missing}'. Run `pip install -r requirements.txt` and try again.")
        sys.exit(1)

    args = parse_args()
    data_dir = Path(args.data_dir).expanduser().resolve()
    app = create_app(data_dir)
    url = f"http://{args.host}:{args.port}/"
    print(f"Starting myHealth sync server on {url} (data dir: {data_dir})")
    try:
        webbrowser.open_new_tab(url)
    except Exception:
        pass
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

from __future__ import annotations

import asyncio
import contextlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from watchfiles import Change, awatch


class WebSocketHub:
    """Simple hub to fan out file change messages to WebSocket subscribers."""

    def __init__(self) -> None:
        self._clients: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, socket: WebSocket) -> None:
        await socket.accept()
        async with self._lock:
            self._clients.add(socket)

    async def disconnect(self, socket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(socket)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        payload = json.dumps(message)
        async with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                await client.send_text(payload)
            except Exception:
                await self.disconnect(client)


def _iso_timestamp(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_path(data_dir: Path, filename: str) -> Path:
    safe_name = Path(filename).name
    if not safe_name.endswith(".json"):
        safe_name += ".json"
    path = (data_dir / safe_name).resolve()
    if data_dir not in path.parents and path != data_dir:
        raise HTTPException(status_code=400, detail="Invalid file path requested")
    return path


def _read_json_file(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"JSON decode failed for {path.name}: {exc}") from exc


def _write_json_file(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def _list_json_files(data_dir: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not data_dir.exists():
        return items
    for file_path in sorted(data_dir.glob("*.json")):
        stat = file_path.stat()
        items.append(
            {
                "name": file_path.name,
                "size": stat.st_size,
                "updated_at": _iso_timestamp(datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)),
            }
        )
    return items


def _snapshot_payload(data_dir: Path) -> Dict[str, Any]:
    snapshot = []
    for meta in _list_json_files(data_dir):
        path = data_dir / meta["name"]
        try:
            data = _read_json_file(path)
        except HTTPException:
            continue
        snapshot.append({"name": meta["name"], "updated_at": meta["updated_at"], "data": data})
    return {"type": "snapshot", "files": snapshot}


async def _watch_data_dir(
    data_dir: Path,
    hub: WebSocketHub,
    stop_event: asyncio.Event,
    last_sent: Dict[str, float],
    last_sent_lock: asyncio.Lock,
) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    async for changes in awatch(data_dir, stop_event=stop_event):
        for change, changed_path in changes:
            path = Path(changed_path)
            if path.suffix.lower() != ".json":
                continue
            if change == Change.deleted:
                async with last_sent_lock:
                    last_sent.pop(path.name, None)
                await hub.broadcast({"type": "deleted", "file": path.name})
                continue
            try:
                data = _read_json_file(path)
            except Exception:
                continue
            stat = path.stat()
            async with last_sent_lock:
                if last_sent.get(path.name) == stat.st_mtime:
                    continue
                last_sent[path.name] = stat.st_mtime
            await hub.broadcast(
                {
                    "type": "updated",
                    "file": path.name,
                    "updated_at": _iso_timestamp(datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)),
                    "data": data,
                }
            )


def create_app(data_dir: Path) -> FastAPI:
    hub = WebSocketHub()
    stop_event = asyncio.Event()
    last_sent: Dict[str, float] = {}
    last_sent_lock = asyncio.Lock()
    app = FastAPI(title="myHealth sync server")
    web_dir = Path(__file__).parent.joinpath("web").resolve()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def _startup() -> None:
        data_dir.mkdir(parents=True, exist_ok=True)
        app.state.watch_task = asyncio.create_task(
            _watch_data_dir(data_dir, hub, stop_event, last_sent, last_sent_lock)
        )

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        task: Optional[asyncio.Task] = getattr(app.state, "watch_task", None)
        if task:
            stop_event.set()
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    @app.get("/healthz")
    async def healthcheck() -> Dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/files")
    async def list_files() -> List[Dict[str, Any]]:
        return _list_json_files(data_dir)

    @app.get("/api/files/{filename}")
    async def get_file(filename: str) -> Any:
        path = _json_path(data_dir, filename)
        if not path.exists():
            raise HTTPException(status_code=404, detail="File not found")
        return _read_json_file(path)

    @app.put("/api/files/{filename}")
    async def save_file(filename: str, data: Any = Body(...)) -> Dict[str, str]:
        path = _json_path(data_dir, filename)
        _write_json_file(path, data)
        stat = path.stat()
        mtime = stat.st_mtime
        async with last_sent_lock:
            last_sent[path.name] = mtime
        await hub.broadcast(
            {
                "type": "updated",
                "file": path.name,
                "updated_at": _iso_timestamp(datetime.fromtimestamp(mtime, tz=timezone.utc)),
                "data": data,
            }
        )
        return {"status": "saved", "file": path.name}

    if web_dir.exists():
        index_path = web_dir / "index.html"

        @app.get("/", include_in_schema=False)
        async def serve_index() -> FileResponse:
            if index_path.exists():
                return FileResponse(index_path)
            raise HTTPException(status_code=404, detail="UI not found")

    @app.websocket("/ws")
    async def websocket_endpoint(socket: WebSocket) -> None:
        await hub.connect(socket)
        try:
            await socket.send_text(json.dumps(_snapshot_payload(data_dir)))
            while True:
                await socket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await hub.disconnect(socket)

    return app


def build_app() -> FastAPI:
    data_dir = Path(__file__).parent.joinpath("data").resolve()
    return create_app(data_dir)

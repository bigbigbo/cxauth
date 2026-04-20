from __future__ import annotations

from contextlib import AbstractContextManager
from pathlib import Path
from typing import Any
import json
import os
import tempfile
import time

from .paths import Paths

REGISTRY_VERSION = 1


def empty_registry() -> dict[str, Any]:
    return {
        "version": REGISTRY_VERSION,
        "activeAccount": None,
        "accounts": {},
    }


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, 0o700)


def ensure_storage(paths: Paths) -> None:
    ensure_private_dir(paths.cxauth_home)
    ensure_private_dir(paths.accounts_dir)
    ensure_private_dir(paths.backups_dir)
    ensure_private_dir(paths.tmp_dir)


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o600) -> None:
    ensure_private_dir(path.parent)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def atomic_write_json(path: Path, payload: dict[str, Any], mode: int = 0o600) -> None:
    data = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8") + b"\n"
    atomic_write_bytes(path, data, mode=mode)


def load_registry(paths: Paths) -> dict[str, Any]:
    ensure_storage(paths)
    if not paths.registry.exists():
        return empty_registry()
    with paths.registry.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    if not isinstance(loaded, dict):
        raise ValueError(f"registry is not an object: {paths.registry}")
    loaded.setdefault("version", REGISTRY_VERSION)
    loaded.setdefault("activeAccount", None)
    loaded.setdefault("accounts", {})
    if not isinstance(loaded["accounts"], dict):
        raise ValueError("registry accounts field must be an object")
    return loaded


def save_registry(paths: Paths, registry: dict[str, Any]) -> None:
    ensure_storage(paths)
    registry["version"] = REGISTRY_VERSION
    registry.setdefault("activeAccount", None)
    registry.setdefault("accounts", {})
    atomic_write_json(paths.registry, registry)


class FileLock(AbstractContextManager["FileLock"]):
    def __init__(self, path: Path) -> None:
        self.path = path
        self._fd: int | None = None

    def acquire(self, timeout_seconds: float = 10.0, poll_seconds: float = 0.05) -> FileLock:
        deadline = time.monotonic() + timeout_seconds
        self.path.parent.mkdir(parents=True, exist_ok=True)
        while True:
            try:
                self._fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.write(self._fd, f"{os.getpid()}\n".encode("utf-8"))
                return self
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"timed out waiting for lock: {self.path}")
                time.sleep(poll_seconds)

    def release(self) -> None:
        if self._fd is not None:
            os.close(self._fd)
            self._fd = None
        if self.path.exists():
            self.path.unlink()

    def __enter__(self) -> FileLock:
        return self.acquire()

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.release()

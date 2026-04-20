from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import shutil
import time

from .auth import AuthSnapshotError, extract_metadata, read_auth_snapshot, write_auth_snapshot
from .paths import Paths, get_paths
from .registry import FileLock, atomic_write_bytes, empty_registry, ensure_storage, load_registry, save_registry


class CommandError(RuntimeError):
    pass


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _default_limit() -> dict[str, Any]:
    return {"display": "unknown", "unit": "unknown", "value": None, "raw": ""}


def _default_status() -> dict[str, Any]:
    return {
        "weeklyLimit": _default_limit(),
        "fiveHourLimit": _default_limit(),
        "checkedAt": None,
        "source": None,
        "rawSnippet": "",
        "state": "not_checked",
    }


def _account_auth_path(paths: Paths, name: str) -> Path:
    return paths.accounts_dir / name / "auth.json"


def _validate_name(name: str) -> None:
    if not name or "/" in name or "\\" in name or name in {".", ".."}:
        raise CommandError("account name must be a simple path-safe string")


def _load(paths: Paths) -> dict[str, Any]:
    registry = load_registry(paths)
    if registry.get("version") is None:
        return empty_registry()
    return registry


def add_snapshot(name: str, auth: dict[str, Any], *, paths: Paths | None = None) -> dict[str, Any]:
    paths = paths or get_paths()
    _validate_name(name)
    ensure_storage(paths)
    metadata = extract_metadata(auth)
    now = _now_iso()
    with FileLock(paths.lock):
        registry = _load(paths)
        accounts = registry["accounts"]
        if name in accounts:
            raise CommandError(f"account already exists: {name}")
        for account in accounts.values():
            if metadata["email"] != "unknown" and account.get("email") == metadata["email"]:
                raise CommandError(f"email is already saved under account: {account.get('name')}")
        auth_path = _account_auth_path(paths, name)
        write_auth_snapshot(auth_path, auth)
        account = {
            "name": name,
            "email": metadata["email"],
            "chatgptAccountId": metadata["chatgptAccountId"],
            "planType": metadata["planType"],
            "authPath": str(auth_path),
            "createdAt": now,
            "updatedAt": now,
            "lastUsedAt": None,
            "status": _default_status(),
            "notes": "",
        }
        accounts[name] = account
        save_registry(paths, registry)
        return account


def _copy_auth_atomic(source: Path, target: Path) -> None:
    auth = read_auth_snapshot(source)
    write_auth_snapshot(target, auth)


def switch_account(
    name: str,
    *,
    paths: Paths | None = None,
    validator: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    paths = paths or get_paths()
    ensure_storage(paths)
    with FileLock(paths.lock):
        registry = _load(paths)
        account = registry["accounts"].get(name)
        if account is None:
            raise CommandError(f"unknown account: {name}")
        source = Path(account["authPath"])
        read_auth_snapshot(source)
        backup = paths.backups_dir / "auth.json.bak"
        if paths.global_auth.exists():
            atomic_write_bytes(backup, paths.global_auth.read_bytes(), mode=0o600)
        _copy_auth_atomic(source, paths.global_auth)
        validated = validator() if validator is not None else True
        account["lastUsedAt"] = _now_iso()
        account["updatedAt"] = _now_iso()
        registry["activeAccount"] = name
        save_registry(paths, registry)
        return {"name": name, "validated": bool(validated), "backupPath": str(backup)}


def _global_auth_metadata(paths: Paths) -> dict[str, str] | None:
    if not paths.global_auth.exists():
        return None
    try:
        return extract_metadata(read_auth_snapshot(paths.global_auth))
    except AuthSnapshotError:
        return None


def current_account(*, paths: Paths | None = None) -> dict[str, Any]:
    paths = paths or get_paths()
    registry = _load(paths)
    metadata = _global_auth_metadata(paths)
    if metadata is None:
        return {"name": None, "state": "missing", "email": "unknown"}
    for account in registry["accounts"].values():
        account_id_matches = (
            account.get("chatgptAccountId") != "unknown"
            and account.get("chatgptAccountId") == metadata.get("chatgptAccountId")
        )
        email_matches = account.get("email") != "unknown" and account.get("email") == metadata.get("email")
        if account_id_matches or email_matches:
            if registry.get("activeAccount") != account["name"]:
                registry["activeAccount"] = account["name"]
                save_registry(paths, registry)
            return {"name": account["name"], "state": "managed", "email": account.get("email", "unknown")}
    return {"name": None, "state": "unmanaged", "email": metadata.get("email", "unknown")}


def list_accounts(*, paths: Paths | None = None) -> dict[str, Any]:
    paths = paths or get_paths()
    registry = _load(paths)
    current = current_account(paths=paths)
    accounts = sorted(registry["accounts"].values(), key=lambda item: item["name"])
    return {
        "accounts": accounts,
        "activeName": current["name"],
        "activeState": current["state"],
        "activeEmail": current["email"],
    }


def remove_account(name: str, *, paths: Paths | None = None) -> dict[str, str]:
    paths = paths or get_paths()
    with FileLock(paths.lock):
        registry = _load(paths)
        current = current_account(paths=paths)
        if current["name"] == name:
            raise CommandError("cannot remove the globally active account")
        account = registry["accounts"].pop(name, None)
        if account is None:
            raise CommandError(f"unknown account: {name}")
        auth_dir = Path(account["authPath"]).parent
        if auth_dir.exists():
            shutil.rmtree(auth_dir)
        if registry.get("activeAccount") == name:
            registry["activeAccount"] = None
        save_registry(paths, registry)
        return {"removed": name}

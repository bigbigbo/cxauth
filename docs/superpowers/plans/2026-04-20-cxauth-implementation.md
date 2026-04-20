# cxauth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local `cxauth` CLI that stores multiple ChatGPT-backed Codex auth snapshots, globally switches `~/.codex/auth.json`, and refreshes quota state through Codex's `/status` surface.

**Architecture:** Use a small Python standard-library package with explicit modules for path resolution, registry persistence, auth metadata extraction, Codex subprocess interactions, command behavior, and CLI rendering. All mutation goes through atomic writes and a lock under `~/.cxauth`; quota probing runs in an isolated temporary `CODEX_HOME` so global Codex auth is never changed by status checks.

**Tech Stack:** Python 3.11+, `argparse`, `unittest`, standard-library `subprocess`, `pty`, `select`, `tempfile`, `json`, `pathlib`.

---

## References

- Design spec: `docs/superpowers/specs/2026-04-20-cxauth-design.md`
- Official Codex auth docs: `https://developers.openai.com/codex/auth`
- Official Codex CLI docs: `https://developers.openai.com/codex/cli`

## File Structure

- Create `pyproject.toml`: Python package metadata and `cxauth` console script.
- Create `src/cxauth/__init__.py`: package version.
- Create `src/cxauth/__main__.py`: `python -m cxauth` entrypoint.
- Create `src/cxauth/paths.py`: resolves `~/.cxauth`, `~/.codex`, and test overrides.
- Create `src/cxauth/registry.py`: registry load/save, atomic JSON writes, private permissions, mutation lock.
- Create `src/cxauth/auth.py`: auth snapshot validation, token-safe metadata extraction, snapshot copy helpers.
- Create `src/cxauth/codex.py`: Codex binary wrapper, device login runner, switch validation, `/status` PTY probe, quota parser.
- Create `src/cxauth/commands.py`: command-level behavior for add, list, switch, current, status, remove.
- Create `src/cxauth/cli.py`: `argparse` parser, output formatting, exit-code handling.
- Create `tests/helpers.py`: shared temp path helpers and fake auth builders.
- Create `tests/test_registry.py`: registry, permissions, and locking tests.
- Create `tests/test_auth.py`: metadata extraction and snapshot validation tests.
- Create `tests/test_commands.py`: add/list/current/switch/remove behavior with isolated homes.
- Create `tests/test_codex.py`: parser, subprocess wrapper, and PTY probe tests with fake `codex` scripts.
- Create `tests/test_cli.py`: CLI argument and output tests.
- Create `README.md`: install, usage, security notes, and quota caveats.

## Task 1: Package Skeleton

**Files:**
- Create: `pyproject.toml`
- Create: `src/cxauth/__init__.py`
- Create: `src/cxauth/__main__.py`
- Create: `src/cxauth/cli.py`

- [ ] **Step 1: Create package metadata**

Create `pyproject.toml`:

```toml
[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[project]
name = "cxauth"
version = "0.1.0"
description = "Manage multiple ChatGPT-backed Codex auth snapshots"
readme = "README.md"
requires-python = ">=3.11"
authors = [{ name = "cxauth maintainers" }]
license = { text = "MIT" }

[project.scripts]
cxauth = "cxauth.cli:main"

[tool.setuptools.packages.find]
where = ["src"]
```

- [ ] **Step 2: Add package entry files**

Create `src/cxauth/__init__.py`:

```python
"""cxauth package."""

__version__ = "0.1.0"
```

Create `src/cxauth/__main__.py`:

```python
from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
```

Create the initial `src/cxauth/cli.py`:

```python
from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cxauth",
        description="Manage multiple ChatGPT-backed Codex auth snapshots.",
    )
    parser.add_argument("--version", action="store_true", help="show cxauth version")
    return parser


def main(argv: list[str] | None = None) -> int:
    from . import __version__

    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    parser.print_help()
    return 0
```

- [ ] **Step 3: Run the empty test suite**

Run:

```bash
python3 -m unittest discover -s tests -v
```

Expected:

```text
Ran 0 tests

OK
```

- [ ] **Step 4: Verify console entrypoint locally**

Run:

```bash
PYTHONPATH=src python3 -m cxauth --version
```

Expected:

```text
0.1.0
```

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml src/cxauth/__init__.py src/cxauth/__main__.py src/cxauth/cli.py
git commit -m "chore: scaffold cxauth package"
```

## Task 2: Paths, Registry, Atomic Writes, and Locking

**Files:**
- Create: `src/cxauth/paths.py`
- Create: `src/cxauth/registry.py`
- Create: `tests/helpers.py`
- Create: `tests/test_registry.py`

- [ ] **Step 1: Write failing registry tests**

Create `tests/helpers.py`:

```python
from __future__ import annotations

from pathlib import Path


def make_env(root: Path) -> dict[str, str]:
    return {
        "CXAUTH_HOME": str(root / "cxauth-home"),
        "CODEX_HOME": str(root / "codex-home"),
    }
```

Create `tests/test_registry.py`:

```python
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from cxauth.paths import get_paths
from cxauth.registry import FileLock, load_registry, save_registry

from .helpers import make_env


class RegistryTests(unittest.TestCase):
    def test_paths_respect_env_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = get_paths(make_env(root))
            self.assertEqual(paths.cxauth_home, root / "cxauth-home")
            self.assertEqual(paths.codex_home, root / "codex-home")
            self.assertEqual(paths.global_auth, root / "codex-home" / "auth.json")
            self.assertEqual(paths.registry, root / "cxauth-home" / "registry.json")

    def test_registry_round_trip_uses_private_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            registry = load_registry(paths)
            registry["activeAccount"] = "main"
            registry["accounts"]["main"] = {"name": "main"}
            save_registry(paths, registry)

            loaded = json.loads(paths.registry.read_text())
            self.assertEqual(loaded["activeAccount"], "main")
            self.assertEqual(loaded["accounts"]["main"]["name"], "main")
            self.assertEqual(paths.registry.stat().st_mode & 0o777, 0o600)
            self.assertEqual(paths.cxauth_home.stat().st_mode & 0o777, 0o700)

    def test_file_lock_rejects_second_holder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            paths.cxauth_home.mkdir(parents=True)
            lock_a = FileLock(paths.lock)
            lock_b = FileLock(paths.lock)
            with lock_a:
                with self.assertRaises(TimeoutError):
                    lock_b.acquire(timeout_seconds=0.05, poll_seconds=0.01)
            self.assertFalse(paths.lock.exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_registry -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'cxauth.paths'`.

- [ ] **Step 3: Implement path resolution**

Create `src/cxauth/paths.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
import os


@dataclass(frozen=True)
class Paths:
    cxauth_home: Path
    codex_home: Path
    registry: Path
    accounts_dir: Path
    backups_dir: Path
    tmp_dir: Path
    lock: Path
    global_auth: Path


def _expand(path: str | Path) -> Path:
    return Path(path).expanduser().resolve()


def get_paths(env: Mapping[str, str] | None = None) -> Paths:
    source = os.environ if env is None else env
    cxauth_home = _expand(source.get("CXAUTH_HOME", "~/.cxauth"))
    codex_home = _expand(source.get("CODEX_HOME", "~/.codex"))
    return Paths(
        cxauth_home=cxauth_home,
        codex_home=codex_home,
        registry=cxauth_home / "registry.json",
        accounts_dir=cxauth_home / "accounts",
        backups_dir=cxauth_home / "backups",
        tmp_dir=cxauth_home / "tmp",
        lock=cxauth_home / "cxauth.lock",
        global_auth=codex_home / "auth.json",
    )
```

- [ ] **Step 4: Implement registry and locking**

Create `src/cxauth/registry.py`:

```python
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

    def acquire(self, timeout_seconds: float = 10.0, poll_seconds: float = 0.05) -> "FileLock":
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

    def __enter__(self) -> "FileLock":
        return self.acquire()

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        self.release()
```

- [ ] **Step 5: Run tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_registry -v
```

Expected: PASS for all three tests.

- [ ] **Step 6: Commit**

```bash
git add src/cxauth/paths.py src/cxauth/registry.py tests/helpers.py tests/test_registry.py
git commit -m "feat: add registry storage primitives"
```

## Task 3: Auth Snapshot Validation and Metadata Extraction

**Files:**
- Create: `src/cxauth/auth.py`
- Create: `tests/test_auth.py`

- [ ] **Step 1: Write failing auth tests**

Create `tests/test_auth.py`:

```python
from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path

from cxauth.auth import AuthSnapshotError, extract_metadata, read_auth_snapshot, write_auth_snapshot
from cxauth.paths import get_paths

from .helpers import make_env


def fake_jwt(payload: dict[str, object]) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode()).rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{header}.{body}.sig"


class AuthTests(unittest.TestCase):
    def test_extract_metadata_from_nested_token_payload(self) -> None:
        auth = {
            "auth_mode": "chatgpt",
            "tokens": {
                "id_token": fake_jwt(
                    {
                        "email": "user@example.com",
                        "sub": "user-sub",
                        "https://api.openai.com/auth": {
                            "chatgpt_account_id": "acct_123",
                            "plan_type": "plus",
                        },
                    }
                )
            },
        }
        metadata = extract_metadata(auth)
        self.assertEqual(metadata["email"], "user@example.com")
        self.assertEqual(metadata["chatgptAccountId"], "acct_123")
        self.assertEqual(metadata["planType"], "plus")

    def test_extract_metadata_keeps_unknown_values_token_safe(self) -> None:
        metadata = extract_metadata({"auth_mode": "chatgpt", "tokens": {"access_token": "bad-token"}})
        self.assertEqual(metadata["email"], "unknown")
        self.assertEqual(metadata["chatgptAccountId"], "unknown")
        self.assertEqual(metadata["planType"], "unknown")
        self.assertNotIn("bad-token", json.dumps(metadata))

    def test_read_auth_snapshot_rejects_missing_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "auth.json"
            path.write_text(json.dumps({"auth_mode": "chatgpt"}), encoding="utf-8")
            with self.assertRaises(AuthSnapshotError):
                read_auth_snapshot(path)

    def test_write_auth_snapshot_sets_private_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            target = paths.accounts_dir / "main" / "auth.json"
            write_auth_snapshot(target, {"auth_mode": "chatgpt", "tokens": {"id_token": "a.b.c"}})
            loaded = json.loads(target.read_text())
            self.assertEqual(loaded["auth_mode"], "chatgpt")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_auth -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'cxauth.auth'`.

- [ ] **Step 3: Implement auth helpers**

Create `src/cxauth/auth.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any
import base64
import json

from .registry import atomic_write_json


class AuthSnapshotError(RuntimeError):
    pass


def _decode_jwt_payload(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        value = json.loads(decoded)
    except (ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _walk_values(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        found.append(value)
        for child in value.values():
            found.extend(_walk_values(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(_walk_values(child))
    return found


def _find_first(payloads: list[dict[str, Any]], keys: tuple[str, ...]) -> str:
    for payload in payloads:
        for key in keys:
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
    return "unknown"


def validate_auth_snapshot(auth: dict[str, Any]) -> None:
    if not isinstance(auth, dict):
        raise AuthSnapshotError("auth snapshot must be a JSON object")
    tokens = auth.get("tokens")
    if not isinstance(tokens, dict) or not tokens:
        raise AuthSnapshotError("auth snapshot does not contain tokens")
    if auth.get("auth_mode") not in (None, "chatgpt"):
        raise AuthSnapshotError("only ChatGPT auth snapshots are supported")


def read_auth_snapshot(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            auth = json.load(handle)
    except FileNotFoundError as exc:
        raise AuthSnapshotError(f"auth snapshot not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise AuthSnapshotError(f"auth snapshot is invalid JSON: {path}") from exc
    validate_auth_snapshot(auth)
    return auth


def write_auth_snapshot(path: Path, auth: dict[str, Any]) -> None:
    validate_auth_snapshot(auth)
    atomic_write_json(path, auth, mode=0o600)


def extract_metadata(auth: dict[str, Any]) -> dict[str, str]:
    tokens = auth.get("tokens", {})
    payloads: list[dict[str, Any]] = []
    if isinstance(tokens, dict):
        for value in tokens.values():
            if isinstance(value, str):
                decoded = _decode_jwt_payload(value)
                if decoded is not None:
                    payloads.extend(_walk_values(decoded))

    return {
        "email": _find_first(payloads, ("email", "preferred_username")),
        "chatgptAccountId": _find_first(payloads, ("chatgpt_account_id", "account_id", "sub")),
        "planType": _find_first(payloads, ("plan_type", "plan", "subscription_plan")),
    }
```

- [ ] **Step 4: Run tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_auth -v
```

Expected: PASS for all four tests.

- [ ] **Step 5: Commit**

```bash
git add src/cxauth/auth.py tests/test_auth.py
git commit -m "feat: parse codex auth snapshots"
```

## Task 4: Account Commands for Add Snapshot, Switch, Current, List, and Remove

**Files:**
- Create: `src/cxauth/commands.py`
- Modify: `src/cxauth/auth.py`
- Create: `tests/test_commands.py`

- [ ] **Step 1: Add test auth builders**

Append to `tests/helpers.py`:

```python
import base64
import json


def fake_jwt(payload: dict[str, object]) -> str:
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none"}).encode()).rstrip(b"=").decode()
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"{header}.{body}.sig"


def fake_auth(email: str, account_id: str, plan: str = "plus") -> dict[str, object]:
    return {
        "auth_mode": "chatgpt",
        "tokens": {
            "id_token": fake_jwt(
                {
                    "email": email,
                    "sub": account_id,
                    "https://api.openai.com/auth": {
                        "chatgpt_account_id": account_id,
                        "plan_type": plan,
                    },
                }
            )
        },
    }
```

In `tests/test_auth.py`, remove the local `fake_jwt` helper and import it:

```python
from .helpers import fake_jwt, make_env
```

- [ ] **Step 2: Write failing command tests**

Create `tests/test_commands.py`:

```python
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cxauth.auth import extract_metadata, read_auth_snapshot, write_auth_snapshot
from cxauth.commands import CommandError, add_snapshot, current_account, list_accounts, remove_account, switch_account
from cxauth.paths import get_paths
from cxauth.registry import load_registry

from .helpers import fake_auth, make_env


class CommandTests(unittest.TestCase):
    def test_add_snapshot_persists_metadata_and_default_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            result = add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)
            self.assertEqual(result["name"], "main")
            self.assertEqual(result["email"], "a@example.com")
            self.assertEqual(result["status"]["state"], "not_checked")
            self.assertTrue((paths.accounts_dir / "main" / "auth.json").exists())

    def test_add_snapshot_rejects_duplicate_name_and_duplicate_email(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)
            with self.assertRaises(CommandError):
                add_snapshot("main", fake_auth("b@example.com", "acct_b"), paths=paths)
            with self.assertRaises(CommandError):
                add_snapshot("backup", fake_auth("a@example.com", "acct_c"), paths=paths)

    def test_switch_replaces_global_auth_and_updates_current(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)
            add_snapshot("backup", fake_auth("b@example.com", "acct_b"), paths=paths)

            switched = switch_account("backup", paths=paths, validator=lambda: True)

            self.assertTrue(switched["validated"])
            self.assertEqual(load_registry(paths)["activeAccount"], "backup")
            self.assertEqual(current_account(paths=paths)["name"], "backup")
            metadata = extract_metadata(read_auth_snapshot(paths.global_auth))
            self.assertEqual(metadata["email"], "b@example.com")

    def test_switch_keeps_backup_when_validation_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            paths.codex_home.mkdir(parents=True)
            write_auth_snapshot(paths.global_auth, fake_auth("old@example.com", "acct_old"))
            add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)

            switched = switch_account("main", paths=paths, validator=lambda: False)

            self.assertFalse(switched["validated"])
            metadata = extract_metadata(read_auth_snapshot(paths.global_auth))
            self.assertEqual(metadata["email"], "a@example.com")
            self.assertTrue((paths.backups_dir / "auth.json.bak").exists())

    def test_remove_refuses_active_account(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)
            switch_account("main", paths=paths, validator=lambda: True)
            with self.assertRaises(CommandError):
                remove_account("main", paths=paths)

    def test_list_accounts_detects_unmanaged_global_auth(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            paths = get_paths(make_env(Path(tmp)))
            paths.codex_home.mkdir(parents=True)
            write_auth_snapshot(paths.global_auth, fake_auth("outside@example.com", "acct_outside"))
            result = list_accounts(paths=paths)
            self.assertEqual(result["activeName"], None)
            self.assertEqual(result["activeState"], "unmanaged")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_auth tests.test_commands -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'cxauth.commands'`.

- [ ] **Step 4: Implement command behavior**

Create `src/cxauth/commands.py`:

```python
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


def _default_status() -> dict[str, Any]:
    return {
        "weeklyLimit": {"display": "unknown", "unit": "unknown", "value": None, "raw": ""},
        "fiveHourLimit": {"display": "unknown", "unit": "unknown", "value": None, "raw": ""},
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
        registry = empty_registry()
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
        if (
            account.get("chatgptAccountId") != "unknown"
            and account.get("chatgptAccountId") == metadata.get("chatgptAccountId")
        ) or (account.get("email") != "unknown" and account.get("email") == metadata.get("email")):
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
```

- [ ] **Step 5: Run tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_auth tests.test_commands -v
```

Expected: PASS for auth and command tests.

- [ ] **Step 6: Commit**

```bash
git add src/cxauth/commands.py src/cxauth/auth.py tests/helpers.py tests/test_auth.py tests/test_commands.py
git commit -m "feat: manage saved codex auth snapshots"
```

## Task 5: Codex Device Login, Validation, and Quota Probe

**Files:**
- Create: `src/cxauth/codex.py`
- Modify: `src/cxauth/commands.py`
- Create: `tests/test_codex.py`

- [ ] **Step 1: Write failing Codex wrapper tests**

Create `tests/test_codex.py`:

```python
from __future__ import annotations

import os
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path

from cxauth.codex import parse_status_output, probe_status, run_device_login, validate_login_status
from cxauth.paths import get_paths

from .helpers import fake_auth, make_env


def write_fake_codex(path: Path, body: str) -> Path:
    script = path / "codex"
    script.write_text("#!/usr/bin/env python3\n" + body, encoding="utf-8")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


class CodexTests(unittest.TestCase):
    def test_parse_status_output_extracts_weekly_and_five_hour_percentages(self) -> None:
        output = "model gpt-5.4 | 5h 18% | weekly 62% | context 71%"
        parsed = parse_status_output(output)
        self.assertEqual(parsed["state"], "ok")
        self.assertEqual(parsed["weeklyLimit"]["display"], "62%")
        self.assertEqual(parsed["weeklyLimit"]["value"], 62)
        self.assertEqual(parsed["fiveHourLimit"]["display"], "18%")
        self.assertEqual(parsed["fiveHourLimit"]["value"], 18)

    def test_parse_status_output_marks_parse_failed_when_no_limits(self) -> None:
        parsed = parse_status_output("status window without limit values")
        self.assertEqual(parsed["state"], "parse_failed")
        self.assertEqual(parsed["weeklyLimit"]["display"], "unknown")

    def test_validate_login_status_uses_codex_binary_and_codex_home(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake = write_fake_codex(
                root,
                "import os, sys\n"
                "assert sys.argv[1:] == ['login', 'status']\n"
                "assert os.environ['CODEX_HOME'].endswith('codex-home')\n"
                "print('Logged in with ChatGPT')\n",
            )
            paths = get_paths(make_env(root))
            self.assertTrue(validate_login_status(paths=paths, codex_bin=str(fake)))

    def test_run_device_login_reads_temp_auth_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            auth_text = repr(fake_auth("new@example.com", "acct_new"))
            fake = write_fake_codex(
                root,
                textwrap.dedent(
                    f"""
                    import ast, json, os, sys
                    from pathlib import Path
                    assert sys.argv[1:] == ['login', '--device-auth']
                    home = Path(os.environ['CODEX_HOME'])
                    home.mkdir(parents=True, exist_ok=True)
                    (home / 'auth.json').write_text(json.dumps(ast.literal_eval({auth_text!r})))
                    print('device login complete')
                    """
                ),
            )
            paths = get_paths(make_env(root))
            auth = run_device_login(paths=paths, codex_bin=str(fake), timeout_seconds=2)
            self.assertEqual(auth["tokens"]["id_token"].count("."), 2)

    def test_probe_status_uses_isolated_home_and_parses_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fake = write_fake_codex(
                root,
                "import sys, time\n"
                "print('ready')\n"
                "for line in sys.stdin:\n"
                "    if line.strip() == '/status':\n"
                "        print('5h 11% weekly 44%', flush=True)\n"
                "    if line.strip() == '/quit':\n"
                "        break\n",
            )
            paths = get_paths(make_env(root))
            auth_path = root / "account-auth.json"
            auth_path.write_text('{"auth_mode":"chatgpt","tokens":{"id_token":"a.b.c"}}', encoding="utf-8")
            result = probe_status(auth_path, paths=paths, codex_bin=str(fake), timeout_seconds=2)
            self.assertEqual(result["state"], "ok")
            self.assertEqual(result["weeklyLimit"]["display"], "44%")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_codex -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'cxauth.codex'`.

- [ ] **Step 3: Implement parser and Codex subprocess wrappers**

Create `src/cxauth/codex.py`:

```python
from __future__ import annotations

from pathlib import Path
from typing import Any
import os
import pty
import re
import select
import shutil
import subprocess
import tempfile
import time

from .auth import read_auth_snapshot
from .paths import Paths, get_paths
from .registry import ensure_private_dir


def _unknown_limit() -> dict[str, Any]:
    return {"display": "unknown", "unit": "unknown", "value": None, "raw": ""}


def _percent_limit(label: str, output: str) -> dict[str, Any]:
    escaped_label = re.escape(label)
    flexible_label = escaped_label.replace("\\-", "[- ]")
    pattern = rf"(?i)(?:{escaped_label}|{flexible_label})\\s*[:=]?\\s*(\\d{{1,3}})%"
    match = re.search(pattern, output)
    if not match:
        return _unknown_limit()
    value = min(100, max(0, int(match.group(1))))
    return {"display": f"{value}%", "unit": "percent", "value": value, "raw": match.group(0)}


def parse_status_output(output: str) -> dict[str, Any]:
    weekly = _percent_limit("weekly", output)
    five_hour = _percent_limit("5h", output)
    if five_hour["display"] == "unknown":
        five_hour = _percent_limit("five-hour", output)
    state = "ok" if weekly["display"] != "unknown" or five_hour["display"] != "unknown" else "parse_failed"
    return {
        "weeklyLimit": weekly,
        "fiveHourLimit": five_hour,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "/status",
        "rawSnippet": output[-2000:],
        "state": state,
    }


def _env_with_codex_home(paths: Paths) -> dict[str, str]:
    env = os.environ.copy()
    env["CODEX_HOME"] = str(paths.codex_home)
    return env


def validate_login_status(*, paths: Paths | None = None, codex_bin: str = "codex") -> bool:
    paths = paths or get_paths()
    result = subprocess.run(
        [codex_bin, "login", "status"],
        env=_env_with_codex_home(paths),
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    return result.returncode == 0


def run_device_login(
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    paths = paths or get_paths()
    ensure_private_dir(paths.tmp_dir)
    temp_home = Path(tempfile.mkdtemp(prefix="login-", dir=str(paths.tmp_dir)))
    try:
        (temp_home / "config.toml").write_text('preferred_auth_method = "chatgpt"\n', encoding="utf-8")
        env = os.environ.copy()
        env["CODEX_HOME"] = str(temp_home)
        subprocess.run(
            [codex_bin, "login", "--device-auth"],
            env=env,
            timeout=timeout_seconds,
            check=True,
        )
        return read_auth_snapshot(temp_home / "auth.json")
    finally:
        shutil.rmtree(temp_home, ignore_errors=True)


def _read_until(fd: int, deadline: float) -> str:
    chunks: list[str] = []
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        chunks.append(data.decode("utf-8", errors="replace"))
        joined = "".join(chunks)
        if "weekly" in joined.lower() or "five-hour" in joined.lower() or "5h" in joined.lower():
            return joined
    return "".join(chunks)


def probe_status(
    auth_path: Path,
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    paths = paths or get_paths()
    read_auth_snapshot(auth_path)
    ensure_private_dir(paths.tmp_dir)
    temp_home = Path(tempfile.mkdtemp(prefix="probe-", dir=str(paths.tmp_dir)))
    try:
        shutil.copy2(auth_path, temp_home / "auth.json")
        env = os.environ.copy()
        env["CODEX_HOME"] = str(temp_home)
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(codex_bin, [codex_bin, "--no-alt-screen"], env)
        deadline = time.monotonic() + timeout_seconds
        os.write(fd, b"/status\n")
        output = _read_until(fd, deadline)
        try:
            os.write(fd, b"/quit\n")
        except OSError:
            pass
        _, status = os.waitpid(pid, 0)
        parsed = parse_status_output(output)
        if parsed["state"] == "parse_failed" and "authentication required" in output.lower():
            parsed["state"] = "auth_expired"
        if time.monotonic() >= deadline and parsed["state"] == "parse_failed":
            parsed["state"] = "timeout"
        return parsed
    finally:
        shutil.rmtree(temp_home, ignore_errors=True)
```

- [ ] **Step 4: Wire Codex wrappers into commands**

Modify `src/cxauth/commands.py` imports:

```python
from .codex import probe_status, run_device_login, validate_login_status
```

Add:

```python
def add_via_device_login(
    name: str,
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    paths = paths or get_paths()
    auth = run_device_login(paths=paths, codex_bin=codex_bin, timeout_seconds=timeout_seconds)
    return add_snapshot(name, auth, paths=paths)


def refresh_status(
    name: str | None = None,
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 20,
) -> list[dict[str, Any]]:
    paths = paths or get_paths()
    updated: list[dict[str, Any]] = []
    with FileLock(paths.lock):
        registry = _load(paths)
        names = [name] if name else sorted(registry["accounts"])
        for account_name in names:
            account = registry["accounts"].get(account_name)
            if account is None:
                raise CommandError(f"unknown account: {account_name}")
            account["status"] = probe_status(
                Path(account["authPath"]),
                paths=paths,
                codex_bin=codex_bin,
                timeout_seconds=timeout_seconds,
            )
            account["updatedAt"] = _now_iso()
            updated.append(account)
        save_registry(paths, registry)
    return updated


def default_switch_validator(paths: Paths, codex_bin: str = "codex") -> bool:
    return validate_login_status(paths=paths, codex_bin=codex_bin)
```

- [ ] **Step 5: Run Codex tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_codex -v
```

Expected: PASS for parser, validation, login, and probe tests.

- [ ] **Step 6: Run all tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Expected: PASS for all tests.

- [ ] **Step 7: Commit**

```bash
git add src/cxauth/codex.py src/cxauth/commands.py tests/test_codex.py
git commit -m "feat: integrate codex login and status probing"
```

## Task 6: CLI Commands and Output Rendering

**Files:**
- Modify: `src/cxauth/cli.py`
- Create: `tests/test_cli.py`

- [ ] **Step 1: Write failing CLI tests**

Create `tests/test_cli.py`:

```python
from __future__ import annotations

from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cxauth import cli
from cxauth.commands import add_snapshot, switch_account
from cxauth.paths import get_paths

from .helpers import fake_auth, make_env


class CliTests(unittest.TestCase):
    def run_cli(self, argv: list[str], env_root: Path) -> tuple[int, str, str]:
        stdout = StringIO()
        stderr = StringIO()
        env = make_env(env_root)
        with patch.dict("os.environ", env, clear=False):
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = cli.main(argv)
        return code, stdout.getvalue(), stderr.getvalue()

    def test_list_renders_account_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = get_paths(make_env(root))
            add_snapshot("main", fake_auth("a@example.com", "acct_a"), paths=paths)
            switch_account("main", paths=paths, validator=lambda: True)
            code, out, err = self.run_cli(["list"], root)
            self.assertEqual(code, 0, err)
            self.assertIn("NAME", out)
            self.assertIn("main", out)
            self.assertIn("a@example.com", out)
            self.assertIn("*", out)

    def test_current_reports_unmanaged_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = get_paths(make_env(root))
            paths.codex_home.mkdir(parents=True)
            paths.global_auth.write_text('{"auth_mode":"chatgpt","tokens":{"id_token":"a.b.c"}}', encoding="utf-8")
            code, out, err = self.run_cli(["current"], root)
            self.assertEqual(code, 0, err)
            self.assertIn("unmanaged", out)

    def test_switch_returns_nonzero_for_unknown_account(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            code, out, err = self.run_cli(["switch", "missing"], Path(tmp))
            self.assertEqual(code, 1)
            self.assertIn("unknown account", err)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_cli -v
```

Expected: FAIL because `list`, `current`, and `switch` subcommands are not registered.

- [ ] **Step 3: Implement CLI parser and rendering**

Replace `src/cxauth/cli.py` with:

```python
from __future__ import annotations

import argparse
import os
import sys
from typing import Any

from . import __version__
from .commands import (
    CommandError,
    add_via_device_login,
    current_account,
    default_switch_validator,
    list_accounts,
    refresh_status,
    remove_account,
    switch_account,
)
from .paths import get_paths


def _codex_bin() -> str:
    return os.environ.get("CXAUTH_CODEX_BIN", "codex")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cxauth",
        description="Manage multiple ChatGPT-backed Codex auth snapshots.",
    )
    parser.add_argument("--version", action="store_true", help="show cxauth version")
    subcommands = parser.add_subparsers(dest="command")

    add = subcommands.add_parser("add", help="add an account through codex device auth")
    add.add_argument("name")

    subcommands.add_parser("list", help="list saved accounts")

    switch = subcommands.add_parser("switch", help="switch the global Codex auth account")
    switch.add_argument("name")

    status = subcommands.add_parser("status", help="refresh quota status")
    status.add_argument("name", nargs="?")
    status.add_argument("--timeout", type=int, default=20)

    subcommands.add_parser("current", help="show the current global account")

    remove = subcommands.add_parser("remove", help="remove a saved inactive account")
    remove.add_argument("name")

    return parser


def _limit_display(account: dict[str, Any], key: str) -> str:
    value = account.get("status", {}).get(key, {})
    return value.get("display") or "unknown"


def _last_checked(account: dict[str, Any]) -> str:
    checked = account.get("status", {}).get("checkedAt")
    return checked or "never"


def _health(account: dict[str, Any]) -> str:
    return account.get("status", {}).get("state") or "not_checked"


def render_table(data: dict[str, Any]) -> str:
    rows = [
        ["NAME", "EMAIL", "PLAN", "ACTIVE", "WEEKLY", "5H", "LAST_CHECKED", "HEALTH"],
    ]
    active = data.get("activeName")
    for account in data["accounts"]:
        rows.append(
            [
                account["name"],
                account.get("email", "unknown"),
                account.get("planType", "unknown"),
                "*" if account["name"] == active else "",
                _limit_display(account, "weeklyLimit"),
                _limit_display(account, "fiveHourLimit"),
                _last_checked(account),
                _health(account),
            ]
        )
    widths = [max(len(str(row[index])) for row in rows) for index in range(len(rows[0]))]
    rendered = []
    for row in rows:
        rendered.append("  ".join(str(cell).ljust(widths[index]) for index, cell in enumerate(row)).rstrip())
    if data.get("activeState") == "unmanaged":
        rendered.append(f"unmanaged global auth: {data.get('activeEmail', 'unknown')}")
    if data.get("activeState") == "missing":
        rendered.append("global auth missing")
    return "\n".join(rendered)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    if not args.command:
        parser.print_help()
        return 0

    paths = get_paths()
    codex_bin = _codex_bin()
    try:
        if args.command == "add":
            account = add_via_device_login(args.name, paths=paths, codex_bin=codex_bin)
            print(f"added {account['name']} <{account.get('email', 'unknown')}>")
            return 0
        if args.command == "list":
            print(render_table(list_accounts(paths=paths)))
            return 0
        if args.command == "switch":
            result = switch_account(
                args.name,
                paths=paths,
                validator=lambda: default_switch_validator(paths, codex_bin=codex_bin),
            )
            suffix = "validated" if result["validated"] else "unverified"
            print(f"switched to {result['name']} ({suffix})")
            return 0
        if args.command == "status":
            updated = refresh_status(
                args.name,
                paths=paths,
                codex_bin=codex_bin,
                timeout_seconds=args.timeout,
            )
            print(render_table({"accounts": updated, "activeName": current_account(paths=paths)["name"]}))
            return 0
        if args.command == "current":
            current = current_account(paths=paths)
            if current["name"]:
                print(f"{current['name']} <{current['email']}>")
            else:
                print(f"{current['state']} <{current['email']}>")
            return 0
        if args.command == "remove":
            removed = remove_account(args.name, paths=paths)
            print(f"removed {removed['removed']}")
            return 0
    except (CommandError, TimeoutError, OSError) as exc:
        print(f"cxauth: {exc}", file=sys.stderr)
        return 1

    parser.error(f"unsupported command: {args.command}")
    return 2
```

- [ ] **Step 4: Run CLI tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest tests.test_cli -v
```

Expected: PASS for CLI tests.

- [ ] **Step 5: Run all tests**

Run:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Expected: PASS for all tests.

- [ ] **Step 6: Commit**

```bash
git add src/cxauth/cli.py tests/test_cli.py
git commit -m "feat: expose cxauth cli commands"
```

## Task 7: README, Manual Verification, and Install Check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README**

Create `README.md`:

```markdown
# cxauth

`cxauth` manages multiple ChatGPT-backed Codex auth snapshots on one machine.

## Install for local development

```bash
python3 -m pip install -e .
```

## Commands

```bash
cxauth add main
cxauth list
cxauth switch main
cxauth status
cxauth status main
cxauth current
cxauth remove backup
```

## What switching changes

`cxauth switch <name>` replaces the global Codex auth file at `~/.codex/auth.json`.
After switching, plain `codex` uses the selected account.

Before replacing the file, `cxauth` stores the previous auth at:

```text
~/.cxauth/backups/auth.json.bak
```

## Storage

`cxauth` stores its registry and saved account auth snapshots under:

```text
~/.cxauth/
```

These files contain sensitive tokens. Do not commit, paste, or share them.

## Quota status

`cxauth status` starts an isolated Codex session with the saved account snapshot,
sends `/status`, and parses values such as `weekly 62%` and `5h 18%`.

Quota parsing is best-effort. If Codex changes the TUI output, switching still works
and status will show `parse_failed`, `timeout`, or `auth_expired`.

## Test

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```
```

- [ ] **Step 2: Run full unit suite**

Run:

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Expected: PASS for all tests.

- [ ] **Step 3: Install editable package**

Run:

```bash
python3 -m pip install -e .
```

Expected: installation succeeds and registers `cxauth`.

- [ ] **Step 4: Verify CLI entrypoint**

Run:

```bash
cxauth --version
```

Expected:

```text
0.1.0
```

- [ ] **Step 5: Dry-run list against isolated homes**

Run:

```bash
CXAUTH_HOME="$(mktemp -d)" CODEX_HOME="$(mktemp -d)" cxauth list
```

Expected:

```text
NAME  EMAIL  PLAN  ACTIVE  WEEKLY  5H  LAST_CHECKED  HEALTH
global auth missing
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document cxauth usage"
```

## Final Verification

- [ ] **Step 1: Run all tests**

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

Expected: PASS.

- [ ] **Step 2: Inspect git status**

```bash
git status --short
```

Expected: no modified tracked implementation files. Untracked `.agents/`, `.claude/`, and `skills-lock.json` may remain because they existed outside the cxauth implementation scope.

- [ ] **Step 3: Manual account creation check**

Run with a real account only after the unit suite passes:

```bash
cxauth add main
cxauth current
cxauth list
```

Expected:

- `cxauth add main` opens the Codex device login flow and saves `~/.cxauth/accounts/main/auth.json`.
- `cxauth current` reports either `missing` before switching or the active managed account after switching.
- `cxauth list` prints the saved account without exposing tokens.

- [ ] **Step 4: Manual global switch check**

```bash
cxauth switch main
codex login status
```

Expected:

- `cxauth switch main` prints `switched to main`.
- `codex login status` exits successfully for the selected account.

- [ ] **Step 5: Manual quota check**

```bash
cxauth status main --timeout 30
cxauth list
```

Expected:

- `cxauth status main` updates `weekly`, `5h`, `last_checked`, and `health` when Codex exposes parseable `/status` output.
- If parsing fails, `health` is `parse_failed`, `timeout`, or `auth_expired`, and `cxauth switch main` remains usable.

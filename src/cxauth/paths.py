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

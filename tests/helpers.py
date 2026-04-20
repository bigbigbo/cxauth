from __future__ import annotations

from pathlib import Path


def make_env(root: Path) -> dict[str, str]:
    return {
        "CXAUTH_HOME": str(root / "cxauth-home"),
        "CODEX_HOME": str(root / "codex-home"),
    }

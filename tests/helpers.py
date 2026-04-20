from __future__ import annotations

import base64
import json
from pathlib import Path


def make_env(root: Path) -> dict[str, str]:
    return {
        "CXAUTH_HOME": str(root / "cxauth-home"),
        "CODEX_HOME": str(root / "codex-home"),
    }


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

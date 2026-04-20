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


def _token_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        tokens: list[str] = []
        for child in value.values():
            tokens.extend(_token_strings(child))
        return tokens
    if isinstance(value, list):
        tokens = []
        for child in value:
            tokens.extend(_token_strings(child))
        return tokens
    return []


def _find_first(payloads: list[dict[str, Any]], keys: tuple[str, ...]) -> str:
    for key in keys:
        for payload in payloads:
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
    payloads: list[dict[str, Any]] = []
    for token in _token_strings(auth.get("tokens", {})):
        decoded = _decode_jwt_payload(token)
        if decoded is not None:
            payloads.extend(_walk_values(decoded))

    return {
        "email": _find_first(payloads, ("email", "preferred_username")),
        "chatgptAccountId": _find_first(payloads, ("chatgpt_account_id", "account_id", "sub")),
        "planType": _find_first(payloads, ("plan_type", "plan", "subscription_plan")),
    }

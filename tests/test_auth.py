from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cxauth.auth import AuthSnapshotError, extract_metadata, read_auth_snapshot, write_auth_snapshot
from cxauth.paths import get_paths

from tests.helpers import fake_jwt, make_env


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

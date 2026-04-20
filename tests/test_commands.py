from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from cxauth.auth import extract_metadata, read_auth_snapshot, write_auth_snapshot
from cxauth.commands import CommandError, add_snapshot, current_account, list_accounts, remove_account, switch_account
from cxauth.paths import get_paths
from cxauth.registry import load_registry

from tests.helpers import fake_auth, make_env


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
            backup_metadata = extract_metadata(read_auth_snapshot(paths.backups_dir / "auth.json.bak"))
            self.assertEqual(backup_metadata["email"], "old@example.com")

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

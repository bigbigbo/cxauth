from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cxauth.paths import get_paths
from cxauth.registry import FileLock, load_registry, save_registry

from tests.helpers import make_env


class RegistryTests(unittest.TestCase):
    def test_paths_respect_env_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
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

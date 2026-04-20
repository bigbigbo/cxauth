from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from cxauth import cli
from cxauth.commands import add_snapshot, switch_account
from cxauth.paths import get_paths

from tests.helpers import fake_auth, make_env


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
            code, _out, err = self.run_cli(["switch", "missing"], Path(tmp))
            self.assertEqual(code, 1)
            self.assertIn("unknown account", err)


if __name__ == "__main__":
    unittest.main()

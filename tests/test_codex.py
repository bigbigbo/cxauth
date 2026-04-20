from __future__ import annotations

import json
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path

from cxauth.codex import parse_status_output, probe_status, run_device_login, validate_login_status
from cxauth.paths import get_paths

from tests.helpers import fake_auth, make_env


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

    def test_parse_status_output_accepts_five_hour_label(self) -> None:
        output = "five-hour-limit 7% weekly-limit 91%"
        parsed = parse_status_output(output)
        self.assertEqual(parsed["state"], "ok")
        self.assertEqual(parsed["weeklyLimit"]["display"], "91%")
        self.assertEqual(parsed["fiveHourLimit"]["display"], "7%")

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
            auth_json = json.dumps(fake_auth("new@example.com", "acct_new"))
            fake = write_fake_codex(
                root,
                textwrap.dedent(
                    f"""
                    import json, os, sys
                    from pathlib import Path
                    assert sys.argv[1:] == ['login', '--device-auth']
                    home = Path(os.environ['CODEX_HOME'])
                    home.mkdir(parents=True, exist_ok=True)
                    (home / 'auth.json').write_text({auth_json!r})
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
                "import sys\n"
                "print('ready', flush=True)\n"
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


if __name__ == "__main__":
    unittest.main()

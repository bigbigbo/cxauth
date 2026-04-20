from __future__ import annotations

import unittest

from cxauth.cli import main


class SmokeTests(unittest.TestCase):
    def test_version_exits_successfully(self) -> None:
        self.assertEqual(main(["--version"]), 0)


if __name__ == "__main__":
    unittest.main()

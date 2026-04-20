from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cxauth",
        description="Manage multiple ChatGPT-backed Codex auth snapshots.",
    )
    parser.add_argument("--version", action="store_true", help="show cxauth version")
    return parser


def main(argv: list[str] | None = None) -> int:
    from . import __version__

    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    parser.print_help()
    return 0

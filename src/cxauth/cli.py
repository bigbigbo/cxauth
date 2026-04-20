from __future__ import annotations

import argparse
import os
import subprocess
import sys
from typing import Any

from . import __version__
from .commands import (
    CommandError,
    add_via_device_login,
    current_account,
    default_switch_validator,
    list_accounts,
    refresh_status,
    remove_account,
    switch_account,
)
from .paths import get_paths


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cxauth",
        description="Manage multiple ChatGPT-backed Codex auth snapshots.",
    )
    parser.add_argument("--version", action="store_true", help="show cxauth version")
    subcommands = parser.add_subparsers(dest="command")

    add = subcommands.add_parser("add", help="add an account through codex device auth")
    add.add_argument("name")

    subcommands.add_parser("list", help="list saved accounts")

    switch = subcommands.add_parser("switch", help="switch the global Codex auth account")
    switch.add_argument("name")

    status = subcommands.add_parser("status", help="refresh quota status")
    status.add_argument("name", nargs="?")
    status.add_argument("--timeout", type=int, default=20)

    subcommands.add_parser("current", help="show the current global account")

    remove = subcommands.add_parser("remove", help="remove a saved inactive account")
    remove.add_argument("name")

    return parser


def _codex_bin() -> str:
    return os.environ.get("CXAUTH_CODEX_BIN", "codex")


def _limit_display(account: dict[str, Any], key: str) -> str:
    value = account.get("status", {}).get(key, {})
    return value.get("display") or "unknown"


def _last_checked(account: dict[str, Any]) -> str:
    checked = account.get("status", {}).get("checkedAt")
    return checked or "never"


def _health(account: dict[str, Any]) -> str:
    return account.get("status", {}).get("state") or "not_checked"


def render_table(data: dict[str, Any]) -> str:
    rows = [
        ["NAME", "EMAIL", "PLAN", "ACTIVE", "WEEKLY", "5H", "LAST_CHECKED", "HEALTH"],
    ]
    active = data.get("activeName")
    for account in data["accounts"]:
        rows.append(
            [
                account["name"],
                account.get("email", "unknown"),
                account.get("planType", "unknown"),
                "*" if account["name"] == active else "",
                _limit_display(account, "weeklyLimit"),
                _limit_display(account, "fiveHourLimit"),
                _last_checked(account),
                _health(account),
            ]
        )
    widths = [max(len(str(row[index])) for row in rows) for index in range(len(rows[0]))]
    rendered = []
    for row in rows:
        rendered.append("  ".join(str(cell).ljust(widths[index]) for index, cell in enumerate(row)).rstrip())
    if data.get("activeState") == "unmanaged":
        rendered.append(f"unmanaged global auth: {data.get('activeEmail', 'unknown')}")
    if data.get("activeState") == "missing":
        rendered.append("global auth missing")
    return "\n".join(rendered)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    if not args.command:
        parser.print_help()
        return 0

    paths = get_paths()
    codex_bin = _codex_bin()
    try:
        if args.command == "add":
            account = add_via_device_login(args.name, paths=paths, codex_bin=codex_bin)
            print(f"added {account['name']} <{account.get('email', 'unknown')}>")
            return 0
        if args.command == "list":
            print(render_table(list_accounts(paths=paths)))
            return 0
        if args.command == "switch":
            result = switch_account(
                args.name,
                paths=paths,
                validator=lambda: default_switch_validator(paths, codex_bin=codex_bin),
            )
            suffix = "validated" if result["validated"] else "unverified"
            print(f"switched to {result['name']} ({suffix})")
            return 0
        if args.command == "status":
            updated = refresh_status(
                args.name,
                paths=paths,
                codex_bin=codex_bin,
                timeout_seconds=args.timeout,
            )
            print(render_table({"accounts": updated, "activeName": current_account(paths=paths)["name"]}))
            return 0
        if args.command == "current":
            current = current_account(paths=paths)
            if current["name"]:
                print(f"{current['name']} <{current['email']}>")
            else:
                print(f"{current['state']} <{current['email']}>")
            return 0
        if args.command == "remove":
            removed = remove_account(args.name, paths=paths)
            print(f"removed {removed['removed']}")
            return 0
    except (CommandError, TimeoutError, OSError, subprocess.SubprocessError) as exc:
        print(f"cxauth: {exc}", file=sys.stderr)
        return 1

    parser.error(f"unsupported command: {args.command}")
    return 2

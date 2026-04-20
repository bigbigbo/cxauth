from __future__ import annotations

from pathlib import Path
from typing import Any
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import tempfile
import time

from .auth import read_auth_snapshot
from .paths import Paths, get_paths
from .registry import ensure_private_dir


def _unknown_limit() -> dict[str, Any]:
    return {"display": "unknown", "unit": "unknown", "value": None, "raw": ""}


def _percent_limit(labels: tuple[str, ...], output: str) -> dict[str, Any]:
    for label in labels:
        escaped_label = re.escape(label)
        flexible_label = escaped_label.replace(r"\-", r"[- ]")
        pattern = rf"(?i)(?:{escaped_label}|{flexible_label})\s*[:=]?\s*(\d{{1,3}})%"
        match = re.search(pattern, output)
        if match:
            value = min(100, max(0, int(match.group(1))))
            return {"display": f"{value}%", "unit": "percent", "value": value, "raw": match.group(0)}
    return _unknown_limit()


def parse_status_output(output: str) -> dict[str, Any]:
    weekly = _percent_limit(("weekly", "weekly-limit"), output)
    five_hour = _percent_limit(("5h", "five-hour", "five-hour-limit"), output)
    state = "ok" if weekly["display"] != "unknown" or five_hour["display"] != "unknown" else "parse_failed"
    return {
        "weeklyLimit": weekly,
        "fiveHourLimit": five_hour,
        "checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "/status",
        "rawSnippet": output[-2000:],
        "state": state,
    }


def _env_with_codex_home(paths: Paths) -> dict[str, str]:
    env = os.environ.copy()
    env["CODEX_HOME"] = str(paths.codex_home)
    return env


def validate_login_status(*, paths: Paths | None = None, codex_bin: str = "codex") -> bool:
    paths = paths or get_paths()
    try:
        result = subprocess.run(
            [codex_bin, "login", "status"],
            env=_env_with_codex_home(paths),
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def run_device_login(
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    paths = paths or get_paths()
    ensure_private_dir(paths.tmp_dir)
    temp_home = Path(tempfile.mkdtemp(prefix="login-", dir=str(paths.tmp_dir)))
    try:
        (temp_home / "config.toml").write_text('preferred_auth_method = "chatgpt"\n', encoding="utf-8")
        env = os.environ.copy()
        env["CODEX_HOME"] = str(temp_home)
        subprocess.run(
            [codex_bin, "login", "--device-auth"],
            env=env,
            timeout=timeout_seconds,
            check=True,
        )
        return read_auth_snapshot(temp_home / "auth.json")
    finally:
        shutil.rmtree(temp_home, ignore_errors=True)


def _read_until_limit(fd: int, deadline: float) -> str:
    chunks: list[str] = []
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        chunks.append(data.decode("utf-8", errors="replace"))
        joined = "".join(chunks)
        lower = joined.lower()
        if "weekly" in lower or "five-hour" in lower or "5h" in lower:
            return joined
    return "".join(chunks)


def _wait_or_kill(pid: int, deadline: float) -> None:
    while time.monotonic() < deadline:
        finished, _ = os.waitpid(pid, os.WNOHANG)
        if finished == pid:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


def probe_status(
    auth_path: Path,
    *,
    paths: Paths | None = None,
    codex_bin: str = "codex",
    timeout_seconds: int = 20,
) -> dict[str, Any]:
    paths = paths or get_paths()
    read_auth_snapshot(auth_path)
    ensure_private_dir(paths.tmp_dir)
    temp_home = Path(tempfile.mkdtemp(prefix="probe-", dir=str(paths.tmp_dir)))
    fd: int | None = None
    try:
        shutil.copy2(auth_path, temp_home / "auth.json")
        env = os.environ.copy()
        env["CODEX_HOME"] = str(temp_home)
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(codex_bin, [codex_bin, "--no-alt-screen"], env)
        deadline = time.monotonic() + timeout_seconds
        os.write(fd, b"/status\n")
        output = _read_until_limit(fd, deadline)
        try:
            os.write(fd, b"/quit\n")
        except OSError:
            pass
        _wait_or_kill(pid, time.monotonic() + 2)
        parsed = parse_status_output(output)
        lower = output.lower()
        if parsed["state"] == "parse_failed" and "authentication required" in lower:
            parsed["state"] = "auth_expired"
        if time.monotonic() >= deadline and parsed["state"] == "parse_failed":
            parsed["state"] = "timeout"
        return parsed
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        shutil.rmtree(temp_home, ignore_errors=True)

"""Stop a live contest load-test run without touching network lock or evidence.

Order: RTMP ffmpeg process groups, then leftover local ffmpeg whose cmdline
matches this contest, then a P4.6 recording-delete reminder and a JSON report.
Does not call network-lock stop/apply, SSH, or any global screenshot TTL.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from safety import SafetyError, normalize_contest_id

log = logging.getLogger("contest-loadtest.cleanup")

RECORDING_REMINDER = (
    "Vigil recordings for contest {contest_id} may still exist. "
    "Delete them later with the official P4.6 API "
    "(admin Vigil UI: 删除整场录像) scoped to this contest_id. "
    "Do not run a global screenshot/recording TTL cleanup."
)

_FFMPEG_NAMES = frozenset({"ffmpeg", "ffmpeg.exe"})
# Linux ps truncates args without -ww; stream keys sit at the end of argv.
_PS_CMD = ("ps", "-axww", "-o", "pid=,args=")
_PS_TIMEOUT_S = 10


def _isoformat(moment: datetime | None = None) -> str:
    return (moment or datetime.now(timezone.utc)).isoformat()


def _filename_timestamp(moment: datetime | None = None) -> str:
    raw = _isoformat(moment)
    return "".join(ch if ch.isalnum() or ch in "-._" else "-" for ch in raw)


def _reminder(contest_id: str) -> str:
    return RECORDING_REMINDER.format(contest_id=contest_id)


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return str(value)


def _call_stop(plane: Any, label: str) -> Any:
    stop = getattr(plane, "stop", None)
    if not callable(stop):
        raise TypeError(f"{label} must provide a stop() method")
    return stop()


def _cmdline_invokes_ffmpeg(cmdline: str) -> bool:
    for token in cmdline.split():
        if Path(token).name in _FFMPEG_NAMES:
            return True
    return False


def _is_loadtest_ffmpeg(cmdline: str, contest_id: str) -> bool:
    if "rtmp://" not in cmdline:
        return False
    # Contiguous marker: independent contest_id / loadtest_ tokens must not match.
    if f"{contest_id}_loadtest_" not in cmdline:
        return False
    return _cmdline_invokes_ffmpeg(cmdline)


def _parse_ps_pid_args(stdout: str) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for raw in stdout.splitlines():
        line = raw.strip()
        if not line:
            continue
        pid_text, sep, cmdline = line.partition(" ")
        if not sep:
            continue
        try:
            pid = int(pid_text)
        except ValueError:
            continue
        rows.append((pid, cmdline.strip()))
    return rows


def _ps_pid_args() -> list[tuple[int, str]]:
    if os.name != "posix":
        raise SafetyError("kill_stray_ffmpeg is Unix-only (ps)")
    completed = subprocess.run(
        _PS_CMD,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=_PS_TIMEOUT_S,
    )
    return _parse_ps_pid_args(completed.stdout)


def _skip_pid(pid: int) -> bool:
    return pid <= 1 or pid == os.getpid() or pid == os.getppid()


def matching_ffmpeg_pids(contest_id: str) -> list[int]:
    contest_id = normalize_contest_id(contest_id)
    pids: list[int] = []
    seen: set[int] = set()
    for pid, cmdline in _ps_pid_args():
        if pid in seen or _skip_pid(pid):
            continue
        if not _is_loadtest_ffmpeg(cmdline, contest_id):
            continue
        seen.add(pid)
        pids.append(pid)
    return pids


def _signal_pid(pid: int) -> None:
    if _skip_pid(pid):
        raise SafetyError(f"refusing to signal pid {pid}")
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return
    # killpg only when this ffmpeg is the session leader of its own group.
    if pgid == pid:
        try:
            os.killpg(pgid, signal.SIGTERM)
            return
        except ProcessLookupError:
            return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return


def kill_stray_ffmpeg(config) -> int:
    """Best-effort: terminate leftover ffmpeg whose cmdline is this load test.

    A process matches only when argv invokes ffmpeg and the cmdline contains
    rtmp:// plus the contiguous marker '{contest_id}_loadtest_'. Unmatched
    ffmpeg is never signaled. dry_run counts matches and does not send signals.
    """
    contest_id = normalize_contest_id(config.contest_id)
    pids = matching_ffmpeg_pids(contest_id)
    if config.dry_run:
        log.info("dry-run: %s stray ffmpeg match(es) for %s", len(pids), contest_id)
        return len(pids)
    failures: list[str] = []
    signaled = 0
    signaled_leaders: set[int] = set()
    for pid in pids:
        try:
            pgid = os.getpgid(pid)
        except ProcessLookupError:
            signaled += 1
            continue
        if pgid in signaled_leaders:
            signaled += 1
            continue
        try:
            _signal_pid(pid)
            signaled += 1
            if pgid == pid:
                signaled_leaders.add(pgid)
        except Exception as exc:
            failures.append(f"pid {pid}: {type(exc).__name__}: {exc}")
    if failures:
        raise RuntimeError(
            "failed to signal stray ffmpeg: " + "; ".join(failures)
        )
    log.info("signaled %s stray ffmpeg process(es) for %s", signaled, contest_id)
    return signaled


def _write_report(config, report: dict) -> Path:
    report_dir = Path(config.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    contest_id = str(report["contest_id"])
    path = report_dir / f"cleanup-{contest_id}-{_filename_timestamp()}.json"
    payload = dict(report)
    payload["report_path"] = str(path)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    log.info("wrote %s", path)
    return path


def stop_run(*, config, rtmp_plane=None, http_plane=None, viewers_plane=None) -> dict:
    """Stop a live run: RTMP first, then viewers ffmpeg, never network-lock, then report."""
    contest_id = normalize_contest_id(config.contest_id)
    errors: list[str] = []
    first_error: BaseException | None = None
    rtmp_stop_result: Any = None
    http_stop_result: Any = None
    viewers_stop_result: Any = None
    rtmp_stopped = False
    http_stopped = False
    viewers_stopped = False
    stray_ffmpeg = 0

    if rtmp_plane is not None:
        try:
            rtmp_stop_result = _call_stop(rtmp_plane, "rtmp_plane")
            rtmp_stopped = True
        except Exception as exc:
            first_error = first_error or exc
            errors.append(f"rtmp_plane.stop: {type(exc).__name__}: {exc}")
            log.error("rtmp_plane.stop failed: %s: %s", type(exc).__name__, exc)

    if viewers_plane is not None:
        try:
            viewers_stop_result = _call_stop(viewers_plane, "viewers_plane")
            viewers_stopped = True
        except Exception as exc:
            first_error = first_error or exc
            errors.append(f"viewers_plane.stop: {type(exc).__name__}: {exc}")
            log.error("viewers_plane.stop failed: %s: %s", type(exc).__name__, exc)

    if http_plane is not None:
        stop = getattr(http_plane, "stop", None)
        if callable(stop):
            try:
                http_stop_result = stop()
                http_stopped = True
            except Exception as exc:
                first_error = first_error or exc
                errors.append(f"http_plane.stop: {type(exc).__name__}: {exc}")
                log.error("http_plane.stop failed: %s: %s", type(exc).__name__, exc)

    try:
        stray_ffmpeg = kill_stray_ffmpeg(config)
    except Exception as exc:
        first_error = first_error or exc
        errors.append(f"kill_stray_ffmpeg: {type(exc).__name__}: {exc}")
        log.error("kill_stray_ffmpeg failed: %s: %s", type(exc).__name__, exc)

    reminder = _reminder(contest_id)
    print(reminder)

    killed = 0 if config.dry_run else stray_ffmpeg
    report = {
        "contest_id": contest_id,
        "dry_run": bool(config.dry_run),
        "stopped_at": _isoformat(),
        "rtmp_plane_provided": rtmp_plane is not None,
        "rtmp_plane_stopped": rtmp_stopped,
        "rtmp_stop_result": _jsonable(rtmp_stop_result),
        "http_plane_provided": http_plane is not None,
        "http_plane_stopped": http_stopped,
        "http_stop_result": _jsonable(http_stop_result),
        "viewers_plane_provided": viewers_plane is not None,
        "viewers_plane_stopped": viewers_stopped,
        "viewers_stop_result": _jsonable(viewers_stop_result),
        "network_lock_touched": False,
        "stray_ffmpeg_matched": stray_ffmpeg,
        "stray_ffmpeg_killed": killed,
        "vigil_recording_reminder": reminder,
        "errors": errors,
    }
    path = _write_report(config, report)
    report["report_path"] = str(path)
    if first_error is not None:
        raise RuntimeError(
            f"cleanup incomplete; report={path}; errors={errors}"
        ) from first_error
    return report

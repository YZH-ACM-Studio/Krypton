"""Poll Vigil health during a load test and write a JSON report.

Stdlib only. Never hits network-lock / exam-network / endpoint-registration URLs.
dry_run never opens a socket.
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from config import LoadtestConfig
from liveness import apply_publisher_liveness
from safety import refuse_forbidden_url

POLL_INTERVAL_S = 2.0
HEALTH_TIMEOUT_S = 3
CONSECUTIVE_FAILS_TO_STOP = 2
BODY_LIMIT = 4096


def _read_limited(fp: Any, limit: int = BODY_LIMIT) -> bytes:
    if fp is None:
        return b""
    read = getattr(fp, "read", None)
    if not callable(read):
        return b""
    return read(limit)


def _decode_body(raw: bytes) -> str:
    return raw.decode("utf-8", errors="replace")


def _rtmp_snapshot(rtmp_plane: object | None) -> Any:
    if rtmp_plane is None:
        return None
    snapshot = getattr(rtmp_plane, "snapshot", None)
    if callable(snapshot):
        return snapshot()
    return None


def _report_config(config: LoadtestConfig) -> dict[str, Any]:
    return {
        "contest_id": config.contest_id,
        "dry_run": config.dry_run,
        "students": config.students,
        "duration_s": config.duration_s,
        "vigil_health": config.vigil_health,
        "stop_on_health_fail": config.stop_on_health_fail,
        "min_living_ratio": config.min_living_ratio,
        "app": config.app,
        "screen": config.screen,
        "camera": config.camera,
        "rtmp_host": config.rtmp_host,
        "rtmp_port": config.rtmp_port,
    }


class Monitor:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config

    def poll_once(self, rtmp_plane: object | None = None) -> dict[str, Any]:
        sample = self._poll_health()
        apply_publisher_liveness(sample, rtmp_plane, self.config)
        return sample

    def _poll_health(self) -> dict[str, Any]:
        url = self.config.vigil_health
        if self.config.dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "skipped": True,
                "url": url,
                "ts": time.time(),
            }
        url = refuse_forbidden_url(url)
        started = time.monotonic()
        try:
            with urllib.request.urlopen(url, timeout=HEALTH_TIMEOUT_S) as resp:
                status = int(resp.getcode())
                body = _decode_body(_read_limited(resp))
                elapsed_ms = int((time.monotonic() - started) * 1000)
                return {
                    "ok": 200 <= status < 300,
                    "dry_run": False,
                    "skipped": False,
                    "status": status,
                    "url": url,
                    "elapsed_ms": elapsed_ms,
                    "body": body,
                    "ts": time.time(),
                }
        except urllib.error.HTTPError as exc:
            try:
                elapsed_ms = int((time.monotonic() - started) * 1000)
                body = _decode_body(_read_limited(exc))
                return {
                    "ok": False,
                    "dry_run": False,
                    "skipped": False,
                    "status": int(exc.code),
                    "url": url,
                    "elapsed_ms": elapsed_ms,
                    "error": str(exc.reason),
                    "body": body,
                    "ts": time.time(),
                }
            finally:
                exc.close()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            reason = getattr(exc, "reason", None)
            return {
                "ok": False,
                "dry_run": False,
                "skipped": False,
                "url": url,
                "elapsed_ms": elapsed_ms,
                "error": str(reason if reason is not None else exc),
                "ts": time.time(),
            }

    def run_until(
        self,
        stop_event: threading.Event,
        rtmp_plane: object | None = None,
    ) -> dict[str, Any]:
        samples: list[dict[str, Any]] = []
        rtmp_snapshots: list[Any] = []
        consecutive_fails = 0
        health_failed = False
        publishers_dead = False
        started = time.monotonic()
        started_at = time.time()

        while True:
            sample = self.poll_once(rtmp_plane)
            sample = dict(sample)
            sample["t"] = time.monotonic() - started
            samples.append(sample)
            if sample.get("publishers_dead"):
                publishers_dead = True

            rtmp_now = _rtmp_snapshot(rtmp_plane)
            if rtmp_now is not None:
                rtmp_snapshots.append(rtmp_now)

            if sample.get("ok"):
                consecutive_fails = 0
            else:
                consecutive_fails += 1
                if (
                    self.config.stop_on_health_fail
                    and consecutive_fails >= CONSECUTIVE_FAILS_TO_STOP
                ):
                    health_failed = True
                    stop_event.set()
                    break

            if stop_event.wait(POLL_INTERVAL_S):
                break

        result: dict[str, Any] = {
            "health_failed": health_failed,
            "publishers_dead": publishers_dead,
            "samples": samples,
            "poll_count": len(samples),
            "consecutive_fails": consecutive_fails,
            "poll_interval_s": POLL_INTERVAL_S,
            "health_timeout_s": HEALTH_TIMEOUT_S,
            "dry_run": self.config.dry_run,
            "contest_id": self.config.contest_id,
            "vigil_health": self.config.vigil_health,
            "started_at": started_at,
            "finished_at": time.time(),
            "elapsed_s": time.monotonic() - started,
            "rtmp": rtmp_snapshots[-1] if rtmp_snapshots else None,
            "rtmp_snapshots": rtmp_snapshots,
            "config": _report_config(self.config),
        }
        return result

    def write_report(self, result: Mapping[str, Any]) -> Path:
        self.config.report_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        path = self.config.report_dir / f"monitor-{stamp}.json"
        payload = {
            "config": _report_config(self.config),
            **dict(result),
        }
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False, default=str) + "\n",
            encoding="utf-8",
        )
        return path

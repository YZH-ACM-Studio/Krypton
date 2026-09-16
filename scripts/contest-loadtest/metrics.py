"""Optional metrics plane for the contest load-test harness.

Probes, in order:
1. SRS HTTP API (default http://127.0.0.1:1985/api/v1/streams/, 3s timeout).
   Operator may point srs_api at a tunnel or /api/v1/summaries. Connection
   refused / unreachable is recorded and skipped; it does not fail the harness.
2. Recording dir (default /data/vigil/recordings): os.walk total bytes + file
   count when the path exists; skip if missing.
3. Caddy log (default /data/access.log): 5xx lines in the last 2000 lines when
   the file exists and is readable; skip if missing.

dry_run returns planned probes and never opens a socket. Every srs_api value
goes through safety.refuse_forbidden_url. Never hits network-lock. Stdlib only.
No SSH.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import safety
from config import LoadtestConfig

LOG = logging.getLogger("contest-loadtest.metrics")
LOG.addHandler(logging.NullHandler())

SRS_TIMEOUT_S = 3
CADDY_LOG_TAIL_LINES = 2000
SRS_BODY_LIMIT = 16 * 1024 * 1024
_TAIL_BLOCK = 8192
PROBE_SRS = "srs"
PROBE_RECORDINGS = "recordings"
PROBE_CADDY_LOG = "caddy_log"


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only onto URLs that pass refuse_forbidden_url."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safety.refuse_forbidden_url(newurl)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        if new_req.has_header("Referer"):
            new_req.remove_header("Referer")
        safety.refuse_forbidden_url(new_req.full_url)
        return new_req


def _as_path(value: Path | str) -> Path:
    return value if isinstance(value, Path) else Path(value)


def _read_limited(fp: Any, limit: int = SRS_BODY_LIMIT) -> bytes:
    if fp is None:
        return b""
    read = getattr(fp, "read", None)
    if not callable(read):
        return b""
    return read(limit)


def _unreachable_reason(exc: BaseException) -> str:
    inner = getattr(exc, "reason", None)
    text = str(inner if inner is not None else exc)
    if text.lower().startswith("unreachable"):
        return text
    return f"unreachable: {text}"


def _http_get(url: str, timeout: float) -> tuple[int, bytes]:
    url = safety.refuse_forbidden_url(url)
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    if request.has_header("Referer"):
        request.remove_header("Referer")
    safety.refuse_forbidden_url(request.full_url)
    opener = urllib.request.build_opener(_SafeRedirectHandler())
    try:
        with opener.open(request, timeout=timeout) as resp:
            status = int(getattr(resp, "status", None) or resp.getcode() or 0)
            return status, _read_limited(resp)
    except urllib.error.HTTPError as exc:
        try:
            return int(exc.code), _read_limited(exc)
        finally:
            exc.close()


def _count_srs_streams(payload: Any) -> int | None:
    if isinstance(payload, list):
        return len(payload)
    if not isinstance(payload, dict):
        return None
    for candidate in (payload, payload.get("data")):
        if not isinstance(candidate, dict):
            continue
        streams = candidate.get("streams")
        if isinstance(streams, list):
            return len(streams)
        if isinstance(streams, dict):
            return len(streams)
        if isinstance(streams, int):
            return streams
        for key in ("nstreams", "stream_count", "nb_streams"):
            value = candidate.get(key)
            if isinstance(value, int):
                return value
    return None


def _status_from_json(payload: Any) -> int | None:
    if not isinstance(payload, dict):
        return None
    for key in ("status", "status_code", "statusCode"):
        value = payload.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    response = payload.get("response")
    if isinstance(response, dict):
        return _status_from_json(response)
    return None


def _line_is_5xx(line: str) -> bool:
    text = line.strip()
    if text.startswith("{"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            status = _status_from_json(payload)
            if status is not None:
                return 500 <= status <= 599
    return " 5" in line


def _tail_lines(path: Path, max_lines: int) -> list[str]:
    if max_lines <= 0:
        return []
    with path.open("rb") as fh:
        fh.seek(0, os.SEEK_END)
        remaining = fh.tell()
        if remaining == 0:
            return []
        data = b""
        while remaining > 0 and data.count(b"\n") <= max_lines:
            read_size = min(_TAIL_BLOCK, remaining)
            remaining -= read_size
            fh.seek(remaining)
            data = fh.read(read_size) + data
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return lines[-max_lines:]


def _planned_probes(config: LoadtestConfig) -> list[dict[str, Any]]:
    return [
        {
            "name": PROBE_SRS,
            "url": str(config.srs_api),
            "timeout_s": SRS_TIMEOUT_S,
            "planned": True,
        },
        {
            "name": PROBE_RECORDINGS,
            "path": str(_as_path(config.recordings_dir)),
            "planned": True,
        },
        {
            "name": PROBE_CADDY_LOG,
            "path": str(_as_path(config.caddy_log)),
            "tail_lines": CADDY_LOG_TAIL_LINES,
            "planned": True,
        },
    ]


class MetricsPlane:
    def __init__(self, config: LoadtestConfig | None = None) -> None:
        self.config = config

    def collect(self, config: LoadtestConfig | None = None) -> dict[str, Any]:
        cfg = config if config is not None else self.config
        if cfg is None:
            raise TypeError("MetricsPlane.collect requires a LoadtestConfig")
        safety.refuse_forbidden_url(str(cfg.srs_api))
        if cfg.dry_run:
            probes = _planned_probes(cfg)
            return {
                "dry_run": True,
                "ok": True,
                "contest_id": cfg.contest_id,
                "probes": probes,
                PROBE_SRS: probes[0],
                PROBE_RECORDINGS: probes[1],
                PROBE_CADDY_LOG: probes[2],
            }
        srs = self._probe_srs(cfg)
        recordings = self._probe_recordings(cfg)
        caddy_log = self._probe_caddy_log(cfg)
        probes = [srs, recordings, caddy_log]
        return {
            "dry_run": False,
            "ok": True,
            "contest_id": cfg.contest_id,
            "probes": probes,
            PROBE_SRS: srs,
            PROBE_RECORDINGS: recordings,
            PROBE_CADDY_LOG: caddy_log,
        }

    def _probe_srs(self, config: LoadtestConfig) -> dict[str, Any]:
        url = safety.refuse_forbidden_url(str(config.srs_api))
        try:
            status, body = _http_get(url, SRS_TIMEOUT_S)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            reason = _unreachable_reason(exc)
            LOG.info("srs probe skipped: %s url=%s", reason, url)
            return {
                "name": PROBE_SRS,
                "url": url,
                "timeout_s": SRS_TIMEOUT_S,
                "skipped": True,
                "ok": False,
                "reason": reason,
            }
        probe: dict[str, Any] = {
            "name": PROBE_SRS,
            "url": url,
            "timeout_s": SRS_TIMEOUT_S,
            "skipped": False,
            "status": status,
        }
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            probe["ok"] = False
            probe["reason"] = f"invalid json: {exc}"
            return probe
        stream_count = _count_srs_streams(payload)
        probe["stream_count"] = stream_count
        if isinstance(payload, dict) and isinstance(payload.get("code"), int):
            probe["code"] = payload["code"]
        probe["ok"] = 200 <= status < 300
        if stream_count is None and probe["ok"]:
            probe["reason"] = "no stream count in response"
        elif not probe["ok"]:
            probe["reason"] = f"http {status}"
        return probe

    def _probe_recordings(self, config: LoadtestConfig) -> dict[str, Any]:
        path = _as_path(config.recordings_dir)
        probe: dict[str, Any] = {
            "name": PROBE_RECORDINGS,
            "path": str(path),
        }
        if not path.exists():
            reason = "path does not exist"
            LOG.info("recordings probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        total_bytes = 0
        file_count = 0
        stat_errors = 0
        try:
            for root, _dirs, files in os.walk(path, followlinks=False):
                for name in files:
                    file_path = os.path.join(root, name)
                    try:
                        total_bytes += os.path.getsize(file_path)
                    except OSError:
                        stat_errors += 1
                        continue
                    file_count += 1
        except OSError as exc:
            reason = f"unreadable: {exc}"
            LOG.info("recordings probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        probe["skipped"] = False
        probe["ok"] = True
        probe["total_bytes"] = total_bytes
        probe["file_count"] = file_count
        if stat_errors:
            probe["stat_errors"] = stat_errors
        return probe

    def _probe_caddy_log(self, config: LoadtestConfig) -> dict[str, Any]:
        path = _as_path(config.caddy_log)
        probe: dict[str, Any] = {
            "name": PROBE_CADDY_LOG,
            "path": str(path),
            "tail_lines": CADDY_LOG_TAIL_LINES,
        }
        if not path.exists():
            reason = "path does not exist"
            LOG.info("caddy_log probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        if not path.is_file():
            reason = "path is not a readable file"
            LOG.info("caddy_log probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        if not os.access(path, os.R_OK):
            reason = "path is not readable"
            LOG.info("caddy_log probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        try:
            lines = _tail_lines(path, CADDY_LOG_TAIL_LINES)
        except OSError as exc:
            reason = f"unreadable: {exc}"
            LOG.info("caddy_log probe skipped: %s path=%s", reason, path)
            probe["skipped"] = True
            probe["ok"] = False
            probe["reason"] = reason
            return probe
        status_5xx = sum(1 for line in lines if _line_is_5xx(line))
        probe["skipped"] = False
        probe["ok"] = True
        probe["status_5xx"] = status_5xx
        probe["lines_scanned"] = len(lines)
        return probe

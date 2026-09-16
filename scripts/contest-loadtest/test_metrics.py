"""Metrics plane tests. Stdlib only; no live HTTP, SSH, or git."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import (
    DEFAULT_CADDY_LOG,
    DEFAULT_RECORDINGS_DIR,
    DEFAULT_SRS_API,
    LoadtestConfig,
)
from metrics import (
    CADDY_LOG_TAIL_LINES,
    SRS_TIMEOUT_S,
    MetricsPlane,
    _http_get,
)
from safety import SafetyError

CONTEST = "aaaaaaaaaaaaaaaaaaaaaaaa"


def _config(**overrides) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST,
        allow_contest_ids=frozenset({CONTEST}),
        confirm="",
        dry_run=True,
    )
    values.update(overrides)
    return LoadtestConfig(**values)


def _live_config(**overrides) -> LoadtestConfig:
    values = dict(
        dry_run=False,
        confirm="LOADTEST",
        srs_api="http://127.0.0.1:9/api/v1/streams/",
        recordings_dir="/tmp/contest-loadtest-missing-recordings",
        caddy_log="/tmp/contest-loadtest-missing-access.log",
    )
    values.update(overrides)
    return _config(**values)


def _probe(result: dict, name: str) -> dict:
    return next(item for item in result["probes"] if item["name"] == name)


def _http_response(status: int = 200, body: bytes = b'{"code":0,"streams":[]}') -> MagicMock:
    resp = MagicMock()
    resp.getcode.return_value = status
    resp.status = status
    resp.read.return_value = body
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


class MetricsConfigDefaultsTest(unittest.TestCase):
    def test_config_field_defaults(self) -> None:
        config = _config()
        self.assertEqual(config.srs_api, "http://127.0.0.1:1985/api/v1/streams/")
        self.assertEqual(config.srs_api, DEFAULT_SRS_API)
        self.assertEqual(str(config.recordings_dir), "/data/vigil/recordings")
        self.assertEqual(str(config.recordings_dir), str(DEFAULT_RECORDINGS_DIR))
        self.assertEqual(str(config.caddy_log), "/data/access.log")
        self.assertEqual(str(config.caddy_log), str(DEFAULT_CADDY_LOG))
        self.assertEqual(SRS_TIMEOUT_S, 3)
        self.assertEqual(CADDY_LOG_TAIL_LINES, 2000)


class MetricsDryRunTest(unittest.TestCase):
    def test_dry_run_does_not_open_sockets(self) -> None:
        plane = MetricsPlane(_config(dry_run=True))
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
            patch.object(
                urllib.request, "build_opener", side_effect=AssertionError("opener")
            ) as opener,
            patch("os.walk", side_effect=AssertionError("walk")) as walk,
        ):
            result = plane.collect()
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["ok"])
        sock.assert_not_called()
        conn.assert_not_called()
        urlopen.assert_not_called()
        opener.assert_not_called()
        walk.assert_not_called()
        names = [item["name"] for item in result["probes"]]
        self.assertEqual(names, ["srs", "recordings", "caddy_log"])
        self.assertTrue(all(item.get("planned") for item in result["probes"]))
        self.assertEqual(result["srs"]["url"], DEFAULT_SRS_API)
        self.assertEqual(result["srs"]["timeout_s"], SRS_TIMEOUT_S)
        self.assertEqual(str(result["recordings"]["path"]), str(DEFAULT_RECORDINGS_DIR))
        self.assertEqual(result["caddy_log"]["tail_lines"], CADDY_LOG_TAIL_LINES)

    def test_dry_run_collect_accepts_config_argument(self) -> None:
        plane = MetricsPlane()
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")),
            patch("socket.create_connection", side_effect=AssertionError("connect")),
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")),
        ):
            result = plane.collect(_config(dry_run=True))
        self.assertTrue(result["dry_run"])
        self.assertEqual(len(result["probes"]), 3)

    def test_dry_run_plans_no_network_lock_urls(self) -> None:
        result = MetricsPlane(_config()).collect()
        blob = json.dumps(result).lower()
        self.assertNotIn("network-lock", blob)
        for snippet in safety.FORBIDDEN_URL_SNIPPETS:
            self.assertNotIn(snippet, blob)


class MetricsForbiddenUrlTest(unittest.TestCase):
    def test_forbidden_srs_url_raises(self) -> None:
        config = _config(srs_api="http://10.1.234.2/d/system/network-lock/apply")
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")),
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
        ):
            with self.assertRaises(SafetyError):
                MetricsPlane(config).collect()
        urlopen.assert_not_called()

    def test_forbidden_srs_url_raises_live(self) -> None:
        config = _live_config(srs_api="http://10.1.234.2/admin/exam-network")
        with patch("metrics._http_get", side_effect=AssertionError("http")) as http_get:
            with self.assertRaises(SafetyError):
                MetricsPlane(config).collect()
        http_get.assert_not_called()


class MetricsSkipTest(unittest.TestCase):
    def test_missing_dir_skip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "recordings-absent"
            config = _live_config(recordings_dir=missing)
            with patch(
                "metrics._http_get",
                side_effect=URLError("Connection refused"),
            ):
                result = MetricsPlane(config).collect()
        rec = _probe(result, "recordings")
        self.assertTrue(rec["skipped"])
        self.assertIn("exist", rec["reason"].lower())
        self.assertTrue(result["ok"])
        self.assertFalse(missing.exists())

    def test_missing_caddy_log_skip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "access.log"
            config = _live_config(caddy_log=missing)
            with patch(
                "metrics._http_get",
                side_effect=URLError("Connection refused"),
            ):
                result = MetricsPlane(config).collect()
        log_probe = _probe(result, "caddy_log")
        self.assertTrue(log_probe["skipped"])
        self.assertIn("exist", log_probe["reason"].lower())
        self.assertTrue(result["ok"])

    def test_srs_connection_refused_skips_and_does_not_fail_harness(self) -> None:
        config = _live_config()
        with patch(
            "metrics._http_get",
            side_effect=URLError("Connection refused"),
        ) as http_get:
            result = MetricsPlane(config).collect()
        http_get.assert_called_once()
        args, kwargs = http_get.call_args
        self.assertEqual(args[0], config.srs_api)
        self.assertEqual(args[1] if len(args) > 1 else kwargs.get("timeout"), SRS_TIMEOUT_S)
        srs = _probe(result, "srs")
        self.assertTrue(srs["skipped"])
        self.assertIn("unreachable", srs["reason"].lower())
        self.assertTrue(result["ok"])


class MetricsLiveProbeTest(unittest.TestCase):
    def test_srs_counts_streams(self) -> None:
        body = json.dumps({"code": 0, "streams": [{}, {}, {}]})
        config = _live_config()
        with patch("metrics._http_get", return_value=(200, body.encode("utf-8"))):
            result = MetricsPlane(config).collect()
        srs = _probe(result, "srs")
        self.assertFalse(srs["skipped"])
        self.assertTrue(srs["ok"])
        self.assertEqual(srs["stream_count"], 3)
        self.assertEqual(srs["status"], 200)

    def test_srs_counts_streams_from_summaries_payload(self) -> None:
        body = json.dumps({"code": 0, "data": {"nstreams": 7}})
        config = _live_config(srs_api="http://127.0.0.1:9/api/v1/summaries")
        with patch("metrics._http_get", return_value=(200, body.encode("utf-8"))):
            result = MetricsPlane(config).collect()
        self.assertEqual(_probe(result, "srs")["stream_count"], 7)

    def test_http_get_timeout_is_3(self) -> None:
        resp = _http_response()
        opener = MagicMock()
        opener.open.return_value = resp
        with patch("urllib.request.build_opener", return_value=opener):
            status, _body = _http_get("http://127.0.0.1:1985/api/v1/streams/", SRS_TIMEOUT_S)
        opener.open.assert_called_once()
        self.assertEqual(opener.open.call_args.kwargs["timeout"], SRS_TIMEOUT_S)
        self.assertEqual(status, 200)

    def test_recordings_walk_counts_bytes_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "recordings"
            nested = root / "sub"
            nested.mkdir(parents=True)
            (root / "a.mp4").write_bytes(b"x" * 100)
            (nested / "b.mp4").write_bytes(b"y" * 50)
            config = _live_config(recordings_dir=root)
            with patch(
                "metrics._http_get",
                side_effect=URLError("Connection refused"),
            ):
                result = MetricsPlane(config).collect()
        rec = _probe(result, "recordings")
        self.assertFalse(rec["skipped"])
        self.assertEqual(rec["file_count"], 2)
        self.assertEqual(rec["total_bytes"], 150)

    def test_caddy_log_counts_5xx_in_last_2000_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "access.log"
            lines = ['127.0.0.1 - - [x] "GET /old HTTP/1.1" 500 1']
            lines.extend(['127.0.0.1 - - [x] "GET /ok HTTP/1.1" 200 1'] * 1998)
            lines.append('127.0.0.1 - - [x] "GET /fail HTTP/1.1" 502 9')
            lines.append(json.dumps({"status": 503}))
            log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
            self.assertEqual(len(lines), 2001)
            config = _live_config(caddy_log=log_path)
            with patch(
                "metrics._http_get",
                side_effect=URLError("Connection refused"),
            ):
                result = MetricsPlane(config).collect()
        probe = _probe(result, "caddy_log")
        self.assertFalse(probe["skipped"])
        self.assertEqual(probe["status_5xx"], 2)
        self.assertEqual(probe["lines_scanned"], CADDY_LOG_TAIL_LINES)
        self.assertEqual(CADDY_LOG_TAIL_LINES, 2000)


if __name__ == "__main__":
    unittest.main()

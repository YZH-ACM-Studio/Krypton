"""Tests for monitor.Monitor. Stdlib only; no live HTTP, SSH, or git."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from config import LoadtestConfig
from monitor import (
    CONSECUTIVE_FAILS_TO_STOP,
    HEALTH_TIMEOUT_S,
    Monitor,
)
from safety import SafetyError

CONTEST = "aaaaaaaaaaaaaaaaaaaaaaaa"


def _config(report_dir: Path, **overrides) -> LoadtestConfig:
    values = {
        "contest_id": CONTEST,
        "allow_contest_ids": frozenset({CONTEST}),
        "confirm": "",
        "dry_run": True,
        "report_dir": report_dir,
        "stop_on_health_fail": True,
        "vigil_health": "http://10.1.235.155:8765/api/health",
    }
    values.update(overrides)
    return LoadtestConfig(**values)


def _http_response(status: int = 200, body: bytes = b'{"status":"ok"}') -> MagicMock:
    resp = MagicMock()
    resp.getcode.return_value = status
    resp.status = status
    resp.read.return_value = body
    resp.__enter__.return_value = resp
    resp.__exit__.return_value = False
    return resp


class FakeStop:
    """Minimal Event stand-in: wait() returns True after `set_after` waits."""

    def __init__(self, set_after: int) -> None:
        self._waits = 0
        self._set_after = set_after
        self._flag = False

    def is_set(self) -> bool:
        return self._flag or self._waits >= self._set_after

    def set(self) -> None:
        self._flag = True

    def wait(self, timeout: float | None = None) -> bool:
        del timeout
        self._waits += 1
        return self.is_set()


class FakeRtmp:
    def __init__(self) -> None:
        self.calls = 0

    def snapshot(self) -> dict[str, int]:
        self.calls += 1
        return {"publishers": self.calls, "active": 1}


class FakeLivingPlane:
    def __init__(self, living: int, planned: int) -> None:
        self._living = living
        self._planned = planned
        self.calls = 0

    def living(self) -> int:
        return self._living

    def planned(self) -> int:
        return self._planned

    def snapshot(self) -> dict[str, int]:
        self.calls += 1
        return {
            "living": self._living,
            "planned": self._planned,
            "publishers": self._living,
            "active": 1,
        }


class MonitorTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.report_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_dry_run_poll_does_not_http(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        with patch("urllib.request.urlopen") as urlopen:
            sample = mon.poll_once()
        urlopen.assert_not_called()
        self.assertTrue(sample["ok"])
        self.assertTrue(sample["dry_run"])
        self.assertTrue(sample["skipped"])
        self.assertEqual(sample["url"], "http://10.1.235.155:8765/api/health")

    def test_poll_once_get_health_timeout_3(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=False, confirm="LOADTEST"))
        resp = _http_response()
        with patch("urllib.request.urlopen", return_value=resp) as urlopen:
            sample = mon.poll_once()
        urlopen.assert_called_once()
        args, kwargs = urlopen.call_args
        self.assertEqual(args[0], "http://10.1.235.155:8765/api/health")
        self.assertEqual(kwargs["timeout"], HEALTH_TIMEOUT_S)
        self.assertEqual(HEALTH_TIMEOUT_S, 3)
        self.assertTrue(sample["ok"])
        self.assertEqual(sample["status"], 200)
        self.assertFalse(sample["dry_run"])
        self.assertIn("ok", sample["body"])

    def test_poll_once_refuses_forbidden_url(self) -> None:
        mon = Monitor(
            _config(
                self.report_dir,
                dry_run=False,
                confirm="LOADTEST",
                vigil_health="http://10.1.235.155:8765/api/exam-network",
            )
        )
        with patch("urllib.request.urlopen") as urlopen:
            with self.assertRaises(SafetyError):
                mon.poll_once()
        urlopen.assert_not_called()

    def test_poll_once_http_error_is_not_ok(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=False, confirm="LOADTEST"))
        err = urllib.error.HTTPError(
            url="http://10.1.235.155:8765/api/health",
            code=503,
            msg="unavailable",
            hdrs=None,
            fp=BytesIO(b"unavailable"),
        )
        with patch("urllib.request.urlopen", side_effect=err):
            sample = mon.poll_once()
        self.assertFalse(sample["ok"])
        self.assertEqual(sample["status"], 503)

    def test_poll_once_url_error_is_not_ok(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=False, confirm="LOADTEST"))
        with patch("urllib.request.urlopen", side_effect=URLError("timed out")):
            sample = mon.poll_once()
        self.assertFalse(sample["ok"])
        self.assertIn("timed out", sample["error"])

    def test_run_until_health_failed_after_two_failures(self) -> None:
        mon = Monitor(
            _config(
                self.report_dir,
                dry_run=False,
                confirm="LOADTEST",
                stop_on_health_fail=True,
            )
        )
        stop = threading.Event()
        with patch("monitor.POLL_INTERVAL_S", 0), patch(
            "urllib.request.urlopen",
            side_effect=URLError("down"),
        ) as urlopen:
            result = mon.run_until(stop)
        self.assertTrue(result["health_failed"])
        self.assertEqual(CONSECUTIVE_FAILS_TO_STOP, 2)
        self.assertEqual(result["poll_count"], 2)
        self.assertEqual(urlopen.call_count, 2)
        self.assertTrue(stop.is_set())
        self.assertTrue(all(not s["ok"] for s in result["samples"]))

    def test_run_until_does_not_stop_when_stop_on_health_fail_false(self) -> None:
        mon = Monitor(
            _config(
                self.report_dir,
                dry_run=False,
                confirm="LOADTEST",
                stop_on_health_fail=False,
            )
        )
        stop = FakeStop(set_after=3)
        with patch("monitor.POLL_INTERVAL_S", 0), patch(
            "urllib.request.urlopen",
            side_effect=URLError("down"),
        ) as urlopen:
            result = mon.run_until(stop)  # type: ignore[arg-type]
        self.assertFalse(result["health_failed"])
        self.assertGreaterEqual(result["poll_count"], 3)
        self.assertGreaterEqual(urlopen.call_count, 3)

    def test_consecutive_fails_reset_on_success(self) -> None:
        mon = Monitor(
            _config(
                self.report_dir,
                dry_run=False,
                confirm="LOADTEST",
                stop_on_health_fail=True,
            )
        )
        stop = FakeStop(set_after=3)
        responses = [
            URLError("down"),
            _http_response(),
            URLError("down"),
            _http_response(),
        ]
        with patch("monitor.POLL_INTERVAL_S", 0), patch(
            "urllib.request.urlopen",
            side_effect=responses,
        ):
            result = mon.run_until(stop)  # type: ignore[arg-type]
        self.assertFalse(result["health_failed"])
        self.assertGreaterEqual(result["poll_count"], 3)

    def test_run_until_dry_run_no_http_and_stops_on_event(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        stop = threading.Event()
        stop.set()
        with patch("urllib.request.urlopen") as urlopen, patch(
            "monitor.POLL_INTERVAL_S", 0
        ):
            result = mon.run_until(stop)
        urlopen.assert_not_called()
        self.assertFalse(result["health_failed"])
        self.assertEqual(result["poll_count"], 1)
        self.assertTrue(result["samples"][0]["skipped"])

    def test_run_until_includes_rtmp_plane_snapshot(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        stop = threading.Event()
        stop.set()
        plane = FakeRtmp()
        result = mon.run_until(stop, rtmp_plane=plane)
        # poll_once may snapshot while attaching liveness; run_until snapshots again.
        self.assertGreaterEqual(plane.calls, 1)
        self.assertEqual(result["rtmp"], {"publishers": plane.calls, "active": 1})
        self.assertEqual(
            result["rtmp_snapshots"],
            [{"publishers": plane.calls, "active": 1}],
        )
        self.assertFalse(result["publishers_dead"])

    def test_poll_once_includes_living_planned_ratio(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        sample = mon.poll_once(FakeLivingPlane(9, 10))
        self.assertEqual(sample["living"], 9)
        self.assertEqual(sample["planned"], 10)
        self.assertAlmostEqual(sample["ratio"], 0.9)
        self.assertTrue(sample["ok"])
        self.assertNotIn("publishers_dead", sample)

    def test_poll_once_dry_run_does_not_fail_dead_publishers(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        sample = mon.poll_once(FakeLivingPlane(0, 10))
        self.assertTrue(sample["ok"])
        self.assertEqual(sample["living"], 0)
        self.assertAlmostEqual(sample["ratio"], 0.0)
        self.assertNotIn("publishers_dead", sample)

    def test_poll_once_live_dead_publishers_marks_unhealthy(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=False, confirm="LOADTEST"))
        resp = _http_response()
        with patch("urllib.request.urlopen", return_value=resp):
            sample = mon.poll_once(FakeLivingPlane(0, 10))
        self.assertFalse(sample["ok"])
        self.assertTrue(sample["publishers_dead"])
        self.assertEqual(sample["living"], 0)
        self.assertEqual(sample["planned"], 10)

    def test_run_until_dead_publishers_are_consecutive_health_fail(self) -> None:
        mon = Monitor(
            _config(
                self.report_dir,
                dry_run=False,
                confirm="LOADTEST",
                stop_on_health_fail=True,
            )
        )
        stop = threading.Event()
        plane = FakeLivingPlane(0, 10)
        with patch("monitor.POLL_INTERVAL_S", 0), patch(
            "urllib.request.urlopen",
            return_value=_http_response(),
        ):
            result = mon.run_until(stop, rtmp_plane=plane)
        self.assertTrue(result["health_failed"])
        self.assertTrue(result["publishers_dead"])
        self.assertEqual(result["poll_count"], CONSECUTIVE_FAILS_TO_STOP)
        self.assertTrue(stop.is_set())
        self.assertTrue(all(s.get("publishers_dead") for s in result["samples"]))

    def test_write_report_json_under_report_dir(self) -> None:
        mon = Monitor(_config(self.report_dir, dry_run=True))
        stop = threading.Event()
        stop.set()
        result = mon.run_until(stop)
        path = mon.write_report(result)
        self.assertEqual(path.parent, self.report_dir)
        self.assertTrue(path.name.startswith("monitor-"))
        self.assertTrue(path.name.endswith(".json"))
        self.assertTrue(path.is_file())
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(payload["contest_id"], CONTEST)
        self.assertIn("health_failed", payload)
        self.assertIn("samples", payload)
        self.assertEqual(payload["config"]["vigil_health"], "http://10.1.235.155:8765/api/health")
        self.assertNotIn("confirm", payload["config"])
        self.assertNotIn("invite_code", payload["config"])
        self.assertNotIn("code", payload["config"])


if __name__ == "__main__":
    unittest.main()

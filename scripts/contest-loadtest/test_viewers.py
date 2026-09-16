"""dry_run tests for the teacher 监考墙 HTTP-FLV pull plane."""

from __future__ import annotations

import io
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import LoadtestConfig
from viewers import (
    ViewerPlane,
    build_pull_command,
    require_http_flv_base,
    require_http_flv_url,
)

CONTEST_ID = "0123456789abcdef00000001"
DENIED_CONTEST_ID = "deadbeefdeadbeefdeadbeef"
FLV_PREFIX = f"http://10.1.234.2/vigil-flv/live-record/{CONTEST_ID}_"


def _config(**overrides) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="",
        dry_run=True,
        students=30,
        duration_s=30,
        screen=True,
        camera=True,
    )
    values.update(overrides)
    return LoadtestConfig(**values)


def _live_config(**overrides) -> LoadtestConfig:
    values = dict(
        dry_run=False,
        confirm="LOADTEST",
        students=4,
        viewers=1,
        viewer_streams=2,
        camera=False,
    )
    values.update(overrides)
    return _config(**values)


def _alive_proc(pid: int, alive: dict, key: str = "value") -> MagicMock:
    proc = MagicMock()
    proc.pid = pid
    proc.returncode = None

    def poll() -> int | None:
        return None if alive[key] else 0

    def wait(timeout: float | None = None) -> int:
        if alive[key]:
            raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=timeout)
        return 0

    proc.poll.side_effect = poll
    proc.wait.side_effect = wait
    return proc


class FakeStream:
    def __init__(self, payload: bytes = b"flvdata") -> None:
        self.payload = payload
        self.pos = 0

    def read(self, n: int = -1) -> bytes:
        if self.pos >= len(self.payload):
            return b""
        if n < 0:
            chunk = self.payload[self.pos :]
            self.pos = len(self.payload)
            return chunk
        chunk = self.payload[self.pos : self.pos + n]
        self.pos += len(chunk)
        return chunk

    def __enter__(self) -> FakeStream:
        return self

    def __exit__(self, *args) -> None:
        return None


class FakeOpener:
    def __init__(self, payload: bytes = b"flvdata") -> None:
        self.payload = payload
        self.requests: list[object] = []
        self.timeouts: list[float | None] = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        return FakeStream(self.payload)


class BuildPullCommandTest(unittest.TestCase):
    def test_exact_ffmpeg_argv_is_pull_not_publish(self) -> None:
        url = "http://10.1.234.2/vigil-flv/live-record/key.flv"
        argv = build_pull_command(url, 180)
        self.assertEqual(
            argv,
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-i",
                url,
                "-t",
                "180",
                "-f",
                "null",
                "-",
            ],
        )
        self.assertNotIn("-re", argv)
        self.assertNotIn("rtmp://", " ".join(argv))
        self.assertEqual(argv[-2:], ["null", "-"])


class RequireHttpFlvUrlTest(unittest.TestCase):
    def test_accepts_production_flv_path(self) -> None:
        url = (
            "http://10.1.234.2/vigil-flv/live-record/"
            f"{CONTEST_ID}_loadtest_0000_screen.flv"
        )
        self.assertEqual(require_http_flv_url(url), url)

    def test_rejects_rtmp(self) -> None:
        with self.assertRaises(safety.SafetyError) as ctx:
            require_http_flv_url(
                f"rtmp://10.1.235.155:1935/live-record/{CONTEST_ID}_loadtest_0000_screen"
            )
        self.assertIn("http", str(ctx.exception).lower())

    def test_rejects_network_lock(self) -> None:
        with self.assertRaises(safety.SafetyError):
            require_http_flv_url("http://10.1.234.2/d/system/network-lock/apply.flv")

    def test_flv_base_must_be_http(self) -> None:
        with self.assertRaises(safety.SafetyError) as ctx:
            require_http_flv_base("rtmp://10.1.235.155/live-record")
        self.assertIn("flv_base", str(ctx.exception))

    def test_flv_base_rejects_network_lock(self) -> None:
        with self.assertRaises(safety.SafetyError):
            require_http_flv_base("http://10.1.234.2/network-lock/vigil-flv")


class DryRunViewerPlaneTest(unittest.TestCase):
    def setUp(self) -> None:
        self._denylist_tmp = tempfile.TemporaryDirectory()
        denylist = Path(self._denylist_tmp.name) / "denied-contests.txt"
        denylist.write_text(f"{DENIED_CONTEST_ID}\n", encoding="utf-8")
        self._denylist_patcher = patch.object(safety, "DENYLIST_PATH", denylist)
        self._denylist_patcher.start()
        self.addCleanup(self._denylist_patcher.stop)
        self.addCleanup(self._denylist_tmp.cleanup)
        self._stdout = io.StringIO()
        self._stdout_patcher = patch("sys.stdout", self._stdout)
        self._stdout_patcher.start()
        self.addCleanup(self._stdout_patcher.stop)

    def test_start_four_viewers_eight_streams_is_32_urls(self) -> None:
        plane = ViewerPlane(_config())
        result = plane.start()
        self.assertEqual(result["planned"], 32)
        self.assertEqual(len(result["urls"]), 32)
        self.assertEqual(len(result["keys"]), 32)
        self.assertEqual(len(result["commands"]), 32)
        self.assertEqual(result["viewers"], 4)
        self.assertEqual(result["viewer_streams"], 8)
        printed = [line for line in self._stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(printed, result["urls"])

    def test_stream_keys_match_regex(self) -> None:
        result = ViewerPlane(_config()).start()
        self.assertEqual(len(result["keys"]), 32)
        for key in result["keys"]:
            self.assertIsNotNone(safety.STREAM_KEY_RE.fullmatch(key), key)
            self.assertTrue(key.endswith("_screen") or key.endswith("_camera"))
            self.assertIn("_loadtest_", key)

    def test_urls_are_http_flv_not_rtmp(self) -> None:
        result = ViewerPlane(_config()).start()
        self.assertEqual(
            result["urls"][0],
            f"{FLV_PREFIX}loadtest_0000_screen.flv",
        )
        for url in result["urls"]:
            self.assertTrue(url.startswith("http://10.1.234.2/vigil-flv/"))
            self.assertTrue(url.endswith(".flv"))
            self.assertNotIn("rtmp://", url)
            self.assertNotIn("network-lock", url)
            self.assertIn("/live-record/", url)
        for command in result["commands"]:
            self.assertNotIn("-re", command)
            self.assertNotIn("rtmp://", " ".join(command))
            self.assertEqual(command[-2:], ["null", "-"])

    def test_screen_first_then_camera_from_student_zero(self) -> None:
        result = ViewerPlane(_config(viewers=1, viewer_streams=4, students=2)).start()
        self.assertEqual(
            result["keys"],
            [
                f"{CONTEST_ID}_loadtest_0000_screen",
                f"{CONTEST_ID}_loadtest_0000_camera",
                f"{CONTEST_ID}_loadtest_0001_screen",
                f"{CONTEST_ID}_loadtest_0001_camera",
            ],
        )
        self.assertEqual([item["viewer"] for item in result["streams"]], [0, 0, 0, 0])
        self.assertEqual([item["kind"] for item in result["streams"]], ["screen", "camera", "screen", "camera"])

    def test_viewers_take_sequential_distinct_keys(self) -> None:
        result = ViewerPlane(_config(viewers=2, viewer_streams=2, camera=False)).start()
        self.assertEqual(
            result["keys"],
            [
                f"{CONTEST_ID}_loadtest_0000_screen",
                f"{CONTEST_ID}_loadtest_0001_screen",
                f"{CONTEST_ID}_loadtest_0002_screen",
                f"{CONTEST_ID}_loadtest_0003_screen",
            ],
        )
        self.assertEqual([item["viewer"] for item in result["streams"]], [0, 0, 1, 1])

    def test_stop_is_idempotent(self) -> None:
        plane = ViewerPlane(_config())
        first = plane.stop()
        plane.start()
        second = plane.stop()
        third = plane.stop()
        self.assertEqual(first["living"], 0)
        self.assertEqual(second, third)
        self.assertEqual(second["living"], 0)
        self.assertEqual(second["signaled"], 0)
        self.assertEqual(plane.living(), 0)

    def test_start_does_not_popen(self) -> None:
        plane = ViewerPlane(_config())
        with patch("viewers.subprocess.Popen") as popen:
            plane.start()
            popen.assert_not_called()
        self.assertEqual(plane.living(), 0)
        snap = plane.snapshot()
        self.assertTrue(snap["dry_run"])
        self.assertTrue(snap["started"])
        self.assertEqual(snap["planned"], 32)
        self.assertEqual(snap["living"], 0)
        self.assertEqual(snap["exited"], 0)
        self.assertEqual(snap["bytes"], 0)
        self.assertEqual(snap["pull_mode"], "planned")

    def test_dry_run_does_not_need_samples_or_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = ViewerPlane(_config(sample_dir=Path(tmp)))
            with patch("viewers.subprocess.Popen") as popen, patch(
                "viewers._ffmpeg_available", return_value=False
            ):
                plane.start()
                popen.assert_not_called()
            self.assertEqual(plane.snapshot()["planned"], 32)

    def test_stop_is_safe_and_keeps_living_zero(self) -> None:
        plane = ViewerPlane(_config())
        plane.stop()
        plane.start()
        with patch("viewers.os.killpg") as killpg:
            plane.stop()
            killpg.assert_not_called()
        self.assertEqual(plane.living(), 0)

    def test_start_twice_fail_fast(self) -> None:
        plane = ViewerPlane(_config())
        plane.start()
        with self.assertRaises(RuntimeError):
            plane.start()

    def test_assert_ready_runs_in_start(self) -> None:
        plane = ViewerPlane(
            _config(
                contest_id=CONTEST_ID,
                allow_contest_ids=frozenset(),
            )
        )
        with self.assertRaises(safety.SafetyError):
            plane.start()
        self.assertFalse(plane.snapshot()["started"])

    def test_refuse_forbidden_url_on_each_http_url(self) -> None:
        plane = ViewerPlane(_config(viewers=2, viewer_streams=2))
        with patch(
            "viewers.safety.refuse_forbidden_url", wraps=safety.refuse_forbidden_url
        ) as mocked:
            result = plane.start()
        self.assertEqual(len(result["urls"]), 4)
        self.assertGreaterEqual(mocked.call_count, 4)
        for url in result["urls"]:
            mocked.assert_any_call(url)

    def test_require_stream_key_runs_in_start(self) -> None:
        plane = ViewerPlane(_config(viewers=1, viewer_streams=2))
        with patch("viewers.safety.require_stream_key", wraps=safety.require_stream_key) as require_key:
            plane.start()
        self.assertGreaterEqual(require_key.call_count, 2)
        require_key.assert_any_call(f"{CONTEST_ID}_loadtest_0000_screen")
        require_key.assert_any_call(f"{CONTEST_ID}_loadtest_0000_camera")

    def test_rtmp_flv_base_is_refused(self) -> None:
        plane = ViewerPlane(_config(flv_base="rtmp://10.1.235.155:1935/live-record"))
        with self.assertRaises(safety.SafetyError) as ctx:
            plane.start()
        self.assertIn("http", str(ctx.exception).lower())
        self.assertFalse(plane.snapshot()["started"])

    def test_network_lock_flv_base_is_refused(self) -> None:
        plane = ViewerPlane(_config(flv_base="http://10.1.234.2/network-lock/vigil-flv"))
        with self.assertRaises(safety.SafetyError):
            plane.start()
        self.assertFalse(plane.snapshot()["started"])

    def test_zero_viewers_fail_closed(self) -> None:
        with self.assertRaises(safety.SafetyError):
            ViewerPlane(_config(viewers=0)).start()

    def test_zero_viewer_streams_fail_closed(self) -> None:
        with self.assertRaises(safety.SafetyError):
            ViewerPlane(_config(viewer_streams=0)).start()

    def test_live_does_not_need_samples(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = ViewerPlane(_live_config(sample_dir=Path(tmp)))
            fake = MagicMock()
            fake.poll.return_value = None
            fake.pid = 4242
            with patch("viewers._ffmpeg_available", return_value=True), patch(
                "viewers.subprocess.Popen", return_value=fake
            ) as popen:
                plane.start()
            self.assertEqual(popen.call_count, 2)
            popen.assert_called()

    def test_non_dry_run_popen_uses_start_new_session(self) -> None:
        plane = ViewerPlane(_live_config())
        fake = MagicMock()
        fake.poll.return_value = None
        fake.pid = 4242
        with patch("viewers._ffmpeg_available", return_value=True), patch(
            "viewers.subprocess.Popen", return_value=fake
        ) as popen:
            plane.start()
        self.assertEqual(popen.call_count, 2)
        for call in popen.call_args_list:
            self.assertTrue(call.kwargs["start_new_session"])
            argv = call.args[0]
            self.assertEqual(argv[0], "ffmpeg")
            self.assertNotIn("-re", argv)
            self.assertEqual(argv[-2:], ["null", "-"])
            self.assertTrue(argv[argv.index("-i") + 1].startswith("http://"))
        self.assertEqual(plane.living(), 2)
        self.assertEqual(plane.snapshot()["pull_mode"], "ffmpeg")

    def test_stop_sigterm_then_sigkill_process_group(self) -> None:
        plane = ViewerPlane(_live_config(viewer_streams=1))
        proc = MagicMock()
        proc.pid = 4242
        alive = {"value": True}

        def poll() -> int | None:
            return None if alive["value"] else 0

        def wait(timeout: float | None = None) -> int:
            if alive["value"]:
                raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=timeout)
            return 0

        def killpg(_pgid: int, sig: int) -> None:
            if sig == signal.SIGKILL:
                alive["value"] = False
                proc.returncode = 0

        proc.poll.side_effect = poll
        proc.wait.side_effect = wait
        with patch("viewers._ffmpeg_available", return_value=True), patch(
            "viewers.subprocess.Popen", return_value=proc
        ), patch("viewers.os.killpg", side_effect=killpg) as killpg_mock, patch(
            "viewers.os.getpgid", side_effect=lambda pid: pid
        ):
            plane.start()
            result = plane.stop()
            again = plane.stop()
        self.assertEqual(result["signaled"], 1)
        self.assertEqual(result["killed"], 1)
        self.assertEqual(result["living"], 0)
        self.assertEqual(again["already_dead"], 1)
        self.assertEqual(again["signaled"], 0)
        self.assertEqual(
            [call.args[1] for call in killpg_mock.call_args_list],
            [signal.SIGTERM, signal.SIGKILL],
        )
        self.assertEqual(plane.living(), 0)

    def test_start_popen_failure_reaps_via_stop_path(self) -> None:
        plane = ViewerPlane(_live_config(students=2, viewer_streams=2))
        alive = {"value": True}
        first = _alive_proc(1111, alive)
        sigs: list[tuple[int, int]] = []

        def killpg(pgid: int, sig: int) -> None:
            sigs.append((pgid, sig))
            alive["value"] = False
            first.returncode = 0

        with patch("viewers._ffmpeg_available", return_value=True), patch(
            "viewers.subprocess.Popen", side_effect=[first, OSError("spawn failed")]
        ), patch("viewers.os.killpg", side_effect=killpg), patch(
            "viewers.os.getpgid", side_effect=lambda pid: pid
        ), patch("viewers.os.kill") as kill_mock:
            with self.assertRaises(OSError) as ctx:
                plane.start()
        self.assertEqual(str(ctx.exception), "spawn failed")
        self.assertEqual(sigs[0], (1111, signal.SIGTERM))
        kill_mock.assert_not_called()
        self.assertEqual(plane.living(), 0)
        snap = plane.snapshot()
        self.assertEqual(snap["planned"], 2)
        self.assertEqual(snap["streams"][0]["pid"], 1111)
        self.assertIsNone(snap["streams"][1]["pid"])

    def test_start_failure_keeps_living_ffmpeg_visible_to_stop(self) -> None:
        plane = ViewerPlane(_live_config(students=2, viewer_streams=2))
        alive = {"value": True}
        first = _alive_proc(2222, alive)
        with patch("viewers._ffmpeg_available", return_value=True), patch(
            "viewers.subprocess.Popen", side_effect=[first, OSError("spawn failed")]
        ), patch("viewers.os.killpg"), patch(
            "viewers.os.getpgid", side_effect=lambda pid: pid
        ):
            with self.assertRaises(RuntimeError) as ctx:
                plane.start()
        self.assertIsInstance(ctx.exception.__cause__, OSError)
        self.assertTrue(plane.snapshot()["started"])
        self.assertEqual(plane.living(), 1)
        with patch("viewers.os.killpg") as killpg, patch(
            "viewers.os.getpgid", side_effect=lambda pid: pid
        ):
            with self.assertRaises(RuntimeError):
                plane.stop()
            self.assertTrue(killpg.called)
        self.assertEqual(plane.living(), 1)

    def test_start_raises_if_all_ffmpeg_die_immediately(self) -> None:
        plane = ViewerPlane(_live_config())
        dead = MagicMock()
        dead.pid = 7
        dead.poll.return_value = 1
        with patch("viewers._ffmpeg_available", return_value=True), patch(
            "viewers.subprocess.Popen", return_value=dead
        ) as popen:
            with self.assertRaises(RuntimeError) as ctx:
                plane.start()
        popen.assert_called()
        msg = str(ctx.exception).lower()
        self.assertIn("died", msg)
        self.assertIn("stderr", msg)
        self.assertEqual(plane.living(), 0)

    def test_urllib_fallback_when_ffmpeg_missing(self) -> None:
        plane = ViewerPlane(_live_config(viewer_streams=2, duration_s=1))
        opener = FakeOpener(b"abcde")
        with patch("viewers._ffmpeg_available", return_value=False), patch(
            "viewers.subprocess.Popen"
        ) as popen, patch("viewers.urllib.request.build_opener", return_value=opener):
            result = plane.start()
            popen.assert_not_called()
            for slot in plane._streams:
                thread = slot.thread
                self.assertIsNotNone(thread)
                assert thread is not None
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())
        self.assertEqual(result["pull_mode"], "urllib")
        self.assertEqual(len(opener.requests), 2)
        for request in opener.requests:
            self.assertTrue(request.full_url.startswith("http://"))
            self.assertNotIn("rtmp://", request.full_url)
            self.assertNotIn("network-lock", request.full_url)
            self.assertFalse(request.has_header("Referer"))
        self.assertGreaterEqual(plane.snapshot()["bytes"], 10)
        stopped = plane.stop()
        again = plane.stop()
        self.assertEqual(stopped["living"], 0)
        self.assertEqual(again["living"], 0)
        self.assertEqual(again["signaled"], 0)

    def test_urllib_stop_is_idempotent_while_blocked(self) -> None:
        plane = ViewerPlane(_live_config(viewer_streams=1, duration_s=30))
        release = threading.Event()

        class BlockingStream(FakeStream):
            def read(self, n: int = -1) -> bytes:
                if plane._stop_event.is_set() or release.is_set():
                    return b""
                release.wait(timeout=0.05)
                if plane._stop_event.is_set() or release.is_set():
                    return b""
                return b"x"

        class BlockingOpener:
            def open(self, request, timeout=None):
                return BlockingStream(b"x")

        with patch("viewers._ffmpeg_available", return_value=False), patch(
            "viewers.urllib.request.build_opener", return_value=BlockingOpener()
        ):
            plane.start()
            deadline = time.monotonic() + 2.0
            while plane.living() == 0 and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(plane.living(), 1)
            first = plane.stop()
            second = plane.stop()
        self.assertEqual(first["living"], 0)
        self.assertEqual(second["living"], 0)
        self.assertEqual(second["signaled"], 0)
        self.assertEqual(plane.living(), 0)


if __name__ == "__main__":
    unittest.main()

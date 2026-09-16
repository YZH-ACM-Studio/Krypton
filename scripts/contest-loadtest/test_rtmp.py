"""dry_run tests for the ffmpeg RTMP push plane."""

from __future__ import annotations

import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import LoadtestConfig
from rtmp import RtmpPlane, build_push_command

CONTEST_ID = "0123456789abcdef00000001"
DENIED_CONTEST_ID = "deadbeefdeadbeefdeadbeef"


def _config(**overrides) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="",
        dry_run=True,
        students=2,
        duration_s=30,
        screen=True,
        camera=True,
    )
    values.update(overrides)
    return LoadtestConfig(**values)


def _live_config(sample_dir: Path, **overrides) -> LoadtestConfig:
    (sample_dir / "screen.flv").write_bytes(b"flv")
    (sample_dir / "camera.flv").write_bytes(b"flv")
    values = dict(
        dry_run=False,
        confirm="LOADTEST",
        sample_dir=sample_dir,
        students=1,
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


class BuildPushCommandTest(unittest.TestCase):
    def test_exact_ffmpeg_argv(self) -> None:
        url = "rtmp://10.1.235.155:1935/live-record/key"
        self.assertEqual(
            build_push_command("/tmp/screen.flv", url),
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "warning",
                "-re",
                "-stream_loop",
                "-1",
                "-i",
                "/tmp/screen.flv",
                "-c",
                "copy",
                "-f",
                "flv",
                url,
            ],
        )


class DryRunRtmpPlaneTest(unittest.TestCase):
    def setUp(self) -> None:
        self._denylist_tmp = tempfile.TemporaryDirectory()
        denylist = Path(self._denylist_tmp.name) / "denied-contests.txt"
        denylist.write_text(f"{DENIED_CONTEST_ID}\n", encoding="utf-8")
        self._denylist_patcher = patch.object(safety, "DENYLIST_PATH", denylist)
        self._denylist_patcher.start()
        self.addCleanup(self._denylist_patcher.stop)
        self.addCleanup(self._denylist_tmp.cleanup)

    def test_start_two_urls_per_student_when_screen_and_camera(self) -> None:
        plane = RtmpPlane(_config(students=2, screen=True, camera=True))
        result = plane.start()
        self.assertEqual(len(result["urls"]), 4)
        self.assertEqual(len(result["keys"]), 4)
        self.assertEqual(len(result["commands"]), 4)
        self.assertEqual(result["planned"], 4)
        self.assertEqual(
            result["urls"],
            [
                f"rtmp://10.1.235.155:1935/live-record/{CONTEST_ID}_loadtest_0000_screen",
                f"rtmp://10.1.235.155:1935/live-record/{CONTEST_ID}_loadtest_0000_camera",
                f"rtmp://10.1.235.155:1935/live-record/{CONTEST_ID}_loadtest_0001_screen",
                f"rtmp://10.1.235.155:1935/live-record/{CONTEST_ID}_loadtest_0001_camera",
            ],
        )
        self.assertEqual(result["keys"][0], f"{CONTEST_ID}_loadtest_0000_screen")
        self.assertEqual(result["keys"][1], f"{CONTEST_ID}_loadtest_0000_camera")

    def test_stream_keys_match_regex(self) -> None:
        result = RtmpPlane(_config(students=3, screen=True, camera=True)).start()
        self.assertEqual(len(result["keys"]), 6)
        for key in result["keys"]:
            self.assertIsNotNone(safety.STREAM_KEY_RE.fullmatch(key), key)
            self.assertTrue(key.endswith("_screen") or key.endswith("_camera"))
            self.assertIn("_loadtest_", key)

    def test_stop_is_idempotent(self) -> None:
        plane = RtmpPlane(_config())
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
        plane = RtmpPlane(_config())
        with patch("rtmp.subprocess.Popen") as popen:
            plane.start()
            popen.assert_not_called()
        self.assertEqual(plane.living(), 0)
        snap = plane.snapshot()
        self.assertTrue(snap["dry_run"])
        self.assertTrue(snap["started"])
        self.assertEqual(snap["planned"], 4)
        self.assertEqual(snap["living"], 0)
        self.assertEqual(snap["exited"], 0)

    def test_missing_samples_ok_in_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_config(sample_dir=Path(tmp)))
            with patch("rtmp.subprocess.Popen") as popen:
                plane.start()
                popen.assert_not_called()
            self.assertEqual(plane.snapshot()["planned"], 4)

    def test_snapshot_lists_screen_and_camera_commands(self) -> None:
        plane = RtmpPlane(_config(students=1))
        plane.start()
        snap = plane.snapshot()
        streams = snap["streams"]
        self.assertEqual([item["kind"] for item in streams], ["screen", "camera"])
        self.assertEqual([item["index"] for item in streams], [0, 0])
        for item in streams:
            self.assertIsNone(item["pid"])
            self.assertFalse(item["living"])
            self.assertIsNone(item["returncode"])
            self.assertEqual(
                item["command"],
                build_push_command(item["sample"], item["url"]),
            )
            self.assertEqual(item["stream_key"], f"{CONTEST_ID}_loadtest_0000_{item['kind']}")
            self.assertEqual(
                item["url"],
                f"rtmp://10.1.235.155:1935/live-record/{item['stream_key']}",
            )

    def test_screen_only_plans_one_stream_per_student(self) -> None:
        plane = RtmpPlane(_config(camera=False, students=3))
        plane.start()
        snap = plane.snapshot()
        self.assertEqual(snap["planned"], 3)
        self.assertEqual([item["kind"] for item in snap["streams"]], ["screen", "screen", "screen"])

    def test_camera_only_plans_one_stream_per_student(self) -> None:
        plane = RtmpPlane(_config(screen=False, students=2))
        plane.start()
        snap = plane.snapshot()
        self.assertEqual(snap["planned"], 2)
        self.assertEqual([item["kind"] for item in snap["streams"]], ["camera", "camera"])

    def test_stop_is_safe_and_keeps_living_zero(self) -> None:
        plane = RtmpPlane(_config())
        plane.stop()
        plane.start()
        with patch("rtmp.os.killpg") as killpg:
            plane.stop()
            killpg.assert_not_called()
        self.assertEqual(plane.living(), 0)

    def test_start_twice_fail_fast(self) -> None:
        plane = RtmpPlane(_config())
        plane.start()
        with self.assertRaises(RuntimeError):
            plane.start()

    def test_assert_ready_runs_in_start(self) -> None:
        plane = RtmpPlane(
            _config(
                contest_id=CONTEST_ID,
                allow_contest_ids=frozenset(),
            )
        )
        with self.assertRaises(safety.SafetyError):
            plane.start()
        self.assertFalse(plane.snapshot()["started"])

    def test_require_stream_key_runs_in_start(self) -> None:
        plane = RtmpPlane(_config())
        with patch("rtmp.safety.require_stream_key", wraps=safety.require_stream_key) as require_key:
            plane.start()
        self.assertGreaterEqual(require_key.call_count, 4)
        require_key.assert_any_call(f"{CONTEST_ID}_loadtest_0000_screen")
        require_key.assert_any_call(f"{CONTEST_ID}_loadtest_0001_camera")
        with patch("rtmp.safety.require_stream_key", side_effect=safety.SafetyError("bad key")):
            with self.assertRaises(safety.SafetyError):
                RtmpPlane(_config()).start()

    def test_non_dry_run_missing_samples_tells_user_to_prepare(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(
                _config(
                    dry_run=False,
                    confirm="LOADTEST",
                    sample_dir=Path(tmp),
                    students=1,
                )
            )
            with patch("rtmp.subprocess.Popen") as popen:
                with self.assertRaises(FileNotFoundError) as ctx:
                    plane.start()
                popen.assert_not_called()
            self.assertIn("prepare-samples", str(ctx.exception))
            self.assertFalse(plane.snapshot()["started"])

    def test_non_dry_run_popen_uses_start_new_session(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)
            (sample_dir / "screen.flv").write_bytes(b"flv")
            (sample_dir / "camera.flv").write_bytes(b"flv")
            plane = RtmpPlane(
                _config(
                    dry_run=False,
                    confirm="LOADTEST",
                    sample_dir=sample_dir,
                    students=1,
                )
            )
            fake = MagicMock()
            fake.poll.return_value = None
            fake.pid = 4242
            with patch("rtmp.subprocess.Popen", return_value=fake) as popen:
                plane.start()
            self.assertEqual(popen.call_count, 2)
            for call in popen.call_args_list:
                self.assertTrue(call.kwargs["start_new_session"])
                argv = call.args[0]
                self.assertEqual(argv[0], "ffmpeg")
                self.assertEqual(argv[-2:], ["flv", argv[-1]])
            self.assertEqual(plane.living(), 2)

    def test_stop_sigterm_then_sigkill_process_group(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)
            (sample_dir / "screen.flv").write_bytes(b"flv")
            plane = RtmpPlane(
                _config(
                    dry_run=False,
                    confirm="LOADTEST",
                    sample_dir=sample_dir,
                    students=1,
                    camera=False,
                )
            )
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
            with patch("rtmp.subprocess.Popen", return_value=proc), patch(
                "rtmp.os.killpg", side_effect=killpg
            ) as killpg_mock, patch("rtmp.os.getpgid", side_effect=lambda pid: pid):
                plane.start()
                result = plane.stop()
                again = plane.stop()
            self.assertEqual(result["signaled"], 1)
            self.assertEqual(result["killed"], 1)
            self.assertEqual(result["living"], 0)
            self.assertEqual(again["already_dead"], 1)
            self.assertEqual(again["signaled"], 0)
            self.assertEqual([call.args[1] for call in killpg_mock.call_args_list], [signal.SIGTERM, signal.SIGKILL])
            self.assertEqual(plane.living(), 0)

    def test_start_popen_failure_reaps_via_stop_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_live_config(Path(tmp), students=2, camera=False))
            alive = {"value": True}
            first = _alive_proc(1111, alive)
            sigs: list[tuple[int, int]] = []

            def killpg(pgid: int, sig: int) -> None:
                sigs.append((pgid, sig))
                alive["value"] = False
                first.returncode = 0

            with patch(
                "rtmp.subprocess.Popen", side_effect=[first, OSError("spawn failed")]
            ), patch("rtmp.os.killpg", side_effect=killpg), patch(
                "rtmp.os.getpgid", side_effect=lambda pid: pid
            ), patch("rtmp.os.kill") as kill_mock:
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
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_live_config(Path(tmp), students=2, camera=False))
            alive = {"value": True}
            first = _alive_proc(2222, alive)
            with patch(
                "rtmp.subprocess.Popen", side_effect=[first, OSError("spawn failed")]
            ), patch("rtmp.os.killpg"), patch(
                "rtmp.os.getpgid", side_effect=lambda pid: pid
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    plane.start()
            self.assertIsInstance(ctx.exception.__cause__, OSError)
            self.assertTrue(plane.snapshot()["started"])
            self.assertEqual(plane.living(), 1)
            with patch("rtmp.os.killpg") as killpg, patch(
                "rtmp.os.getpgid", side_effect=lambda pid: pid
            ):
                with self.assertRaises(RuntimeError):
                    plane.stop()
                self.assertTrue(killpg.called)
            self.assertEqual(plane.living(), 1)

    def test_start_raises_if_all_ffmpeg_die_immediately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_live_config(Path(tmp)))
            dead = MagicMock()
            dead.pid = 7
            dead.poll.return_value = 1
            with patch("rtmp.subprocess.Popen", return_value=dead) as popen:
                with self.assertRaises(RuntimeError) as ctx:
                    plane.start()
            popen.assert_called()
            msg = str(ctx.exception).lower()
            self.assertIn("died", msg)
            self.assertIn("stderr", msg)
            self.assertEqual(plane.living(), 0)

    def test_stop_sigkill_timeout_continues_then_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_live_config(Path(tmp), students=2, camera=False))
            alive = {"a": True, "b": True}
            proc_a = _alive_proc(11, alive, "a")
            proc_b = _alive_proc(22, alive, "b")
            sigs: list[tuple[int, int]] = []

            def killpg(pgid: int, sig: int) -> None:
                sigs.append((pgid, sig))

            with patch("rtmp.subprocess.Popen", side_effect=[proc_a, proc_b]), patch(
                "rtmp.os.killpg", side_effect=killpg
            ), patch("rtmp.os.getpgid", side_effect=lambda pid: pid):
                plane.start()
                with self.assertRaises(RuntimeError) as ctx:
                    plane.stop()
            self.assertIn("pid=11", str(ctx.exception))
            self.assertIn("pid=22", str(ctx.exception))
            self.assertEqual(
                sigs,
                [
                    (11, signal.SIGTERM),
                    (22, signal.SIGTERM),
                    (11, signal.SIGKILL),
                    (22, signal.SIGKILL),
                ],
            )
            self.assertEqual(plane.living(), 2)

    def test_stop_signals_pid_when_not_session_leader(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            plane = RtmpPlane(_live_config(Path(tmp)))
            alive = {"value": True}
            proc = _alive_proc(4242, alive)

            def kill(pid: int, sig: int) -> None:
                self.assertEqual(pid, 4242)
                if sig == signal.SIGTERM:
                    alive["value"] = False
                    proc.returncode = 0

            with patch("rtmp.subprocess.Popen", return_value=proc), patch(
                "rtmp.os.getpgid", return_value=99
            ), patch("rtmp.os.kill", side_effect=kill) as kill_mock, patch(
                "rtmp.os.killpg"
            ) as killpg_mock:
                plane.start()
                result = plane.stop()
            killpg_mock.assert_not_called()
            self.assertEqual(
                [call.args[1] for call in kill_mock.call_args_list], [signal.SIGTERM]
            )
            self.assertEqual(result["signaled"], 1)
            self.assertEqual(result["living"], 0)


if __name__ == "__main__":
    unittest.main()

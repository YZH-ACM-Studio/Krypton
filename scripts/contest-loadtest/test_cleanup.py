"""Cleanup tests: stop RTMP, never network-lock, never unmatched ffmpeg."""

from __future__ import annotations

import io
import json
import os
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from config import LoadtestConfig
from cleanup import kill_stray_ffmpeg, matching_ffmpeg_pids, stop_run
from safety import SafetyError

CONTEST_ID = "c1eac1000000000000000001"
OTHER_CONTEST_ID = "c1eac1000000000000000002"


def _config(**kwargs) -> LoadtestConfig:
    kwargs.setdefault("dry_run", True)
    return LoadtestConfig(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="LOADTEST",
        **kwargs,
    )


def _ps_line(pid: int, cmdline: str) -> str:
    return f"{pid:>5} {cmdline}"


def _match_cmd(contest_id: str = CONTEST_ID) -> str:
    return (
        f"/usr/bin/ffmpeg -re -i screen.flv -c copy "
        f"rtmp://10.1.235.155:1935/live-record/{contest_id}_loadtest_0001_screen"
    )


class _FakeRtmp:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def stop(self) -> dict:
        self.calls.append("stop")
        return {"ffmpeg_groups": 2}

    def apply(self) -> None:
        self.calls.append("apply")
        raise AssertionError("cleanup must not call rtmp_plane.apply")


class _FakeHttp:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def stop(self) -> str:
        self.calls.append("stop")
        return "http-stopped"

    def apply(self) -> None:
        self.calls.append("apply")
        raise AssertionError("cleanup must not call http_plane.apply")

    def stop_network_lock(self) -> None:
        self.calls.append("stop_network_lock")
        raise AssertionError("cleanup must not call network-lock stop")

    def apply_network_policy(self) -> None:
        self.calls.append("apply_network_policy")
        raise AssertionError("cleanup must not call network-lock apply")


class _BoomRtmp:
    def stop(self) -> None:
        raise RuntimeError("ffmpeg wait failed")


class KillStrayFfmpegTests(unittest.TestCase):
    def test_refuses_invalid_contest_id_before_ps(self) -> None:
        config = LoadtestConfig(
            contest_id="not-a-contest-id",
            allow_contest_ids=frozenset({"aaaaaaaaaaaaaaaaaaaaaaaa"}),
            confirm="LOADTEST",
            dry_run=True,
        )
        with patch("cleanup.subprocess.run") as run:
            with self.assertRaises(SafetyError):
                kill_stray_ffmpeg(config)
            run.assert_not_called()

    def test_dry_run_counts_matching_ffmpeg_without_kill(self) -> None:
        stdout = "\n".join(
            [
                _ps_line(80, "/usr/bin/ffmpeg -i in rtmp://host/live/other"),
                _ps_line(81, _match_cmd()),
                _ps_line(82, _match_cmd()),
            ]
        )
        completed = subprocess.CompletedProcess(
            args=("ps",), returncode=0, stdout=stdout, stderr=""
        )
        with patch("cleanup.subprocess.run", return_value=completed):
            with patch("cleanup.os.killpg") as killpg:
                with patch("cleanup.os.kill") as kill:
                    count = kill_stray_ffmpeg(_config(dry_run=True))
        self.assertEqual(count, 2)
        killpg.assert_not_called()
        kill.assert_not_called()

    def test_never_kills_unmatched_ffmpeg_or_non_ffmpeg(self) -> None:
        stdout = "\n".join(
            [
                _ps_line(200, "/usr/bin/ffmpeg -i in rtmp://host/live/unrelated"),
                _ps_line(
                    201,
                    f"/usr/bin/ffmpeg -i in rtmp://host/live/{CONTEST_ID}_student_screen",
                ),
                _ps_line(
                    202,
                    f"/usr/bin/ffmpeg -i in file.flv {CONTEST_ID} loadtest_",
                ),
                _ps_line(
                    203,
                    f"/usr/bin/python loadtest.py rtmp://host {CONTEST_ID} loadtest_",
                ),
                _ps_line(
                    206,
                    f"/usr/bin/ffmpeg -i in rtmp://host/live/{CONTEST_ID} other loadtest_0001_screen",
                ),
                _ps_line(
                    207,
                    f"/usr/bin/ffmpeg -i in rtmp://host/live/{CONTEST_ID}_student_loadtest_0001_screen",
                ),
                _ps_line(
                    204,
                    f"/usr/bin/ffmpeg -i in rtmp://host/live/{OTHER_CONTEST_ID}_loadtest_0001_screen",
                ),
                _ps_line(205, _match_cmd()),
            ]
        )
        completed = subprocess.CompletedProcess(
            args=("ps",), returncode=0, stdout=stdout, stderr=""
        )
        signaled: list[int] = []

        def _getpgid(pid: int) -> int:
            return pid

        def _killpg(pgid: int, sig: int) -> None:
            signaled.append(pgid)
            self.assertEqual(sig, signal.SIGTERM)

        with patch("cleanup.subprocess.run", return_value=completed):
            with patch("cleanup.os.getpgid", side_effect=_getpgid):
                with patch("cleanup.os.getpgrp", return_value=1):
                    with patch("cleanup.os.killpg", side_effect=_killpg):
                        with patch("cleanup.os.kill") as kill:
                            count = kill_stray_ffmpeg(_config(dry_run=False))
        self.assertEqual(count, 1)
        self.assertEqual(signaled, [205])
        kill.assert_not_called()

    def test_matching_helper_requires_contiguous_loadtest_marker(self) -> None:
        stdout = "\n".join(
            [
                _ps_line(9, "/bin/sleep 10"),
                _ps_line(
                    11,
                    f"/usr/bin/ffmpeg -i in rtmp://host/live/{CONTEST_ID} loadtest_0001_screen",
                ),
                _ps_line(10, _match_cmd()),
            ]
        )
        completed = subprocess.CompletedProcess(
            args=("ps",), returncode=0, stdout=stdout, stderr=""
        )
        with patch("cleanup.subprocess.run", return_value=completed):
            self.assertEqual(matching_ffmpeg_pids(CONTEST_ID), [10])

    def test_ps_command_uses_wide_args(self) -> None:
        completed = subprocess.CompletedProcess(
            args=("ps",), returncode=0, stdout="", stderr=""
        )
        with patch("cleanup.subprocess.run", return_value=completed) as run:
            matching_ffmpeg_pids(CONTEST_ID)
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0], ("ps", "-axww", "-o", "pid=,args="))

    def test_signals_pid_when_not_session_leader(self) -> None:
        stdout = "\n".join(
            [
                _ps_line(301, _match_cmd()),
                _ps_line(302, _match_cmd()),
            ]
        )
        completed = subprocess.CompletedProcess(
            args=("ps",), returncode=0, stdout=stdout, stderr=""
        )
        killed: list[int] = []

        def _getpgid(pid: int) -> int:
            return 50

        def _kill(pid: int, sig: int) -> None:
            killed.append(pid)
            self.assertEqual(sig, signal.SIGTERM)

        with patch("cleanup.subprocess.run", return_value=completed):
            with patch("cleanup.os.getpgid", side_effect=_getpgid):
                with patch("cleanup.os.killpg") as killpg:
                    with patch("cleanup.os.kill", side_effect=_kill):
                        count = kill_stray_ffmpeg(_config(dry_run=False))
        self.assertEqual(count, 2)
        self.assertEqual(killed, [301, 302])
        killpg.assert_not_called()


@unittest.skipUnless(os.name == "posix", "Unix only")
class KillStrayFfmpegSpawnTests(unittest.TestCase):
    def _write_fake_ffmpeg(self, directory: Path) -> Path:
        script = directory / "ffmpeg"
        script.write_text("#!/bin/sh\n/bin/sleep 120\n", encoding="utf-8")
        script.chmod(script.stat().st_mode | stat.S_IXUSR)
        return script

    def _spawn(self, ffmpeg: Path, url: str) -> subprocess.Popen:
        proc = subprocess.Popen(
            [str(ffmpeg), "-re", "-i", "screen.flv", "-c", "copy", url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        self.addCleanup(self._reap, proc)
        return proc

    def _reap(self, proc: subprocess.Popen) -> None:
        if proc.poll() is not None:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)

    def _url(self, contest_id: str) -> str:
        return (
            f"rtmp://127.0.0.1:1935/live-record/"
            f"{contest_id}_loadtest_0099_camera"
        )

    def _wait_listed(self, proc: subprocess.Popen, contest_id: str) -> None:
        deadline = time.time() + 5
        while time.time() < deadline:
            if proc.poll() is not None:
                raise AssertionError(f"fake ffmpeg exited early: {proc.returncode}")
            if proc.pid in matching_ffmpeg_pids(contest_id):
                return
            time.sleep(0.05)
        raise AssertionError(f"pid {proc.pid} never appeared in ps for {contest_id}")

    def test_live_kill_only_matching_spawned_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ffmpeg = self._write_fake_ffmpeg(Path(tmp))
            matching = self._spawn(ffmpeg, self._url(CONTEST_ID))
            unmatched = self._spawn(ffmpeg, self._url(OTHER_CONTEST_ID))
            self._wait_listed(matching, CONTEST_ID)
            self._wait_listed(unmatched, OTHER_CONTEST_ID)
            killed = kill_stray_ffmpeg(_config(dry_run=False))
            self.assertGreaterEqual(killed, 1)
            matching.wait(timeout=5)
            self.assertIsNotNone(matching.poll())
            self.assertIsNone(unmatched.poll())


class StopRunTests(unittest.TestCase):
    def test_refuses_invalid_contest_id(self) -> None:
        config = LoadtestConfig(
            contest_id="bad",
            allow_contest_ids=frozenset({"aaaaaaaaaaaaaaaaaaaaaaaa"}),
            confirm="LOADTEST",
            dry_run=True,
        )
        rtmp = _FakeRtmp()
        with self.assertRaises(SafetyError):
            stop_run(config=config, rtmp_plane=rtmp)
        self.assertEqual(rtmp.calls, [])

    def test_stops_rtmp_then_http_and_skips_network_lock(self) -> None:
        order: list[str] = []
        rtmp = _FakeRtmp()
        http = _FakeHttp()
        orig_rtmp_stop = rtmp.stop
        orig_http_stop = http.stop

        def rtmp_stop() -> dict:
            order.append("rtmp")
            return orig_rtmp_stop()

        def http_stop() -> str:
            order.append("http")
            return orig_http_stop()

        rtmp.stop = rtmp_stop  # type: ignore[method-assign]
        http.stop = http_stop  # type: ignore[method-assign]
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(report_dir=Path(tmp), dry_run=True)
            with patch("cleanup.kill_stray_ffmpeg", return_value=0) as stray:
                buf = io.StringIO()
                with redirect_stdout(buf):
                    report = stop_run(
                        config=config, rtmp_plane=rtmp, http_plane=http
                    )
                stray.assert_called_once_with(config)
        self.assertEqual(order, ["rtmp", "http"])
        self.assertEqual(rtmp.calls, ["stop"])
        self.assertEqual(http.calls, ["stop"])
        self.assertTrue(report["rtmp_plane_stopped"])
        self.assertTrue(report["http_plane_stopped"])
        self.assertFalse(report["network_lock_touched"])
        self.assertEqual(report["rtmp_stop_result"], {"ffmpeg_groups": 2})
        self.assertIn("P4.6", buf.getvalue())
        self.assertIn(CONTEST_ID, buf.getvalue())
        self.assertIn("TTL", buf.getvalue())

    def test_writes_cleanup_report_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_dir = Path(tmp)
            config = _config(report_dir=report_dir, dry_run=True)
            with patch("cleanup.kill_stray_ffmpeg", return_value=3):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    report = stop_run(config=config, rtmp_plane=_FakeRtmp())
            path = Path(report["report_path"])
            self.assertTrue(path.is_file())
            self.assertEqual(path.parent, report_dir)
            self.assertTrue(path.name.startswith(f"cleanup-{CONTEST_ID}-"))
            self.assertTrue(path.name.endswith(".json"))
            data = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(data["contest_id"], CONTEST_ID)
            self.assertTrue(data["dry_run"])
            self.assertFalse(data["network_lock_touched"])
            self.assertEqual(data["stray_ffmpeg_matched"], 3)
            self.assertEqual(data["stray_ffmpeg_killed"], 0)
            self.assertIn("P4.6", data["vigil_recording_reminder"])
            self.assertEqual(data["errors"], [])
            self.assertEqual(data["report_path"], str(path))

    def test_rtmp_stop_failure_still_writes_report_then_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(report_dir=Path(tmp), dry_run=True)
            http = _FakeHttp()
            with patch("cleanup.kill_stray_ffmpeg", return_value=0):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    with self.assertRaises(RuntimeError) as ctx:
                        stop_run(
                            config=config,
                            rtmp_plane=_BoomRtmp(),
                            http_plane=http,
                        )
            self.assertEqual(http.calls, ["stop"])
            self.assertIn("P4.6", buf.getvalue())
            self.assertIn("cleanup incomplete", str(ctx.exception))
            reports = list(Path(tmp).glob("cleanup-*.json"))
            self.assertEqual(len(reports), 1)
            data = json.loads(reports[0].read_text(encoding="utf-8"))
            self.assertFalse(data["rtmp_plane_stopped"])
            self.assertTrue(data["http_plane_stopped"])
            self.assertFalse(data["network_lock_touched"])
            self.assertTrue(data["errors"])
            self.assertIn("ffmpeg wait failed", data["errors"][0])

    def test_http_plane_without_stop_does_not_fail_or_call_apply(self) -> None:
        class HttpNoStop:
            def apply(self) -> None:
                raise AssertionError("cleanup must not call http_plane.apply")

            def stop_network_lock(self) -> None:
                raise AssertionError("cleanup must not call network-lock stop")

        with tempfile.TemporaryDirectory() as tmp:
            config = _config(report_dir=Path(tmp), dry_run=True)
            with patch("cleanup.kill_stray_ffmpeg", return_value=0):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    report = stop_run(config=config, http_plane=HttpNoStop())
            self.assertTrue(report["http_plane_provided"])
            self.assertFalse(report["http_plane_stopped"])
            self.assertFalse(report["network_lock_touched"])
            self.assertEqual(report["errors"], [])
            self.assertIn("P4.6", buf.getvalue())

    def test_none_planes_still_print_reminder_and_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = _config(report_dir=Path(tmp), dry_run=True)
            with patch("cleanup.kill_stray_ffmpeg", return_value=0):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    report = stop_run(config=config)
            self.assertFalse(report["rtmp_plane_provided"])
            self.assertFalse(report["http_plane_provided"])
            self.assertFalse(report["network_lock_touched"])
            self.assertIn("删除整场录像", buf.getvalue())
            self.assertTrue(Path(report["report_path"]).is_file())


if __name__ == "__main__":
    unittest.main()

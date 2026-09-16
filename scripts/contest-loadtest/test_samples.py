"""Command-shape tests for contest load-test sample clips."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from config import CAMERA_BITRATE_KBPS, LoadtestConfig, SCREEN_BITRATE_KBPS  # noqa: E402
from samples import (  # noqa: E402
    _report_encoded_clip,
    build_camera_cmd,
    build_screen_cmd,
    prepare_samples,
)

_CONTEST = "0" * 24


def _joined(cmd: list[str]) -> str:
    return " ".join(cmd)


def _config(*, sample_dir: Path, dry_run: bool = True, ffmpeg: str = "ffmpeg") -> LoadtestConfig:
    return LoadtestConfig(
        contest_id=_CONTEST,
        allow_contest_ids=frozenset({_CONTEST}),
        confirm="LOADTEST",
        dry_run=dry_run,
        sample_dir=sample_dir,
        ffmpeg=ffmpeg,
    )


class SampleCommandTests(unittest.TestCase):
    def test_screen_cmd_matches_client_encoder(self) -> None:
        cmd = build_screen_cmd("ffmpeg", "/tmp/screen.flv")
        joined = _joined(cmd)
        self.assertIn("2500k", joined)
        self.assertIn("5000k", joined)
        self.assertIn("libx264", joined)
        self.assertIn("ultrafast", joined)
        self.assertIn("zerolatency", joined)
        self.assertIn("baseline", joined)
        self.assertIn("yuv420p", joined)
        self.assertIn("testsrc2=size=1920x1080:rate=15", joined)
        self.assertIn("-an", cmd)
        self.assertEqual(cmd[cmd.index("-b:v") + 1], "2500k")
        self.assertEqual(cmd[cmd.index("-minrate") + 1], "2500k")
        self.assertEqual(cmd[cmd.index("-maxrate") + 1], "2500k")
        self.assertEqual(cmd[cmd.index("-g") + 1], "15")
        self.assertEqual(cmd[cmd.index("-keyint_min") + 1], "15")
        self.assertNotIn("rtmp://", joined)
        self.assertNotIn("aac", joined)
        self.assertTrue(joined.endswith("/tmp/screen.flv"))

    def test_camera_cmd_matches_client_encoder(self) -> None:
        cmd = build_camera_cmd("ffmpeg", "/tmp/camera.flv")
        joined = _joined(cmd)
        self.assertIn("2000k", joined)
        self.assertIn("4000k", joined)
        self.assertIn("libx264", joined)
        self.assertIn("ultrafast", joined)
        self.assertIn("zerolatency", joined)
        self.assertIn("baseline", joined)
        self.assertIn("yuv420p", joined)
        self.assertIn("aac", joined)
        self.assertIn("64k", joined)
        self.assertIn("44100", joined)
        self.assertIn("testsrc2=size=1920x1080:rate=15", joined)
        self.assertIn("sine=frequency=440:sample_rate=44100", joined)
        self.assertEqual(cmd[cmd.index("-b:v") + 1], "2000k")
        self.assertEqual(cmd[cmd.index("-minrate") + 1], "2000k")
        self.assertEqual(cmd[cmd.index("-maxrate") + 1], "2000k")
        self.assertEqual(cmd[cmd.index("-g") + 1], "15")
        self.assertNotIn("rtmp://", joined)
        self.assertNotIn("2500k", joined)
        self.assertTrue(joined.endswith("/tmp/camera.flv"))

    def test_commands_together_cover_required_tokens(self) -> None:
        screen = _joined(build_screen_cmd("ffmpeg", "screen.flv"))
        camera = _joined(build_camera_cmd("ffmpeg", "camera.flv"))
        combined = f"{screen} {camera}"
        for token in ("2500k", "2000k", "libx264", "ultrafast", "baseline", "yuv420p", "aac"):
            self.assertIn(token, combined)
        self.assertNotIn("rtmp://", combined)

    def test_refuses_rtmp_output(self) -> None:
        with self.assertRaises(RuntimeError):
            build_screen_cmd("ffmpeg", "rtmp://10.1.235.155:1935/live-record/x_screen")
        with self.assertRaises(RuntimeError):
            build_camera_cmd("ffmpeg", "rtmp://example/live-nodvr/x_camera")

    def test_prepare_samples_dry_run_does_not_need_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)
            result = prepare_samples(
                _config(sample_dir=sample_dir, dry_run=True, ffmpeg="/no/such/ffmpeg-binary"),
                duration_s=30,
            )
            self.assertTrue(sample_dir.is_dir())
            self.assertFalse(result["screen_sample"].exists())
            self.assertFalse(result["camera_sample"].exists())
            self.assertIn("2500k", result["screen_cmd"])
            self.assertIn("2000k", result["camera_cmd"])
            self.assertIn("aac", result["camera_cmd"])
            self.assertNotIn("rtmp://", _joined(result["screen_cmd"]))
            self.assertNotIn("rtmp://", _joined(result["camera_cmd"]))

    def test_missing_ffmpeg_raises_unless_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)
            with self.assertRaises(RuntimeError):
                prepare_samples(
                    _config(
                        sample_dir=sample_dir,
                        dry_run=False,
                        ffmpeg="/no/such/ffmpeg-binary",
                    )
                )

    def test_report_logs_size_and_bits_per_s(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "screen.flv"
            path.write_bytes(b"x" * 10_000_000)
            with self.assertLogs("contest-loadtest.samples", level="INFO") as cm:
                _report_encoded_clip(
                    kind="screen",
                    path=path,
                    duration_s=30.0,
                    target_kbps=SCREEN_BITRATE_KBPS,
                )
        joined = "\n".join(cm.output)
        self.assertIn("size_bytes=10000000", joined)
        self.assertIn("bits/s=", joined)
        self.assertFalse(any("WARNING" in line for line in cm.output))

    def test_report_warns_on_undershoot_but_does_not_raise(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "camera.flv"
            path.write_bytes(b"x" * 1000)
            with self.assertLogs("contest-loadtest.samples", level="WARNING") as cm:
                _report_encoded_clip(
                    kind="camera",
                    path=path,
                    duration_s=30.0,
                    target_kbps=CAMERA_BITRATE_KBPS,
                )
        joined = "\n".join(cm.output)
        self.assertIn("undershoots", joined)
        self.assertIn("under-load SRS", joined)

    def test_prepare_samples_skips_report_without_ffprobe(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)

            def fake_run(cmd: list[str], out_path: Path) -> None:
                out_path.write_bytes(b"flv")

            with patch("samples._require_ffmpeg"), patch(
                "samples._run_ffmpeg", side_effect=fake_run
            ), patch("samples._ffprobe_binary", return_value=None), patch(
                "samples._report_encoded_clip"
            ) as report:
                result = prepare_samples(
                    _config(sample_dir=sample_dir, dry_run=False),
                    duration_s=30,
                )
            report.assert_not_called()
            self.assertTrue(result["screen_sample"].is_file())
            self.assertTrue(result["camera_sample"].is_file())

    def test_prepare_samples_undershoot_logs_warning_and_returns(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            sample_dir = Path(tmp)

            def fake_run(cmd: list[str], out_path: Path) -> None:
                out_path.write_bytes(b"x" * 500)

            with patch("samples._require_ffmpeg"), patch(
                "samples._run_ffmpeg", side_effect=fake_run
            ), patch("samples._ffprobe_binary", return_value="/usr/bin/ffprobe"):
                with self.assertLogs("contest-loadtest.samples", level="WARNING") as cm:
                    result = prepare_samples(
                        _config(sample_dir=sample_dir, dry_run=False),
                        duration_s=30,
                    )
            self.assertTrue(result["screen_sample"].is_file())
            self.assertTrue(result["camera_sample"].is_file())
            self.assertTrue(any("under-load SRS" in line for line in cm.output))


if __name__ == "__main__":
    unittest.main()

"""CLI parsing for loadtest.py. Subprocess only; no network."""

from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLI = "loadtest.py"
CONTEST_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"
SUBCOMMANDS = (
    "prepare-samples",
    "dry-run",
    "rtmp",
    "http",
    "ramp",
    "stop",
    "burst",
    "viewers",
    "screenshots",
    "all",
    "metrics",
)
# Listed in top-level --help only once the parser wires them.
OPTIONAL_WIRED = ("heartbeat",)


def _run(*args: str, timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", CLI, *args],
        cwd=HERE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
    )


def _help_commands(help_text: str) -> set[str]:
    match = re.search(r"\{([^}]+)\}", help_text)
    if not match:
        return set()
    return {part.strip() for part in match.group(1).split(",") if part.strip()}


def _subcommand_wired(name: str) -> bool:
    result = _run(name, "--help")
    combined = f"{result.stdout}\n{result.stderr}"
    if "invalid choice" in combined:
        return False
    return result.returncode == 0


class LoadtestCliTests(unittest.TestCase):
    def test_help_lists_subcommands(self) -> None:
        result = _run("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        help_text = f"{result.stdout}\n{result.stderr}"
        for name in SUBCOMMANDS:
            self.assertIn(name, help_text)
        wired = _help_commands(help_text)
        for name in OPTIONAL_WIRED:
            if name in wired or _subcommand_wired(name):
                self.assertIn(name, help_text)

    def test_allow_contest_id_required(self) -> None:
        result = _run(
            "dry-run",
            "--contest-id",
            CONTEST_ID,
            "--students",
            "1",
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("allow-contest-id", f"{result.stdout}\n{result.stderr}")

    def test_dry_run_succeeds_without_confirm(self) -> None:
        result = _run(
            "dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "1",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertTrue("Mbps" in combined or "kbps" in combined, combined)

    def test_dry_run_prints_mbps_and_one_ffmpeg_command(self) -> None:
        result = _run(
            "dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "30",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        # 30 * (2500 screen + 2000 camera + 64 AAC) / 1000
        self.assertIn("136.92 Mbps", result.stdout)
        self.assertIn("example ffmpeg argv:", result.stdout)
        self.assertIn("-re", result.stdout)
        self.assertIn("-c copy", result.stdout)

    def test_dry_run_normalizes_uppercase_contest_id_into_stream_key(self) -> None:
        upper = CONTEST_ID.upper()
        result = _run(
            "dry-run",
            "--contest-id",
            upper,
            "--allow-contest-id",
            upper,
            "--students",
            "1",
            "--no-camera",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"{CONTEST_ID}_loadtest_0000_screen", result.stdout)
        self.assertNotIn(upper, result.stdout)

    def test_rtmp_without_confirm_exits_2(self) -> None:
        result = _run(
            "rtmp",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "1",
            "--duration",
            "1",
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertTrue(
            "confirm" in combined.lower() or "LOADTEST" in combined,
            combined,
        )

    def test_http_without_confirm_exits_2(self) -> None:
        result = _run(
            "http",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--users-file",
            "users.example.csv",
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertTrue(
            "confirm" in combined.lower() or "LOADTEST" in combined,
            combined,
        )

    def test_stop_without_confirm_lists_without_killing(self) -> None:
        result = _run(
            "stop",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertIn("matching", combined)
        self.assertNotIn("signaled", combined)

    def test_burst_without_confirm_exits_2(self) -> None:
        result = _run(
            "burst",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--users-file",
            "users.example.csv",
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertTrue(
            "confirm" in combined.lower() or "LOADTEST" in combined,
            combined,
        )

    def test_viewers_dry_run(self) -> None:
        result = _run(
            "viewers",
            "--dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "2",
            "--viewers",
            "1",
            "--viewer-streams",
            "2",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_screenshots_dry_run(self) -> None:
        result = _run(
            "screenshots",
            "--dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "1",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_all_without_confirm_exits_2(self) -> None:
        result = _run(
            "all",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "1",
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        combined = f"{result.stdout}\n{result.stderr}"
        self.assertTrue(
            "confirm" in combined.lower() or "LOADTEST" in combined,
            combined,
        )

    def test_metrics_dry_run(self) -> None:
        result = _run(
            "metrics",
            "--dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_all_dry_run_one_student(self) -> None:
        result = _run(
            "all",
            "--dry-run",
            "--contest-id",
            CONTEST_ID,
            "--allow-contest-id",
            CONTEST_ID,
            "--students",
            "1",
        )
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()

"""Fail-closed gates for the contest load-test harness."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import CONFIRM_TOKEN, LoadtestConfig
from safety import (
    SafetyError,
    assert_ready,
    load_denylist,
    normalize_contest_id,
    refuse_forbidden_url,
    require_allowed_contest,
    require_confirm,
    require_stream_key,
)

VALID_CONTEST_ID = "aabbccddeeff001122334455"
OTHER_CONTEST_ID = "0123456789abcdef01234567"
RTMP_RECORD_URL = (
    f"rtmp://10.1.235.155:1935/live-record/{VALID_CONTEST_ID}_loadtest_0001_screen"
)


class NormalizeContestIdTests(unittest.TestCase):
    def test_accepts_24_hex(self) -> None:
        self.assertEqual(normalize_contest_id(VALID_CONTEST_ID), VALID_CONTEST_ID)

    def test_lowercases_uppercase_hex(self) -> None:
        self.assertEqual(
            normalize_contest_id("AABBCCDDEEFF001122334455"),
            VALID_CONTEST_ID,
        )

    def test_lowercases_mixed_case_hex(self) -> None:
        self.assertEqual(
            normalize_contest_id("AaBbCcDdEeFf001122334455"),
            VALID_CONTEST_ID,
        )

    def test_rejects_short(self) -> None:
        with self.assertRaises(SafetyError):
            normalize_contest_id("aabbccddeeff00112233445")

    def test_rejects_non_hex(self) -> None:
        with self.assertRaises(SafetyError):
            normalize_contest_id("aabbccddeeff00112233445g")

    def test_rejects_uppercase_mixed_with_non_hex(self) -> None:
        with self.assertRaises(SafetyError):
            normalize_contest_id("AABBCCDDEEFF00112233445Z")


class RequireAllowedContestTests(unittest.TestCase):
    def test_rejects_id_not_in_allowlist(self) -> None:
        with self.assertRaises(SafetyError) as ctx:
            require_allowed_contest(VALID_CONTEST_ID, [OTHER_CONTEST_ID])
        self.assertIn("allow-contest-id", str(ctx.exception))

    def test_rejects_denylist_file_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            denylist = Path(tmp) / "denied-contests.txt"
            denylist.write_text(f"{VALID_CONTEST_ID}\n", encoding="utf-8")
            with patch.object(safety, "DENYLIST_PATH", denylist):
                with self.assertRaises(SafetyError) as ctx:
                    require_allowed_contest(VALID_CONTEST_ID, [VALID_CONTEST_ID])
                message = str(ctx.exception).lower()
                self.assertIn("denylist", message)
                self.assertIn(VALID_CONTEST_ID, message)


class RequireConfirmTests(unittest.TestCase):
    def test_dry_run_skips_token(self) -> None:
        require_confirm("", dry_run=True)
        require_confirm("nope", dry_run=True)

    def test_non_dry_run_requires_loadtest(self) -> None:
        with self.assertRaises(SafetyError):
            require_confirm("", dry_run=False)
        with self.assertRaises(SafetyError):
            require_confirm("loadtest", dry_run=False)
        require_confirm(CONFIRM_TOKEN, dry_run=False)


class RefuseForbiddenUrlTests(unittest.TestCase):
    def test_rejects_network_lock(self) -> None:
        with self.assertRaises(SafetyError):
            refuse_forbidden_url("http://10.1.234.2/d/system/network-lock/apply")

    def test_rejects_exam_network(self) -> None:
        with self.assertRaises(SafetyError):
            refuse_forbidden_url("http://10.1.234.2/admin/exam-network")

    def test_rejects_endpoint_registrations(self) -> None:
        with self.assertRaises(SafetyError):
            refuse_forbidden_url(
                "http://10.1.234.2/api/vigil/endpoint-registrations"
            )

    def test_rejects_recover(self) -> None:
        with self.assertRaises(SafetyError):
            refuse_forbidden_url("http://10.1.234.2/api/endpoints/recover")

    def test_allows_oj_login(self) -> None:
        url = "http://10.1.234.2/login"
        self.assertEqual(refuse_forbidden_url(url), url)

    def test_allows_rtmp_record_url(self) -> None:
        self.assertEqual(refuse_forbidden_url(RTMP_RECORD_URL), RTMP_RECORD_URL)


class LoadDenylistTests(unittest.TestCase):
    def test_junk_denylist_line_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            denylist = Path(tmp) / "denied-contests.txt"
            denylist.write_text("not-a-hex-id\n", encoding="utf-8")
            with patch.object(safety, "DENYLIST_PATH", denylist):
                with self.assertRaises(SafetyError) as ctx:
                    load_denylist()
                message = str(ctx.exception).lower()
                self.assertIn("denylist", message)
                self.assertIn("not-a-hex-id", message)


class RequireStreamKeyTests(unittest.TestCase):
    def test_accepts_loadtest_screen_key(self) -> None:
        key = f"{VALID_CONTEST_ID}_loadtest_0001_screen"
        self.assertEqual(require_stream_key(key), key)

    def test_rejects_real_client_machine_id(self) -> None:
        with self.assertRaises(SafetyError):
            require_stream_key(f"{VALID_CONTEST_ID}_m_deadbeef_screen")


class AssertReadyTests(unittest.TestCase):
    def test_assert_ready_on_loadtest_config(self) -> None:
        config = LoadtestConfig(
            contest_id=VALID_CONTEST_ID,
            allow_contest_ids=frozenset({VALID_CONTEST_ID}),
            confirm="",
            dry_run=True,
        )
        with tempfile.TemporaryDirectory() as tmp:
            denylist = Path(tmp) / "denied-contests.txt"
            with patch.object(safety, "DENYLIST_PATH", denylist):
                assert_ready(config)

    def test_live_assert_ready_empty_denylist_fails(self) -> None:
        config = LoadtestConfig(
            contest_id=VALID_CONTEST_ID,
            allow_contest_ids=frozenset({VALID_CONTEST_ID}),
            confirm=CONFIRM_TOKEN,
            dry_run=False,
        )
        with tempfile.TemporaryDirectory() as tmp:
            denylist = Path(tmp) / "denied-contests.txt"
            denylist.write_text("", encoding="utf-8")
            with patch.object(safety, "DENYLIST_PATH", denylist):
                with self.assertRaises(SafetyError) as ctx:
                    assert_ready(config)
                self.assertIn("denylist", str(ctx.exception).lower())


if __name__ == "__main__":
    unittest.main()

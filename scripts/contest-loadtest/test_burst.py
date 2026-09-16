"""Tests for the contest-start HTTP burst plane."""

from __future__ import annotations

import json
import tempfile
import unittest
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import safety
from burst import BURST_VERBS, BurstPlane, LIMITER_NOTE, percentile
from config import DEFAULT_BURST_CONCURRENCY, LoadtestConfig
from http_oj import HttpPlane

CONTEST_ID = "0123456789abcdef01234567"
DENIED_CONTEST_ID = "deadbeefdeadbeefdeadbeef"
OJ_BASE = "http://10.1.234.2"


def make_config(**kwargs) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="",
        oj_base=OJ_BASE,
        dry_run=True,
        pid=1001,
        lang="cc",
        code="int main(){return 0;}\n",
        login_stagger_s=2.2,
        invite_code="",
        xff_prefix="",
    )
    values.update(kwargs)
    return LoadtestConfig(**values)


def planned_urls(result: dict) -> list[str]:
    return [item["url"] for item in result["planned_requests"]]


def make_users(count: int) -> list[dict[str, str]]:
    return [{"uname": f"user{i}", "password": f"pw{i}"} for i in range(count)]


class BurstPlaneDryRunTest(unittest.TestCase):
    def setUp(self) -> None:
        self.users = [
            {"uname": "alice", "password": "secret"},
            {"uname": "bob", "password": "hunter2"},
        ]
        self.plane = BurstPlane(make_config())

    def test_dry_run_does_not_open_sockets(self) -> None:
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
            patch.object(HttpPlane, "_send", side_effect=AssertionError("_send")) as send,
            patch("burst.ThreadPoolExecutor", side_effect=AssertionError("executor")) as pool,
        ):
            result = self.plane.run(self.users)
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["ok"])
        sock.assert_not_called()
        conn.assert_not_called()
        urlopen.assert_not_called()
        send.assert_not_called()
        pool.assert_not_called()

    def test_dry_run_plans_scoreboard_and_submit(self) -> None:
        result = self.plane.run(self.users)
        urls = planned_urls(result)
        self.assertIn(f"{OJ_BASE}/contest/{CONTEST_ID}/scoreboard", urls)
        self.assertIn(f"{OJ_BASE}/p/1001/submit?tid={CONTEST_ID}", urls)
        self.assertIn(f"{OJ_BASE}/p/1001?tid={CONTEST_ID}", urls)
        kinds = [item["kind"] for item in result["planned_requests"]]
        self.assertEqual(kinds.count("scoreboard"), 2)
        self.assertEqual(kinds.count("submit"), 2)
        self.assertEqual(kinds.count("problem"), 2)
        burst = [item for item in result["planned_requests"] if item["phase"] == "burst"]
        self.assertEqual(
            [item["kind"] for item in burst[:3]],
            ["problem", "scoreboard", "submit"],
        )
        submit = next(item for item in result["planned_requests"] if item["kind"] == "submit")
        self.assertEqual(submit["method"], "POST")
        scoreboard = next(item for item in result["planned_requests"] if item["kind"] == "scoreboard")
        self.assertEqual(scoreboard["method"], "GET")

    def test_dry_run_plans_no_network_lock_urls(self) -> None:
        result = self.plane.run(self.users)
        blob = json.dumps(result)
        for snippet in safety.FORBIDDEN_URL_SNIPPETS:
            self.assertNotIn(snippet, blob.lower())
        for url in planned_urls(result):
            lowered = url.lower()
            self.assertNotIn("network-lock", lowered)
            self.assertNotIn("exam-network", lowered)
            self.assertNotIn("endpoint-registrations", lowered)
            self.assertNotIn("/register", lowered)
        for item in result["planned_requests"]:
            self.assertNotIn("Referer", item["headers"])
            self.assertNotIn("X-Forwarded-For", item["headers"])

    def test_dry_run_redacts_passwords(self) -> None:
        result = self.plane.run(self.users)
        serialized = json.dumps(result)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("hunter2", serialized)
        login = result["planned_requests"][0]
        self.assertEqual(login["form"]["password"], "***")
        self.assertEqual(login["form"]["uname"], "alice")
        self.assertIn("403", result["limiter_note"])
        self.assertEqual(result["limiter_note"], LIMITER_NOTE)

    def test_dry_run_refuses_network_lock_base(self) -> None:
        plane = BurstPlane(make_config(oj_base="http://10.1.234.2/network-lock/apply"))
        with self.assertRaises(safety.SafetyError):
            plane.run(self.users)

    def test_dry_run_refuses_exam_network_base(self) -> None:
        plane = BurstPlane(make_config(oj_base="http://10.1.234.2/exam-network"))
        with self.assertRaises(safety.SafetyError):
            plane.run(self.users)

    def test_concurrency_below_user_count_fails_without_sockets(self) -> None:
        plane = BurstPlane(make_config(burst_concurrency=1))
        with (
            patch.object(HttpPlane, "_send", side_effect=AssertionError("http")),
            patch("burst.ThreadPoolExecutor", side_effect=AssertionError("executor")),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run(self.users)
        message = str(ctx.exception)
        self.assertIn("burst_concurrency", message)
        self.assertIn("--concurrency", message)
        self.assertIn("user_count=2", message)

    def test_dry_run_pool_equals_user_count_not_configured_max(self) -> None:
        result = self.plane.run(self.users)
        self.assertEqual(result["burst_concurrency"], 2)
        self.assertEqual(result["user_count"], 2)

    def test_default_concurrency_allows_40_users(self) -> None:
        self.assertEqual(DEFAULT_BURST_CONCURRENCY, 40)
        plane = BurstPlane(make_config())
        result = plane.run(make_users(40))
        self.assertTrue(result["ok"])
        self.assertEqual(result["user_count"], 40)
        self.assertEqual(result["burst_concurrency"], 40)
        self.assertEqual(result["verbs"], list(BURST_VERBS))
        self.assertEqual(len([item for item in result["planned_requests"] if item["kind"] == "submit"]), 40)

    def test_default_concurrency_refuses_50_users_without_sockets(self) -> None:
        plane = BurstPlane(make_config())
        with (
            patch.object(HttpPlane, "_send", side_effect=AssertionError("http")),
            patch("burst.ThreadPoolExecutor", side_effect=AssertionError("executor")),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run(make_users(50))
        message = str(ctx.exception)
        self.assertIn("burst_concurrency=40", message)
        self.assertIn("user_count=50", message)
        self.assertIn("--concurrency", message)

    def test_zero_concurrency_has_no_32_cap(self) -> None:
        plane = BurstPlane(make_config(burst_concurrency=0))
        result = plane.run(make_users(50))
        self.assertTrue(result["ok"])
        self.assertEqual(result["burst_concurrency"], 50)
        self.assertEqual(result["user_count"], 50)

    def test_raised_concurrency_allows_50_users(self) -> None:
        plane = BurstPlane(make_config(burst_concurrency=50))
        result = plane.run(make_users(50))
        self.assertTrue(result["ok"])
        self.assertEqual(result["burst_concurrency"], 50)


class BurstPlaneLiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self._denylist_tmp = tempfile.TemporaryDirectory()
        denylist = Path(self._denylist_tmp.name) / "denied-contests.txt"
        denylist.write_text(f"{DENIED_CONTEST_ID}\n", encoding="utf-8")
        self._denylist_patcher = patch.object(safety, "DENYLIST_PATH", denylist)
        self._denylist_patcher.start()
        self.addCleanup(self._denylist_patcher.stop)
        self.addCleanup(self._denylist_tmp.cleanup)
        self.config = make_config(dry_run=False, confirm="LOADTEST", login_stagger_s=0)
        self.plane = BurstPlane(self.config)
        self.users = [
            {"uname": "alice", "password": "secret"},
            {"uname": "bob", "password": "hunter2"},
        ]
        self.captured: list[urllib.request.Request] = []

    def _response_for(self, request: urllib.request.Request) -> tuple[int, bytes, dict]:
        url = request.full_url
        method = request.get_method()
        if url.endswith("/login"):
            return 200, b'{"uid":1}', {}
        if url.endswith(f"/contest/{CONTEST_ID}") and method == "POST":
            return 200, b"{}", {}
        if url.endswith(f"/p/1001?tid={CONTEST_ID}"):
            return 200, b'{"pid":1001}', {}
        if url.endswith(f"/contest/{CONTEST_ID}/scoreboard"):
            return 200, b"{}", {}
        if "/submit?" in url:
            return 200, b'{"rid":"rec1"}', {}
        raise AssertionError(f"unexpected URL {url}")

    def test_live_pid_zero_raises_without_http(self) -> None:
        plane = BurstPlane(make_config(dry_run=False, confirm="LOADTEST", pid=0))
        with (
            patch.object(BurstPlane, "_send", side_effect=AssertionError("http")) as send,
            patch.object(BurstPlane, "_run_live", side_effect=AssertionError("live")) as live,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")),
            patch("burst.ThreadPoolExecutor", side_effect=AssertionError("executor")) as pool,
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run(self.users)
        send.assert_not_called()
        live.assert_not_called()
        pool.assert_not_called()
        message = str(ctx.exception)
        self.assertIn("/p/0", message)
        self.assertIn("pid", message.lower())

    def test_live_warmup_then_burst_urls(self) -> None:
        def fake_send(opener, request):
            self.captured.append(request)
            return self._response_for(request)

        with (
            patch.object(BurstPlane, "_send", side_effect=fake_send),
            patch("time.sleep", side_effect=AssertionError("sleep")) as sleep,
        ):
            result = self.plane.run(self.users)
        sleep.assert_not_called()
        self.assertTrue(result["ok"])
        self.assertFalse(result["dry_run"])
        self.assertNotIn("secret", json.dumps(result))
        self.assertNotIn("hunter2", json.dumps(result))

        warmup_urls = [req.full_url for req in self.captured[:4]]
        self.assertEqual(
            warmup_urls,
            [
                f"{OJ_BASE}/login",
                f"{OJ_BASE}/contest/{CONTEST_ID}",
                f"{OJ_BASE}/login",
                f"{OJ_BASE}/contest/{CONTEST_ID}",
            ],
        )
        burst_urls = [req.full_url for req in self.captured[4:]]
        self.assertEqual(len(burst_urls), 6)
        self.assertEqual(burst_urls.count(f"{OJ_BASE}/p/1001?tid={CONTEST_ID}"), 2)
        self.assertEqual(burst_urls.count(f"{OJ_BASE}/contest/{CONTEST_ID}/scoreboard"), 2)
        self.assertEqual(burst_urls.count(f"{OJ_BASE}/p/1001/submit?tid={CONTEST_ID}"), 2)
        for request in self.captured:
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertNotIn("referer", headers)
            self.assertFalse(request.has_header("Referer"))
            self.assertNotIn("x-forwarded-for", headers)
            lowered = request.full_url.lower()
            self.assertNotIn("network-lock", lowered)
            self.assertNotIn("exam-network", lowered)

        self.assertEqual(result["verbs"]["problem"]["count_2xx"], 2)
        self.assertEqual(result["verbs"]["scoreboard"]["count_2xx"], 2)
        self.assertEqual(result["verbs"]["submit"]["count_2xx"], 2)
        self.assertEqual(result["totals"]["count_403"], 0)
        self.assertIsNotNone(result["verbs"]["problem"]["p50_s"])
        self.assertIsNotNone(result["verbs"]["problem"]["p99_s"])

    def test_live_records_403_without_failing_the_harness(self) -> None:
        def fake_send(opener, request):
            if "/scoreboard" in request.full_url:
                return 403, b'{"error":"OpcountExceeded"}', {}
            if "/submit?" in request.full_url:
                return 500, b'{"error":"boom"}', {}
            return 200, b"{}", {}

        with patch.object(BurstPlane, "_send", side_effect=fake_send):
            result = self.plane.run(self.users)
        self.assertTrue(result["ok"])
        self.assertEqual(result["verbs"]["scoreboard"]["count_403"], 2)
        self.assertEqual(result["verbs"]["submit"]["count_5xx"], 2)
        self.assertEqual(result["totals"]["count_403"], 2)
        self.assertEqual(result["totals"]["count_5xx"], 2)

    def test_live_records_timeouts(self) -> None:
        def fake_send(opener, request):
            if request.full_url.endswith(f"/p/1001?tid={CONTEST_ID}"):
                raise RuntimeError("GET timed out") from TimeoutError("timed out")
            return 200, b"{}", {}

        with patch.object(BurstPlane, "_send", side_effect=fake_send):
            result = self.plane.run(self.users)
        self.assertTrue(result["ok"])
        self.assertEqual(result["verbs"]["problem"]["timeouts"], 2)
        self.assertEqual(result["totals"]["timeouts"], 2)
        self.assertEqual(result["verbs"]["problem"]["count_2xx"], 0)

    def test_live_pool_workers_equal_warmup_sessions_not_configured_max(self) -> None:
        users = [
            {"uname": "alice", "password": "secret"},
            {"uname": "bob", "password": "hunter2"},
            {"uname": "carol", "password": "failme"},
        ]
        captured: list[int] = []

        def fake_send(opener, request):
            data = request.data or b""
            if request.full_url.endswith("/login") and b"uname=carol" in data:
                raise RuntimeError("login failed")
            return self._response_for(request)

        def pool_factory(*args, **kwargs):
            workers = kwargs.get("max_workers", args[0] if args else None)
            captured.append(workers)
            return ThreadPoolExecutor(*args, **kwargs)

        with (
            patch.object(BurstPlane, "_send", side_effect=fake_send),
            patch("burst.ThreadPoolExecutor", side_effect=pool_factory),
        ):
            result = self.plane.run(users)
        self.assertEqual(captured, [2])
        self.assertEqual(result["burst_concurrency"], 2)
        self.assertEqual(result["user_count"], 3)
        self.assertFalse(result["ok"])
        self.assertEqual(result["verbs"]["problem"]["count_2xx"], 2)
        self.assertEqual(result["verbs"]["scoreboard"]["count_2xx"], 2)
        self.assertEqual(result["verbs"]["submit"]["count_2xx"], 2)

    def test_live_pool_has_no_32_cap(self) -> None:
        users = make_users(50)
        captured: list[int] = []

        def fake_send(opener, request):
            return self._response_for(request)

        def pool_factory(*args, **kwargs):
            captured.append(kwargs.get("max_workers", args[0] if args else None))
            return ThreadPoolExecutor(*args, **kwargs)

        plane = BurstPlane(
            make_config(
                dry_run=False,
                confirm="LOADTEST",
                login_stagger_s=0,
                burst_concurrency=50,
            )
        )
        with (
            patch.object(BurstPlane, "_send", side_effect=fake_send),
            patch("burst.ThreadPoolExecutor", side_effect=pool_factory),
        ):
            result = plane.run(users)
        self.assertEqual(captured, [50])
        self.assertTrue(result["ok"])
        self.assertEqual(result["burst_concurrency"], 50)
        self.assertEqual(result["totals"]["count_2xx"], 150)


class PercentileTest(unittest.TestCase):
    def test_empty_is_none(self) -> None:
        self.assertIsNone(percentile([], 50))
        self.assertIsNone(percentile([], 99))

    def test_linear_interpolation(self) -> None:
        samples = [1.0, 2.0, 3.0, 4.0, 5.0]
        self.assertEqual(percentile(samples, 50), 3.0)
        self.assertAlmostEqual(percentile(samples, 99), 4.96)


if __name__ == "__main__":
    unittest.main()

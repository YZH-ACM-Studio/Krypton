"""Tests for the OJ HTTP load-test plane."""

from __future__ import annotations

import io
import json
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs

import safety
from config import LoadtestConfig
from http_oj import HttpPlane, REQUEST_TIMEOUT_S

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


def write_users_csv(text: str) -> Path:
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".csv", delete=False)
    handle.write(text)
    handle.close()
    return Path(handle.name)


class FakeResponse:
    def __init__(self, body: bytes | str, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self.body = body.encode("utf-8") if isinstance(body, str) else body
        self.status = status
        self.headers = headers or {"Content-Type": "application/json"}

    def read(self) -> bytes:
        return self.body

    def getcode(self) -> int:
        return self.status

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *args) -> None:
        return None


class RecordingOpener:
    def __init__(self, handler) -> None:
        self.handler = handler
        self.requests: list[urllib.request.Request] = []
        self.timeouts: list[float | None] = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        return self.handler(request)


class HttpPlaneLoadUsersTest(unittest.TestCase):
    def test_load_users_reads_uname_password(self) -> None:
        path = write_users_csv("uname,password\nalice,secret\nbob,hunter2\n")
        try:
            users = HttpPlane.load_users(path)
        finally:
            path.unlink()
        self.assertEqual(
            users,
            [{"uname": "alice", "password": "secret"}, {"uname": "bob", "password": "hunter2"}],
        )

    def test_load_users_strips_whitespace_and_bom(self) -> None:
        path = write_users_csv("\ufeffuname,password\n  alice  ,  secret  \n")
        try:
            users = HttpPlane.load_users(path)
        finally:
            path.unlink()
        self.assertEqual(users, [{"uname": "alice", "password": "secret"}])

    def test_load_users_missing_columns(self) -> None:
        path = write_users_csv("username,pass\nalice,secret\n")
        try:
            with self.assertRaises(ValueError):
                HttpPlane.load_users(path)
        finally:
            path.unlink()

    def test_load_users_missing_password_fails(self) -> None:
        path = write_users_csv("uname,password\nalice,\n")
        try:
            with self.assertRaises(ValueError):
                HttpPlane.load_users(path)
        finally:
            path.unlink()

    def test_load_users_empty_fails(self) -> None:
        path = write_users_csv("uname,password\n")
        try:
            with self.assertRaises(ValueError):
                HttpPlane.load_users(path)
        finally:
            path.unlink()

    def test_load_users_missing_file(self) -> None:
        with self.assertRaises(FileNotFoundError):
            HttpPlane.load_users("/tmp/contest-loadtest-missing-users.csv")


class HttpPlaneDryRunTest(unittest.TestCase):
    def setUp(self) -> None:
        self.users = [
            {"uname": "alice", "password": "secret"},
            {"uname": "bob", "password": "hunter2"},
        ]
        self.plane = HttpPlane(make_config())

    def test_dry_run_does_not_open_sockets(self) -> None:
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
            patch.object(HttpPlane, "_send", side_effect=AssertionError("_send")) as send,
        ):
            result = self.plane.run(self.users)
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["ok"])
        sock.assert_not_called()
        conn.assert_not_called()
        urlopen.assert_not_called()
        send.assert_not_called()

    def test_dry_run_plans_login_attend_problem_submit_record(self) -> None:
        result = self.plane.run(self.users)
        planned = result["planned_requests"]
        self.assertEqual(len(planned), 10)
        kinds = [item["kind"] for item in planned]
        self.assertEqual(kinds, ["login", "attend", "problem", "submit", "record"] * 2)

        login = planned[0]
        self.assertEqual(login["method"], "POST")
        self.assertEqual(login["url"], f"{OJ_BASE}/login")
        self.assertEqual(login["form"], {"uname": "alice", "password": "***"})
        self.assertNotEqual(login["form"]["password"], "secret")
        self.assertEqual(login["headers"]["Accept"], "application/json")
        self.assertNotIn("Referer", login["headers"])
        self.assertEqual(login["stagger_s"], 0)
        serialized = json.dumps(result)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("hunter2", serialized)

        attend = planned[1]
        self.assertEqual(attend["method"], "POST")
        self.assertEqual(attend["url"], f"{OJ_BASE}/contest/{CONTEST_ID}")
        self.assertEqual(attend["form"], {"operation": "attend"})
        self.assertNotIn("code", attend["form"])

        problem = planned[2]
        self.assertEqual(problem["method"], "GET")
        self.assertEqual(problem["url"], f"{OJ_BASE}/p/1001?tid={CONTEST_ID}")

        submit = planned[3]
        self.assertEqual(submit["method"], "POST")
        self.assertEqual(submit["url"], f"{OJ_BASE}/p/1001/submit?tid={CONTEST_ID}")
        self.assertEqual(submit["json"], {"lang": "cc", "code": "int main(){return 0;}\n"})
        self.assertEqual(submit["headers"]["Content-Type"], "application/json")

        record = planned[4]
        self.assertEqual(record["method"], "GET")
        self.assertEqual(record["url"], f"{OJ_BASE}/record/{{rid}}")

        second_login = planned[5]
        self.assertEqual(second_login["uname"], "bob")
        self.assertEqual(second_login["stagger_s"], 2.2)
        self.assertEqual(second_login["form"]["uname"], "bob")
        self.assertEqual(second_login["form"]["password"], "***")

    def test_dry_run_redacts_invite_code(self) -> None:
        plane = HttpPlane(make_config(invite_code="ABC123", xff_prefix="203.0.113"))
        planned = plane.run(self.users)["planned_requests"]
        self.assertEqual(planned[1]["form"], {"operation": "attend", "code": "***"})
        self.assertNotIn("ABC123", json.dumps(planned))
        self.assertEqual(planned[0]["headers"]["X-Forwarded-For"], "203.0.113.1")
        self.assertEqual(planned[5]["headers"]["X-Forwarded-For"], "203.0.113.2")
        self.assertNotIn("X-Forwarded-For", HttpPlane(make_config())._headers(0))

    def test_dry_run_refuses_forbidden_base(self) -> None:
        plane = HttpPlane(make_config(oj_base="http://10.1.234.2/exam-network"))
        with self.assertRaises(safety.SafetyError):
            plane.run(self.users)

    def test_dry_run_refuses_network_lock_base(self) -> None:
        plane = HttpPlane(make_config(oj_base="http://10.1.234.2/network-lock/apply"))
        with self.assertRaises(safety.SafetyError):
            plane.run(self.users)

    def test_run_rejects_empty_users(self) -> None:
        with self.assertRaises(ValueError):
            self.plane.run([])


class HttpPlaneLiveTest(unittest.TestCase):
    def setUp(self) -> None:
        self._denylist_tmp = tempfile.TemporaryDirectory()
        denylist = Path(self._denylist_tmp.name) / "denied-contests.txt"
        denylist.write_text(f"{DENIED_CONTEST_ID}\n", encoding="utf-8")
        self._denylist_patcher = patch.object(safety, "DENYLIST_PATH", denylist)
        self._denylist_patcher.start()
        self.addCleanup(self._denylist_patcher.stop)
        self.addCleanup(self._denylist_tmp.cleanup)
        self.config = make_config(dry_run=False, confirm="LOADTEST", login_stagger_s=0, xff_prefix="198.51.100")
        self.plane = HttpPlane(self.config)
        self.users = [{"uname": "alice", "password": "secret"}]
        self.captured: list[urllib.request.Request] = []

    def _response_for(self, request: urllib.request.Request) -> FakeResponse:
        url = request.full_url
        if url.endswith("/login"):
            return FakeResponse('{"uid":1}')
        if f"/contest/{CONTEST_ID}" in url:
            return FakeResponse("{}")
        if url.endswith(f"/p/1001?tid={CONTEST_ID}"):
            return FakeResponse('{"pid":1001}')
        if "/submit?" in url:
            return FakeResponse('{"rid":"rec1"}')
        if url.endswith("/record/rec1"):
            return FakeResponse('{"status":1}')
        raise AssertionError(f"unexpected URL {url}")

    def test_live_pid_zero_raises_without_http(self) -> None:
        plane = HttpPlane(make_config(dry_run=False, confirm="LOADTEST", pid=0))
        with (
            patch.object(HttpPlane, "_send", side_effect=AssertionError("http")) as send,
            patch.object(HttpPlane, "_run_live", side_effect=AssertionError("live")) as live,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run(self.users)
        send.assert_not_called()
        live.assert_not_called()
        message = str(ctx.exception)
        self.assertIn("/p/0", message)
        self.assertIn("pid", message.lower())

    def test_run_live_skips_safety_gates_fails_via_assert_ready(self) -> None:
        def assert_run_blocked(plane: HttpPlane, *, needle: str) -> None:
            with (
                patch.object(safety, "assert_ready", wraps=safety.assert_ready) as ready,
                patch.object(HttpPlane, "_send", side_effect=AssertionError("http")),
            ):
                with self.assertRaises(safety.SafetyError) as ctx:
                    plane.run(self.users)
            ready.assert_called_once_with(plane.config)
            self.assertIn(needle, str(ctx.exception))

        missing_confirm = HttpPlane(make_config(dry_run=False, confirm=""))
        assert_run_blocked(missing_confirm, needle="LOADTEST")

        empty_allowlist = HttpPlane(
            make_config(dry_run=False, confirm="LOADTEST", allow_contest_ids=frozenset())
        )
        assert_run_blocked(empty_allowlist, needle="allow-contest-id")

        with tempfile.TemporaryDirectory() as tmp:
            empty_denylist = Path(tmp) / "denied-contests.txt"
            empty_denylist.write_text("", encoding="utf-8")
            with patch.object(safety, "DENYLIST_PATH", empty_denylist):
                empty_deny = HttpPlane(make_config(dry_run=False, confirm="LOADTEST"))
                assert_run_blocked(empty_deny, needle="denylist")

    def test_live_sequence_urllib_json_no_referer(self) -> None:
        def fake_send(opener, request):
            self.captured.append(request)
            response = self._response_for(request)
            return response.status, response.read(), dict(response.headers)

        with (
            patch.object(HttpPlane, "_send", side_effect=fake_send),
            patch("time.sleep", side_effect=AssertionError("sleep")) as sleep,
        ):
            result = self.plane.run(self.users)
        sleep.assert_not_called()
        self.assertTrue(result["ok"])
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["users"][0]["rid"], "rec1")
        self.assertEqual([req.get_method() for req in self.captured], ["POST", "POST", "GET", "POST", "GET"])
        self.assertEqual(
            [req.full_url for req in self.captured],
            [
                f"{OJ_BASE}/login",
                f"{OJ_BASE}/contest/{CONTEST_ID}",
                f"{OJ_BASE}/p/1001?tid={CONTEST_ID}",
                f"{OJ_BASE}/p/1001/submit?tid={CONTEST_ID}",
                f"{OJ_BASE}/record/rec1",
            ],
        )

        for request in self.captured:
            headers = {key.lower(): value for key, value in request.header_items()}
            self.assertEqual(headers["accept"], "application/json")
            self.assertNotIn("referer", headers)
            self.assertFalse(request.has_header("Referer"))
            self.assertEqual(headers["x-forwarded-for"], "198.51.100.1")

        login_form = parse_qs(self.captured[0].data.decode("utf-8"), keep_blank_values=True)
        self.assertEqual(login_form, {"uname": ["alice"], "password": ["secret"]})
        attend_form = parse_qs(self.captured[1].data.decode("utf-8"), keep_blank_values=True)
        self.assertEqual(attend_form, {"operation": ["attend"]})
        self.assertIsNone(self.captured[2].data)
        submit_headers = {key.lower(): value for key, value in self.captured[3].header_items()}
        self.assertEqual(submit_headers["content-type"], "application/json")
        self.assertEqual(
            json.loads(self.captured[3].data.decode("utf-8")),
            {"lang": "cc", "code": "int main(){return 0;}\n"},
        )

    def test_live_rid_from_url_and_invite_code(self) -> None:
        plane = HttpPlane(make_config(dry_run=False, confirm="LOADTEST", login_stagger_s=0, invite_code="ZX9"))
        captured: list[urllib.request.Request] = []

        def fake_send(opener, request):
            captured.append(request)
            if "/submit?" in request.full_url:
                return 200, b'{"url":"/record/abc_def-1"}', {}
            return 200, b"{}", {}

        with patch.object(HttpPlane, "_send", side_effect=fake_send):
            result = plane.run(self.users)
        self.assertTrue(result["ok"])
        self.assertEqual(result["users"][0]["rid"], "abc_def-1")
        attend_form = parse_qs(captured[1].data.decode("utf-8"))
        self.assertEqual(attend_form["code"], ["ZX9"])
        self.assertEqual(captured[4].full_url, f"{OJ_BASE}/record/abc_def-1")

    def test_live_staggers_logins(self) -> None:
        plane = HttpPlane(make_config(dry_run=False, confirm="LOADTEST", login_stagger_s=2.2))
        sleeps: list[float] = []

        def fake_send(opener, request):
            if "/submit?" in request.full_url:
                return 200, b'{"rid":"r2"}', {}
            return 200, b"{}", {}

        with (
            patch.object(HttpPlane, "_send", side_effect=fake_send),
            patch("time.sleep", side_effect=lambda seconds: sleeps.append(seconds)),
        ):
            plane.run(
                [
                    {"uname": "alice", "password": "secret"},
                    {"uname": "bob", "password": "hunter2"},
                ]
            )
        self.assertEqual(sleeps, [2.2])

    def test_send_uses_urllib_timeout_and_refuses_forbidden(self) -> None:
        opener = RecordingOpener(lambda request: FakeResponse("{}"))
        request = self.plane._build_request(
            index=0,
            method="GET",
            url=f"{OJ_BASE}/p/1001?tid={CONTEST_ID}",
        )
        status, body, _headers = self.plane._send(opener, request)
        self.assertEqual(status, 200)
        self.assertEqual(body, b"{}")
        self.assertEqual(opener.timeouts, [REQUEST_TIMEOUT_S])
        self.assertFalse(opener.requests[0].has_header("Referer"))

        forbidden = urllib.request.Request("http://10.1.234.2/endpoint-registrations")
        with self.assertRaises(safety.SafetyError):
            self.plane._send(opener, forbidden)

    def test_login_http_error_is_recorded_not_swallowed(self) -> None:
        def fake_send(opener, request):
            return 401, b'{"error":"denied"}', {}

        with patch.object(HttpPlane, "_send", side_effect=fake_send):
            result = self.plane.run(self.users)
        self.assertFalse(result["ok"])
        self.assertFalse(result["users"][0]["ok"])
        self.assertIn("HTTP 401", result["users"][0]["error"])
        self.assertEqual(len(result["users"][0]["requests"]), 1)

    def test_malformed_rid_fails(self) -> None:
        def fake_send(opener, request):
            if "/submit?" in request.full_url:
                return 200, b'{"rid":"../network-lock/x"}', {}
            return 200, b"{}", {}

        with patch.object(HttpPlane, "_send", side_effect=fake_send):
            result = self.plane.run(self.users)
        self.assertFalse(result["ok"])
        self.assertIn("malformed rid", result["users"][0]["error"])

    def test_redirect_strips_referer_and_refuses_forbidden(self) -> None:
        from http_oj import _SafeRedirectHandler

        origin = urllib.request.Request(f"{OJ_BASE}/login", method="GET")
        origin.add_header("Accept", "application/json")
        handler = _SafeRedirectHandler()
        redirected = handler.redirect_request(
            origin,
            fp=io.BytesIO(b""),
            code=302,
            msg="Found",
            headers={"Location": f"{OJ_BASE}/p/1001"},
            newurl=f"{OJ_BASE}/p/1001",
        )
        self.assertIsNotNone(redirected)
        assert redirected is not None
        self.assertFalse(redirected.has_header("Referer"))
        with self.assertRaises(safety.SafetyError):
            handler.redirect_request(
                origin,
                fp=io.BytesIO(b""),
                code=302,
                msg="Found",
                headers={"Location": "http://10.1.234.2/api/vigil/endpoint-registrations"},
                newurl="http://10.1.234.2/api/vigil/endpoint-registrations",
            )


class HttpPlaneSafetyOnBuildTest(unittest.TestCase):
    def test_every_builder_calls_refuse(self) -> None:
        plane = HttpPlane(make_config())
        with patch.object(safety, "refuse_forbidden_url", side_effect=lambda url: url) as mocked:
            plane._login_url()
            plane._attend_url()
            plane._problem_url()
            plane._submit_url()
            plane._record_url("abc")
            self.assertGreaterEqual(mocked.call_count, 5)

    def test_abs_rejects_relative_path(self) -> None:
        plane = HttpPlane(make_config())
        with self.assertRaises(ValueError):
            plane._abs("login")


if __name__ == "__main__":
    unittest.main()

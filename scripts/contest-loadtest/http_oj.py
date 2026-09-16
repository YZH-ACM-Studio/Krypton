"""HTTP plane for the school-contest load-test harness.

Issues only the OJ student path: login, contest attend, problem view, submit,
record poll. Every URL is checked with safety.refuse_forbidden_url before use.
Non-dry-run traffic is stdlib urllib with Accept: application/json and no Referer.
"""

from __future__ import annotations

import csv
import http.cookiejar
import io
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlencode, urlparse

import safety
from config import LoadtestConfig

REQUEST_TIMEOUT_S = 30
ACCEPT_JSON = "application/json"
CONTENT_TYPE_FORM = "application/x-www-form-urlencoded"
CONTENT_TYPE_JSON = "application/json"
REDACTED_SECRET = "***"
RID_RE = re.compile(r"^[A-Za-z0-9_-]+$")
RECORD_PATH_RE = re.compile(r"/record/([^/?#]+)$")


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects without sending Referer; refuse forbidden targets."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safety.refuse_forbidden_url(newurl)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        _strip_referer(new_req)
        safety.refuse_forbidden_url(new_req.full_url)
        return new_req


def _strip_referer(request: urllib.request.Request) -> None:
    if request.has_header("Referer"):
        request.remove_header("Referer")


class HttpPlane:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config

    @staticmethod
    def load_users(csv_path: str | Path) -> list[dict[str, str]]:
        path = Path(csv_path)
        if not path.is_file():
            raise FileNotFoundError(f"users csv not found: {path}")
        text = path.read_text(encoding="utf-8-sig")
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            raise ValueError("users csv has no header row")
        users: list[dict[str, str]] = []
        for line_no, raw in enumerate(reader, start=2):
            row = {(key or "").strip(): (value if value is not None else "") for key, value in raw.items()}
            if "uname" not in row or "password" not in row:
                raise ValueError("users csv must have uname,password columns")
            uname = row["uname"].strip()
            password = row["password"].strip()
            if not uname or not password:
                raise ValueError(f"users csv line {line_no} missing uname or password")
            users.append({"uname": uname, "password": password})
        if not users:
            raise ValueError("users csv contains no users")
        return users

    def run(self, users: list[Mapping[str, str]]) -> dict[str, Any]:
        safety.assert_ready(self.config)
        if not self.config.dry_run and self.config.pid <= 0:
            raise safety.SafetyError(
                "live HTTP run requires pid > 0; refusing GET/POST /p/0"
            )
        safety.refuse_forbidden_url(self.config.oj_base)
        normalized = self._require_users(users)
        if self.config.dry_run:
            return self._run_dry(normalized)
        return self._run_live(normalized)

    def _require_users(self, users: list[Mapping[str, str]]) -> list[dict[str, str]]:
        if not users:
            raise ValueError("users must be non-empty")
        normalized: list[dict[str, str]] = []
        for index, user in enumerate(users):
            uname = (user.get("uname") or "").strip()
            password = user.get("password")
            if not uname or password is None or password == "":
                raise ValueError(f"users[{index}] missing uname or password")
            normalized.append({"uname": uname, "password": str(password)})
        return normalized

    def _run_dry(self, users: list[dict[str, str]]) -> dict[str, Any]:
        planned: list[dict[str, Any]] = []
        for index, user in enumerate(users):
            planned.extend(self._plan_user(index, user["uname"]))
        return {
            "dry_run": True,
            "contest_id": self.config.contest_id,
            "user_count": len(users),
            "login_stagger_s": self.config.login_stagger_s,
            "ok": True,
            "planned_requests": planned,
        }

    def _run_live(self, users: list[dict[str, str]]) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        overall_ok = True
        for index, user in enumerate(users):
            if index > 0 and self.config.login_stagger_s > 0:
                time.sleep(self.config.login_stagger_s)
            result = self._run_user(index, user["uname"], user["password"])
            results.append(result)
            if not result["ok"]:
                overall_ok = False
        return {
            "dry_run": False,
            "contest_id": self.config.contest_id,
            "user_count": len(users),
            "login_stagger_s": self.config.login_stagger_s,
            "ok": overall_ok,
            "users": results,
        }

    def _plan_user(self, index: int, uname: str) -> list[dict[str, Any]]:
        attend_form: dict[str, str] = {"operation": "attend"}
        if self.config.invite_code:
            attend_form["code"] = REDACTED_SECRET
        return [
            {
                "index": index,
                "uname": uname,
                "kind": "login",
                "method": "POST",
                "url": self._login_url(),
                "headers": self._headers(index, content_type=CONTENT_TYPE_FORM),
                "form": {"uname": uname, "password": REDACTED_SECRET},
                "stagger_s": index * self.config.login_stagger_s,
            },
            {
                "index": index,
                "uname": uname,
                "kind": "attend",
                "method": "POST",
                "url": self._attend_url(),
                "headers": self._headers(index, content_type=CONTENT_TYPE_FORM),
                "form": attend_form,
            },
            {
                "index": index,
                "uname": uname,
                "kind": "problem",
                "method": "GET",
                "url": self._problem_url(),
                "headers": self._headers(index),
            },
            {
                "index": index,
                "uname": uname,
                "kind": "submit",
                "method": "POST",
                "url": self._submit_url(),
                "headers": self._headers(index, content_type=CONTENT_TYPE_JSON),
                "json": {"lang": self.config.lang, "code": self.config.code},
            },
            {
                "index": index,
                "uname": uname,
                "kind": "record",
                "method": "GET",
                "url": self._record_url("{rid}"),
                "headers": self._headers(index),
            },
        ]

    def _run_user(self, index: int, uname: str, password: str) -> dict[str, Any]:
        opener = self._build_opener()
        requests_log: list[dict[str, Any]] = []
        user_result: dict[str, Any] = {
            "index": index,
            "uname": uname,
            "ok": False,
            "rid": None,
            "requests": requests_log,
            "error": None,
        }
        attend_form: dict[str, str] = {"operation": "attend"}
        if self.config.invite_code:
            attend_form["code"] = self.config.invite_code
        try:
            self._exchange(
                opener,
                index=index,
                kind="login",
                method="POST",
                url=self._login_url(),
                form={"uname": uname, "password": password},
                log=requests_log,
            )
            self._exchange(
                opener,
                index=index,
                kind="attend",
                method="POST",
                url=self._attend_url(),
                form=attend_form,
                log=requests_log,
            )
            self._exchange(
                opener,
                index=index,
                kind="problem",
                method="GET",
                url=self._problem_url(),
                log=requests_log,
            )
            submit_payload = self._exchange(
                opener,
                index=index,
                kind="submit",
                method="POST",
                url=self._submit_url(),
                json_body={"lang": self.config.lang, "code": self.config.code},
                log=requests_log,
            )
            rid = _rid_from_submit(submit_payload)
            user_result["rid"] = rid
            self._exchange(
                opener,
                index=index,
                kind="record",
                method="GET",
                url=self._record_url(rid),
                log=requests_log,
            )
        except Exception as exc:
            user_result["error"] = f"{type(exc).__name__}: {exc}"
            return user_result
        user_result["ok"] = True
        return user_result

    def _exchange(
        self,
        opener: urllib.request.OpenerDirector,
        *,
        index: int,
        kind: str,
        method: str,
        url: str,
        form: dict[str, str] | None = None,
        json_body: dict[str, str] | None = None,
        log: list[dict[str, Any]],
    ) -> dict[str, Any]:
        request = self._build_request(index=index, method=method, url=url, form=form, json_body=json_body)
        started = time.perf_counter()
        status, body, _response_headers = self._send(opener, request)
        elapsed_s = time.perf_counter() - started
        entry: dict[str, Any] = {
            "kind": kind,
            "method": method,
            "url": request.full_url,
            "status": status,
            "ok": 200 <= status < 300,
            "elapsed_s": elapsed_s,
        }
        log.append(entry)
        if not entry["ok"]:
            snippet = _body_snippet(body)
            raise RuntimeError(f"HTTP {status} {method} {request.full_url}: {snippet}")
        payload = _parse_json_object(body, url=request.full_url, status=status)
        return payload

    def _build_request(
        self,
        *,
        index: int,
        method: str,
        url: str,
        form: dict[str, str] | None = None,
        json_body: dict[str, str] | None = None,
    ) -> urllib.request.Request:
        if form is not None and json_body is not None:
            raise ValueError("request cannot be both form and JSON")
        safety.refuse_forbidden_url(url)
        data: bytes | None = None
        content_type: str | None = None
        if form is not None:
            data = urlencode(form).encode("utf-8")
            content_type = CONTENT_TYPE_FORM
        elif json_body is not None:
            data = json.dumps(json_body, separators=(",", ":")).encode("utf-8")
            content_type = CONTENT_TYPE_JSON
        headers = self._headers(index, content_type=content_type)
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        _strip_referer(request)
        safety.refuse_forbidden_url(request.full_url)
        return request

    def _send(
        self,
        opener: urllib.request.OpenerDirector,
        request: urllib.request.Request,
    ) -> tuple[int, bytes, dict[str, str]]:
        safety.refuse_forbidden_url(request.full_url)
        if request.has_header("Referer"):
            raise RuntimeError(f"refusing to send Referer to {request.full_url}")
        try:
            response = opener.open(request, timeout=REQUEST_TIMEOUT_S)
        except urllib.error.HTTPError as exc:
            body = exc.read() if exc.fp is not None else b""
            headers = dict(exc.headers.items()) if exc.headers is not None else {}
            return int(exc.code), body, headers
        except urllib.error.URLError as exc:
            raise RuntimeError(f"request failed {request.get_method()} {request.full_url}: {exc}") from exc
        with response:
            body = response.read()
            status = getattr(response, "status", None) or response.getcode() or 0
            headers = dict(response.headers.items()) if response.headers is not None else {}
            return int(status), body, headers

    def _build_opener(self) -> urllib.request.OpenerDirector:
        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(jar),
            _SafeRedirectHandler(),
        )

    def _headers(self, index: int, *, content_type: str | None = None) -> dict[str, str]:
        headers = {"Accept": ACCEPT_JSON}
        xff = self._xff(index)
        if xff:
            headers["X-Forwarded-For"] = xff
        if content_type:
            headers["Content-Type"] = content_type
        return headers

    def _xff(self, index: int) -> str | None:
        prefix = (self.config.xff_prefix or "").strip().rstrip(".")
        if not prefix:
            return None
        return f"{prefix}.{index + 1}"

    def _login_url(self) -> str:
        return self._abs("/login")

    def _attend_url(self) -> str:
        return self._abs(f"/contest/{self.config.contest_id}")

    def _problem_url(self) -> str:
        return self._abs(f"/p/{self.config.pid}", {"tid": self.config.contest_id})

    def _submit_url(self) -> str:
        return self._abs(f"/p/{self.config.pid}/submit", {"tid": self.config.contest_id})

    def _record_url(self, rid: str) -> str:
        return self._abs(f"/record/{rid}")

    def _abs(self, path: str, query: dict[str, str] | None = None) -> str:
        if not path.startswith("/"):
            raise ValueError(f"path must be absolute: {path!r}")
        url = f"{self.config.oj_base.rstrip('/')}{path}"
        if query:
            url = f"{url}?{urlencode(query)}"
        return safety.refuse_forbidden_url(url)


def _parse_json_object(body: bytes, *, url: str, status: int) -> dict[str, Any]:
    text = body.decode("utf-8")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"non-JSON response from {url} status={status}: {_body_snippet(body)}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"JSON response from {url} is not an object: {type(payload).__name__}")
    return payload


def _rid_from_submit(payload: Mapping[str, Any]) -> str:
    rid = payload.get("rid")
    if isinstance(rid, str) and rid.strip():
        return _require_rid(rid.strip())
    url = payload.get("url")
    if isinstance(url, str) and url.strip():
        path = urlparse(url.strip()).path
        match = RECORD_PATH_RE.search(path)
        if match:
            return _require_rid(match.group(1))
    raise RuntimeError("submit JSON missing rid")


def _require_rid(rid: str) -> str:
    if not RID_RE.fullmatch(rid):
        raise RuntimeError(f"submit returned malformed rid: {rid!r}")
    return rid


def _body_snippet(body: bytes) -> str:
    return body.decode("utf-8", errors="replace")[:200]

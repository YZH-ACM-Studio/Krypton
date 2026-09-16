"""Contest-start HTTP spike (unlike sequential HttpPlane).

Students are logged in one-by-one with login_stagger_s (Hydro login limiter is
30 requests / 60s / IP). After warmup, a barrier releases GET /p/{pid}?tid=,
GET /contest/{tid}/scoreboard, and POST submit at nearly the same time.

Hydro has no HTTP 429. The global limiter raises OpcountExceeded as 403 after
100 requests / 5s / IP. A one-IP burst that records 403s after that cap is a
useful measurement (it proves the limiter is armed). X-Forwarded-For spoofing
stays unused unless LoadtestConfig.xff_prefix is already set.

Does not create users. Live pid<=0 is a SafetyError. Every URL goes through
safety.refuse_forbidden_url. Reports redact passwords and never send Referer.
"""

from __future__ import annotations

import math
import socket
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Mapping

import safety
from config import HYDRO_GLOBAL_RATE_PER_5S, LoadtestConfig
from http_oj import (
    CONTENT_TYPE_FORM,
    CONTENT_TYPE_JSON,
    HttpPlane,
    REDACTED_SECRET,
    REQUEST_TIMEOUT_S,
)

BURST_VERBS = ("problem", "scoreboard", "submit")
LIMITER_NOTE = (
    "Hydro has no HTTP 429; OpcountExceeded is 403 after "
    f"{HYDRO_GLOBAL_RATE_PER_5S} requests/5s/IP. "
    "A one-IP burst hitting that cap is a useful limiter measurement. "
    "X-Forwarded-For spoofing stays off unless config.xff_prefix is set."
)


@dataclass
class _BurstSession:
    index: int
    uname: str
    opener: urllib.request.OpenerDirector
    report: dict[str, Any]


class BurstPlane(HttpPlane):
    def __init__(self, config: LoadtestConfig) -> None:
        super().__init__(config)

    def _run_dry(self, users: list[dict[str, str]]) -> dict[str, Any]:
        workers = self._burst_workers(len(users))
        planned: list[dict[str, Any]] = []
        for index, user in enumerate(users):
            planned.extend(self._plan_burst_user(index, user["uname"]))
        return {
            "dry_run": True,
            "contest_id": self.config.contest_id,
            "user_count": len(users),
            "login_stagger_s": self.config.login_stagger_s,
            "burst_concurrency": workers,
            "ok": True,
            "verbs": list(BURST_VERBS),
            "limiter_note": LIMITER_NOTE,
            "planned_requests": planned,
        }

    def _run_live(self, users: list[dict[str, str]]) -> dict[str, Any]:
        self._burst_workers(len(users))
        user_reports: list[dict[str, Any]] = []
        sessions: list[_BurstSession] = []
        for index, user in enumerate(users):
            if index > 0 and self.config.login_stagger_s > 0:
                time.sleep(self.config.login_stagger_s)
            report, opener = self._warmup_user(index, user["uname"], user["password"])
            user_reports.append(report)
            if opener is not None:
                sessions.append(
                    _BurstSession(
                        index=index,
                        uname=user["uname"],
                        opener=opener,
                        report=report,
                    )
                )

        workers = len(sessions)
        if sessions:
            barrier = threading.Barrier(workers)
            with ThreadPoolExecutor(max_workers=workers) as executor:
                futures = [
                    executor.submit(self._burst_session, barrier, session)
                    for session in sessions
                ]
                for future, session in zip(futures, sessions):
                    try:
                        future.result()
                    except Exception as exc:
                        session.report["ok"] = False
                        if not session.report.get("error"):
                            session.report["error"] = f"{type(exc).__name__}: {exc}"

        burst_records: list[dict[str, Any]] = []
        for report in user_reports:
            burst_records.extend(report.get("burst") or [])
        verbs = summarize_verbs(burst_records)
        return {
            "dry_run": False,
            "contest_id": self.config.contest_id,
            "user_count": len(users),
            "login_stagger_s": self.config.login_stagger_s,
            "burst_concurrency": workers,
            "ok": all(bool(report["ok"]) for report in user_reports),
            "verbs": verbs,
            "totals": _totals(verbs),
            "limiter_note": LIMITER_NOTE,
            "users": user_reports,
        }

    def _burst_workers(self, user_count: int) -> int:
        """One worker per user. burst_concurrency > 0 is a MAX, not the pool size."""
        if user_count < 1:
            raise ValueError("users must be non-empty")
        configured = int(self.config.burst_concurrency or 0)
        if configured > 0 and user_count > configured:
            raise safety.SafetyError(
                f"burst_concurrency={configured} is below user_count={user_count}; "
                "raise --concurrency so the start barrier has one worker per user"
            )
        return user_count

    def _plan_burst_user(self, index: int, uname: str) -> list[dict[str, Any]]:
        attend_form: dict[str, str] = {"operation": "attend"}
        if self.config.invite_code:
            attend_form["code"] = REDACTED_SECRET
        return [
            {
                "index": index,
                "uname": uname,
                "kind": "login",
                "phase": "warmup",
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
                "phase": "warmup",
                "method": "POST",
                "url": self._attend_url(),
                "headers": self._headers(index, content_type=CONTENT_TYPE_FORM),
                "form": attend_form,
            },
            {
                "index": index,
                "uname": uname,
                "kind": "problem",
                "phase": "burst",
                "method": "GET",
                "url": self._problem_url(),
                "headers": self._headers(index),
            },
            {
                "index": index,
                "uname": uname,
                "kind": "scoreboard",
                "phase": "burst",
                "method": "GET",
                "url": self._scoreboard_url(),
                "headers": self._headers(index),
            },
            {
                "index": index,
                "uname": uname,
                "kind": "submit",
                "phase": "burst",
                "method": "POST",
                "url": self._submit_url(),
                "headers": self._headers(index, content_type=CONTENT_TYPE_JSON),
                "json": {"lang": self.config.lang, "code": self.config.code},
            },
        ]

    def _warmup_user(
        self,
        index: int,
        uname: str,
        password: str,
    ) -> tuple[dict[str, Any], urllib.request.OpenerDirector | None]:
        opener = self._build_opener()
        warmup: list[dict[str, Any]] = []
        report: dict[str, Any] = {
            "index": index,
            "uname": uname,
            "ok": False,
            "warmup": warmup,
            "burst": [],
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
                log=warmup,
            )
            self._exchange(
                opener,
                index=index,
                kind="attend",
                method="POST",
                url=self._attend_url(),
                form=attend_form,
                log=warmup,
            )
        except Exception as exc:
            report["error"] = f"{type(exc).__name__}: {exc}"
            return report, None
        report["ok"] = True
        return report, opener

    def _burst_session(self, barrier: threading.Barrier, session: _BurstSession) -> None:
        burst_log: list[dict[str, Any]] = session.report.setdefault("burst", [])
        try:
            barrier.wait(timeout=REQUEST_TIMEOUT_S)
        except threading.BrokenBarrierError:
            session.report["ok"] = False
            session.report["error"] = "burst barrier failed"
            return
        for kind, method, url, json_body in (
            ("problem", "GET", self._problem_url(), None),
            ("scoreboard", "GET", self._scoreboard_url(), None),
            ("submit", "POST", self._submit_url(), {"lang": self.config.lang, "code": self.config.code}),
        ):
            burst_log.append(
                self._burst_exchange(
                    session.opener,
                    index=session.index,
                    kind=kind,
                    method=method,
                    url=url,
                    json_body=json_body,
                )
            )

    def _burst_exchange(
        self,
        opener: urllib.request.OpenerDirector,
        *,
        index: int,
        kind: str,
        method: str,
        url: str,
        json_body: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request = self._build_request(index=index, method=method, url=url, json_body=json_body)
        started = time.perf_counter()
        try:
            status, _body, _headers = self._send(opener, request)
        except Exception as exc:
            elapsed_s = time.perf_counter() - started
            timeout = is_timeout(exc)
            return {
                "kind": kind,
                "method": method,
                "url": request.full_url,
                "status": None,
                "timeout": timeout,
                "elapsed_s": elapsed_s,
                "error": f"{type(exc).__name__}: {exc}",
            }
        return {
            "kind": kind,
            "method": method,
            "url": request.full_url,
            "status": int(status),
            "timeout": False,
            "elapsed_s": time.perf_counter() - started,
            "error": None,
        }

    def _scoreboard_url(self) -> str:
        return self._abs(f"/contest/{self.config.contest_id}/scoreboard")


def is_timeout(exc: BaseException) -> bool:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, (TimeoutError, socket.timeout)):
            return True
        reason = getattr(current, "reason", None)
        if isinstance(reason, BaseException):
            if isinstance(reason, (TimeoutError, socket.timeout)):
                return True
            if "timed out" in str(reason).lower():
                return True
        if "timed out" in str(current).lower():
            return True
        current = current.__cause__ or current.__context__
    return False


def percentile(samples: list[float], percent: float) -> float | None:
    if not samples:
        return None
    if percent < 0 or percent > 100:
        raise ValueError(f"percent must be 0..100, got {percent}")
    ordered = sorted(samples)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (percent / 100.0) * (len(ordered) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(ordered[low])
    weight = rank - low
    return float(ordered[low]) * (1.0 - weight) + float(ordered[high]) * weight


def summarize_verbs(records: list[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    by_verb: dict[str, dict[str, Any]] = {}
    for verb in BURST_VERBS:
        samples = [record for record in records if record.get("kind") == verb]
        latencies = [
            float(record["elapsed_s"])
            for record in samples
            if not record.get("timeout") and record.get("elapsed_s") is not None
        ]
        count_2xx = 0
        count_403 = 0
        count_5xx = 0
        timeouts = 0
        for record in samples:
            if record.get("timeout"):
                timeouts += 1
                continue
            status = _status(record)
            if status is None:
                continue
            if 200 <= status < 300:
                count_2xx += 1
            elif status == 403:
                count_403 += 1
            elif 500 <= status < 600:
                count_5xx += 1
        by_verb[verb] = {
            "count": len(samples),
            "count_2xx": count_2xx,
            "count_403": count_403,
            "count_5xx": count_5xx,
            "timeouts": timeouts,
            "p50_s": percentile(latencies, 50),
            "p99_s": percentile(latencies, 99),
        }
    return by_verb


def _status(record: Mapping[str, Any]) -> int | None:
    status = record.get("status")
    if status is None:
        return None
    return int(status)


def _totals(verbs: Mapping[str, Mapping[str, Any]]) -> dict[str, int]:
    keys = ("count", "count_2xx", "count_403", "count_5xx", "timeouts")
    return {key: int(sum(int(verb[key]) for verb in verbs.values())) for key in keys}

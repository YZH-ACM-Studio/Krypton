"""Fail closed before any traffic leaves this machine.

Rules:
- contest id must be 24 lowercase hex (SRS on_publish regex)
- contest id must be listed in --allow-contest-id (repeatable)
- non-dry-run requires --confirm LOADTEST
- never call network-lock / exam-network / endpoint-registration URLs
- never use a production contest id from the denylist file
- live runs fail closed if denied-contests.txt has no valid 24-hex id
- stream keys must use machine id loadtest_XXXX (4+ digits), not real client ids
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse

from config import CONFIRM_TOKEN, APP_NODVR, APP_RECORD

CONTEST_ID_RE = re.compile(r"^[0-9a-f]{24}$")
STREAM_KEY_RE = re.compile(r"^([0-9a-f]{24})_(loadtest_\d{4,})_(screen|camera)$")

FORBIDDEN_URL_SNIPPETS = (
    "/network-lock/",
    "/exam-network",
    "/endpoint-registrations",
    "/api/endpoints/recover",
    "/api/vigil/endpoint-registrations",
    "apply_network_policy",
    "network-execution",
)

DENYLIST_PATH = Path(__file__).resolve().parent / "denied-contests.txt"


class SafetyError(ValueError):
    """Load test refused to start or to send a request."""


def normalize_contest_id(raw: str) -> str:
    contest_id = (raw or "").strip().lower()
    if not CONTEST_ID_RE.fullmatch(contest_id):
        raise SafetyError(
            "contest id must be a 24-char lowercase hex Mongo ObjectId; "
            f"got {raw!r}. Create a dedicated hidden test contest first."
        )
    return contest_id


def load_denylist(path: Path | None = None) -> frozenset[str]:
    resolved = DENYLIST_PATH if path is None else path
    if not resolved.is_file():
        return frozenset()
    ids: set[str] = set()
    for line_no, line in enumerate(resolved.read_text(encoding="utf-8").splitlines(), start=1):
        text = line.split("#", 1)[0].strip().lower()
        if not text:
            continue
        if not CONTEST_ID_RE.fullmatch(text):
            raise SafetyError(
                f"denylist {resolved.name} line {line_no} is not a 24-hex contest id: {line!r}"
            )
        ids.add(text)
    return frozenset(ids)


def require_allowed_contest(contest_id: str, allow_contest_ids: Iterable[str]) -> str:
    contest_id = normalize_contest_id(contest_id)
    allowed = {normalize_contest_id(item) for item in allow_contest_ids}
    if contest_id not in allowed:
        raise SafetyError(
            f"contest {contest_id} is not in --allow-contest-id. "
            "The harness will not guess a target."
        )
    denied = load_denylist(DENYLIST_PATH)
    if contest_id in denied:
        raise SafetyError(
            f"contest {contest_id} is on the local denylist ({DENYLIST_PATH.name}). "
            "Refusing to hit a protected contest."
        )
    return contest_id


def require_confirm(confirm: str, *, dry_run: bool) -> None:
    if dry_run:
        return
    if (confirm or "").strip() != CONFIRM_TOKEN:
        raise SafetyError(
            f"non-dry-run requires --confirm {CONFIRM_TOKEN}. "
            "This is a live push against OJ/Vigil."
        )


def require_rtmp_app(app: str) -> str:
    if app not in (APP_RECORD, APP_NODVR):
        raise SafetyError(f"rtmp app must be {APP_RECORD!r} or {APP_NODVR!r}, got {app!r}")
    return app


def require_stream_key(stream_key: str) -> str:
    if not STREAM_KEY_RE.fullmatch(stream_key):
        raise SafetyError(
            "stream key must be {contestId}_loadtest_XXXX_{screen|camera} "
            f"with 4+ digit machine id, got {stream_key!r}"
        )
    return stream_key


def refuse_forbidden_url(url: str) -> str:
    lowered = (url or "").lower()
    for snippet in FORBIDDEN_URL_SNIPPETS:
        if snippet in lowered:
            raise SafetyError(
                f"refusing URL that touches network lock, exam network, or endpoint identity: {url}"
            )
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https", "rtmp", "ws", "wss", ""):
        raise SafetyError(f"unsupported URL scheme: {url}")
    return url


def assert_ready(config) -> None:
    require_allowed_contest(config.contest_id, config.allow_contest_ids)
    require_confirm(config.confirm, dry_run=config.dry_run)
    require_rtmp_app(config.app)
    if not config.screen and not config.camera:
        raise SafetyError("enable at least one of screen or camera")
    if config.students < 1:
        raise SafetyError("students must be >= 1")
    if config.duration_s < 1:
        raise SafetyError("duration must be >= 1")
    refuse_forbidden_url(config.oj_base)
    refuse_forbidden_url(config.vigil_health)
    if not config.dry_run:
        denied = load_denylist()
        if not denied:
            raise SafetyError(
                f"live run requires at least one valid 24-hex contest id in {DENYLIST_PATH.name}. "
                "Empty or comments-only denylist is fail-closed."
            )
        kind = "screen" if config.screen else "camera"
        require_stream_key(config.stream_key(0, kind))
        refuse_forbidden_url(config.rtmp_url(0, kind))

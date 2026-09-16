"""Teacher 监考墙 HTTP-FLV pull plane for the school-contest load-test harness.

Production path is Caddy `/vigil-flv/{app}/{contestId}_{loadtest_XXXX}_{screen|camera}.flv`
(prefix stripped, reverse-proxied to SRS :8080). This plane PULLS; ffmpeg `-re`
publish is wrong here. Stdlib only. Never RTMP publish, never network-lock.
"""

from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import safety
from config import LoadtestConfig

LOG = logging.getLogger("contest-loadtest.viewers")
LOG.addHandler(logging.NullHandler())

STOP_GRACE_S = 5.0
KILL_WAIT_S = 2.0
READ_CHUNK = 65536
KINDS = ("screen", "camera")


def build_pull_command(url: str, duration_s: int, *, ffmpeg: str = "ffmpeg") -> list[str]:
    """ffmpeg HTTP-FLV pull into a null sink. Do not pass `-re` (that is publish)."""
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-i",
        url,
        "-t",
        str(int(duration_s)),
        "-f",
        "null",
        "-",
    ]


def require_http_flv_base(flv_base: str) -> str:
    parsed = urlparse(flv_base or "")
    if parsed.scheme not in ("http", "https"):
        raise safety.SafetyError(f"flv_base must be http(s); got {flv_base!r}")
    return require_http_flv_url(flv_base, require_flv_suffix=False)


def require_http_flv_url(url: str, *, require_flv_suffix: bool = True) -> str:
    url = safety.refuse_forbidden_url(url)
    if "network-lock" in (url or "").lower():
        raise safety.SafetyError(
            f"refusing URL that touches network lock, exam network, or endpoint identity: {url}"
        )
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise safety.SafetyError(f"FLV pull URL must be http(s); got {url!r}")
    if require_flv_suffix and not parsed.path.lower().endswith(".flv"):
        raise safety.SafetyError(f"FLV pull URL must end with .flv; got {url!r}")
    return url


def _ffmpeg_available(ffmpeg: str) -> bool:
    if shutil.which(ffmpeg):
        return True
    try:
        return Path(ffmpeg).is_file()
    except OSError:
        return False


def _empty_stop() -> dict[str, int]:
    return {
        "signaled": 0,
        "terminated": 0,
        "killed": 0,
        "already_dead": 0,
        "living": 0,
    }


def _kinds(config: LoadtestConfig) -> tuple[str, ...]:
    return tuple(kind for kind in KINDS if getattr(config, kind))


def _student_stream_pool(config: LoadtestConfig) -> list[tuple[int, str]]:
    kinds = _kinds(config)
    return [(index, kind) for index in range(config.students) for kind in kinds]


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only to http(s) FLV URLs; refuse network-lock targets."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require_http_flv_url(newurl)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        if new_req.has_header("Referer"):
            new_req.remove_header("Referer")
        require_http_flv_url(new_req.full_url)
        return new_req


@dataclass
class ViewerSlot:
    viewer: int
    slot: int
    index: int
    machine_id: str
    kind: str
    stream_key: str
    url: str
    command: list[str]
    proc: subprocess.Popen[bytes] | None = None
    thread: threading.Thread | None = None
    bytes_read: int = 0
    error: str | None = None


class ViewerPlane:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config
        self._streams: list[ViewerSlot] = []
        self._started = False
        self._stop_event = threading.Event()
        self._pull_mode = "planned"
        self._bytes_lock = threading.Lock()

    def start(self) -> dict:
        """Start pulls for viewers * viewer_streams. dry_run does not Popen."""
        if self._started:
            raise RuntimeError("ViewerPlane.start() already called")
        safety.assert_ready(self.config)
        if self.config.viewers < 1:
            raise safety.SafetyError("viewers must be >= 1")
        if self.config.viewer_streams < 1:
            raise safety.SafetyError("viewer_streams must be >= 1")
        require_http_flv_base(self.config.flv_base)
        slots = self._plan()
        if self.config.dry_run:
            self._pull_mode = "planned"
            self._streams = slots
            for slot in slots:
                LOG.info("dry-run viewer=%s slot=%s url=%s", slot.viewer, slot.slot, slot.url)
                print(slot.url)
        else:
            self._stop_event.clear()
            use_ffmpeg = _ffmpeg_available(self.config.ffmpeg)
            self._pull_mode = "ffmpeg" if use_ffmpeg else "urllib"
            self._streams = slots
            try:
                if use_ffmpeg:
                    self._spawn_ffmpeg(slots)
                else:
                    self._spawn_urllib(slots)
                if slots and self._pull_mode == "ffmpeg" and self.living() == 0:
                    raise RuntimeError(
                        "all ffmpeg pullers died immediately after start; "
                        "stderr was hidden (redirected to DEVNULL). "
                        "Check the ffmpeg binary and HTTP-FLV URL."
                    )
            except BaseException as exc:
                if self._started:
                    try:
                        self.stop()
                    except Exception as stop_exc:
                        raise stop_exc from exc
                raise
        self._started = True
        LOG.info(
            "viewer plane started dry_run=%s pull_mode=%s planned=%s living=%s",
            self.config.dry_run,
            self._pull_mode,
            len(self._streams),
            self.living(),
        )
        result = self.snapshot()
        result["urls"] = [slot.url for slot in self._streams]
        result["keys"] = [slot.stream_key for slot in self._streams]
        result["commands"] = [list(slot.command) for slot in self._streams]
        return result

    def living(self) -> int:
        return sum(1 for slot in self._streams if _is_living(slot))

    def bytes_read(self) -> int:
        with self._bytes_lock:
            return sum(slot.bytes_read for slot in self._streams)

    def stop(self) -> dict:
        """SIGTERM each ffmpeg puller, then SIGKILL leftovers; join urllib threads. Idempotent."""
        if not self._started:
            return _empty_stop()
        self._stop_event.set()
        signaled = 0
        already_dead = 0
        waiting: list[ViewerSlot] = []
        thread_waiting: list[ViewerSlot] = []
        for slot in self._streams:
            proc = slot.proc
            if proc is not None:
                if proc.poll() is not None:
                    already_dead += 1
                    continue
                if self._send_signal(slot, signal.SIGTERM):
                    signaled += 1
                    waiting.append(slot)
                else:
                    already_dead += 1
                continue
            thread = slot.thread
            if thread is None:
                continue
            if not thread.is_alive():
                already_dead += 1
                continue
            signaled += 1
            thread_waiting.append(slot)

        deadline = time.monotonic() + STOP_GRACE_S
        terminated = 0
        killed = 0
        for slot in waiting:
            proc = slot.proc
            if proc is None:
                continue
            remaining = deadline - time.monotonic()
            try:
                proc.wait(timeout=max(remaining, 0.0))
                terminated += 1
                continue
            except subprocess.TimeoutExpired:
                pass
            LOG.warning("ffmpeg pid=%s still alive after SIGTERM; sending SIGKILL", proc.pid)
            self._send_signal(slot, signal.SIGKILL)
            killed += 1
            try:
                proc.wait(timeout=KILL_WAIT_S)
            except subprocess.TimeoutExpired:
                LOG.error(
                    "ffmpeg pid=%s did not exit after SIGKILL; continuing remaining pullers",
                    proc.pid,
                )

        thread_deadline = time.monotonic() + STOP_GRACE_S
        for slot in thread_waiting:
            thread = slot.thread
            if thread is None:
                continue
            remaining = thread_deadline - time.monotonic()
            thread.join(timeout=max(remaining, 0.0))
            if thread.is_alive():
                LOG.error(
                    "urllib puller still alive after join timeout viewer=%s stream_key=%s",
                    slot.viewer,
                    slot.stream_key,
                )
            else:
                terminated += 1

        living_ids = _living_ids(self._streams)
        result = {
            "signaled": signaled,
            "terminated": terminated,
            "killed": killed,
            "already_dead": already_dead,
            "living": len(living_ids),
        }
        LOG.info("viewer plane stopped %s", result)
        if living_ids:
            raise RuntimeError("viewer pullers still alive after stop: " + ", ".join(living_ids))
        return result

    def snapshot(self) -> dict[str, Any]:
        streams: list[dict[str, Any]] = []
        exited = 0
        with self._bytes_lock:
            for slot in self._streams:
                returncode = None if slot.proc is None else slot.proc.poll()
                if slot.proc is not None and returncode is not None:
                    exited += 1
                elif slot.thread is not None and not slot.thread.is_alive():
                    exited += 1
                streams.append(
                    {
                        "viewer": slot.viewer,
                        "slot": slot.slot,
                        "index": slot.index,
                        "machine_id": slot.machine_id,
                        "kind": slot.kind,
                        "stream_key": slot.stream_key,
                        "url": slot.url,
                        "command": list(slot.command),
                        "living": _is_living(slot),
                        "returncode": returncode,
                        "pid": None if slot.proc is None else slot.proc.pid,
                        "bytes": slot.bytes_read,
                        "error": slot.error,
                    }
                )
        return {
            "dry_run": self.config.dry_run,
            "started": self._started,
            "pull_mode": self._pull_mode,
            "viewers": self.config.viewers,
            "viewer_streams": self.config.viewer_streams,
            "students": self.config.students,
            "screen": self.config.screen,
            "camera": self.config.camera,
            "planned": len(self._streams),
            "living": self.living(),
            "exited": exited,
            "bytes": sum(item["bytes"] for item in streams),
            "streams": streams,
        }

    def _plan(self) -> list[ViewerSlot]:
        pool = _student_stream_pool(self.config)
        if not pool:
            raise safety.SafetyError("no screen/camera streams available to pull")
        slots: list[ViewerSlot] = []
        total = self.config.viewers * self.config.viewer_streams
        for n in range(total):
            viewer = n // self.config.viewer_streams
            slot_n = n % self.config.viewer_streams
            index, kind = pool[n % len(pool)]
            stream_key = safety.require_stream_key(self.config.stream_key(index, kind))
            url = require_http_flv_url(self.config.flv_url(index, kind))
            slots.append(
                ViewerSlot(
                    viewer=viewer,
                    slot=slot_n,
                    index=index,
                    machine_id=self.config.machine_id(index),
                    kind=kind,
                    stream_key=stream_key,
                    url=url,
                    command=build_pull_command(
                        url,
                        self.config.duration_s,
                        ffmpeg=self.config.ffmpeg,
                    ),
                )
            )
        return slots

    def _spawn_ffmpeg(self, slots: list[ViewerSlot]) -> None:
        for slot in slots:
            LOG.info(
                "spawning ffmpeg pull viewer=%s slot=%s stream_key=%s",
                slot.viewer,
                slot.slot,
                slot.stream_key,
            )
            slot.proc = subprocess.Popen(
                slot.command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            # stop() no-ops unless _started; never hide a living ffmpeg from it.
            self._started = True

    def _spawn_urllib(self, slots: list[ViewerSlot]) -> None:
        opener = urllib.request.build_opener(_SafeRedirectHandler)
        for slot in slots:
            LOG.info(
                "spawning urllib pull viewer=%s slot=%s stream_key=%s",
                slot.viewer,
                slot.slot,
                slot.stream_key,
            )
            thread = threading.Thread(
                target=self._urllib_worker,
                args=(slot, opener),
                name=f"viewer-pull-{slot.viewer}-{slot.slot}",
                daemon=True,
            )
            slot.thread = thread
            thread.start()
            self._started = True

    def _urllib_worker(self, slot: ViewerSlot, opener: urllib.request.OpenerDirector) -> None:
        url = require_http_flv_url(slot.url)
        deadline = time.monotonic() + max(int(self.config.duration_s), 1)
        request = urllib.request.Request(url, method="GET")
        if request.has_header("Referer"):
            request.remove_header("Referer")
        try:
            timeout = max(float(self.config.duration_s), 1.0)
            with opener.open(request, timeout=timeout) as resp:
                while not self._stop_event.is_set() and time.monotonic() < deadline:
                    chunk = resp.read(READ_CHUNK)
                    if not chunk:
                        return
                    with self._bytes_lock:
                        slot.bytes_read += len(chunk)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            slot.error = str(exc)
            LOG.warning("urllib pull failed stream_key=%s: %s", slot.stream_key, exc)
        except Exception as exc:
            slot.error = str(exc)
            LOG.exception("urllib pull crashed stream_key=%s", slot.stream_key)

    def _send_signal(self, slot: ViewerSlot, sig: int) -> bool:
        proc = slot.proc
        if proc is None or proc.poll() is not None:
            return False
        pid = proc.pid
        try:
            pgid = os.getpgid(pid)
            # killpg only when this ffmpeg is the session leader (start_new_session).
            if pgid == pid:
                os.killpg(pgid, sig)
            else:
                os.kill(pid, sig)
            return True
        except ProcessLookupError:
            return False


def _is_living(slot: ViewerSlot) -> bool:
    if slot.proc is not None:
        return slot.proc.poll() is None
    if slot.thread is not None:
        return slot.thread.is_alive()
    return False


def _living_ids(slots: list[ViewerSlot]) -> list[str]:
    ids: list[str] = []
    for slot in slots:
        if slot.proc is not None and slot.proc.poll() is None:
            ids.append(f"pid={slot.proc.pid}")
        elif slot.thread is not None and slot.thread.is_alive():
            ids.append(f"thread={slot.thread.name}")
    return ids

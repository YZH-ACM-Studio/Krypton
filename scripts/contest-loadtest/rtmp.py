"""RTMP publish plane for the school-contest load-test harness.

Starts N fake students against SRS using pre-built FLV samples and production
stream keys `{contestId}_{loadtest_XXXX}_{screen|camera}`. stdlib only.
"""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import safety
from config import LoadtestConfig

LOG = logging.getLogger("contest-loadtest.rtmp")
LOG.addHandler(logging.NullHandler())

STOP_GRACE_S = 5.0
KILL_WAIT_S = 2.0
KINDS = ("screen", "camera")


def build_push_command(sample: Path | str, url: str, *, ffmpeg: str = "ffmpeg") -> list[str]:
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-re",
        "-stream_loop",
        "-1",
        "-i",
        str(sample),
        "-c",
        "copy",
        "-f",
        "flv",
        url,
    ]


def _sample_for(config: LoadtestConfig, kind: str) -> Path:
    if kind == "screen":
        return config.screen_sample
    if kind == "camera":
        return config.camera_sample
    raise ValueError(f"unknown stream kind {kind!r}")


def _empty_stop() -> dict[str, int]:
    return {
        "signaled": 0,
        "terminated": 0,
        "killed": 0,
        "already_dead": 0,
        "living": 0,
    }


@dataclass
class StreamSlot:
    index: int
    machine_id: str
    kind: str
    stream_key: str
    url: str
    sample: Path
    command: list[str]
    proc: subprocess.Popen[bytes] | None = None


class RtmpPlane:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config
        self._streams: list[StreamSlot] = []
        self._started = False

    def start(self) -> dict:
        """Start publishers for students 0..students-1. dry_run does not Popen."""
        if self._started:
            raise RuntimeError("RtmpPlane.start() already called")
        safety.assert_ready(self.config)
        slots = self._plan()
        if not self.config.dry_run:
            self._require_samples(slots)
            # Keep slots on the plane before Popen so stop() can reap a partial launch.
            self._streams = slots
            try:
                for slot in slots:
                    LOG.info(
                        "spawning ffmpeg index=%s kind=%s stream_key=%s",
                        slot.index,
                        slot.kind,
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
                if slots and self.living() == 0:
                    raise RuntimeError(
                        "all ffmpeg publishers died immediately after start; "
                        "stderr was hidden (redirected to DEVNULL). "
                        "Check the ffmpeg binary, sample files, and RTMP URL."
                    )
            except BaseException as exc:
                if self._started:
                    try:
                        self.stop()
                    except Exception as stop_exc:
                        raise stop_exc from exc
                raise
        else:
            self._streams = slots
        self._started = True
        LOG.info(
            "rtmp plane started dry_run=%s planned=%s living=%s",
            self.config.dry_run,
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

    def planned(self) -> int:
        return len(self._streams)

    def stop(self) -> dict:
        """SIGTERM each publisher, then SIGKILL leftovers. Idempotent."""
        if not self._started:
            return _empty_stop()
        signaled = 0
        already_dead = 0
        waiting: list[StreamSlot] = []
        for slot in self._streams:
            proc = slot.proc
            if proc is None:
                continue
            if proc.poll() is not None:
                already_dead += 1
                continue
            if self._send_signal(slot, signal.SIGTERM):
                signaled += 1
                waiting.append(slot)
            else:
                already_dead += 1

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
                    "ffmpeg pid=%s did not exit after SIGKILL; continuing remaining publishers",
                    proc.pid,
                )

        living_pids = [
            slot.proc.pid
            for slot in self._streams
            if slot.proc is not None and _is_living(slot)
        ]
        result = {
            "signaled": signaled,
            "terminated": terminated,
            "killed": killed,
            "already_dead": already_dead,
            "living": len(living_pids),
        }
        LOG.info("rtmp plane stopped %s", result)
        if living_pids:
            raise RuntimeError(
                "ffmpeg still alive after SIGKILL: "
                + ", ".join(f"pid={pid}" for pid in living_pids)
            )
        return result

    def snapshot(self) -> dict[str, Any]:
        streams: list[dict[str, Any]] = []
        exited = 0
        for slot in self._streams:
            returncode = None if slot.proc is None else slot.proc.poll()
            if slot.proc is not None and returncode is not None:
                exited += 1
            streams.append(
                {
                    "index": slot.index,
                    "machine_id": slot.machine_id,
                    "kind": slot.kind,
                    "stream_key": slot.stream_key,
                    "url": slot.url,
                    "sample": str(slot.sample),
                    "command": list(slot.command),
                    "living": _is_living(slot),
                    "returncode": returncode,
                    "pid": None if slot.proc is None else slot.proc.pid,
                }
            )
        return {
            "dry_run": self.config.dry_run,
            "started": self._started,
            "students": self.config.students,
            "screen": self.config.screen,
            "camera": self.config.camera,
            "planned": len(self._streams),
            "living": self.living(),
            "exited": exited,
            "streams": streams,
        }

    def _plan(self) -> list[StreamSlot]:
        kinds = [kind for kind in KINDS if getattr(self.config, kind)]
        slots: list[StreamSlot] = []
        for index in range(self.config.students):
            machine_id = self.config.machine_id(index)
            for kind in kinds:
                stream_key = safety.require_stream_key(self.config.stream_key(index, kind))
                url = safety.refuse_forbidden_url(self.config.rtmp_url(index, kind))
                sample = _sample_for(self.config, kind)
                slots.append(
                    StreamSlot(
                        index=index,
                        machine_id=machine_id,
                        kind=kind,
                        stream_key=stream_key,
                        url=url,
                        sample=sample,
                        command=build_push_command(sample, url, ffmpeg=self.config.ffmpeg),
                    )
                )
        return slots

    def _require_samples(self, slots: list[StreamSlot]) -> None:
        missing = sorted({str(slot.sample) for slot in slots if not slot.sample.is_file()})
        if missing:
            raise FileNotFoundError(
                "RTMP samples missing: "
                + ", ".join(missing)
                + ". Run prepare-samples before a live push."
            )

    def _send_signal(self, slot: StreamSlot, sig: int) -> bool:
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


def _is_living(slot: StreamSlot) -> bool:
    return slot.proc is not None and slot.proc.poll() is None

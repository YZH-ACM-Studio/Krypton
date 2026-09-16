#!/usr/bin/env python3
"""CLI entry for the school-contest load-test harness.

Working-directory independent: this file inserts its own directory on sys.path.
Live RTMP/HTTP/ramp/all runs require --confirm LOADTEST. SafetyError exits 2.
Live metrics is local/read-only and does not require LOADTEST or SSH.
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import replace
from pathlib import Path
from typing import Any, Callable, Sequence

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import liveness
from burst import BurstPlane
from cleanup import RECORDING_REMINDER, kill_stray_ffmpeg, stop_run
from config import (
    AAC_BITRATE_KBPS,
    APP_NODVR,
    APP_RECORD,
    CAMERA_BITRATE_KBPS,
    CONFIRM_TOKEN,
    DEFAULT_BURST_CONCURRENCY,
    DEFAULT_CADDY_LOG,
    DEFAULT_RECORDINGS_DIR,
    DEFAULT_RTMP_HOST,
    DEFAULT_SRS_API,
    LoadtestConfig,
    SCREEN_BITRATE_KBPS,
)
from http_oj import HttpPlane
from monitor import Monitor
from rtmp import RtmpPlane
from safety import (
    SafetyError,
    assert_ready,
    normalize_contest_id,
    refuse_forbidden_url,
    require_allowed_contest,
)
from samples import prepare_samples
from screenshots import ScreenshotPlane
from viewers import ViewerPlane

log = logging.getLogger("contest-loadtest.cli")

_DUMMY_CONTEST_ID = "0" * 24
_SAMPLE_CLIP_S = 30
_MONITOR_JOIN_S = 15.0
_LIVENESS_POLL_S = 2.0
_BG_JOIN_S = 5.0
_OPTIONAL_IMPORT_RETRY_S = 0.2
_SRS_STREAMS_API = DEFAULT_SRS_API
_METRICS_TIMEOUT_S = 2.0
_METRICS_BODY_LIMIT = 65536
_METRICS_NOTE = (
    "SRS HTTP API :1985 is only reachable on oj-vigil. "
    "Unreadability on the loadgen is expected. Do not SSH."
)


def _import_optional(module_name: str, attr: str) -> Any:
    try:
        module = importlib.import_module(module_name)
        return getattr(module, attr)
    except (ImportError, AttributeError, SyntaxError):
        sys.modules.pop(module_name, None)
        return None


def _import_optional_retry(module_name: str, attr: str) -> Any:
    found = _import_optional(module_name, attr)
    if found is not None:
        return found
    time.sleep(_OPTIONAL_IMPORT_RETRY_S)
    return _import_optional(module_name, attr)


MetricsPlane = _import_optional("metrics", "MetricsPlane")
HeartbeatPlane = _import_optional("heartbeat", "HeartbeatPlane")


class _PlaneRef:
    """Swap the live RtmpPlane during ramp without restarting Monitor."""

    def __init__(self) -> None:
        self.plane: RtmpPlane | None = None

    def snapshot(self) -> dict | None:
        plane = self.plane
        if plane is None:
            return None
        return plane.snapshot()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="loadtest.py",
        description="School-contest load-test harness (ffmpeg RTMP + optional OJ HTTP).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    prepare_p = sub.add_parser("prepare-samples", help="encode local screen/camera FLV clips")
    prepare_p.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg binary")
    prepare_p.add_argument(
        "--duration",
        type=int,
        default=_SAMPLE_CLIP_S,
        metavar="S",
        help="clip length in seconds (default 30)",
    )
    prepare_p.set_defaults(func=cmd_prepare_samples)

    dry_p = sub.add_parser("dry-run", help="plan RTMP URLs without connecting")
    _add_contest_args(dry_p)
    _add_stream_args(dry_p)
    dry_p.add_argument("--students", type=int, default=30)
    dry_p.add_argument("--ffmpeg", default="ffmpeg")
    dry_p.set_defaults(func=cmd_dry_run, confirm="", dry_run=True, duration=180, hold=180, pid=0)

    rtmp_p = sub.add_parser("rtmp", help="push screen/camera RTMP for N students")
    _add_contest_args(rtmp_p)
    _add_stream_args(rtmp_p)
    _add_live_flags(rtmp_p)
    rtmp_p.add_argument("--students", type=int, default=30)
    rtmp_p.add_argument("--duration", type=int, default=180, metavar="S")
    rtmp_p.add_argument("--ffmpeg", default="ffmpeg")
    rtmp_p.set_defaults(func=cmd_rtmp, hold=180, pid=0)

    http_p = sub.add_parser("http", help="login / attend / optional submit against OJ")
    _add_contest_args(http_p)
    _add_live_flags(http_p)
    http_p.add_argument("--users-file", required=True, metavar="CSV")
    http_p.add_argument("--pid", type=int, default=0)
    http_p.set_defaults(
        func=cmd_http,
        students=30,
        duration=180,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
    )

    burst_p = sub.add_parser(
        "burst",
        help="contest-start spike: staggered login, then concurrent problem/scoreboard/submit",
    )
    _add_contest_args(burst_p)
    _add_live_flags(burst_p)
    burst_p.add_argument("--users-file", required=True, metavar="CSV")
    burst_p.add_argument("--pid", type=int, default=0)
    burst_p.add_argument(
        "--concurrency",
        dest="burst_concurrency",
        type=int,
        default=DEFAULT_BURST_CONCURRENCY,
        help="max burst users (one thread per user; raise if the CSV is larger)",
    )
    burst_p.set_defaults(
        func=cmd_burst,
        students=30,
        duration=180,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
    )

    viewers_p = sub.add_parser("viewers", help="pull teacher 监考墙 HTTP-FLV streams")
    _add_contest_args(viewers_p)
    _add_stream_args(viewers_p)
    _add_live_flags(viewers_p)
    viewers_p.add_argument("--students", type=int, default=30)
    viewers_p.add_argument("--duration", type=int, default=180, metavar="S")
    viewers_p.add_argument("--ffmpeg", default="ffmpeg")
    viewers_p.add_argument("--viewers", type=int, default=4)
    viewers_p.add_argument("--viewer-streams", type=int, default=8)
    viewers_p.set_defaults(func=cmd_viewers, hold=180, pid=0)

    screenshots_p = sub.add_parser(
        "screenshots",
        help="upload JPEG screenshots to isolated Vigil (never production by default)",
    )
    _add_contest_args(screenshots_p)
    _add_live_flags(screenshots_p)
    screenshots_p.add_argument(
        "--identity-dir",
        default=str(_HERE / "identities"),
        help="local P-256 identity directory",
    )
    screenshots_p.add_argument(
        "--interval",
        type=float,
        default=60.0,
        metavar="S",
        help="seconds between uploads per student (maps to screenshot_interval_s)",
    )
    screenshots_p.add_argument("--students", type=int, default=30)
    screenshots_p.add_argument(
        "--vigil-upload-base",
        default="",
        help="isolated Vigil origin; empty refuses live uploads",
    )
    screenshots_p.add_argument(
        "--allow-prod-screenshots",
        action="store_true",
        help="allow live POST to production Vigil host (off by default)",
    )
    screenshots_p.set_defaults(
        func=cmd_screenshots,
        duration=180,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
        pid=0,
    )

    ramp_p = sub.add_parser("ramp", help="step students through 30,100,150,200,300")
    _add_contest_args(ramp_p)
    _add_stream_args(ramp_p)
    _add_live_flags(ramp_p)
    ramp_p.add_argument("--students", type=int, default=30, help="ignored; ramp levels are used")
    ramp_p.add_argument("--duration", type=int, default=180, metavar="S")
    ramp_p.add_argument("--hold", type=int, default=180, metavar="S", help="seconds to hold each ramp level")
    ramp_p.add_argument("--ffmpeg", default="ffmpeg")
    ramp_p.set_defaults(func=cmd_ramp, pid=0)

    all_p = sub.add_parser(
        "all",
        help="RTMP + viewers + optional burst/screenshots/heartbeat",
    )
    _add_contest_args(all_p)
    _add_stream_args(all_p)
    _add_live_flags(all_p)
    all_p.add_argument("--students", type=int, default=30)
    all_p.add_argument("--duration", type=int, default=180, metavar="S")
    all_p.add_argument("--ffmpeg", default="ffmpeg")
    all_p.add_argument("--viewers", type=int, default=4)
    all_p.add_argument("--viewer-streams", type=int, default=8)
    all_p.add_argument("--users-file", default="", metavar="CSV")
    all_p.add_argument("--pid", type=int, default=0)
    all_p.add_argument(
        "--concurrency",
        dest="burst_concurrency",
        type=int,
        default=DEFAULT_BURST_CONCURRENCY,
        help="max burst users (one thread per user; raise if the CSV is larger)",
    )
    all_p.add_argument(
        "--identity-dir",
        default=str(_HERE / "identities"),
        help="local P-256 identity directory",
    )
    all_p.add_argument(
        "--interval",
        type=float,
        default=60.0,
        metavar="S",
        help="seconds between uploads per student (maps to screenshot_interval_s)",
    )
    all_p.add_argument(
        "--vigil-upload-base",
        default="",
        help="isolated Vigil origin for screenshots/heartbeat; empty skips those planes",
    )
    all_p.add_argument(
        "--vigil-ws-base",
        default="",
        help="optional Vigil WS origin for heartbeats",
    )
    all_p.add_argument(
        "--allow-prod-screenshots",
        action="store_true",
        help="allow live POST to production Vigil host (off by default)",
    )
    all_p.set_defaults(func=cmd_all, hold=180)

    metrics_p = sub.add_parser(
        "metrics",
        help="local SRS/liveness metrics (no SSH; LOADTEST not required)",
    )
    _add_contest_args(metrics_p)
    metrics_p.add_argument(
        "--dry-run",
        action="store_true",
        help="plan only; do not open sockets",
    )
    metrics_p.add_argument(
        "--confirm",
        default="",
        metavar="TOKEN",
        help="optional; live metrics is local/read-only and does not require LOADTEST",
    )
    metrics_p.add_argument(
        "--srs-api",
        default=DEFAULT_SRS_API,
        help="local SRS HTTP API (default loopback :1985); never SSH",
    )
    metrics_p.add_argument(
        "--recordings-dir",
        default=str(DEFAULT_RECORDINGS_DIR),
        help="local recording directory to walk; missing path is skipped",
    )
    metrics_p.add_argument(
        "--caddy-log",
        default=str(DEFAULT_CADDY_LOG),
        help="local Caddy access log; missing path is skipped",
    )
    metrics_p.add_argument("--students", type=int, default=30)
    metrics_p.set_defaults(
        func=cmd_metrics,
        duration=180,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
        pid=0,
    )

    heartbeat_p = sub.add_parser(
        "heartbeat",
        help="WebSocket client heartbeats to isolated Vigil (never production by default)",
    )
    _add_contest_args(heartbeat_p)
    _add_live_flags(heartbeat_p)
    heartbeat_p.add_argument(
        "--identity-dir",
        default=str(_HERE / "identities"),
        help="local P-256 identity directory",
    )
    heartbeat_p.add_argument("--students", type=int, default=30)
    heartbeat_p.add_argument("--duration", type=int, default=180, metavar="S")
    heartbeat_p.add_argument(
        "--vigil-upload-base",
        default="",
        help="isolated Vigil HTTP origin used to derive ws/wss when --vigil-ws-base is empty",
    )
    heartbeat_p.add_argument(
        "--vigil-ws-base",
        default="",
        help="isolated Vigil WS origin; empty derives from --vigil-upload-base",
    )
    heartbeat_p.add_argument(
        "--allow-prod-screenshots",
        action="store_true",
        help="allow live WS to production Vigil host (off by default)",
    )
    heartbeat_p.set_defaults(
        func=cmd_heartbeat,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
        pid=0,
    )

    stop_p = sub.add_parser("stop", help="SIGTERM leftover load-test ffmpeg for this contest")
    _add_contest_args(stop_p)
    _add_live_flags(stop_p)
    stop_p.set_defaults(
        func=cmd_stop,
        students=30,
        duration=180,
        hold=180,
        screen=True,
        camera=True,
        rtmp_host=DEFAULT_RTMP_HOST,
        app=APP_RECORD,
        ffmpeg="ffmpeg",
        pid=0,
    )
    return parser


def _add_contest_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--contest-id", required=True, metavar="HEX", help="24-char hex contest ObjectId")
    parser.add_argument(
        "--allow-contest-id",
        action="append",
        required=True,
        metavar="HEX",
        help="permitted contest id (repeatable); contest-id must also be passed here",
    )


def _add_stream_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--rtmp-host", default=DEFAULT_RTMP_HOST)
    parser.add_argument("--app", choices=(APP_RECORD, APP_NODVR), default=APP_RECORD)
    parser.add_argument("--no-screen", dest="screen", action="store_false", help="do not push screen streams")
    parser.add_argument("--no-camera", dest="camera", action="store_false", help="do not push camera streams")
    parser.set_defaults(screen=True, camera=True)


def _add_live_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--confirm",
        default="",
        metavar="TOKEN",
        help=f"live runs require {CONFIRM_TOKEN}",
    )
    parser.add_argument("--dry-run", action="store_true", help="plan only; do not connect or push")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    return build_parser().parse_args(argv)


def _build_config(args: argparse.Namespace, *, dry_run: bool) -> LoadtestConfig:
    contest_id = normalize_contest_id(args.contest_id)
    allow = [normalize_contest_id(item) for item in (args.allow_contest_id or [])]
    # contest-id must also be present in the allow list; assert_ready enforces it.
    kwargs: dict[str, Any] = dict(
        contest_id=contest_id,
        allow_contest_ids=frozenset(allow),
        confirm=getattr(args, "confirm", "") or "",
        rtmp_host=getattr(args, "rtmp_host", DEFAULT_RTMP_HOST),
        app=getattr(args, "app", APP_RECORD),
        students=int(getattr(args, "students", 30)),
        duration_s=int(getattr(args, "duration", 180)),
        screen=bool(getattr(args, "screen", True)),
        camera=bool(getattr(args, "camera", True)),
        dry_run=dry_run,
        ffmpeg=getattr(args, "ffmpeg", "ffmpeg") or "ffmpeg",
        pid=int(getattr(args, "pid", 0) or 0),
        hold_s=int(getattr(args, "hold", 180)),
        burst_concurrency=int(getattr(args, "burst_concurrency", DEFAULT_BURST_CONCURRENCY) or 0),
        viewers=int(getattr(args, "viewers", 4)),
        viewer_streams=int(getattr(args, "viewer_streams", 8)),
        vigil_upload_base=str(getattr(args, "vigil_upload_base", "") or ""),
        allow_prod_screenshots=bool(getattr(args, "allow_prod_screenshots", False)),
        identity_dir=Path(getattr(args, "identity_dir", _HERE / "identities")),
        screenshot_interval_s=float(getattr(args, "interval", 60.0) or 60.0),
        vigil_ws_base=str(getattr(args, "vigil_ws_base", "") or ""),
        srs_api=str(getattr(args, "srs_api", "") or "") or DEFAULT_SRS_API,
        recordings_dir=getattr(args, "recordings_dir", DEFAULT_RECORDINGS_DIR)
        or DEFAULT_RECORDINGS_DIR,
        caddy_log=getattr(args, "caddy_log", DEFAULT_CADDY_LOG) or DEFAULT_CADDY_LOG,
    )
    return LoadtestConfig(**kwargs)


def _samples_missing(config: LoadtestConfig) -> bool:
    if config.screen and not config.screen_sample.is_file():
        return True
    if config.camera and not config.camera_sample.is_file():
        return True
    return False


def _ensure_samples(config: LoadtestConfig, duration_s: int = _SAMPLE_CLIP_S) -> None:
    if config.dry_run:
        prepare_samples(config, duration_s=duration_s)
        return
    if _samples_missing(config):
        log.info("sample clips missing; running prepare-samples")
        prepare_samples(config, duration_s=duration_s)


def _print_rtmp_urls(plane: RtmpPlane) -> None:
    snap = plane.snapshot()
    for stream in snap["streams"]:
        print(stream["url"])


def _start_monitor(
    config: LoadtestConfig,
    rtmp_plane: object,
) -> tuple[threading.Event, threading.Thread, Monitor, dict[str, object]]:
    stop_event = threading.Event()
    monitor = Monitor(config)
    box: dict[str, object] = {}

    def worker() -> None:
        box["result"] = monitor.run_until(stop_event, rtmp_plane=rtmp_plane)

    thread = threading.Thread(target=worker, name="loadtest-monitor", daemon=True)
    thread.start()
    return stop_event, thread, monitor, box


def _finish_monitor(
    stop_event: threading.Event,
    thread: threading.Thread,
    monitor: Monitor,
    box: dict[str, object],
) -> bool:
    stop_event.set()
    thread.join(timeout=_MONITOR_JOIN_S)
    result = box.get("result")
    if not isinstance(result, dict):
        return False
    path = monitor.write_report(result)
    print(f"monitor report: {path}")
    return bool(result.get("health_failed"))


def cmd_prepare_samples(args: argparse.Namespace) -> int:
    config = LoadtestConfig(
        contest_id=_DUMMY_CONTEST_ID,
        allow_contest_ids=frozenset({_DUMMY_CONTEST_ID}),
        confirm="",
        dry_run=False,
        ffmpeg=args.ffmpeg,
    )
    result = prepare_samples(config, duration_s=int(args.duration))
    print(f"screen: {result['screen_sample']}")
    print(f"camera: {result['camera_sample']}")
    return 0


def _estimated_kbps_per_student(config: LoadtestConfig) -> int:
    kbps = 0
    if config.screen:
        kbps += SCREEN_BITRATE_KBPS
    if config.camera:
        kbps += CAMERA_BITRATE_KBPS + AAC_BITRATE_KBPS
    return kbps


def _print_bitrate_and_example(
    config: LoadtestConfig,
    started: dict,
    *,
    live: bool = False,
) -> None:
    mbps = liveness.estimate_mbps(config)
    total_kbps = config.students * _estimated_kbps_per_student(config)
    print(f"estimated bitrate: {mbps:.2f} Mbps ({total_kbps} kbps)")
    commands = started.get("commands") or []
    if commands:
        print("example ffmpeg argv: " + " ".join(str(part) for part in commands[0]))
    if live:
        _warn_if_over_nic(config)


def _warn_if_over_nic(config: LoadtestConfig) -> None:
    capacity = liveness.check_capacity(config)
    if not capacity.get("over_nic"):
        return
    estimate = float(capacity["estimate_mbps"])
    nic = capacity.get("nic_speed_mbps")
    headroom = float(capacity.get("headroom") or liveness.NIC_HEADROOM)
    nic_text = "unknown" if nic is None else f"{float(nic):.2f} Mbps"
    print(
        f"WARNING: estimated {estimate:.2f} Mbps exceeds {headroom:.0%} of NIC {nic_text}",
        file=sys.stderr,
    )


def _print_live_capacity(config: LoadtestConfig) -> None:
    if config.dry_run:
        return
    mbps = liveness.estimate_mbps(config)
    total_kbps = config.students * _estimated_kbps_per_student(config)
    print(f"estimated bitrate: {mbps:.2f} Mbps ({total_kbps} kbps)")
    _warn_if_over_nic(config)


def _background_call(
    fn: Callable[[], Any],
    box: dict[str, object],
    key: str,
) -> threading.Thread:
    def worker() -> None:
        try:
            box[key] = fn()
        except Exception as exc:
            box[f"{key}_error"] = exc
            log.exception("%s plane failed", key)

    thread = threading.Thread(target=worker, name=f"loadtest-{key}", daemon=True)
    thread.start()
    return thread


def _raise_background_error(box: dict[str, object], *keys: str) -> None:
    for key in keys:
        exc = box.get(f"{key}_error")
        if isinstance(exc, BaseException):
            raise exc


def _stop_optional_plane(plane: object | None) -> None:
    if plane is None:
        return
    stopper = getattr(plane, "stop", None)
    if callable(stopper):
        stopper()
        return
    event = getattr(plane, "_stop", None)
    setter = getattr(event, "set", None)
    if callable(setter):
        setter()


def _plane_start_or_run(plane: object) -> Any:
    start = getattr(plane, "start", None)
    if callable(start):
        return start()
    run = getattr(plane, "run", None)
    if callable(run):
        return run()
    raise TypeError(f"{type(plane).__name__} has neither start() nor run()")


def _print_background_reports(box: dict[str, object], *keys: str) -> None:
    for key in keys:
        report = box.get(key)
        if report is not None:
            print(json.dumps(report, indent=2, default=str))


def _ws_or_upload_base(config: LoadtestConfig, args: argparse.Namespace) -> str:
    ws_base = str(getattr(args, "vigil_ws_base", "") or "").strip()
    if not ws_base:
        ws_base = str(getattr(config, "vigil_ws_base", "") or "").strip()
    upload_base = str(config.vigil_upload_base or "").strip()
    return ws_base or upload_base


class _LocalMetricsPlane:
    """Loopback SRS/liveness collector used when metrics.py is not present.

    Never SSHes. Live GET is 127.0.0.1:1985 (or --srs-api). Unreachable is ok.
    """

    def __init__(self, config: LoadtestConfig, srs_api: str = "") -> None:
        self.config = config
        self.srs_api = (srs_api or "").strip() or _SRS_STREAMS_API

    def collect(self) -> dict[str, Any]:
        capacity = liveness.check_capacity(self.config)
        srs_api = refuse_forbidden_url(self.srs_api)
        result: dict[str, Any] = {
            "dry_run": self.config.dry_run,
            "ok": True,
            "ssh": False,
            "contest_id": self.config.contest_id,
            "srs_api": srs_api,
            "reachable": False,
            "streams": None,
            "note": _METRICS_NOTE,
            **capacity,
        }
        if self.config.dry_run:
            return result
        try:
            request = urllib.request.Request(srs_api, method="GET")
            if request.has_header("Referer"):
                request.remove_header("Referer")
            with urllib.request.urlopen(request, timeout=_METRICS_TIMEOUT_S) as resp:
                raw = resp.read(_METRICS_BODY_LIMIT)
            result["reachable"] = True
            text = raw.decode("utf-8", errors="replace")
            try:
                result["streams"] = json.loads(text)
            except json.JSONDecodeError:
                result["streams"] = text
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            result["reachable"] = False
            result["error"] = f"{type(exc).__name__}: {exc}"
            result["ok"] = True
        return result


def _fail_if_publishers_dead(config: LoadtestConfig, plane: object) -> None:
    liveness.fail_if_publishers_dead(plane, min_ratio=float(config.min_living_ratio))


def _wait_live_publishers(
    config: LoadtestConfig,
    plane: object,
    stop_event: threading.Event,
    timeout_s: int,
) -> bool:
    """Wait timeout_s. Return True if stop_event is set. Fail if publishers die."""
    deadline = time.monotonic() + max(int(timeout_s), 1)
    while True:
        _fail_if_publishers_dead(config, plane)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if stop_event.wait(timeout=min(remaining, _LIVENESS_POLL_S)):
            _fail_if_publishers_dead(config, plane)
            return True
    _fail_if_publishers_dead(config, plane)
    return False


def _require_ffmpeg_alive(plane: RtmpPlane) -> None:
    snap = plane.snapshot()
    living = int(snap["living"])
    planned = int(snap["planned"])
    if living == 0 or living < planned / 2:
        raise SafetyError(f"ffmpeg died immediately: living={living} planned={planned}")


def cmd_dry_run(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=True)
    assert_ready(config)
    prepare_samples(config, duration_s=_SAMPLE_CLIP_S)
    plane = RtmpPlane(config)
    started = plane.start()
    _print_bitrate_and_example(config, started)
    print("planned RTMP URLs (not connecting):")
    _print_rtmp_urls(plane)
    return 0


def cmd_rtmp(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _ensure_samples(config)
    plane = RtmpPlane(config)
    stop_event: threading.Event | None = None
    thread: threading.Thread | None = None
    monitor: Monitor | None = None
    box: dict[str, object] | None = None
    interrupted = False
    health_failed = False
    try:
        started = plane.start()
        print("planned RTMP URLs:" if config.dry_run else "RTMP URLs:")
        _print_rtmp_urls(plane)
        _print_bitrate_and_example(config, started, live=not config.dry_run)
        if not config.dry_run:
            _require_ffmpeg_alive(plane)
            _fail_if_publishers_dead(config, plane)
            stop_event, thread, monitor, box = _start_monitor(config, plane)
            _wait_live_publishers(config, plane, stop_event, config.duration_s)
    except KeyboardInterrupt:
        interrupted = True
        print("interrupted", file=sys.stderr)
    finally:
        stop_run(config=config, rtmp_plane=plane)
        if stop_event is not None and thread is not None and monitor is not None and box is not None:
            health_failed = _finish_monitor(stop_event, thread, monitor, box)
    if interrupted:
        return 130
    if health_failed:
        print("STOP: vigil health failed", file=sys.stderr)
        return 1
    return 0


def cmd_http(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _print_live_capacity(config)
    if not config.dry_run and int(config.pid) <= 0:
        raise SafetyError("--pid is required for live submit")
    plane = HttpPlane(config)
    users = plane.load_users(args.users_file)
    report = plane.run(users)
    print(json.dumps(report, indent=2, default=str))
    if report.get("dry_run"):
        return 0
    return 0 if report.get("ok") else 1


def cmd_burst(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _print_live_capacity(config)
    if not config.dry_run and int(config.pid) <= 0:
        raise SafetyError("--pid is required for live burst")
    plane = BurstPlane(config)
    users = plane.load_users(args.users_file)
    report = plane.run(users)
    print(json.dumps(report, indent=2, default=str))
    if report.get("dry_run"):
        return 0
    return 0 if report.get("ok") else 1


def cmd_viewers(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _print_live_capacity(config)
    plane = ViewerPlane(config)
    stop_event: threading.Event | None = None
    thread: threading.Thread | None = None
    monitor: Monitor | None = None
    box: dict[str, object] | None = None
    interrupted = False
    health_failed = False
    try:
        print("planned FLV pull URLs (not connecting):" if config.dry_run else "FLV pull URLs:")
        started = plane.start()
        if not config.dry_run:
            for url in started["urls"]:
                print(url)
        commands = started.get("commands") or []
        if commands:
            print("example ffmpeg argv: " + " ".join(str(part) for part in commands[0]))
        if not config.dry_run:
            snap = plane.snapshot()
            living = int(snap["living"])
            planned = int(snap["planned"])
            if snap.get("pull_mode") == "ffmpeg" and (living == 0 or living < planned / 2):
                raise SafetyError(
                    f"ffmpeg pullers died immediately: living={living} planned={planned}"
                )
            stop_event, thread, monitor, box = _start_monitor(config, plane)
            stop_event.wait(timeout=max(int(config.duration_s), 1))
    except KeyboardInterrupt:
        interrupted = True
        print("interrupted", file=sys.stderr)
    finally:
        stop_run(config=config, viewers_plane=plane)
        if stop_event is not None and thread is not None and monitor is not None and box is not None:
            health_failed = _finish_monitor(stop_event, thread, monitor, box)
    if interrupted:
        return 130
    if health_failed:
        print("STOP: vigil health failed", file=sys.stderr)
        return 1
    return 0


def cmd_screenshots(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _print_live_capacity(config)
    plane = ScreenshotPlane(config)
    report = plane.run()
    print(json.dumps(report, indent=2, default=str))
    if report.get("dry_run"):
        return 0
    return 0 if report.get("ok") else 1


def cmd_ramp(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    if not config.ramp:
        raise SafetyError("ramp is empty")
    config = replace(config, students=int(config.ramp[0]), duration_s=int(config.hold_s))
    assert_ready(config)
    _ensure_samples(config)
    ref = _PlaneRef()
    stop_event, thread, monitor, box = _start_monitor(config, ref)
    health_failed = False
    exit_code = 0
    interrupted = False
    try:
        for n in config.ramp:
            if ref.plane is not None:
                ref.plane.stop()
            if stop_event.is_set():
                print("STOP: vigil health failed", file=sys.stderr)
                exit_code = 1
                break
            step = replace(config, students=int(n), duration_s=int(config.hold_s))
            assert_ready(step)
            print(f"ramp: students={n} hold_s={config.hold_s}", flush=True)
            plane = RtmpPlane(step)
            ref.plane = plane
            started = plane.start()
            _print_rtmp_urls(plane)
            _print_bitrate_and_example(step, started, live=not config.dry_run)
            if config.dry_run:
                continue
            _require_ffmpeg_alive(plane)
            _fail_if_publishers_dead(step, plane)
            if _wait_live_publishers(step, plane, stop_event, config.hold_s):
                print("STOP: vigil health failed", file=sys.stderr)
                exit_code = 1
                break
    except KeyboardInterrupt:
        interrupted = True
        print("interrupted", file=sys.stderr)
    finally:
        stop_run(config=config, rtmp_plane=ref.plane)
        health_failed = _finish_monitor(stop_event, thread, monitor, box)
    if interrupted:
        return 130
    if health_failed and exit_code == 0:
        print("STOP: vigil health failed", file=sys.stderr)
        return 1
    return exit_code


def cmd_all(args: argparse.Namespace) -> int:
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _ensure_samples(config)

    rtmp_plane = RtmpPlane(config)
    viewers_plane: ViewerPlane | None = None
    screenshot_plane: object | None = None
    heartbeat_plane: object | None = None
    stop_event: threading.Event | None = None
    thread: threading.Thread | None = None
    monitor: Monitor | None = None
    box: dict[str, object] | None = None
    bg_box: dict[str, object] = {}
    bg_threads: list[threading.Thread] = []
    interrupted = False
    health_failed = False

    try:
        started = rtmp_plane.start()
        print("planned RTMP URLs:" if config.dry_run else "RTMP URLs:")
        _print_rtmp_urls(rtmp_plane)
        _print_bitrate_and_example(config, started, live=not config.dry_run)
        if not config.dry_run:
            _require_ffmpeg_alive(rtmp_plane)
            _fail_if_publishers_dead(config, rtmp_plane)

        if int(config.viewers) > 0:
            print(
                "planned FLV pull URLs (not connecting):"
                if config.dry_run
                else "FLV pull URLs:"
            )
            viewers_plane = ViewerPlane(config)
            viewer_started = viewers_plane.start()
            if not config.dry_run:
                for url in viewer_started["urls"]:
                    print(url)
                snap = viewers_plane.snapshot()
                living = int(snap["living"])
                planned = int(snap["planned"])
                if snap.get("pull_mode") == "ffmpeg" and (living == 0 or living < planned / 2):
                    raise SafetyError(
                        f"ffmpeg pullers died immediately: living={living} planned={planned}"
                    )

        users_file = str(getattr(args, "users_file", "") or "").strip()
        if users_file and int(config.pid) > 0:
            burst_plane = BurstPlane(config)
            users = burst_plane.load_users(users_file)
            bg_threads.append(
                _background_call(lambda: burst_plane.run(users), bg_box, "burst")
            )
        elif users_file or int(config.pid) > 0:
            log.info("burst skipped; need both --users-file and --pid")

        if str(config.vigil_upload_base or "").strip():
            screenshot_plane = ScreenshotPlane(config)
            bg_threads.append(
                _background_call(screenshot_plane.run, bg_box, "screenshots")
            )

        endpoint_base = _ws_or_upload_base(config, args)
        if endpoint_base:
            heartbeat_cls = HeartbeatPlane or _import_optional_retry(
                "heartbeat", "HeartbeatPlane"
            )
            if heartbeat_cls is not None:
                heartbeat_plane = heartbeat_cls(config)
                bg_threads.append(
                    _background_call(
                        lambda: _plane_start_or_run(heartbeat_plane),
                        bg_box,
                        "heartbeat",
                    )
                )
            else:
                log.info("heartbeat module not available; skipping")

        _raise_background_error(bg_box, "burst", "screenshots", "heartbeat")

        if not config.dry_run:
            stop_event, thread, monitor, box = _start_monitor(config, rtmp_plane)
            _wait_live_publishers(config, rtmp_plane, stop_event, config.duration_s)
    except KeyboardInterrupt:
        interrupted = True
        print("interrupted", file=sys.stderr)
    finally:
        try:
            stop_run(config=config, rtmp_plane=rtmp_plane, viewers_plane=viewers_plane)
        finally:
            _stop_optional_plane(heartbeat_plane)
            _stop_optional_plane(screenshot_plane)
            for bg in bg_threads:
                bg.join(timeout=_BG_JOIN_S)
            if (
                stop_event is not None
                and thread is not None
                and monitor is not None
                and box is not None
            ):
                health_failed = _finish_monitor(stop_event, thread, monitor, box)

    if interrupted:
        return 130
    _raise_background_error(bg_box, "burst", "screenshots", "heartbeat")
    _print_background_reports(bg_box, "burst", "screenshots", "heartbeat")
    if health_failed:
        print("STOP: vigil health failed", file=sys.stderr)
        return 1
    return 0


def cmd_metrics(args: argparse.Namespace) -> int:
    dry_run = bool(getattr(args, "dry_run", False))
    config = _build_config(args, dry_run=dry_run)
    require_allowed_contest(config.contest_id, config.allow_contest_ids)
    plane_cls = MetricsPlane or _import_optional_retry("metrics", "MetricsPlane")
    if plane_cls is None:
        plane = _LocalMetricsPlane(config, srs_api=str(config.srs_api))
    else:
        plane = plane_cls(config)
    collect = getattr(plane, "collect", None)
    if not callable(collect):
        raise SafetyError("MetricsPlane.collect is not available")
    try:
        report = collect()
    except TypeError:
        report = collect(config)
    if not isinstance(report, dict):
        raise SafetyError("MetricsPlane.collect must return a dict")
    _print_live_capacity(config)
    print(json.dumps(report, indent=2, default=str))
    if report.get("ssh"):
        raise SafetyError("metrics must not SSH; refusing a collector that used SSH")
    return 0 if report.get("ok", True) else 1


def cmd_heartbeat(args: argparse.Namespace) -> int:
    cls = HeartbeatPlane or _import_optional_retry("heartbeat", "HeartbeatPlane")
    if cls is None:
        raise SafetyError("heartbeat module is not available")
    config = _build_config(args, dry_run=bool(args.dry_run))
    assert_ready(config)
    _print_live_capacity(config)
    plane = cls(config)
    report = plane.run()
    print(json.dumps(report, indent=2, default=str))
    if report.get("dry_run"):
        return 0
    return 0 if report.get("ok") else 1


def cmd_stop(args: argparse.Namespace) -> int:
    dry_run = bool(args.dry_run) or (args.confirm or "").strip() != CONFIRM_TOKEN
    config = _build_config(args, dry_run=dry_run)
    contest_id = require_allowed_contest(config.contest_id, config.allow_contest_ids)
    matched = kill_stray_ffmpeg(config)
    if config.dry_run:
        print(f"stop: {matched} matching ffmpeg process(es) for contest {contest_id}")
    else:
        print(f"stop: signaled {matched} stray ffmpeg process(es) for contest {contest_id}")
    print(RECORDING_REMINDER.format(contest_id=contest_id))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    args = parse_args(argv)
    try:
        return int(args.func(args))
    except SafetyError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    sys.exit(main())

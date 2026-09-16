"""Shared config for the school-contest load-test harness.

This is the only module other files should import for knobs. Keep it stdlib-only.
Do not mint endpoint credentials, do not call network-lock apply, do not touch
existing production problems.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import FrozenSet

# Real Client rtmp_publisher.h / rtmp_publisher.cpp (2026-06 upgrade).
SCREEN_BITRATE_KBPS = 2500
CAMERA_BITRATE_KBPS = 2000
SCREEN_FPS = 15
CAMERA_FPS = 15
GOP_SECONDS = 1
# Client scale is min(1920, iw) / min(1080, ih).
SCREEN_WIDTH = 1920
SCREEN_HEIGHT = 1080
CAMERA_WIDTH = 1920
CAMERA_HEIGHT = 1080
AAC_BITRATE_KBPS = 64
AAC_SAMPLE_RATE = 44100
RTMP_PORT = 1935
APP_RECORD = "live-record"
APP_NODVR = "live-nodvr"

DEFAULT_OJ_BASE = "http://10.1.234.2"
DEFAULT_RTMP_HOST = "10.1.235.155"
DEFAULT_VIGIL_HEALTH = "http://10.1.235.155:8765/api/health"
DEFAULT_SRS_API = "http://127.0.0.1:1985/api/v1/streams/"
DEFAULT_RECORDINGS_DIR: Path | str = "/data/vigil/recordings"
DEFAULT_CADDY_LOG: Path | str = "/data/access.log"

# Hydro global HTTP limiter: 100 requests / 5s / IP.
HYDRO_GLOBAL_RATE_PER_5S = 100
HYDRO_LOGIN_PER_60S = 30
# 40 users × 3 burst verbs = 120, enough to observe the 100/5s limiter.
DEFAULT_BURST_CONCURRENCY = 40

CONFIRM_TOKEN = "LOADTEST"

HERE = Path(__file__).resolve().parent
DEFAULT_SAMPLE_DIR = HERE / "samples"
DEFAULT_REPORT_DIR = HERE / "reports"


@dataclass(frozen=True)
class LoadtestConfig:
    contest_id: str
    allow_contest_ids: FrozenSet[str]
    confirm: str
    rtmp_host: str = DEFAULT_RTMP_HOST
    rtmp_port: int = RTMP_PORT
    oj_base: str = DEFAULT_OJ_BASE
    vigil_health: str = DEFAULT_VIGIL_HEALTH
    app: str = APP_RECORD
    students: int = 30
    duration_s: int = 180
    screen: bool = True
    camera: bool = True
    dry_run: bool = True
    sample_dir: Path = DEFAULT_SAMPLE_DIR
    report_dir: Path = DEFAULT_REPORT_DIR
    ffmpeg: str = "ffmpeg"
    invite_code: str = ""
    pid: int = 0
    lang: str = "cc"
    code: str = "int main(){return 0;}\n"
    login_stagger_s: float = 2.2
    xff_prefix: str = ""
    ramp: tuple[int, ...] = field(default_factory=lambda: (30, 100, 150, 200, 300))
    hold_s: int = 180
    stop_on_health_fail: bool = True
    flv_base: str = "http://10.1.234.2/vigil-flv"  # Caddy strips prefix, SRS HTTP-FLV
    burst_concurrency: int = DEFAULT_BURST_CONCURRENCY
    viewers: int = 4
    viewer_streams: int = 8
    min_living_ratio: float = 0.9
    vigil_upload_base: str = ""  # empty = screenshots live refused
    vigil_ws_base: str = ""  # empty = derive from vigil_upload_base; both empty = WS live refused
    allow_prod_screenshots: bool = False
    identity_dir: Path = HERE / "identities"
    screenshot_interval_s: float = 60.0
    srs_api: str = DEFAULT_SRS_API
    recordings_dir: Path | str = DEFAULT_RECORDINGS_DIR
    caddy_log: Path | str = DEFAULT_CADDY_LOG

    @property
    def screen_sample(self) -> Path:
        return self.sample_dir / "screen.flv"

    @property
    def camera_sample(self) -> Path:
        return self.sample_dir / "camera.flv"

    def machine_id(self, index: int) -> str:
        return f"loadtest_{index:04d}"

    def stream_key(self, index: int, kind: str) -> str:
        if kind not in ("screen", "camera"):
            raise ValueError(f"unknown stream kind {kind!r}")
        return f"{self.contest_id}_{self.machine_id(index)}_{kind}"

    def rtmp_url(self, index: int, kind: str) -> str:
        return f"rtmp://{self.rtmp_host}:{self.rtmp_port}/{self.app}/{self.stream_key(index, kind)}"

    def flv_url(self, index: int, kind: str) -> str:
        return f"{self.flv_base.rstrip('/')}/{self.app}/{self.stream_key(index, kind)}.flv"

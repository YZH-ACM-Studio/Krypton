"""Pre-encode short FLV clips that match Client rtmp_publisher.cpp.

Live load tests must `ffmpeg -re -c copy` these files. This module never
pushes RTMP and never live-encodes the fan-out.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any

from config import (
    AAC_BITRATE_KBPS,
    AAC_SAMPLE_RATE,
    CAMERA_BITRATE_KBPS,
    CAMERA_FPS,
    CAMERA_HEIGHT,
    CAMERA_WIDTH,
    GOP_SECONDS,
    LoadtestConfig,
    SCREEN_BITRATE_KBPS,
    SCREEN_FPS,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
)

# Client GOP is fps * gopSeconds (rtmp_publisher.cpp). Defaults: 15fps * 1s.
_SCREEN_GOP = max(1, SCREEN_FPS * GOP_SECONDS)
_CAMERA_GOP = max(1, CAMERA_FPS * GOP_SECONDS)
_SCREEN_SOURCE = f"testsrc2=size={SCREEN_WIDTH}x{SCREEN_HEIGHT}:rate={SCREEN_FPS}"
_CAMERA_SOURCE = f"testsrc2=size={CAMERA_WIDTH}x{CAMERA_HEIGHT}:rate={CAMERA_FPS}"
_CAMERA_SINE = f"sine=frequency=440:sample_rate={AAC_SAMPLE_RATE}"
_UNDERSHOOT_RATIO = 0.70

log = logging.getLogger("contest-loadtest.samples")


def _require_duration(duration_s: int) -> int:
    duration = int(duration_s)
    if duration < 1:
        raise ValueError(f"duration_s must be >= 1, got {duration_s!r}")
    return duration


def _require_local_output(out_path: str | Path) -> str:
    text = str(out_path)
    if "rtmp://" in text.lower():
        raise RuntimeError(
            f"refusing RTMP output {text!r}; sample clips are local files only"
        )
    return text


def _x264_args(bitrate_kbps: int, gop_frames: int) -> list[str]:
    rate = f"{bitrate_kbps}k"
    gop = str(gop_frames)
    return [
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-b:v",
        rate,
        "-minrate",
        rate,
        "-maxrate",
        rate,
        "-bufsize",
        f"{bitrate_kbps * 2}k",
        "-g",
        gop,
        "-keyint_min",
        gop,
        "-profile:v",
        "baseline",
        "-pix_fmt",
        "yuv420p",
    ]


def build_screen_cmd(ffmpeg: str, out_path: str | Path, duration_s: int = 30) -> list[str]:
    duration = _require_duration(duration_s)
    output = _require_local_output(out_path)
    return [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "lavfi",
        "-i",
        _SCREEN_SOURCE,
        "-t",
        str(duration),
        *_x264_args(SCREEN_BITRATE_KBPS, _SCREEN_GOP),
        "-an",
        "-f",
        "flv",
        output,
    ]


def build_camera_cmd(ffmpeg: str, out_path: str | Path, duration_s: int = 30) -> list[str]:
    duration = _require_duration(duration_s)
    output = _require_local_output(out_path)
    return [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "lavfi",
        "-i",
        _CAMERA_SOURCE,
        "-f",
        "lavfi",
        "-i",
        _CAMERA_SINE,
        "-t",
        str(duration),
        *_x264_args(CAMERA_BITRATE_KBPS, _CAMERA_GOP),
        "-c:a",
        "aac",
        "-b:a",
        f"{AAC_BITRATE_KBPS}k",
        "-ar",
        str(AAC_SAMPLE_RATE),
        "-shortest",
        "-f",
        "flv",
        output,
    ]


def _require_ffmpeg(ffmpeg: str) -> None:
    if shutil.which(ffmpeg):
        return
    if Path(ffmpeg).is_file():
        return
    raise RuntimeError(
        f"ffmpeg not found: {ffmpeg!r}. Install ffmpeg or pass an explicit binary."
    )


def _run_ffmpeg(cmd: list[str], out_path: Path) -> None:
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError(f"ffmpeg not found: {cmd[0]!r}") from exc
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or exc.stdout or "").strip()
        raise RuntimeError(
            f"ffmpeg failed writing {out_path} (exit {exc.returncode}): {err}"
        ) from exc


def _ffprobe_binary(ffmpeg: str) -> str | None:
    ffmpeg_path = Path(ffmpeg)
    suffix = ffmpeg_path.suffix
    name = f"ffprobe{suffix}" if suffix else "ffprobe"
    sibling = ffmpeg_path.with_name(name)
    if sibling.is_file():
        return str(sibling)
    found = shutil.which(str(sibling))
    if found:
        return found
    return shutil.which(name)


def _target_kbps(kind: str) -> int:
    if kind == "screen":
        return SCREEN_BITRATE_KBPS
    if kind == "camera":
        return CAMERA_BITRATE_KBPS + AAC_BITRATE_KBPS
    raise ValueError(f"unknown clip kind {kind!r}")


def _report_encoded_clip(*, kind: str, path: Path, duration_s: float, target_kbps: int) -> None:
    size_bytes = path.stat().st_size
    bits_per_s = size_bytes * 8 / duration_s
    log.info(
        "%s clip %s size_bytes=%s bits/s=%.0f duration_s=%s",
        kind,
        path,
        size_bytes,
        bits_per_s,
        duration_s,
    )
    target_bps = target_kbps * 1000
    if bits_per_s < _UNDERSHOOT_RATIO * target_bps:
        log.warning(
            "%s clip undershoots target bitrate (%.0f bits/s < 70%% of %s bits/s); "
            "300-student results will under-load SRS",
            kind,
            bits_per_s,
            target_bps,
        )


def _report_encoded_samples(config: LoadtestConfig, duration_s: int) -> None:
    # Existence gate only; bits/s is size*8/duration, not ffprobe bit_rate.
    if _ffprobe_binary(config.ffmpeg) is None:
        return
    duration = float(duration_s)
    if duration <= 0:
        return
    for kind, path in (
        ("screen", config.screen_sample),
        ("camera", config.camera_sample),
    ):
        _report_encoded_clip(
            kind=kind,
            path=path,
            duration_s=duration,
            target_kbps=_target_kbps(kind),
        )


def prepare_samples(config: LoadtestConfig, duration_s: int = 30) -> dict[str, Any]:
    """Write config.screen_sample and config.camera_sample, or return cmds in dry_run."""
    config.sample_dir.mkdir(parents=True, exist_ok=True)
    screen_cmd = build_screen_cmd(config.ffmpeg, config.screen_sample, duration_s)
    camera_cmd = build_camera_cmd(config.ffmpeg, config.camera_sample, duration_s)
    result: dict[str, Any] = {
        "screen_cmd": screen_cmd,
        "camera_cmd": camera_cmd,
        "screen_sample": config.screen_sample,
        "camera_sample": config.camera_sample,
        "dry_run": config.dry_run,
    }
    if config.dry_run:
        return result
    _require_ffmpeg(config.ffmpeg)
    _run_ffmpeg(screen_cmd, config.screen_sample)
    _run_ffmpeg(camera_cmd, config.camera_sample)
    _report_encoded_samples(config, duration_s)
    return result

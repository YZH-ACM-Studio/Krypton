"""Publisher liveness and NIC capacity helpers for the contest load-test harness.

Stdlib only. nic_speed_mbps reads local sysfs for the default-route NIC; it
never opens a socket. dry_run callers may still read /sys — that is local.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Mapping

from config import (
    AAC_BITRATE_KBPS,
    CAMERA_BITRATE_KBPS,
    LoadtestConfig,
    SCREEN_BITRATE_KBPS,
)
from safety import SafetyError

LOG = logging.getLogger("contest-loadtest.liveness")
LOG.addHandler(logging.NullHandler())

NIC_HEADROOM = 0.7
DEFAULT_MIN_LIVING_RATIO = 0.9
_PROC_ROUTE = Path("/proc/net/route")
_SYS_NET = Path("/sys/class/net")


def sample_bitrate_bps(path: Path | str, duration_s: float) -> float:
    """Return size*8/duration for a local sample clip. Same formula as samples.py."""
    duration = float(duration_s)
    if duration <= 0:
        raise ValueError(f"duration_s must be > 0, got {duration_s!r}")
    size_bytes = Path(path).stat().st_size
    return size_bytes * 8 / duration


def nic_speed_mbps() -> float | None:
    """Linux /sys/class/net/<default-route-iface>/speed in Mbps. macOS returns None."""
    if sys.platform != "linux":
        return None
    try:
        iface = _default_route_iface()
        if iface is None:
            return None
        raw = (_SYS_NET / iface / "speed").read_text(encoding="ascii").strip()
        speed = float(raw)
    except (OSError, ValueError):
        return None
    if speed <= 0:
        return None
    return speed


def estimate_mbps(config: LoadtestConfig) -> float:
    """students * (2500 screen + 2000 camera + 64 AAC) kbps, as Mbps."""
    kbps = 0
    if config.screen:
        kbps += SCREEN_BITRATE_KBPS
    if config.camera:
        kbps += CAMERA_BITRATE_KBPS + AAC_BITRATE_KBPS
    return config.students * kbps / 1000.0


def check_capacity(config: LoadtestConfig) -> dict[str, Any]:
    """Warn when the estimated push exceeds 70% of the local NIC speed."""
    estimate = estimate_mbps(config)
    nic = nic_speed_mbps()
    over_nic = bool(nic is not None and estimate > NIC_HEADROOM * nic)
    result: dict[str, Any] = {
        "estimate_mbps": estimate,
        "nic_speed_mbps": nic,
        "headroom": NIC_HEADROOM,
        "over_nic": over_nic,
        "students": config.students,
        "screen": config.screen,
        "camera": config.camera,
    }
    if over_nic:
        LOG.warning(
            "estimated %.3f Mbps exceeds %.0f%% of NIC %.3f Mbps (over_nic=True)",
            estimate,
            NIC_HEADROOM * 100,
            nic,
        )
    return result


def publisher_counts(rtmp_plane: object) -> tuple[int, int]:
    """Return (living, planned) from a plane, snapshot, or mapping."""
    if isinstance(rtmp_plane, Mapping):
        return _counts_from_mapping(rtmp_plane)
    living = _maybe_count(rtmp_plane, "living")
    planned = _maybe_count(rtmp_plane, "planned")
    if living is not None and planned is not None:
        return living, planned
    snapshot = getattr(rtmp_plane, "snapshot", None)
    if callable(snapshot):
        snap = snapshot()
        if snap is None:
            raise SafetyError("rtmp plane snapshot is None")
        if isinstance(snap, Mapping) and "living" in snap and "planned" in snap:
            return int(snap["living"]), int(snap["planned"])
    raise SafetyError("rtmp plane does not report living/planned counts")


def living_ratio(rtmp_plane: object) -> float:
    living, planned = publisher_counts(rtmp_plane)
    return _ratio(living, planned)


def fail_if_publishers_dead(
    rtmp_plane: object,
    min_ratio: float = DEFAULT_MIN_LIVING_RATIO,
) -> None:
    living, planned = publisher_counts(rtmp_plane)
    ratio = _ratio(living, planned)
    if planned <= 0 or ratio < min_ratio:
        raise SafetyError(
            "ffmpeg publishers below min living ratio: "
            f"living={living} planned={planned} ratio={ratio:.3f} "
            f"min_ratio={min_ratio}"
        )


def apply_publisher_liveness(
    sample: dict[str, Any],
    rtmp_plane: object | None,
    config: LoadtestConfig,
) -> dict[str, Any]:
    """Attach living/planned/ratio. Non-dry-run ratio < min_living_ratio marks unhealthy."""
    if rtmp_plane is None:
        return sample
    try:
        living, planned = publisher_counts(rtmp_plane)
    except SafetyError:
        return sample
    ratio = _ratio(living, planned)
    sample["living"] = living
    sample["planned"] = planned
    sample["ratio"] = ratio
    if config.dry_run or planned <= 0:
        return sample
    if ratio < float(config.min_living_ratio):
        sample["ok"] = False
        sample["publishers_dead"] = True
        LOG.warning(
            "publishers below min living ratio: living=%s planned=%s ratio=%.3f min_ratio=%s",
            living,
            planned,
            ratio,
            config.min_living_ratio,
        )
    return sample


def _ratio(living: int, planned: int) -> float:
    if planned <= 0:
        return 0.0
    return living / float(planned)


def _counts_from_mapping(snap: Mapping[str, Any]) -> tuple[int, int]:
    try:
        return int(snap["living"]), int(snap["planned"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SafetyError("rtmp plane snapshot missing living/planned") from exc


def _maybe_count(rtmp_plane: object, name: str) -> int | None:
    if not hasattr(rtmp_plane, name):
        return None
    value = getattr(rtmp_plane, name)
    if callable(value):
        value = value()
    if value is None:
        return None
    return int(value)


def _default_route_iface() -> str | None:
    try:
        text = _PROC_ROUTE.read_text(encoding="ascii")
    except OSError:
        return None
    best_iface: str | None = None
    best_metric: int | None = None
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        iface = parts[0]
        if parts[1] != "00000000" or not _safe_iface(iface):
            continue
        try:
            metric = int(parts[6], 16) if len(parts) > 6 else 0
        except ValueError:
            continue
        if best_metric is None or metric < best_metric:
            best_metric = metric
            best_iface = iface
    return best_iface


def _safe_iface(name: str) -> bool:
    if not name or name in (".", "..", "lo"):
        return False
    if "/" in name or "\\" in name:
        return False
    return True

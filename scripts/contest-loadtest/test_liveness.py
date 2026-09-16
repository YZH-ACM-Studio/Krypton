"""Liveness, bitrate estimate, and NIC capacity helpers. Stdlib only."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from config import LoadtestConfig
from liveness import (
    DEFAULT_MIN_LIVING_RATIO,
    NIC_HEADROOM,
    check_capacity,
    estimate_mbps,
    fail_if_publishers_dead,
    living_ratio,
    nic_speed_mbps,
    publisher_counts,
    sample_bitrate_bps,
)
from safety import SafetyError

CONTEST = "aaaaaaaaaaaaaaaaaaaaaaaa"


def _config(**overrides) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST,
        allow_contest_ids=frozenset({CONTEST}),
        confirm="",
        dry_run=True,
        students=30,
        screen=True,
        camera=True,
    )
    values.update(overrides)
    return LoadtestConfig(**values)


class FakePlane:
    def __init__(self, living: int, planned: int) -> None:
        self._living = living
        self._planned = planned

    def living(self) -> int:
        return self._living

    def planned(self) -> int:
        return self._planned

    def snapshot(self) -> dict[str, int]:
        return {"living": self._living, "planned": self._planned}


class SampleBitrateTests(unittest.TestCase):
    def test_size_times_eight_over_duration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "screen.flv"
            path.write_bytes(b"x" * 10_000)
            self.assertEqual(sample_bitrate_bps(path, 8.0), 10_000 * 8 / 8.0)

    def test_rejects_non_positive_duration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "screen.flv"
            path.write_bytes(b"x")
            with self.assertRaises(ValueError):
                sample_bitrate_bps(path, 0)
            with self.assertRaises(ValueError):
                sample_bitrate_bps(path, -1)


class EstimateMbpsTests(unittest.TestCase):
    def test_thirty_students_screen_and_camera(self) -> None:
        # 30 * (2500 screen + 2000 camera + 64 AAC) / 1000 = 4.564 * 30
        self.assertAlmostEqual(estimate_mbps(_config(students=30)), 4.564 * 30)
        self.assertAlmostEqual(estimate_mbps(_config(students=30)), 136.92)

    def test_screen_only_omits_camera_and_aac(self) -> None:
        self.assertAlmostEqual(
            estimate_mbps(_config(students=30, camera=False)),
            30 * 2.5,
        )


class NicSpeedTests(unittest.TestCase):
    def test_nic_speed_mbps_does_not_throw(self) -> None:
        speed = nic_speed_mbps()
        self.assertTrue(speed is None or speed > 0)
        with patch("liveness.sys.platform", "linux"):
            linux_speed = nic_speed_mbps()
        self.assertTrue(linux_speed is None or linux_speed > 0)
        with patch("liveness.sys.platform", "darwin"):
            self.assertIsNone(nic_speed_mbps())

    def test_linux_reads_default_route_sysfs_speed(self) -> None:
        route = (
            "Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT\n"
            "eth0 00000000 0101A8C0 0003 0 0 00000064 00000000 0 0 0\n"
            "wlan0 00000000 0101A8C0 0003 0 0 00000258 00000000 0 0 0\n"
        )

        def fake_read_text(self: Path, encoding: str = "utf-8", errors: str | None = None) -> str:
            del encoding, errors
            text = str(self)
            if text == "/proc/net/route":
                return route
            if text == "/sys/class/net/eth0/speed":
                return "1000\n"
            raise FileNotFoundError(text)

        with patch("liveness.sys.platform", "linux"), patch.object(
            Path, "read_text", fake_read_text
        ):
            self.assertEqual(nic_speed_mbps(), 1000.0)


class CheckCapacityTests(unittest.TestCase):
    def test_over_nic_when_estimate_exceeds_headroom(self) -> None:
        with patch("liveness.nic_speed_mbps", return_value=100.0):
            result = check_capacity(_config(students=30))
        self.assertTrue(result["over_nic"])
        self.assertEqual(result["nic_speed_mbps"], 100.0)
        self.assertEqual(result["headroom"], NIC_HEADROOM)
        self.assertAlmostEqual(result["estimate_mbps"], 4.564 * 30)

    def test_not_over_nic_when_nic_unknown_or_fast(self) -> None:
        with patch("liveness.nic_speed_mbps", return_value=None):
            self.assertFalse(check_capacity(_config(students=30))["over_nic"])
        with patch("liveness.nic_speed_mbps", return_value=1000.0):
            self.assertFalse(check_capacity(_config(students=30))["over_nic"])


class LivingRatioTests(unittest.TestCase):
    def test_ratio_from_plane_methods(self) -> None:
        self.assertEqual(publisher_counts(FakePlane(9, 10)), (9, 10))
        self.assertAlmostEqual(living_ratio(FakePlane(9, 10)), 0.9)
        self.assertEqual(living_ratio(FakePlane(0, 10)), 0.0)

    def test_ratio_from_mapping(self) -> None:
        self.assertEqual(living_ratio({"living": 4, "planned": 8}), 0.5)

    def test_fail_if_publishers_dead_living_zero(self) -> None:
        with self.assertRaises(SafetyError) as ctx:
            fail_if_publishers_dead(FakePlane(living=0, planned=10))
        message = str(ctx.exception)
        self.assertIn("living=0", message)
        self.assertIn("planned=10", message)

    def test_fail_if_publishers_dead_mapping_living_zero(self) -> None:
        with self.assertRaises(SafetyError):
            fail_if_publishers_dead({"living": 0, "planned": 4})

    def test_accepts_ratio_at_min(self) -> None:
        fail_if_publishers_dead(FakePlane(9, 10), min_ratio=DEFAULT_MIN_LIVING_RATIO)


if __name__ == "__main__":
    unittest.main()

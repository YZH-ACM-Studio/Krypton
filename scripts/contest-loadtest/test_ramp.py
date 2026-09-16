"""Ramp / hold defaults for the school-contest load-test harness.

CLI coverage is skipped until loadtest.py exposes parse_args or build_parser.
"""

from __future__ import annotations

import unittest

from config import LoadtestConfig

CONTEST_ID = "0123456789abcdef01234567"


def _config(**kwargs) -> LoadtestConfig:
    return LoadtestConfig(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="LOADTEST",
        **kwargs,
    )


class RampConfigTests(unittest.TestCase):
    def test_default_ramp_and_hold_s(self) -> None:
        cfg = _config()
        self.assertEqual(cfg.ramp, (30, 100, 150, 200, 300))
        self.assertEqual(cfg.hold_s, 180)

    def test_custom_ramp_and_hold_s_are_stored(self) -> None:
        cfg = _config(ramp=(30, 100), hold_s=60)
        self.assertEqual(cfg.ramp, (30, 100))
        self.assertEqual(cfg.hold_s, 60)


if __name__ == "__main__":
    unittest.main()

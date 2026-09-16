import unittest
from pathlib import Path

from config import (
    CAMERA_BITRATE_KBPS,
    CAMERA_HEIGHT,
    CAMERA_WIDTH,
    DEFAULT_BURST_CONCURRENCY,
    DEFAULT_CADDY_LOG,
    DEFAULT_RECORDINGS_DIR,
    DEFAULT_SRS_API,
    LoadtestConfig,
    SCREEN_BITRATE_KBPS,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
)
from safety import STREAM_KEY_RE


def _config() -> LoadtestConfig:
    contest_id = "aaaaaaaaaaaaaaaaaaaaaaaa"
    return LoadtestConfig(
        contest_id=contest_id,
        allow_contest_ids=frozenset({contest_id}),
        confirm="",
    )


class LoadtestConfigTests(unittest.TestCase):
    def test_machine_id(self) -> None:
        self.assertEqual(_config().machine_id(1), "loadtest_0001")

    def test_stream_key_matches_safety_regex(self) -> None:
        key = _config().stream_key(1, "screen")
        self.assertIsNotNone(STREAM_KEY_RE.fullmatch(key))

    def test_rtmp_url_defaults(self) -> None:
        url = _config().rtmp_url(1, "screen")
        self.assertIn("10.1.235.155:1935", url)
        self.assertIn("/live-record/", url)
        self.assertTrue(url.startswith("rtmp://10.1.235.155:1935/live-record/"))

    def test_flv_url_defaults(self) -> None:
        config = _config()
        url = config.flv_url(1, "screen")
        self.assertEqual(
            url,
            "http://10.1.234.2/vigil-flv/live-record/"
            f"{config.stream_key(1, 'screen')}.flv",
        )
        self.assertTrue(url.startswith("http://10.1.234.2/vigil-flv/live-record/"))
        self.assertTrue(url.endswith(".flv"))

    def test_flv_url_strips_trailing_slash(self) -> None:
        config = LoadtestConfig(
            contest_id="aaaaaaaaaaaaaaaaaaaaaaaa",
            allow_contest_ids=frozenset({"aaaaaaaaaaaaaaaaaaaaaaaa"}),
            confirm="",
            flv_base="http://10.1.234.2/vigil-flv/",
        )
        url = config.flv_url(1, "camera")
        self.assertEqual(
            url,
            "http://10.1.234.2/vigil-flv/live-record/"
            f"{config.stream_key(1, 'camera')}.flv",
        )
        self.assertNotIn("//live-record/", url)

    def test_new_field_defaults(self) -> None:
        config = _config()
        self.assertEqual(config.flv_base, "http://10.1.234.2/vigil-flv")
        self.assertEqual(DEFAULT_BURST_CONCURRENCY, 40)
        self.assertEqual(config.burst_concurrency, 40)
        self.assertEqual(config.burst_concurrency, DEFAULT_BURST_CONCURRENCY)
        self.assertEqual(config.viewers, 4)
        self.assertEqual(config.viewer_streams, 8)
        self.assertEqual(config.min_living_ratio, 0.9)
        self.assertEqual(config.vigil_upload_base, "")
        self.assertEqual(config.vigil_ws_base, "")
        self.assertFalse(config.allow_prod_screenshots)
        self.assertEqual(config.identity_dir, Path(__file__).resolve().parent / "identities")
        self.assertEqual(config.screenshot_interval_s, 60.0)
        self.assertEqual(config.srs_api, "http://127.0.0.1:1985/api/v1/streams/")
        self.assertEqual(config.srs_api, DEFAULT_SRS_API)
        self.assertEqual(str(config.recordings_dir), "/data/vigil/recordings")
        self.assertEqual(str(config.recordings_dir), str(DEFAULT_RECORDINGS_DIR))
        self.assertEqual(str(config.caddy_log), "/data/access.log")
        self.assertEqual(str(config.caddy_log), str(DEFAULT_CADDY_LOG))

    def test_bitrate_knobs(self) -> None:
        self.assertEqual(SCREEN_BITRATE_KBPS, 2500)
        self.assertEqual(CAMERA_BITRATE_KBPS, 2000)
        self.assertEqual(SCREEN_WIDTH, 1920)
        self.assertEqual(SCREEN_HEIGHT, 1080)
        self.assertEqual(CAMERA_WIDTH, 1920)
        self.assertEqual(CAMERA_HEIGHT, 1080)


if __name__ == "__main__":
    unittest.main()

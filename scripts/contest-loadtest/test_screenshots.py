"""Safety and dry-run tests for the JPEG screenshot upload plane."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import socket
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import LoadtestConfig
from screenshots import (
    CRYPTOGRAPHY_REQUIRED,
    ISOLATED_VIGIL_REQUIRED,
    JPEG_HEIGHT,
    JPEG_QUALITY,
    JPEG_WIDTH,
    MAX_DIMENSION,
    MIME_TYPE,
    PROD_VIGIL_HOST,
    REASON_TAG,
    TINY_JPEG,
    UPLOAD_PATH,
    ScreenshotPlane,
    _is_prod_vigil_host,
    authenticated_upload_headers,
    build_jpeg_command,
)

CONTEST_ID = "0123456789abcdef00000001"
DENIED_CONTEST_ID = "deadbeefdeadbeefdeadbeef"
ISOLATED_BASE = "http://127.0.0.1:18765"
PROD_BASE = f"http://{PROD_VIGIL_HOST}:8765"


def _config(**overrides) -> LoadtestConfig:
    values = dict(
        contest_id=CONTEST_ID,
        allow_contest_ids=frozenset({CONTEST_ID}),
        confirm="",
        dry_run=True,
        students=2,
        duration_s=180,
        screen=True,
        camera=True,
        vigil_upload_base="",
        allow_prod_screenshots=False,
        screenshot_interval_s=60.0,
    )
    values.update(overrides)
    return LoadtestConfig(**values)


def _live_config(identity_dir: Path, **overrides) -> LoadtestConfig:
    values = dict(
        dry_run=False,
        confirm="LOADTEST",
        students=1,
        duration_s=1,
        identity_dir=identity_dir,
        vigil_upload_base=ISOLATED_BASE,
    )
    values.update(overrides)
    return _config(**values)


class ScreenshotPlaneTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._denylist_tmp = tempfile.TemporaryDirectory()
        denylist = Path(self._denylist_tmp.name) / "denied-contests.txt"
        denylist.write_text(f"{DENIED_CONTEST_ID}\n", encoding="utf-8")
        self._denylist_patcher = patch.object(safety, "DENYLIST_PATH", denylist)
        self._denylist_patcher.start()
        self.addCleanup(self._denylist_patcher.stop)
        self.addCleanup(self._denylist_tmp.cleanup)
        self._identity_tmp = tempfile.TemporaryDirectory()
        self.identity_dir = Path(self._identity_tmp.name)
        self.addCleanup(self._identity_tmp.cleanup)


class BuildJpegCommandTest(unittest.TestCase):
    def test_matches_client_max_dimension_and_quality(self) -> None:
        cmd = build_jpeg_command("ffmpeg")
        joined = " ".join(cmd)
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-f", cmd)
        self.assertIn("lavfi", cmd)
        self.assertIn("testsrc2=size=1280x720:rate=1", joined)
        self.assertIn(f"scale={MAX_DIMENSION}:-2", joined)
        self.assertEqual(cmd[cmd.index("-q:v") + 1], str(JPEG_QUALITY))
        self.assertEqual(JPEG_QUALITY, 75)
        self.assertEqual(MAX_DIMENSION, 1280)
        self.assertEqual(JPEG_WIDTH, 1280)
        self.assertEqual(JPEG_HEIGHT, 720)
        self.assertTrue(joined.endswith("pipe:1"))
        self.assertIn("mjpeg", joined)


class GenerateIdentitiesTest(ScreenshotPlaneTestBase):
    def test_writes_pem_and_json_without_http(self) -> None:
        plane = ScreenshotPlane(_config(identity_dir=self.identity_dir, students=2))
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
            patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
        ):
            records = plane.generate_identities(2)
        sock.assert_not_called()
        conn.assert_not_called()
        urlopen.assert_not_called()
        send.assert_not_called()
        self.assertEqual(len(records), 2)
        for index, record in enumerate(records):
            endpoint_id = f"loadtest_{index:04d}"
            pem_path = self.identity_dir / f"{endpoint_id}.pem"
            json_path = self.identity_dir / f"{endpoint_id}.json"
            self.assertTrue(pem_path.is_file(), pem_path)
            self.assertTrue(json_path.is_file(), json_path)
            pem = pem_path.read_text(encoding="ascii")
            self.assertIn("BEGIN PRIVATE KEY", pem)
            self.assertIn("END PRIVATE KEY", pem)
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["endpoint_id"], endpoint_id)
            self.assertEqual(payload["machine_id"], endpoint_id)
            self.assertEqual(payload["curve"], "P-256")
            self.assertIn("BEGIN PUBLIC KEY", payload["public_key_pem"])
            self.assertNotIn("BEGIN PRIVATE", json.dumps(payload))
            self.assertNotIn("PRIVATE KEY", json.dumps(payload))
            self.assertEqual(
                payload["machine_fingerprint"],
                hashlib.sha256(endpoint_id.encode("utf-8")).hexdigest(),
            )
            self.assertEqual(record["endpoint_id"], endpoint_id)

    def test_requires_cryptography(self) -> None:
        plane = ScreenshotPlane(_config(identity_dir=self.identity_dir))
        with patch(
            "screenshots._require_cryptography",
            side_effect=safety.SafetyError(CRYPTOGRAPHY_REQUIRED),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.generate_identities(1)
        self.assertEqual(str(ctx.exception), CRYPTOGRAPHY_REQUIRED)
        self.assertEqual(list(self.identity_dir.iterdir()), [])


class DryRunScreenshotPlaneTest(ScreenshotPlaneTestBase):
    def test_plans_uploads_per_interval_without_sockets(self) -> None:
        plane = ScreenshotPlane(_config(students=2, duration_s=180, screenshot_interval_s=60.0))
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch.object(urllib.request, "urlopen", side_effect=AssertionError("urlopen")) as urlopen,
            patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
            patch("screenshots.generate_jpeg_bytes", side_effect=AssertionError("ffmpeg")) as jpeg,
            patch.object(ScreenshotPlane, "generate_identities", side_effect=AssertionError("keys")),
        ):
            result = plane.run()
        sock.assert_not_called()
        conn.assert_not_called()
        urlopen.assert_not_called()
        send.assert_not_called()
        jpeg.assert_not_called()
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["students"], 2)
        self.assertEqual(result["interval_s"], 60.0)
        self.assertEqual(result["ticks_per_student"], 3)
        self.assertEqual(result["planned_uploads"], 6)
        self.assertEqual(result["max_dimension"], 1280)
        self.assertEqual(result["jpeg_quality"], 75)
        self.assertEqual(result["upload_path"], UPLOAD_PATH)
        self.assertIsNone(result["upload_url"])
        self.assertEqual(result["ffmpeg_command"], build_jpeg_command("ffmpeg"))
        self.assertEqual(len(result["identities"]), 2)
        first = result["identities"][0]
        self.assertEqual(first["endpoint_id"], "loadtest_0000")
        self.assertEqual(first["method"], "POST")
        self.assertEqual(first["path"], "/api/uploads/screenshots")
        self.assertEqual(first["form"]["client_id"], "loadtest_0000")
        self.assertEqual(first["form"]["reason_tag"], REASON_TAG)
        self.assertEqual(first["form"]["oj_contest_id"], CONTEST_ID)
        self.assertEqual(first["form"]["width"], "1280")
        self.assertEqual(first["form"]["height"], "720")
        self.assertIn("X-Endpoint-Signature", first["headers"])

    def test_dry_run_with_isolated_base_plans_url_without_posting(self) -> None:
        plane = ScreenshotPlane(
            _config(students=1, vigil_upload_base=ISOLATED_BASE, duration_s=60)
        )
        with patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send:
            result = plane.run()
        send.assert_not_called()
        self.assertEqual(result["planned_uploads"], 1)
        self.assertEqual(result["upload_url"], f"{ISOLATED_BASE}{UPLOAD_PATH}")


class LiveScreenshotSafetyTest(ScreenshotPlaneTestBase):
    def test_empty_upload_base_tells_operator_to_use_isolated_vigil(self) -> None:
        plane = ScreenshotPlane(_live_config(self.identity_dir, vigil_upload_base=""))
        with (
            patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
            patch("socket.socket", side_effect=AssertionError("socket opened")),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        send.assert_not_called()
        self.assertEqual(str(ctx.exception), ISOLATED_VIGIL_REQUIRED)
        self.assertIn("isolated Vigil", str(ctx.exception))

    def test_refuses_production_host_without_allow_prod_screenshots(self) -> None:
        bases = (
            PROD_BASE,
            f"http://{PROD_VIGIL_HOST}.:8765",
            f"http://[::ffff:{PROD_VIGIL_HOST}]:8765",
            "http://10.01.235.155:8765",
            "http://0xa01eb9b:8765",
            "http://[::ffff:a01:eb9b]:8765",
        )
        for base in bases:
            with self.subTest(base=base):
                plane = ScreenshotPlane(
                    _live_config(self.identity_dir, vigil_upload_base=base)
                )
                with (
                    patch("socket.getaddrinfo", side_effect=OSError("dns disabled")),
                    patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
                    patch("urllib.request.urlopen", side_effect=AssertionError("urlopen")) as urlopen,
                    patch("socket.socket", side_effect=AssertionError("socket opened")),
                ):
                    with self.assertRaises(safety.SafetyError) as ctx:
                        plane.run()
                send.assert_not_called()
                urlopen.assert_not_called()
                message = str(ctx.exception)
                self.assertIn(PROD_VIGIL_HOST, message)
                self.assertIn("allow_prod_screenshots", message)
                self.assertNotIn("isolated Vigil; default is empty", message)

    def test_refuses_alternate_prod_ip_encodings_when_getaddrinfo_fails(self) -> None:
        hosts = (
            "10.01.235.155",
            "0xa01eb9b",
            "::ffff:a01:eb9b",
            "10.1.235.0155",
            "10.1.60315",
            "0xA.0x1.0xEB.0x9B",
            "0:0:0:0:0:ffff:10.1.235.155",
        )
        with patch("socket.getaddrinfo", side_effect=OSError("dns disabled")) as gai:
            for host in hosts:
                with self.subTest(host=host):
                    self.assertTrue(_is_prod_vigil_host(host), host)
                    if ":" in host:
                        base = f"http://[{host}]:8765"
                    else:
                        base = f"http://{host}:8765"
                    plane = ScreenshotPlane(
                        _live_config(self.identity_dir, vigil_upload_base=base)
                    )
                    with (
                        patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
                        patch("urllib.request.urlopen", side_effect=AssertionError("urlopen")) as urlopen,
                        patch("socket.socket", side_effect=AssertionError("socket opened")),
                    ):
                        with self.assertRaises(safety.SafetyError) as ctx:
                            plane.run()
                    send.assert_not_called()
                    urlopen.assert_not_called()
                    self.assertIn("allow_prod_screenshots", str(ctx.exception))
                    self.assertIn(PROD_VIGIL_HOST, str(ctx.exception))
        gai.assert_not_called()

    def test_prod_host_gate_uses_getaddrinfo_when_name_resolves_to_prod(self) -> None:
        fake = [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", (PROD_VIGIL_HOST, 0)),
        ]
        with patch("socket.getaddrinfo", return_value=fake) as gai:
            self.assertTrue(_is_prod_vigil_host("vigil.example.test"))
        gai.assert_called()
        with patch("socket.getaddrinfo", side_effect=OSError("dns disabled")):
            self.assertFalse(_is_prod_vigil_host("vigil.example.test"))
            self.assertFalse(_is_prod_vigil_host("127.0.0.1"))
            self.assertFalse(_is_prod_vigil_host("10.1.235.156"))

    def test_refuses_redirect_to_production_host_without_allow_prod_screenshots(self) -> None:
        from screenshots import _SafeRedirectHandler

        origin_url = f"{ISOLATED_BASE}{UPLOAD_PATH}"
        origin = urllib.request.Request(origin_url, data=b"jpeg", method="POST")
        handler = _SafeRedirectHandler(
            _config(vigil_upload_base=ISOLATED_BASE, allow_prod_screenshots=False)
        )
        isolated_redirect = handler.redirect_request(
            origin,
            fp=io.BytesIO(b""),
            code=302,
            msg="Found",
            headers={"Location": origin_url},
            newurl=origin_url,
        )
        self.assertIsNotNone(isolated_redirect)
        assert isolated_redirect is not None
        self.assertFalse(isolated_redirect.has_header("Referer"))
        prod_urls = (
            f"http://{PROD_VIGIL_HOST}:8765{UPLOAD_PATH}",
            f"http://{PROD_VIGIL_HOST}.:8765{UPLOAD_PATH}",
            f"http://[::ffff:{PROD_VIGIL_HOST}]:8765{UPLOAD_PATH}",
            f"http://10.01.235.155:8765{UPLOAD_PATH}",
            f"http://0xa01eb9b:8765{UPLOAD_PATH}",
            f"http://[::ffff:a01:eb9b]:8765{UPLOAD_PATH}",
        )
        for prod_url in prod_urls:
            with self.subTest(prod_url=prod_url):
                with self.assertRaises(safety.SafetyError) as ctx:
                    handler.redirect_request(
                        origin,
                        fp=io.BytesIO(b""),
                        code=302,
                        msg="Found",
                        headers={"Location": prod_url},
                        newurl=prod_url,
                    )
                self.assertIn(PROD_VIGIL_HOST, str(ctx.exception))
        prod_handler = _SafeRedirectHandler(
            _config(vigil_upload_base=PROD_BASE, allow_prod_screenshots=False)
        )
        prod_url = f"{PROD_BASE}{UPLOAD_PATH}"
        prod_origin = urllib.request.Request(prod_url, data=b"jpeg", method="POST")
        with self.assertRaises(safety.SafetyError) as ctx:
            prod_handler.redirect_request(
                prod_origin,
                fp=io.BytesIO(b""),
                code=302,
                msg="Found",
                headers={"Location": prod_url},
                newurl=prod_url,
            )
        self.assertIn("allow_prod_screenshots", str(ctx.exception))

    def test_refuses_recover_enroll_and_network_lock_bases(self) -> None:
        forbidden = (
            "http://127.0.0.1:9/api/endpoints/recover",
            "http://127.0.0.1:9/endpoint-registrations",
            "http://127.0.0.1:9/enroll",
            "http://127.0.0.1:9/network-lock/apply",
        )
        for base in forbidden:
            plane = ScreenshotPlane(_live_config(self.identity_dir, vigil_upload_base=base))
            with patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send:
                with self.assertRaises(safety.SafetyError) as ctx:
                    plane.run()
            send.assert_not_called()
            self.assertIn("refusing", str(ctx.exception).lower())

    def test_live_missing_confirm_fails_before_post(self) -> None:
        plane = ScreenshotPlane(_live_config(self.identity_dir, confirm=""))
        with patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send:
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        send.assert_not_called()
        self.assertIn("LOADTEST", str(ctx.exception))

    def test_live_empty_denylist_fails_before_post(self) -> None:
        empty = Path(self._denylist_tmp.name) / "denied-contests.txt"
        empty.write_text("# none\n", encoding="utf-8")
        plane = ScreenshotPlane(_live_config(self.identity_dir))
        with patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send:
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        send.assert_not_called()
        self.assertIn("denylist", str(ctx.exception).lower())

    def test_live_requires_cryptography_before_post(self) -> None:
        plane = ScreenshotPlane(_live_config(self.identity_dir))
        with (
            patch(
                "screenshots._require_cryptography",
                side_effect=safety.SafetyError(CRYPTOGRAPHY_REQUIRED),
            ),
            patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        send.assert_not_called()
        self.assertEqual(str(ctx.exception), CRYPTOGRAPHY_REQUIRED)


class LiveIsolatedScreenshotPlaneTest(ScreenshotPlaneTestBase):
    def test_allow_prod_override_posts_only_to_upload_path(self) -> None:
        plane = ScreenshotPlane(
            _live_config(
                self.identity_dir,
                vigil_upload_base=PROD_BASE,
                allow_prod_screenshots=True,
            )
        )
        plane.generate_identities(1)
        captured: list[urllib.request.Request] = []

        def fake_send(request: urllib.request.Request) -> tuple[int, bytes]:
            captured.append(request)
            return 200, b'{"screenshot_id":"s1"}'

        with (
            patch.object(ScreenshotPlane, "_send", side_effect=fake_send),
            patch("screenshots.generate_jpeg_bytes", return_value=TINY_JPEG),
        ):
            result = plane.run()
        self.assertGreaterEqual(result["attempted"], 1)
        self.assertEqual(result["failed"], 0)
        self.assertTrue(result["ok"])
        self.assertEqual(captured[0].full_url, f"{PROD_BASE}{UPLOAD_PATH}")
        self.assertEqual(captured[0].get_method(), "POST")
        self.assertNotIn("/api/endpoints/recover", captured[0].full_url)
        self.assertNotIn("enroll", captured[0].full_url.lower())
        self.assertNotIn("network-lock", captured[0].full_url.lower())

    def test_isolated_live_posts_signed_multipart(self) -> None:
        plane = ScreenshotPlane(_live_config(self.identity_dir))
        plane.generate_identities(1)
        captured: list[urllib.request.Request] = []

        def fake_send(request: urllib.request.Request) -> tuple[int, bytes]:
            captured.append(request)
            return 200, b'{"screenshot_id":"s1"}'

        with (
            patch.object(ScreenshotPlane, "_send", side_effect=fake_send),
            patch("screenshots.generate_jpeg_bytes", return_value=TINY_JPEG),
        ):
            result = plane.run()
        self.assertGreaterEqual(len(captured), 1)
        request = captured[0]
        self.assertEqual(request.full_url, f"{ISOLATED_BASE}{UPLOAD_PATH}")
        self.assertEqual(request.get_method(), "POST")
        headers = {key.lower(): value for key, value in request.header_items()}
        self.assertEqual(headers["x-endpoint-id"], "loadtest_0000")
        self.assertEqual(headers["x-endpoint-protocol-version"], "1")
        self.assertEqual(headers["x-endpoint-body-sha256"], hashlib.sha256(TINY_JPEG).hexdigest())
        self.assertTrue(headers["x-endpoint-signature"])
        self.assertNotIn("referer", headers)
        body = request.data
        self.assertIsInstance(body, bytes)
        self.assertNotIn(b"BEGIN PRIVATE", body)
        self.assertNotIn(b"BEGIN PUBLIC", body)
        self.assertIn(b'name="client_id"', body)
        self.assertIn(b"loadtest_0000", body)
        self.assertIn(b'name="reason_tag"', body)
        self.assertIn(b"scheduled", body)
        self.assertIn(b'name="file"', body)
        self.assertIn(b"screenshot.jpg", body)
        self.assertIn(b"image/jpeg", body)
        self.assertIn(TINY_JPEG, body)
        self.assertTrue(result["ok"])
        self.assertFalse(result["dry_run"])
        self.assertEqual(result["planned_uploads"], 1)

    def test_live_missing_identities_fails_without_post(self) -> None:
        plane = ScreenshotPlane(_live_config(self.identity_dir))
        with (
            patch("screenshots.generate_jpeg_bytes", return_value=TINY_JPEG) as jpeg,
            patch.object(ScreenshotPlane, "_send", side_effect=AssertionError("send")) as send,
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        send.assert_not_called()
        jpeg.assert_not_called()
        self.assertIn("generate_identities", str(ctx.exception))


class SigningProtocolTest(ScreenshotPlaneTestBase):
    def test_headers_match_server_authenticated_upload_contract(self) -> None:
        from cryptography.hazmat.primitives import hashes

        from screenshots import _require_cryptography

        plane = ScreenshotPlane(_config(identity_dir=self.identity_dir))
        record = plane.generate_identities(1)[0]
        _, serialization, ec = _require_cryptography()
        pem_path = self.identity_dir / f"{record['endpoint_id']}.pem"
        private_key = serialization.load_pem_private_key(pem_path.read_bytes(), password=None)
        captured_at = "2026-09-09T12:00:00.000Z"
        headers = authenticated_upload_headers(
            record["endpoint_id"],
            TINY_JPEG,
            private_key,
            machine_fingerprint=record["machine_fingerprint"],
            exam_id=CONTEST_ID,
            captured_at=captured_at,
            width=JPEG_WIDTH,
            height=JPEG_HEIGHT,
            reason_tag=REASON_TAG,
            oj_contest_id=CONTEST_ID,
            mime_type=MIME_TYPE,
        )
        self.assertEqual(headers["X-Endpoint-Id"], "loadtest_0000")
        self.assertEqual(headers["X-Endpoint-Protocol-Version"], "1")
        self.assertEqual(headers["X-Endpoint-Body-SHA256"], hashlib.sha256(TINY_JPEG).hexdigest())
        public_key = serialization.load_pem_public_key(record["public_key_pem"].encode("ascii"))
        signed = {
            "endpointId": record["endpoint_id"],
            "issuedAt": headers["X-Endpoint-Issued-At"],
            "machineFingerprint": record["machine_fingerprint"],
            "nonce": headers["X-Endpoint-Nonce"],
            "protocolVersion": 1,
            "request": {
                "method": "POST",
                "path": UPLOAD_PATH,
                "imageSha256": headers["X-Endpoint-Body-SHA256"],
                "clientId": record["endpoint_id"],
                "examId": CONTEST_ID,
                "commandId": "",
                "capturedAt": captured_at,
                "width": JPEG_WIDTH,
                "height": JPEG_HEIGHT,
                "reasonTag": REASON_TAG,
                "eventId": "",
                "examSessionId": "",
                "ojContestId": CONTEST_ID,
                "mimeType": MIME_TYPE,
            },
        }
        canonical = json.dumps(
            signed,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        signature = base64.urlsafe_b64decode(
            headers["X-Endpoint-Signature"] + "=" * (-len(headers["X-Endpoint-Signature"]) % 4)
        )
        public_key.verify(signature, canonical, ec.ECDSA(hashes.SHA256()))


class TinyJpegConstantTest(unittest.TestCase):
    def test_tiny_jpeg_has_soi_marker(self) -> None:
        self.assertTrue(TINY_JPEG.startswith(b"\xff\xd8"))
        self.assertTrue(TINY_JPEG.endswith(b"\xff\xd9"))


if __name__ == "__main__":
    unittest.main()

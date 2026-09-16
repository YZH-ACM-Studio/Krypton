"""Safety and dry-run tests for the student Client WebSocket heartbeat plane."""

from __future__ import annotations

import base64
import hashlib
import json
import socket
import struct
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import safety
from config import LoadtestConfig
from heartbeat import (
    AUTH_PURPOSE,
    CLIENT_WS_PATH_PREFIX,
    CRYPTOGRAPHY_REQUIRED,
    HEARTBEAT_INTERVAL_S,
    ISOLATED_VIGIL_REQUIRED,
    PROD_VIGIL_HOST,
    HeartbeatPlane,
    _is_prod_vigil_host,
    assert_heartbeat_live_allowed,
    assert_ws_redirect_allowed,
    authenticated_websocket_headers,
    client_ws_url,
    connect_websocket,
    resolve_ws_base,
)

CONTEST_ID = "0123456789abcdef00000001"
DENIED_CONTEST_ID = "deadbeefdeadbeefdeadbeef"
ISOLATED_HTTP = "http://127.0.0.1:18765"
ISOLATED_WS = "ws://127.0.0.1:18765"
PROD_HTTP = f"http://{PROD_VIGIL_HOST}:8765"
PROD_WS = f"ws://{PROD_VIGIL_HOST}:8765"


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
        vigil_ws_base="",
        allow_prod_screenshots=False,
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
        vigil_ws_base=ISOLATED_WS,
    )
    values.update(overrides)
    return _config(**values)


class HeartbeatPlaneTestBase(unittest.TestCase):
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


class DryRunHeartbeatPlaneTest(HeartbeatPlaneTestBase):
    def test_plans_connections_per_interval_without_sockets(self) -> None:
        plane = HeartbeatPlane(_config(students=2, duration_s=180))
        with (
            patch("socket.socket", side_effect=AssertionError("socket opened")) as sock,
            patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
            patch("ssl.create_default_context", side_effect=AssertionError("ssl")) as ssl_ctx,
            patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect,
        ):
            result = plane.run()
        sock.assert_not_called()
        conn.assert_not_called()
        ssl_ctx.assert_not_called()
        connect.assert_not_called()
        self.assertTrue(result["dry_run"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["students"], 2)
        self.assertEqual(result["interval_s"], HEARTBEAT_INTERVAL_S)
        self.assertEqual(HEARTBEAT_INTERVAL_S, 5.0)
        self.assertEqual(result["ticks_per_student"], 36)
        self.assertEqual(result["planned_connections"], 2)
        self.assertEqual(result["planned_heartbeats"], 72)
        self.assertEqual(result["path_prefix"], CLIENT_WS_PATH_PREFIX)
        self.assertIsNone(result["ws_base"])
        self.assertEqual(result["auth_purpose"], AUTH_PURPOSE)
        self.assertEqual(len(result["identities"]), 2)
        first = result["identities"][0]
        self.assertEqual(first["endpoint_id"], "loadtest_0000")
        self.assertEqual(first["path"], "/api/ws/clients/loadtest_0000")
        self.assertIsNone(first["url"])
        self.assertEqual(first["heartbeat"]["type"], "heartbeat")
        self.assertEqual(first["heartbeat"]["client_id"], "loadtest_0000")
        self.assertEqual(first["heartbeat"]["exam_id"], CONTEST_ID)
        self.assertIn("X-Endpoint-Signature", first["headers"])
        self.assertEqual(first["auth_purpose"], "client.websocket")

    def test_derives_ws_url_from_upload_base_without_connecting(self) -> None:
        plane = HeartbeatPlane(
            _config(students=1, vigil_upload_base=ISOLATED_HTTP, duration_s=5)
        )
        with patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect:
            result = plane.run()
        connect.assert_not_called()
        self.assertEqual(result["planned_connections"], 1)
        self.assertEqual(result["planned_heartbeats"], 1)
        self.assertEqual(result["ws_base"], ISOLATED_WS)
        url = result["identities"][0]["url"]
        self.assertTrue(url.startswith(f"{ISOLATED_WS}{CLIENT_WS_PATH_PREFIX}loadtest_0000"))
        self.assertIn("exam_id=", url)


class LiveHeartbeatSafetyTest(HeartbeatPlaneTestBase):
    def test_empty_base_tells_operator_to_use_isolated_vigil(self) -> None:
        plane = HeartbeatPlane(
            _live_config(self.identity_dir, vigil_ws_base="", vigil_upload_base="")
        )
        with (
            patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect,
            patch("socket.create_connection", side_effect=AssertionError("connect")),
            patch("socket.socket", side_effect=AssertionError("socket opened")),
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        connect.assert_not_called()
        self.assertEqual(str(ctx.exception), ISOLATED_VIGIL_REQUIRED)
        self.assertIn("isolated Vigil", str(ctx.exception))

    def test_refuses_production_host_without_allow_prod_screenshots(self) -> None:
        bases = (
            PROD_WS,
            f"ws://{PROD_VIGIL_HOST}.:8765",
            f"ws://[{'::ffff:' + PROD_VIGIL_HOST}]:8765",
            PROD_HTTP,
            "ws://10.01.235.155:8765",
            "ws://0xa01eb9b:8765",
            "ws://[::ffff:a01:eb9b]:8765",
        )
        for base in bases:
            with self.subTest(base=base):
                plane = HeartbeatPlane(
                    _live_config(self.identity_dir, vigil_ws_base=base, vigil_upload_base="")
                )
                with (
                    patch("socket.getaddrinfo", side_effect=OSError("dns disabled")),
                    patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect,
                    patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
                    patch("socket.socket", side_effect=AssertionError("socket opened")),
                ):
                    with self.assertRaises(safety.SafetyError) as ctx:
                        plane.run()
                connect.assert_not_called()
                conn.assert_not_called()
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
                        base = f"ws://[{host}]:8765"
                    else:
                        base = f"ws://{host}:8765"
                    plane = HeartbeatPlane(
                        _live_config(
                            self.identity_dir,
                            vigil_ws_base=base,
                            vigil_upload_base="",
                        )
                    )
                    with (
                        patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect,
                        patch("socket.create_connection", side_effect=AssertionError("connect")) as conn,
                        patch("socket.socket", side_effect=AssertionError("socket opened")),
                    ):
                        with self.assertRaises(safety.SafetyError) as ctx:
                            plane.run()
                    connect.assert_not_called()
                    conn.assert_not_called()
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

    def test_refuses_production_host_derived_from_upload_base(self) -> None:
        derived = (
            PROD_HTTP,
            f"http://{PROD_VIGIL_HOST}.:8765",
            f"http://[{'::ffff:' + PROD_VIGIL_HOST}]:8765",
        )
        for base in derived:
            with self.subTest(base=base):
                plane = HeartbeatPlane(
                    _live_config(self.identity_dir, vigil_ws_base="", vigil_upload_base=base)
                )
                with patch("socket.create_connection", side_effect=AssertionError("connect")) as conn:
                    with self.assertRaises(safety.SafetyError) as ctx:
                        plane.run()
                conn.assert_not_called()
                self.assertIn(PROD_VIGIL_HOST, str(ctx.exception))
                self.assertIn("allow_prod_screenshots", str(ctx.exception))

    def test_refuses_redirect_to_production_host_without_allow_prod_screenshots(self) -> None:
        config = _config(vigil_ws_base=ISOLATED_WS, allow_prod_screenshots=False)
        isolated = f"{ISOLATED_WS}{CLIENT_WS_PATH_PREFIX}loadtest_0000"
        assert_ws_redirect_allowed(isolated, config)
        prod_urls = (
            f"{PROD_WS}{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"ws://{PROD_VIGIL_HOST}.:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"ws://[{'::ffff:' + PROD_VIGIL_HOST}]:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"{PROD_HTTP}{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"ws://10.01.235.155:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"ws://0xa01eb9b:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000",
            f"ws://[::ffff:a01:eb9b]:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000",
        )
        for prod_url in prod_urls:
            with self.subTest(prod_url=prod_url):
                parsed = urlparse(prod_url)
                if parsed.scheme in ("http", "https"):
                    with self.assertRaises(safety.SafetyError):
                        assert_ws_redirect_allowed(prod_url, config)
                    continue
                with self.assertRaises(safety.SafetyError) as ctx:
                    assert_ws_redirect_allowed(prod_url, config)
                self.assertIn(PROD_VIGIL_HOST, str(ctx.exception))
        prod_config = _config(vigil_ws_base=PROD_WS, allow_prod_screenshots=False)
        with self.assertRaises(safety.SafetyError) as ctx:
            assert_ws_redirect_allowed(
                f"{PROD_WS}{CLIENT_WS_PATH_PREFIX}loadtest_0000",
                prod_config,
            )
        self.assertIn("allow_prod_screenshots", str(ctx.exception))

    def test_redirect_to_production_does_not_open_prod_socket(self) -> None:
        isolated = f"{ISOLATED_WS}{CLIENT_WS_PATH_PREFIX}loadtest_0000"
        prod_location = f"http://{PROD_VIGIL_HOST}:8765{CLIENT_WS_PATH_PREFIX}loadtest_0000"
        response = (
            b"HTTP/1.1 302 Found\r\n"
            + f"Location: {prod_location}\r\n\r\n".encode("ascii")
        )

        class FakeSock:
            def __init__(self) -> None:
                self.sent = bytearray()
                self._payload = response

            def sendall(self, data: bytes) -> None:
                self.sent.extend(data)

            def recv(self, n: int) -> bytes:
                chunk = self._payload[:n]
                self._payload = self._payload[n:]
                return chunk

            def settimeout(self, timeout: float | None) -> None:
                return None

            def close(self) -> None:
                return None

            def shutdown(self, how: int) -> None:
                return None

        hosts: list[str] = []

        def fake_create_connection(address, timeout=None):
            host = address[0]
            hosts.append(host)
            if host == PROD_VIGIL_HOST or str(host).rstrip(".").endswith(PROD_VIGIL_HOST):
                raise AssertionError("connected to production Vigil")
            return FakeSock()

        config = _config(vigil_ws_base=ISOLATED_WS, allow_prod_screenshots=False)
        with patch("socket.create_connection", side_effect=fake_create_connection):
            with self.assertRaises(safety.SafetyError) as ctx:
                connect_websocket(isolated, {}, config)
        self.assertEqual(hosts, ["127.0.0.1"])
        self.assertIn(PROD_VIGIL_HOST, str(ctx.exception))
        self.assertIn("allow_prod_screenshots", str(ctx.exception))

    def test_refuses_recover_enroll_and_network_lock_bases(self) -> None:
        forbidden = (
            "http://127.0.0.1:9/api/endpoints/recover",
            "ws://127.0.0.1:9/endpoint-registrations",
            "http://127.0.0.1:9/enroll",
            "ws://127.0.0.1:9/network-lock/apply",
        )
        for base in forbidden:
            plane = HeartbeatPlane(_live_config(self.identity_dir, vigil_ws_base=base))
            with patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect:
                with self.assertRaises(safety.SafetyError) as ctx:
                    plane.run()
            connect.assert_not_called()
            self.assertIn("refusing", str(ctx.exception).lower())

    def test_live_missing_confirm_fails_before_connect(self) -> None:
        plane = HeartbeatPlane(_live_config(self.identity_dir, confirm=""))
        with patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect:
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        connect.assert_not_called()
        self.assertIn("LOADTEST", str(ctx.exception))

    def test_live_requires_cryptography_before_connect(self) -> None:
        plane = HeartbeatPlane(_live_config(self.identity_dir))
        with (
            patch(
                "heartbeat._require_cryptography",
                side_effect=safety.SafetyError(CRYPTOGRAPHY_REQUIRED),
            ),
            patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect,
        ):
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        connect.assert_not_called()
        self.assertEqual(str(ctx.exception), CRYPTOGRAPHY_REQUIRED)

    def test_live_missing_identities_fails_without_connect(self) -> None:
        plane = HeartbeatPlane(_live_config(self.identity_dir))
        with patch.object(HeartbeatPlane, "_connect", side_effect=AssertionError("connect")) as connect:
            with self.assertRaises(safety.SafetyError) as ctx:
                plane.run()
        connect.assert_not_called()
        self.assertIn("generate_identities", str(ctx.exception))
        self.assertIn("ScreenshotPlane", str(ctx.exception))


class ResolveWsBaseTest(unittest.TestCase):
    def test_prefers_vigil_ws_base(self) -> None:
        config = _config(vigil_ws_base="wss://isolated.example:9443", vigil_upload_base=ISOLATED_HTTP)
        self.assertEqual(resolve_ws_base(config), "wss://isolated.example:9443")

    def test_derives_http_to_ws_and_https_to_wss(self) -> None:
        http_config = _config(vigil_upload_base="http://127.0.0.1:18765/api/uploads/screenshots")
        self.assertEqual(resolve_ws_base(http_config), ISOLATED_WS)
        https_config = _config(vigil_ws_base="", vigil_upload_base="https://isolated.example")
        self.assertEqual(resolve_ws_base(https_config), "wss://isolated.example")

    def test_empty_both_is_empty(self) -> None:
        self.assertEqual(resolve_ws_base(_config()), "")


class SigningProtocolTest(HeartbeatPlaneTestBase):
    def test_headers_match_server_authenticated_websocket_contract(self) -> None:
        from cryptography.hazmat.primitives import hashes
        from heartbeat import _require_cryptography
        from screenshots import ScreenshotPlane

        plane = ScreenshotPlane(_config(identity_dir=self.identity_dir))
        record = plane.generate_identities(1)[0]
        _, serialization, ec = _require_cryptography()
        pem_path = self.identity_dir / f"{record['endpoint_id']}.pem"
        private_key = serialization.load_pem_private_key(pem_path.read_bytes(), password=None)
        headers = authenticated_websocket_headers(
            record["endpoint_id"],
            private_key,
            machine_fingerprint=record["machine_fingerprint"],
        )
        self.assertEqual(headers["X-Endpoint-Protocol-Version"], "1")
        self.assertEqual(
            headers["X-Endpoint-Machine-Fingerprint"],
            record["machine_fingerprint"],
        )
        self.assertNotIn("X-Endpoint-Body-SHA256", headers)
        public_key = serialization.load_pem_public_key(record["public_key_pem"].encode("ascii"))
        signed = {
            "authPurpose": "client.websocket",
            "endpointId": record["endpoint_id"],
            "issuedAt": headers["X-Endpoint-Issued-At"],
            "machineFingerprint": record["machine_fingerprint"],
            "nonce": headers["X-Endpoint-Nonce"],
            "protocolVersion": 1,
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


class StdlibWebSocketClientTest(HeartbeatPlaneTestBase):
    def test_upgrade_and_masked_text_heartbeat(self) -> None:
        from screenshots import ScreenshotPlane

        ScreenshotPlane(_config(identity_dir=self.identity_dir)).generate_identities(1)
        received: dict[str, object] = {}
        ready = threading.Event()
        done = threading.Event()
        errors: list[str] = []

        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind(("127.0.0.1", 0))
        port = server.getsockname()[1]
        server.listen(1)
        server.settimeout(5)

        def serve() -> None:
            try:
                ready.set()
                conn, _addr = server.accept()
                with conn:
                    buf = b""
                    while b"\r\n\r\n" not in buf:
                        chunk = conn.recv(4096)
                        if not chunk:
                            raise RuntimeError("client closed during upgrade")
                        buf += chunk
                    header, leftover = buf.split(b"\r\n\r\n", 1)
                    lines = header.decode("iso-8859-1").split("\r\n")
                    headers = {}
                    for line in lines[1:]:
                        name, _, value = line.partition(":")
                        headers[name.strip().lower()] = value.strip()
                    self.assertTrue(lines[0].startswith("GET /api/ws/clients/loadtest_0000"))
                    self.assertEqual(headers["upgrade"].lower(), "websocket")
                    self.assertIn("x-endpoint-signature", headers)
                    self.assertEqual(headers["x-endpoint-protocol-version"], "1")
                    key = headers["sec-websocket-key"]
                    accept = base64.b64encode(
                        hashlib.sha1(
                            (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
                        ).digest()
                    ).decode("ascii")
                    conn.sendall(
                        (
                            "HTTP/1.1 101 Switching Protocols\r\n"
                            "Upgrade: websocket\r\n"
                            "Connection: Upgrade\r\n"
                            f"Sec-WebSocket-Accept: {accept}\r\n"
                            "\r\n"
                        ).encode("ascii")
                    )
                    frame_buf = leftover
                    while len(frame_buf) < 2:
                        frame_buf += conn.recv(4096)
                    b1 = frame_buf[1]
                    self.assertTrue(b1 & 0x80, "client frames must be masked")
                    length = b1 & 0x7F
                    idx = 2
                    if length == 126:
                        while len(frame_buf) < 4:
                            frame_buf += conn.recv(4096)
                        length = struct.unpack("!H", frame_buf[2:4])[0]
                        idx = 4
                    while len(frame_buf) < idx + 4 + length:
                        frame_buf += conn.recv(4096)
                    mask = frame_buf[idx : idx + 4]
                    idx += 4
                    payload = bytes(
                        b ^ mask[i % 4] for i, b in enumerate(frame_buf[idx : idx + length])
                    )
                    received["json"] = json.loads(payload.decode("utf-8"))
            except Exception as exc:
                errors.append(f"{type(exc).__name__}: {exc}")
            finally:
                done.set()
                try:
                    server.close()
                except OSError:
                    pass

        thread = threading.Thread(target=serve, name="ws-test-server", daemon=True)
        thread.start()
        self.assertTrue(ready.wait(timeout=2))
        plane = HeartbeatPlane(
            _live_config(
                self.identity_dir,
                vigil_ws_base=f"ws://127.0.0.1:{port}",
                duration_s=1,
            )
        )
        try:
            result = plane.run()
        finally:
            plane.stop()
            self.assertTrue(done.wait(timeout=5))
            thread.join(timeout=2)
        self.assertEqual(errors, [])
        self.assertTrue(result["ok"], result.get("errors"))
        self.assertGreaterEqual(result["succeeded"], 1)
        payload = received["json"]
        assert isinstance(payload, dict)
        self.assertEqual(payload["type"], "heartbeat")
        self.assertEqual(payload["client_id"], "loadtest_0000")
        self.assertEqual(payload["exam_id"], CONTEST_ID)

    def test_assert_live_allowed_accepts_isolated_ws(self) -> None:
        url = assert_heartbeat_live_allowed(_live_config(self.identity_dir))
        self.assertEqual(url, ISOLATED_WS)

    def test_client_ws_url_path(self) -> None:
        url = client_ws_url(_config(vigil_ws_base=ISOLATED_WS), "loadtest_0000")
        self.assertTrue(url.startswith(f"{ISOLATED_WS}/api/ws/clients/loadtest_0000?"))


if __name__ == "__main__":
    unittest.main()

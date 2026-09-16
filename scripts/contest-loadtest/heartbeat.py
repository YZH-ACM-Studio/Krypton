"""Student Client WebSocket heartbeat plane for the contest load-test harness.

Connects to {ws_base}/api/ws/clients/{endpoint_id} with ECDSA P-256
X-Endpoint-* headers (purpose client.websocket) and sends JSON
{"type":"heartbeat",...} every 5s. stdlib only + optional cryptography.
Reuses identity PEM files written by ScreenshotPlane.generate_identities.
Never mints keys, never POSTs keys, never calls recover/enroll/network-lock.

HARD SAFETY:
- live only when vigil_ws_base is set, or vigil_upload_base can be derived
  (http->ws, https->wss)
- empty base -> SafetyError; isolated Vigil required
- host 10.1.235.155 / trailing-dot / IPv4-mapped / alternate IP encodings
  refused unless allow_prod_screenshots
- cryptography required for live
- redirects must not follow to the production host
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import logging
import secrets
import socket
import ssl
import struct
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse

import safety
from config import LoadtestConfig

LOG = logging.getLogger("contest-loadtest.heartbeat")
LOG.addHandler(logging.NullHandler())

PROD_VIGIL_HOST = "10.1.235.155"
HEARTBEAT_INTERVAL_S = 5.0
CLIENT_WS_PATH_PREFIX = "/api/ws/clients/"
AUTH_PURPOSE = "client.websocket"
REQUEST_TIMEOUT_S = 15
MAX_REDIRECTS = 5
HEADER_MAX_BYTES = 65536
MAX_FRAME_BYTES = 1_000_000
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
CLIENT_VERSION = "loadtest"
CLIENT_PROTOCOL_VERSION = 2
CRYPTOGRAPHY_REQUIRED = "cryptography package required on the loadgen (not on oj)"
ISOLATED_VIGIL_REQUIRED = (
    "live client heartbeats require config.vigil_ws_base (or vigil_upload_base "
    "to derive ws/wss) pointing at an isolated Vigil; default is empty. Do not "
    f"mint credentials onto production Vigil ({PROD_VIGIL_HOST})."
)

_IDENTITY_URL_SNIPPETS = (
    "/api/endpoints/recover",
    "/endpoint-registrations",
    "enroll",
    "network-lock",
    "apply_network_policy",
    "network-execution",
)

_SIGNING_HEADER_NAMES = (
    "X-Endpoint-Protocol-Version",
    "X-Endpoint-Issued-At",
    "X-Endpoint-Nonce",
    "X-Endpoint-Machine-Fingerprint",
    "X-Endpoint-Signature",
)

_REDIRECT_STATUS = {301, 302, 303, 307, 308}


class _LoadedIdentity:
    def __init__(
        self,
        *,
        endpoint_id: str,
        machine_id: str,
        machine_fingerprint: str,
        pem_path: Path,
        private_key: Any,
    ) -> None:
        self.endpoint_id = endpoint_id
        self.machine_id = machine_id
        self.machine_fingerprint = machine_fingerprint
        self.pem_path = pem_path
        self.private_key = private_key


def _require_cryptography():
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except ImportError as exc:
        raise safety.SafetyError(CRYPTOGRAPHY_REQUIRED) from exc
    return hashes, serialization, ec


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _utc_ms() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _canonical_json(payload: dict[str, object]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _refuse_ws_url(url: str) -> str:
    safety.refuse_forbidden_url(url)
    lowered = (url or "").lower()
    for snippet in _IDENTITY_URL_SNIPPETS:
        if snippet in lowered:
            raise safety.SafetyError(
                "refusing URL that touches endpoint recover, enroll, "
                f"registrations, or network-lock: {url}"
            )
    return url


def _normalize_hostname(host: str) -> str:
    return (host or "").lower().rstrip(".")


_PROD_V4 = ipaddress.IPv4Address(PROD_VIGIL_HOST)
_IPV4_PART_WIDTHS = {
    1: (32,),
    2: (8, 24),
    3: (8, 8, 16),
    4: (8, 8, 8, 8),
}


def _strip_host_literal(host: str) -> str:
    text = (host or "").strip().lower()
    if text.startswith("[") and text.endswith("]"):
        text = text[1:-1]
    if "%" in text:
        text = text.split("%", 1)[0]
    return text


def _literal_is_prod_vigil(addr: str) -> bool:
    text = _strip_host_literal(addr)
    try:
        parsed = ipaddress.ip_address(text)
    except ValueError:
        return False
    if parsed == _PROD_V4:
        return True
    return isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped == _PROD_V4


def _ipv4_field_values(field: str) -> tuple[int, ...]:
    token = field.strip().lower()
    if not token:
        return ()
    if token.startswith("0x"):
        try:
            return (int(token, 16),)
        except ValueError:
            return ()
    if not token.isdigit():
        return ()
    values = [int(token, 10)]
    if len(token) > 1 and token[0] == "0" and all(ch in "01234567" for ch in token):
        octal = int(token, 8)
        if octal != values[0]:
            values.append(octal)
    return tuple(values)


def _packed_ipv4_candidates(host: str) -> set[bytes]:
    text = _strip_host_literal(host)
    packed: set[bytes] = set()
    try:
        packed.add(socket.inet_aton(text))
    except OSError:
        pass
    try:
        packed.add(socket.inet_pton(socket.AF_INET, text))
    except OSError:
        pass
    parts = text.split(".")
    if not 1 <= len(parts) <= 4:
        return packed
    fields = [_ipv4_field_values(part) for part in parts]
    if any(len(item) == 0 for item in fields):
        return packed
    widths = _IPV4_PART_WIDTHS[len(parts)]

    def walk(index: int, acc: int) -> None:
        if index == len(fields):
            packed.add(acc.to_bytes(4, "big"))
            return
        width = widths[index]
        limit = 1 << width
        for value in fields[index]:
            if 0 <= value < limit:
                walk(index + 1, (acc << width) | value)

    walk(0, 0)
    return packed


def _text_is_prod_vigil(host: str) -> bool:
    # Keep exact/trailing-dot/IPv4-mapped string matches, then parse encodings
    # locally so a DNS failure cannot fail-open (octal, hex, 3-part, mapped).
    text = _strip_host_literal(host).rstrip(".")
    if not text:
        return False
    if text == PROD_VIGIL_HOST:
        return True
    ipv4_mapped_prefix = "::ffff:"
    if text.startswith(ipv4_mapped_prefix):
        mapped = _normalize_hostname(text[len(ipv4_mapped_prefix) :])
        if mapped == PROD_VIGIL_HOST:
            return True
    if _literal_is_prod_vigil(text):
        return True
    prod_packed = _PROD_V4.packed
    if prod_packed in _packed_ipv4_candidates(text):
        return True
    if ":" in text:
        idx = text.rfind(":")
        suffix = text[idx + 1 :]
        prefix = text[: idx + 1]
        if suffix and prod_packed in _packed_ipv4_candidates(suffix):
            if _literal_is_prod_vigil(prefix + PROD_VIGIL_HOST):
                return True
    return False


def _is_prod_vigil_host(host: str) -> bool:
    if _text_is_prod_vigil(host):
        return True
    raw = _strip_host_literal(host)
    if not raw:
        return False
    try:
        results = socket.getaddrinfo(raw, None)
    except OSError:
        return False
    for _family, _type, _proto, _canon, sockaddr in results:
        if not sockaddr:
            continue
        address = str(sockaddr[0])
        if _text_is_prod_vigil(address) or _literal_is_prod_vigil(address):
            return True
    return False


def _ws_origin(url: str) -> str:
    parsed = urlparse((url or "").strip())
    scheme = (parsed.scheme or "").lower()
    if scheme == "http":
        scheme = "ws"
    elif scheme == "https":
        scheme = "wss"
    elif scheme in ("ws", "wss"):
        pass
    else:
        raise safety.SafetyError(
            f"vigil_ws_base must be ws(s) or http(s) to derive a WebSocket origin, got {url!r}"
        )
    if not parsed.netloc:
        raise safety.SafetyError(f"vigil_ws_base missing host: {url!r}")
    return f"{scheme}://{parsed.netloc}"


def resolve_ws_base(config: LoadtestConfig) -> str:
    """Return ws(s) origin from vigil_ws_base, else derived from vigil_upload_base."""
    explicit = (config.vigil_ws_base or "").strip()
    upload = (config.vigil_upload_base or "").strip()
    raw = explicit or upload
    if not raw:
        return ""
    _refuse_ws_url(raw)
    return _ws_origin(raw)


def client_ws_url(config: LoadtestConfig, endpoint_id: str) -> str:
    base = resolve_ws_base(config)
    if not base:
        return ""
    path = f"{CLIENT_WS_PATH_PREFIX}{endpoint_id}"
    query = urlencode({"hostname": endpoint_id, "exam_id": config.contest_id})
    return _refuse_ws_url(f"{base}{path}?{query}")


def _expected_ws_host(config: LoadtestConfig) -> str:
    base = resolve_ws_base(config)
    return _normalize_hostname(urlparse(base).hostname or "")


def _assert_ws_path(path: str) -> None:
    if not path.startswith(CLIENT_WS_PATH_PREFIX):
        raise safety.SafetyError(
            f"refusing websocket path {path!r}; expected to start with {CLIENT_WS_PATH_PREFIX}"
        )
    rest = path[len(CLIENT_WS_PATH_PREFIX) :]
    if not rest or "/" in rest:
        raise safety.SafetyError(
            f"refusing websocket path {path!r}; expected {CLIENT_WS_PATH_PREFIX}<endpoint_id>"
        )


def _assert_ws_target_allowed(url: str, config: LoadtestConfig, *, kind: str) -> None:
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("ws", "wss"):
        raise safety.SafetyError(f"refusing {kind} URL with scheme {scheme!r}: {url}")
    host = _normalize_hostname(parsed.hostname or "")
    if _is_prod_vigil_host(host) and not config.allow_prod_screenshots:
        raise safety.SafetyError(
            f"refusing websocket {kind} to production Vigil host {PROD_VIGIL_HOST}; "
            "point vigil_ws_base at an isolated Vigil or set allow_prod_screenshots=True"
        )
    expected = _expected_ws_host(config)
    if host != expected:
        raise safety.SafetyError(
            f"refusing websocket {kind} host {host!r}; expected {expected!r} from vigil_ws_base"
        )
    _assert_ws_path(parsed.path or "")


def assert_ws_redirect_allowed(url: str, config: LoadtestConfig) -> None:
    _refuse_ws_url(url)
    _assert_ws_target_allowed(url, config, kind="redirect")


def assert_heartbeat_live_allowed(config: LoadtestConfig) -> str:
    """Return the live ws(s) origin. Fail closed before any socket."""
    safety.require_confirm(config.confirm, dry_run=False)
    denied = safety.load_denylist()
    if not denied:
        raise safety.SafetyError(
            f"live run requires at least one valid 24-hex contest id in {safety.DENYLIST_PATH.name}. "
            "Empty or comments-only denylist is fail-closed."
        )
    base = resolve_ws_base(config)
    if not base:
        raise safety.SafetyError(ISOLATED_VIGIL_REQUIRED)
    parsed = urlparse(base)
    if parsed.scheme not in ("ws", "wss"):
        raise safety.SafetyError(f"vigil_ws_base must be ws(s) after derivation, got {base!r}")
    host = _normalize_hostname(parsed.hostname or "")
    if _is_prod_vigil_host(host) and not config.allow_prod_screenshots:
        raise safety.SafetyError(
            f"refusing live client websocket to production Vigil host {PROD_VIGIL_HOST}; "
            "point vigil_ws_base at an isolated Vigil or set allow_prod_screenshots=True"
        )
    return base


def authenticated_websocket_headers(
    endpoint_id: str,
    private_key: Any,
    *,
    machine_fingerprint: str,
    auth_purpose: str = AUTH_PURPOSE,
) -> dict[str, str]:
    """ECDSA P-256 headers matching Server tests/endpoint_test_identity.py."""
    if auth_purpose != AUTH_PURPOSE:
        raise safety.SafetyError(
            f"heartbeat plane only signs {AUTH_PURPOSE!r}, got {auth_purpose!r}"
        )
    hashes, _serialization, ec = _require_cryptography()
    issued_at = _utc_ms()
    nonce = secrets.token_urlsafe(24)
    signed: dict[str, object] = {
        "authPurpose": auth_purpose,
        "endpointId": endpoint_id,
        "issuedAt": issued_at,
        "machineFingerprint": machine_fingerprint,
        "nonce": nonce,
        "protocolVersion": 1,
    }
    signature = _b64url(private_key.sign(_canonical_json(signed), ec.ECDSA(hashes.SHA256())))
    return {
        "X-Endpoint-Protocol-Version": "1",
        "X-Endpoint-Issued-At": issued_at,
        "X-Endpoint-Nonce": nonce,
        "X-Endpoint-Machine-Fingerprint": machine_fingerprint,
        "X-Endpoint-Signature": signature,
    }


def heartbeat_message(
    *,
    endpoint_id: str,
    machine_id: str,
    contest_id: str,
    sequence: int,
    sent_at: str = "",
) -> dict[str, object]:
    return {
        "type": "heartbeat",
        "client_id": endpoint_id,
        "exam_id": contest_id,
        "activeExamSessionId": "",
        "clientProtocolVersion": CLIENT_PROTOCOL_VERSION,
        "clientVersion": CLIENT_VERSION,
        "hostname": machine_id,
        "sent_at": sent_at or _utc_ms(),
        "sequence": str(sequence),
    }


def _ticks_per_student(config: LoadtestConfig) -> int:
    interval = float(HEARTBEAT_INTERVAL_S)
    if interval <= 0:
        raise safety.SafetyError(f"heartbeat interval must be > 0, got {interval!r}")
    return max(1, int(config.duration_s // interval))


def _encode_frame(opcode: int, payload: bytes) -> bytes:
    if not 0 <= opcode <= 15:
        raise ValueError(f"invalid websocket opcode {opcode}")
    if len(payload) > MAX_FRAME_BYTES:
        raise RuntimeError("websocket frame too large")
    header = bytearray()
    header.append(0x80 | opcode)
    length = len(payload)
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    mask = secrets.token_bytes(4)
    header.extend(mask)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return bytes(header) + masked


def _parse_frame(buf: bytes) -> tuple[int, bytes, bytes] | None:
    if len(buf) < 2:
        return None
    b0, b1 = buf[0], buf[1]
    if (b0 & 0x70) != 0:
        raise RuntimeError("websocket RSV bits must be 0")
    if (b0 & 0x80) == 0:
        raise RuntimeError("fragmented websocket frames are not supported")
    opcode = b0 & 0x0F
    masked = bool(b1 & 0x80)
    length = b1 & 0x7F
    idx = 2
    if length == 126:
        if len(buf) < 4:
            return None
        length = struct.unpack("!H", buf[2:4])[0]
        idx = 4
    elif length == 127:
        if len(buf) < 10:
            return None
        length = struct.unpack("!Q", buf[2:10])[0]
        idx = 10
    if length > MAX_FRAME_BYTES:
        raise RuntimeError("websocket frame too large")
    if masked:
        if len(buf) < idx + 4 + length:
            return None
        mask = buf[idx : idx + 4]
        idx += 4
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(buf[idx : idx + length]))
        rest = buf[idx + length :]
    else:
        if len(buf) < idx + length:
            return None
        payload = buf[idx : idx + length]
        rest = buf[idx + length :]
    return opcode, payload, rest


def _host_header(parsed) -> str:
    hostname = parsed.hostname or ""
    port = parsed.port
    if ":" in hostname:
        host = f"[{hostname}]"
    else:
        host = hostname
    default = 443 if parsed.scheme in ("wss", "https") else 80
    if port and port != default:
        return f"{host}:{port}"
    return host


def _connect_host_port(parsed) -> tuple[str, int]:
    hostname = parsed.hostname or ""
    if not hostname:
        raise safety.SafetyError(f"websocket URL missing host: {parsed.geturl()}")
    if parsed.port:
        port = parsed.port
    else:
        port = 443 if parsed.scheme in ("wss", "https") else 80
    return hostname, port


def _read_http_response(sock: socket.socket) -> tuple[bytes, bytes]:
    buf = bytearray()
    while b"\r\n\r\n" not in buf:
        if len(buf) > HEADER_MAX_BYTES:
            raise RuntimeError("HTTP response headers too large during websocket upgrade")
        chunk = sock.recv(4096)
        if not chunk:
            raise RuntimeError("connection closed during HTTP websocket upgrade")
        buf.extend(chunk)
    header, leftover = bytes(buf).split(b"\r\n\r\n", 1)
    return header, leftover


def _parse_http_headers(raw: bytes) -> tuple[int, dict[str, str]]:
    text = raw.decode("iso-8859-1")
    lines = text.split("\r\n")
    if not lines:
        raise RuntimeError("empty HTTP response during websocket upgrade")
    parts = lines[0].split(" ", 2)
    if len(parts) < 2:
        raise RuntimeError(f"malformed HTTP status line: {lines[0]!r}")
    try:
        status = int(parts[1])
    except ValueError as exc:
        raise RuntimeError(f"malformed HTTP status line: {lines[0]!r}") from exc
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line:
            continue
        name, sep, value = line.partition(":")
        if not sep:
            raise RuntimeError(f"malformed HTTP header: {line!r}")
        headers[name.strip().lower()] = value.strip()
    return status, headers


def _ws_accept(key: str) -> str:
    digest = hashlib.sha1((key + WS_GUID).encode("ascii"), usedforsecurity=False).digest()
    return base64.b64encode(digest).decode("ascii")


def _normalize_ws_redirect(current: str, location: str) -> str:
    joined = urljoin(current, location)
    parsed = urlparse(joined)
    scheme = (parsed.scheme or "").lower()
    if scheme == "http":
        parsed = parsed._replace(scheme="ws")
    elif scheme == "https":
        parsed = parsed._replace(scheme="wss")
    elif scheme in ("ws", "wss"):
        pass
    else:
        raise safety.SafetyError(f"unsupported websocket redirect scheme: {joined}")
    return parsed.geturl()


def _build_upgrade_request(parsed, headers: dict[str, str], key: str) -> bytes:
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    lines = [
        f"GET {path} HTTP/1.1",
        f"Host: {_host_header(parsed)}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        f"Sec-WebSocket-Key: {key}",
    ]
    for name, value in headers.items():
        if name.lower() in {"host", "upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "referer"}:
            continue
        lines.append(f"{name}: {value}")
    return ("\r\n".join(lines) + "\r\n\r\n").encode("ascii")


class WebSocketClient:
    """Minimal RFC 6455 client: text frames, ping/pong, close. Client frames are masked."""

    def __init__(self, sock: socket.socket, leftover: bytes = b"") -> None:
        self._sock = sock
        self._buf = bytearray(leftover)
        self._closed = False

    def send_text(self, text: str) -> None:
        if self._closed:
            raise RuntimeError("websocket is closed")
        payload = text.encode("utf-8")
        self._sock.settimeout(REQUEST_TIMEOUT_S)
        self._sock.sendall(_encode_frame(0x1, payload))

    def send_pong(self, data: bytes) -> None:
        if self._closed:
            return
        self._sock.settimeout(REQUEST_TIMEOUT_S)
        self._sock.sendall(_encode_frame(0xA, data))

    def recv(self, timeout: float | None) -> tuple[int, bytes] | None:
        if self._closed:
            raise RuntimeError("websocket is closed")
        while True:
            parsed = _parse_frame(bytes(self._buf))
            if parsed is not None:
                opcode, payload, rest = parsed
                self._buf = bytearray(rest)
                return opcode, payload
            self._sock.settimeout(timeout)
            try:
                chunk = self._sock.recv(4096)
            except TimeoutError:
                return None
            except OSError as exc:
                if self._closed:
                    raise RuntimeError("websocket is closed") from exc
                raise
            if not chunk:
                raise RuntimeError("websocket closed by peer")
            self._buf.extend(chunk)
            if len(self._buf) > MAX_FRAME_BYTES + 16:
                raise RuntimeError("websocket buffer exceeded frame limit")

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._sock.sendall(_encode_frame(0x8, struct.pack("!H", 1000)))
        except OSError:
            pass
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self._sock.close()
        except OSError:
            pass


def connect_websocket(
    url: str,
    headers: dict[str, str],
    config: LoadtestConfig,
) -> WebSocketClient:
    """HTTP upgrade + optional safe redirects. Never follows to production Vigil."""
    current = _refuse_ws_url(url)
    redirects = 0
    while True:
        _assert_ws_target_allowed(current, config, kind="connect")
        parsed = urlparse(current)
        host, port = _connect_host_port(parsed)
        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        raw_sock = socket.create_connection((host, port), timeout=REQUEST_TIMEOUT_S)
        sock: socket.socket = raw_sock
        try:
            if parsed.scheme == "wss":
                ctx = ssl.create_default_context()
                sock = ctx.wrap_socket(raw_sock, server_hostname=host)
            sock.settimeout(REQUEST_TIMEOUT_S)
            sock.sendall(_build_upgrade_request(parsed, headers, key))
            raw_headers, leftover = _read_http_response(sock)
            status, response_headers = _parse_http_headers(raw_headers)
            if status in _REDIRECT_STATUS:
                location = response_headers.get("location") or ""
                sock.close()
                if not location:
                    raise RuntimeError(f"websocket redirect HTTP {status} missing Location")
                current = _normalize_ws_redirect(current, location)
                assert_ws_redirect_allowed(current, config)
                redirects += 1
                if redirects > MAX_REDIRECTS:
                    raise RuntimeError(f"too many websocket redirects from {url}")
                continue
            if status != 101:
                raise RuntimeError(f"HTTP {status} websocket upgrade {current}")
            accept = response_headers.get("sec-websocket-accept") or ""
            if accept != _ws_accept(key):
                raise RuntimeError("invalid Sec-WebSocket-Accept during upgrade")
            return WebSocketClient(sock, leftover)
        except BaseException:
            for item in (sock, raw_sock):
                try:
                    item.close()
                except OSError:
                    pass
            raise


def _load_identities(config: LoadtestConfig, n: int) -> list[_LoadedIdentity]:
    _, serialization, _ = _require_cryptography()
    identity_dir = Path(config.identity_dir)
    loaded: list[_LoadedIdentity] = []
    missing: list[str] = []
    for index in range(n):
        endpoint_id = config.machine_id(index)
        pem_path = identity_dir / f"{endpoint_id}.pem"
        json_path = identity_dir / f"{endpoint_id}.json"
        if not pem_path.is_file() or not json_path.is_file():
            missing.append(endpoint_id)
            continue
        raw = json.loads(json_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict) or raw.get("endpoint_id") != endpoint_id:
            raise safety.SafetyError(
                f"identity json {json_path} does not match endpoint {endpoint_id}"
            )
        machine_id = str(raw.get("machine_id") or endpoint_id)
        fingerprint = str(raw.get("machine_fingerprint") or "")
        expected = hashlib.sha256(machine_id.encode("utf-8")).hexdigest()
        if fingerprint != expected:
            raise safety.SafetyError(
                f"identity {endpoint_id} machine_fingerprint does not match machine_id"
            )
        private_key = serialization.load_pem_private_key(pem_path.read_bytes(), password=None)
        loaded.append(
            _LoadedIdentity(
                endpoint_id=endpoint_id,
                machine_id=machine_id,
                machine_fingerprint=fingerprint,
                pem_path=pem_path,
                private_key=private_key,
            )
        )
    if missing:
        raise safety.SafetyError(
            f"live heartbeat run needs {n} identities in {identity_dir}; "
            f"missing {missing}. Call ScreenshotPlane.generate_identities({n}) first "
            "(local P-256 keys, never POSTed)."
        )
    return loaded


class HeartbeatPlane:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config
        self._stop = threading.Event()
        self._started = False
        self._lock = threading.Lock()
        self._clients: list[WebSocketClient] = []
        self._attempted = 0
        self._succeeded = 0
        self._failed = 0
        self._errors: list[str] = []

    def run(self) -> dict[str, Any]:
        """dry_run plans N connections with no sockets. live heartbeats on isolated Vigil."""
        if self._started:
            raise RuntimeError("HeartbeatPlane.run() already called")
        safety.assert_ready(self.config)
        ticks = _ticks_per_student(self.config)
        planned_connections = self.config.students
        planned_heartbeats = planned_connections * ticks
        if self.config.dry_run:
            self._started = True
            return self._plan(
                ticks=ticks,
                planned_connections=planned_connections,
                planned_heartbeats=planned_heartbeats,
            )
        ws_base = assert_heartbeat_live_allowed(self.config)
        _require_cryptography()
        identities = _load_identities(self.config, self.config.students)
        self._started = True
        self._stop.clear()
        threads = [
            threading.Thread(
                target=self._student_loop,
                name=f"heartbeat-{identity.endpoint_id}",
                args=(identity, ticks),
                daemon=True,
            )
            for identity in identities
        ]
        try:
            for thread in threads:
                thread.start()
            deadline = time.monotonic() + float(self.config.duration_s)
            for thread in threads:
                remaining = deadline - time.monotonic()
                thread.join(timeout=max(0.0, remaining))
        finally:
            self.stop()
            for thread in threads:
                thread.join(timeout=REQUEST_TIMEOUT_S + 1.0)
        errors = list(self._errors)
        result = {
            "dry_run": False,
            "ok": self._failed == 0 and self._attempted > 0,
            "students": self.config.students,
            "interval_s": HEARTBEAT_INTERVAL_S,
            "duration_s": self.config.duration_s,
            "ticks_per_student": ticks,
            "planned_connections": planned_connections,
            "planned_heartbeats": planned_heartbeats,
            "attempted": self._attempted,
            "succeeded": self._succeeded,
            "failed": self._failed,
            "ws_base": ws_base,
            "path_prefix": CLIENT_WS_PATH_PREFIX,
            "auth_purpose": AUTH_PURPOSE,
            "errors": errors,
        }
        LOG.info(
            "heartbeat plane finished %s",
            {k: v for k, v in result.items() if k != "errors"},
        )
        return result

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            clients = list(self._clients)
            self._clients.clear()
        for client in clients:
            client.close()

    def _plan(
        self,
        *,
        ticks: int,
        planned_connections: int,
        planned_heartbeats: int,
    ) -> dict[str, Any]:
        base = resolve_ws_base(self.config)
        identities: list[dict[str, Any]] = []
        for index in range(self.config.students):
            endpoint_id = self.config.machine_id(index)
            url = client_ws_url(self.config, endpoint_id) if base else None
            identities.append(
                {
                    "index": index,
                    "endpoint_id": endpoint_id,
                    "machine_id": endpoint_id,
                    "path": f"{CLIENT_WS_PATH_PREFIX}{endpoint_id}",
                    "url": url,
                    "interval_s": HEARTBEAT_INTERVAL_S,
                    "ticks": ticks,
                    "auth_purpose": AUTH_PURPOSE,
                    "headers": list(_SIGNING_HEADER_NAMES),
                    "heartbeat": {
                        "type": "heartbeat",
                        "client_id": endpoint_id,
                        "exam_id": self.config.contest_id,
                    },
                }
            )
        return {
            "dry_run": True,
            "ok": True,
            "students": self.config.students,
            "interval_s": HEARTBEAT_INTERVAL_S,
            "duration_s": self.config.duration_s,
            "ticks_per_student": ticks,
            "planned_connections": planned_connections,
            "planned_heartbeats": planned_heartbeats,
            "path_prefix": CLIENT_WS_PATH_PREFIX,
            "ws_base": base or None,
            "auth_purpose": AUTH_PURPOSE,
            "identities": identities,
        }

    def _connect(self, url: str, headers: dict[str, str]) -> WebSocketClient:
        _refuse_ws_url(url)
        if "Referer" in headers or "referer" in headers:
            raise RuntimeError(f"refusing to send Referer to {url}")
        return connect_websocket(url, headers, self.config)

    def _student_loop(self, identity: _LoadedIdentity, ticks: int) -> None:
        url = client_ws_url(self.config, identity.endpoint_id)
        client: WebSocketClient | None = None
        try:
            headers = authenticated_websocket_headers(
                identity.endpoint_id,
                identity.private_key,
                machine_fingerprint=identity.machine_fingerprint,
            )
            client = self._connect(url, headers)
            with self._lock:
                self._clients.append(client)
            LOG.info("heartbeat connected endpoint=%s url=%s", identity.endpoint_id, url)
            for tick in range(ticks):
                if self._stop.is_set():
                    return
                self._send_heartbeat(client, identity, tick + 1)
                if tick + 1 >= ticks or self._stop.is_set():
                    return
                self._wait_and_drain(client, HEARTBEAT_INTERVAL_S)
        except Exception as exc:
            LOG.error(
                "heartbeat failed endpoint=%s err=%s",
                identity.endpoint_id,
                exc,
            )
            with self._lock:
                self._failed += 1
                self._errors.append(
                    f"{identity.endpoint_id}: {type(exc).__name__}: {exc}"
                )
        finally:
            if client is not None:
                with self._lock:
                    if client in self._clients:
                        self._clients.remove(client)
                client.close()

    def _send_heartbeat(
        self,
        client: WebSocketClient,
        identity: _LoadedIdentity,
        sequence: int,
    ) -> None:
        message = heartbeat_message(
            endpoint_id=identity.endpoint_id,
            machine_id=identity.machine_id,
            contest_id=self.config.contest_id,
            sequence=sequence,
        )
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        if "BEGIN PRIVATE" in encoded or "BEGIN PUBLIC" in encoded:
            raise RuntimeError("refusing to send key material on heartbeat websocket")
        with self._lock:
            self._attempted += 1
        client.send_text(encoded)
        with self._lock:
            self._succeeded += 1
        LOG.debug(
            "heartbeat sent endpoint=%s sequence=%s",
            identity.endpoint_id,
            sequence,
        )

    def _wait_and_drain(self, client: WebSocketClient, seconds: float) -> None:
        if seconds <= 0:
            return
        deadline = time.monotonic() + seconds
        while not self._stop.is_set():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            try:
                frame = client.recv(timeout=min(remaining, 0.5))
            except (RuntimeError, OSError):
                return
            if frame is None:
                continue
            opcode, payload = frame
            if opcode == 0x8:
                return
            if opcode == 0x9:
                client.send_pong(payload)

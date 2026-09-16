"""Periodic JPEG screenshot upload plane for the contest load-test harness.

Matches Client capture/upload knobs: maxDimension 1280, JPEG quality 75,
interval 60s, POST multipart /api/uploads/screenshots with ECDSA P-256
X-Endpoint-* headers. stdlib + optional cryptography.

HARD SAFETY:
- never call /api/endpoints/recover, /endpoint-registrations, enroll, network-lock
- never mint credentials onto production Vigil
- local software P-256 keys stay in identity_dir; they are never POSTed
- live POST only when vigil_upload_base is set, host is not production
  (unless allow_prod_screenshots), confirm is LOADTEST, and the denylist
  is non-empty
"""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import logging
import secrets
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import safety
from config import LoadtestConfig

LOG = logging.getLogger("contest-loadtest.screenshots")
LOG.addHandler(logging.NullHandler())

PROD_VIGIL_HOST = "10.1.235.155"
MAX_DIMENSION = 1280
JPEG_QUALITY = 75
# Client screenshot upload cap is maxDimension 1280, not the 1920 RTMP scale.
JPEG_WIDTH = 1280
JPEG_HEIGHT = 720
MIME_TYPE = "image/jpeg"
UPLOAD_PATH = "/api/uploads/screenshots"
REASON_TAG = "scheduled"
REQUEST_TIMEOUT_S = 15
CRYPTOGRAPHY_REQUIRED = "cryptography package required on the loadgen (not on oj)"
ISOLATED_VIGIL_REQUIRED = (
    "live screenshot uploads require config.vigil_upload_base pointing at an "
    "isolated Vigil; default is empty. Do not mint credentials onto production "
    f"Vigil ({PROD_VIGIL_HOST})."
)

# 1x1 JPEG for unit tests that must not spawn ffmpeg.
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000"
    "ffdb004300010101010101010101010101010101"
    "0101010101010101010101010101010101010101"
    "0101010101010101010101010101010101010101"
    "01010101010101ffc0000b080001000101011100"
    "ffc4001400010000000000000000000000000000"
    "000affda00080001000100003f00ffd9"
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
    "X-Endpoint-Id",
    "X-Endpoint-Protocol-Version",
    "X-Endpoint-Issued-At",
    "X-Endpoint-Nonce",
    "X-Endpoint-Body-SHA256",
    "X-Endpoint-Machine-Fingerprint",
    "X-Endpoint-Signature",
)


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Follow redirects only onto allowed screenshot URLs; never send Referer."""

    def __init__(self, config: LoadtestConfig) -> None:
        super().__init__()
        self._config = config

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _refuse_screenshot_url(newurl)
        _assert_screenshot_redirect_allowed(newurl, self._config)
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        if new_req.has_header("Referer"):
            new_req.remove_header("Referer")
        _refuse_screenshot_url(new_req.full_url)
        _assert_screenshot_redirect_allowed(new_req.full_url, self._config)
        return new_req


@dataclass
class _LoadedIdentity:
    endpoint_id: str
    machine_id: str
    machine_fingerprint: str
    pem_path: Path
    private_key: Any


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


def _refuse_screenshot_url(url: str) -> str:
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


def _upload_host(base: str) -> str:
    return _normalize_hostname(urlparse(base).hostname or "")


def _assert_screenshot_redirect_allowed(url: str, config: LoadtestConfig) -> None:
    parsed = urlparse(url)
    host = _normalize_hostname(parsed.hostname or "")
    if _is_prod_vigil_host(host) and not config.allow_prod_screenshots:
        raise safety.SafetyError(
            f"refusing screenshot redirect to production Vigil host {PROD_VIGIL_HOST}; "
            "point vigil_upload_base at an isolated Vigil or set allow_prod_screenshots=True"
        )
    expected = _upload_host(config.vigil_upload_base)
    if host != expected:
        raise safety.SafetyError(
            f"refusing screenshot redirect host {host!r}; "
            f"expected {expected!r} from vigil_upload_base"
        )
    path = parsed.path or ""
    if path != UPLOAD_PATH and not path.endswith(UPLOAD_PATH):
        raise safety.SafetyError(
            f"refusing screenshot redirect path {path!r}; "
            f"expected to end with {UPLOAD_PATH}"
        )


def screenshot_upload_url(config: LoadtestConfig) -> str:
    base = (config.vigil_upload_base or "").strip().rstrip("/")
    if not base:
        return ""
    return _refuse_screenshot_url(f"{base}{UPLOAD_PATH}")


def assert_screenshot_live_allowed(config: LoadtestConfig) -> str:
    """Return the live upload URL. Fail closed before any POST."""
    safety.require_confirm(config.confirm, dry_run=False)
    denied = safety.load_denylist()
    if not denied:
        raise safety.SafetyError(
            f"live run requires at least one valid 24-hex contest id in {safety.DENYLIST_PATH.name}. "
            "Empty or comments-only denylist is fail-closed."
        )
    base = (config.vigil_upload_base or "").strip()
    if not base:
        raise safety.SafetyError(ISOLATED_VIGIL_REQUIRED)
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https"):
        raise safety.SafetyError(
            f"vigil_upload_base must be http(s) for screenshot POST, got {base!r}"
        )
    host = _upload_host(base)
    if _is_prod_vigil_host(host) and not config.allow_prod_screenshots:
        raise safety.SafetyError(
            f"refusing live screenshot POST to production Vigil host {PROD_VIGIL_HOST}; "
            "point vigil_upload_base at an isolated Vigil or set allow_prod_screenshots=True"
        )
    return screenshot_upload_url(config)


def build_jpeg_command(ffmpeg: str = "ffmpeg") -> list[str]:
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "warning",
        "-f",
        "lavfi",
        "-i",
        f"testsrc2=size={JPEG_WIDTH}x{JPEG_HEIGHT}:rate=1",
        "-frames:v",
        "1",
        "-vf",
        f"scale={MAX_DIMENSION}:-2",
        "-q:v",
        str(JPEG_QUALITY),
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]


def generate_jpeg_bytes(*, ffmpeg: str = "ffmpeg") -> bytes:
    """Encode one 1280-wide JPEG via ffmpeg lavfi testsrc2, q=75."""
    cmd = build_jpeg_command(ffmpeg)
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            timeout=30,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"ffmpeg not found ({ffmpeg!r}); required to generate load-test JPEGs"
        ) from exc
    if proc.returncode != 0 or not proc.stdout.startswith(b"\xff\xd8"):
        stderr = proc.stderr.decode("utf-8", "replace")
        raise RuntimeError(
            f"ffmpeg jpeg generation failed rc={proc.returncode}: {stderr}"
        )
    return proc.stdout


def _canonical_json(payload: dict[str, object]) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def authenticated_upload_headers(
    endpoint_id: str,
    body: bytes,
    private_key: Any,
    *,
    machine_fingerprint: str,
    exam_id: str = "",
    command_id: str = "",
    captured_at: str = "",
    width: int = 0,
    height: int = 0,
    reason_tag: str = "",
    event_id: str = "",
    exam_session_id: str = "",
    oj_contest_id: str = "",
    mime_type: str = MIME_TYPE,
) -> dict[str, str]:
    """ECDSA P-256 headers matching Server tests/endpoint_test_identity.py."""
    hashes, _serialization, ec = _require_cryptography()
    issued_at = _utc_ms()
    nonce = secrets.token_urlsafe(24)
    digest = hashlib.sha256(body).hexdigest()
    signed: dict[str, object] = {
        "endpointId": endpoint_id,
        "issuedAt": issued_at,
        "machineFingerprint": machine_fingerprint,
        "nonce": nonce,
        "protocolVersion": 1,
        "request": {
            "method": "POST",
            "path": UPLOAD_PATH,
            "imageSha256": digest,
            "clientId": endpoint_id,
            "examId": exam_id,
            "commandId": command_id,
            "capturedAt": captured_at,
            "width": width,
            "height": height,
            "reasonTag": reason_tag,
            "eventId": event_id,
            "examSessionId": exam_session_id,
            "ojContestId": oj_contest_id,
            "mimeType": mime_type,
        },
    }
    signature = _b64url(private_key.sign(_canonical_json(signed), ec.ECDSA(hashes.SHA256())))
    return {
        "X-Endpoint-Id": endpoint_id,
        "X-Endpoint-Protocol-Version": "1",
        "X-Endpoint-Issued-At": issued_at,
        "X-Endpoint-Nonce": nonce,
        "X-Endpoint-Body-SHA256": digest,
        "X-Endpoint-Machine-Fingerprint": machine_fingerprint,
        "X-Endpoint-Signature": signature,
    }


def _encode_multipart(
    fields: list[tuple[str, str]],
    *,
    filename: str,
    content_type: str,
    body: bytes,
) -> tuple[bytes, str]:
    boundary = "----KryptonLoadtest" + secrets.token_hex(16)
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="{name}"\r\n'
                f"\r\n"
                f"{value}\r\n"
            ).encode("utf-8")
        )
    chunks.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n"
            f"\r\n"
        ).encode("utf-8")
        + body
        + b"\r\n"
    )
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def _ticks_per_student(config: LoadtestConfig) -> int:
    interval = float(config.screenshot_interval_s)
    if interval <= 0:
        raise safety.SafetyError(
            f"screenshot_interval_s must be > 0, got {config.screenshot_interval_s!r}"
        )
    return max(1, int(config.duration_s // interval))


def _form_fields(
    *,
    endpoint_id: str,
    contest_id: str,
    captured_at: str,
) -> list[tuple[str, str]]:
    return [
        ("client_id", endpoint_id),
        ("exam_id", contest_id),
        ("width", str(JPEG_WIDTH)),
        ("height", str(JPEG_HEIGHT)),
        ("captured_at", captured_at),
        ("reason_tag", REASON_TAG),
        ("oj_contest_id", contest_id),
    ]


class ScreenshotPlane:
    def __init__(self, config: LoadtestConfig) -> None:
        self.config = config
        self._stop = threading.Event()
        self._started = False
        self._lock = threading.Lock()
        self._attempted = 0
        self._succeeded = 0
        self._failed = 0
        self._errors: list[str] = []

    def generate_identities(self, n: int) -> list[dict[str, Any]]:
        """Write local software P-256 PEM + JSON under identity_dir. Never networks."""
        count = int(n)
        if count < 1:
            raise ValueError(f"generate_identities n must be >= 1, got {n!r}")
        _, serialization, ec = _require_cryptography()
        identity_dir = Path(self.config.identity_dir)
        identity_dir.mkdir(parents=True, exist_ok=True)
        records: list[dict[str, Any]] = []
        for index in range(count):
            endpoint_id = self.config.machine_id(index)
            private_key = ec.generate_private_key(ec.SECP256R1())
            pem = private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            public_der = private_key.public_key().public_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            public_pem = private_key.public_key().public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
            machine_id = endpoint_id
            record = {
                "endpoint_id": endpoint_id,
                "machine_id": machine_id,
                "machine_fingerprint": hashlib.sha256(machine_id.encode("utf-8")).hexdigest(),
                "curve": "P-256",
                "public_key_pem": public_pem.decode("ascii"),
                "public_key_der_b64url": _b64url(public_der),
                "public_key_fingerprint": hashlib.sha256(public_der).hexdigest(),
            }
            pem_path = identity_dir / f"{endpoint_id}.pem"
            json_path = identity_dir / f"{endpoint_id}.json"
            pem_path.write_bytes(pem)
            pem_path.chmod(0o600)
            json_path.write_text(
                json.dumps(record, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            json_path.chmod(0o600)
            LOG.info("wrote local screenshot identity endpoint_id=%s", endpoint_id)
            records.append(record)
        return records

    def run(self) -> dict[str, Any]:
        """dry_run plans uploads with no sockets. live POSTs on an isolated Vigil."""
        if self._started:
            raise RuntimeError("ScreenshotPlane.run() already called")
        safety.assert_ready(self.config)
        ticks = _ticks_per_student(self.config)
        planned_uploads = self.config.students * ticks
        if self.config.dry_run:
            self._started = True
            return self._plan(ticks=ticks, planned_uploads=planned_uploads)
        upload_url = assert_screenshot_live_allowed(self.config)
        _require_cryptography()
        identities = self._load_identities(self.config.students)
        jpeg = generate_jpeg_bytes(ffmpeg=self.config.ffmpeg)
        self._started = True
        self._stop.clear()
        threads = [
            threading.Thread(
                target=self._student_loop,
                name=f"screenshot-{identity.endpoint_id}",
                args=(identity, jpeg, upload_url, ticks),
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
            self._stop.set()
            for thread in threads:
                thread.join(timeout=REQUEST_TIMEOUT_S + 1.0)
        errors = list(self._errors)
        result = {
            "dry_run": False,
            "ok": self._failed == 0 and self._attempted > 0,
            "students": self.config.students,
            "interval_s": self.config.screenshot_interval_s,
            "duration_s": self.config.duration_s,
            "ticks_per_student": ticks,
            "planned_uploads": planned_uploads,
            "attempted": self._attempted,
            "succeeded": self._succeeded,
            "failed": self._failed,
            "upload_url": upload_url,
            "max_dimension": MAX_DIMENSION,
            "jpeg_quality": JPEG_QUALITY,
            "errors": errors,
        }
        LOG.info("screenshot plane finished %s", {k: v for k, v in result.items() if k != "errors"})
        return result

    def _plan(self, *, ticks: int, planned_uploads: int) -> dict[str, Any]:
        base = (self.config.vigil_upload_base or "").strip()
        upload_url = screenshot_upload_url(self.config) if base else None
        identities: list[dict[str, Any]] = []
        for index in range(self.config.students):
            endpoint_id = self.config.machine_id(index)
            identities.append(
                {
                    "index": index,
                    "endpoint_id": endpoint_id,
                    "machine_id": endpoint_id,
                    "method": "POST",
                    "path": UPLOAD_PATH,
                    "url": upload_url,
                    "interval_s": self.config.screenshot_interval_s,
                    "ticks": ticks,
                    "max_dimension": MAX_DIMENSION,
                    "jpeg_quality": JPEG_QUALITY,
                    "mime_type": MIME_TYPE,
                    "form": {
                        "client_id": endpoint_id,
                        "exam_id": self.config.contest_id,
                        "width": str(JPEG_WIDTH),
                        "height": str(JPEG_HEIGHT),
                        "reason_tag": REASON_TAG,
                        "oj_contest_id": self.config.contest_id,
                    },
                    "headers": list(_SIGNING_HEADER_NAMES),
                }
            )
        return {
            "dry_run": True,
            "ok": True,
            "students": self.config.students,
            "interval_s": self.config.screenshot_interval_s,
            "duration_s": self.config.duration_s,
            "ticks_per_student": ticks,
            "planned_uploads": planned_uploads,
            "max_dimension": MAX_DIMENSION,
            "jpeg_quality": JPEG_QUALITY,
            "upload_path": UPLOAD_PATH,
            "upload_url": upload_url,
            "ffmpeg_command": build_jpeg_command(self.config.ffmpeg),
            "identities": identities,
        }

    def _load_identities(self, n: int) -> list[_LoadedIdentity]:
        _, serialization, _ = _require_cryptography()
        identity_dir = Path(self.config.identity_dir)
        loaded: list[_LoadedIdentity] = []
        missing: list[str] = []
        for index in range(n):
            endpoint_id = self.config.machine_id(index)
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
                f"live screenshot run needs {n} identities in {identity_dir}; "
                f"missing {missing}. Call generate_identities({n}) first "
                "(local P-256 keys, never POSTed)."
            )
        return loaded

    def _student_loop(
        self,
        identity: _LoadedIdentity,
        jpeg: bytes,
        upload_url: str,
        ticks: int,
    ) -> None:
        interval = float(self.config.screenshot_interval_s)
        for tick in range(ticks):
            if self._stop.is_set():
                return
            try:
                self._upload_one(identity, jpeg, upload_url)
            except Exception as exc:
                LOG.error(
                    "screenshot upload failed endpoint=%s tick=%s err=%s",
                    identity.endpoint_id,
                    tick,
                    exc,
                )
                with self._lock:
                    self._failed += 1
                    self._errors.append(
                        f"{identity.endpoint_id} tick={tick}: {type(exc).__name__}: {exc}"
                    )
            if tick + 1 >= ticks or self._stop.is_set():
                return
            self._wait(interval)

    def _upload_one(self, identity: _LoadedIdentity, jpeg: bytes, upload_url: str) -> None:
        _refuse_screenshot_url(upload_url)
        captured_at = _utc_ms()
        headers = authenticated_upload_headers(
            identity.endpoint_id,
            jpeg,
            identity.private_key,
            machine_fingerprint=identity.machine_fingerprint,
            exam_id=self.config.contest_id,
            captured_at=captured_at,
            width=JPEG_WIDTH,
            height=JPEG_HEIGHT,
            reason_tag=REASON_TAG,
            oj_contest_id=self.config.contest_id,
            mime_type=MIME_TYPE,
        )
        body, content_type = _encode_multipart(
            _form_fields(
                endpoint_id=identity.endpoint_id,
                contest_id=self.config.contest_id,
                captured_at=captured_at,
            ),
            filename="screenshot.jpg",
            content_type=MIME_TYPE,
            body=jpeg,
        )
        if b"BEGIN PRIVATE" in body or b"BEGIN PUBLIC" in body:
            raise RuntimeError("refusing to POST key material in screenshot multipart")
        request_headers = {
            "Accept": "application/json",
            "Content-Type": content_type,
            **headers,
        }
        request = urllib.request.Request(
            upload_url,
            data=body,
            headers=request_headers,
            method="POST",
        )
        if request.has_header("Referer"):
            request.remove_header("Referer")
        _refuse_screenshot_url(request.full_url)
        with self._lock:
            self._attempted += 1
        status, response_body = self._send(request)
        if 200 <= status < 300:
            with self._lock:
                self._succeeded += 1
            LOG.info(
                "screenshot uploaded endpoint=%s status=%s bytes=%s",
                identity.endpoint_id,
                status,
                len(jpeg),
            )
            return
        snippet = response_body.decode("utf-8", "replace")[:200]
        raise RuntimeError(f"HTTP {status} POST {upload_url}: {snippet}")

    def _send(self, request: urllib.request.Request) -> tuple[int, bytes]:
        _refuse_screenshot_url(request.full_url)
        if request.has_header("Referer"):
            raise RuntimeError(f"refusing to send Referer to {request.full_url}")
        opener = urllib.request.build_opener(_SafeRedirectHandler(self.config))
        try:
            response = opener.open(request, timeout=REQUEST_TIMEOUT_S)
        except urllib.error.HTTPError as exc:
            body = exc.read() if exc.fp is not None else b""
            return int(exc.code), body
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"screenshot POST failed {request.get_method()} {request.full_url}: {exc}"
            ) from exc
        with response:
            body = response.read()
            status = getattr(response, "status", None) or response.getcode() or 0
            return int(status), body

    def _wait(self, seconds: float) -> None:
        if seconds <= 0:
            return
        self._stop.wait(seconds)

#!/usr/bin/env python3
"""Opt-in real SRS/Vigil integration test. Only loopback and a fresh temp directory.

Requires ffmpeg/ffprobe on PATH and an already-built SRS 6.0.184 binary.
No production credentials, Docker, downloads, service actions, or client changes.
The unpatched binary must fail the default active-publisher shutdown case.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import resource
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CID = "a" * 24


def main():
    if not __debug__:
        raise RuntimeError("Assertions must be enabled for integration verification")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument(
        "--python",
        type=Path,
        default=REPO / "ecosystems/KryptonVigilSystem/Server/.venv/bin/python",
    )
    parser.add_argument("--screens", type=int, default=1)
    parser.add_argument("--cameras", type=int, default=1)
    parser.add_argument("--seconds", type=float, default=3)
    parser.add_argument(
        "--mode",
        choices=["stop", "natural", "inflight", "rename-failure"],
        default="stop",
    )
    parser.add_argument("--delay-first-dvr", type=float, default=0)
    parser.add_argument("--fail-first-dvr", action="store_true")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    assert 0 <= args.cameras <= args.screens <= 300 and args.screens > 0
    assert args.seconds >= 1 and args.delay_first_dvr >= 0 and args.timeout > 0
    assert args.mode != "inflight" or args.delay_first_dvr >= 3
    binary = args.binary.resolve(strict=True)
    root = Path(tempfile.mkdtemp(prefix="krypton-srs-shutdown-")).resolve()
    print("ARTIFACTS", root, flush=True)
    (root / "data/recordings").mkdir(parents=True)
    # The limit only affects this test and its children, not the user's system.
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if soft != resource.RLIM_INFINITY:
        target = 4096 if hard == resource.RLIM_INFINITY else min(hard, 4096)
        resource.setrlimit(resource.RLIMIT_NOFILE, (max(soft, target), hard))
    env = {k: v for k, v in os.environ.items() if not k.startswith(("SRS_", "KVS_"))}
    env["MallocNanoZone"] = "0"
    env["NO_PROXY"] = "127.0.0.1,localhost"
    http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    procs = []
    sockets = []
    viewers = []

    def spawn(argv, log, cwd=root):
        with (root / log).open("a") as out:
            proc = subprocess.Popen(
                [str(x) for x in argv],
                cwd=cwd,
                env=env,
                stdout=out,
                stderr=subprocess.STDOUT,
            )
        procs.append(proc)
        return proc

    def wait_for(check, message, timeout=args.timeout):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            value = check()
            if value:
                return value
            time.sleep(0.05)
        raise AssertionError(message)

    def port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    ports = set()
    while len(ports) < 4:
        ports.add(port())
    rtmp, api, web, hooks = sorted(ports)

    def get_json(url, data=None, headers=None):
        payload = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(url, data=payload, headers=headers or {})
        with http.open(req, timeout=5) as response:
            return json.load(response)

    def ready(url, proc):
        assert proc.poll() is None, f"process exited early: {proc.returncode}"
        try:
            return get_json(url)
        except OSError:
            return False

    def events():
        path = root / "hooks.jsonl"
        return (
            [json.loads(line) for line in path.read_text().splitlines()]
            if path.exists()
            else []
        )

    def completed(action):
        return [
            e for e in events() if e["action"] == action and e["phase"] == "finished"
        ]

    streams = [(i, "screen") for i in range(args.screens)] + [
        (i, "camera") for i in range(args.cameras)
    ]
    count = len(streams)
    fixture_args = [
        args.python,
        Path(__file__).with_name("vigil_fixture.py"),
        "--server",
        REPO / "ecosystems/KryptonVigilSystem/Server",
        "--case",
        root,
        "--port",
        hooks,
        "--screens",
        args.screens,
        "--delay-first-dvr",
        args.delay_first_dvr,
    ]
    if args.fail_first_dvr:
        fixture_args.append("--fail-first-dvr")
    srs = None
    try:
        vigil = spawn(fixture_args, "vigil.log")
        wait_for(
            lambda: ready(f"http://127.0.0.1:{hooks}/health", vigil),
            "Vigil startup failed",
        )
        config = (REPO / "ops/srs/krypton.conf").read_text()
        replacements = {
            "listen              1935;": f"listen              127.0.0.1:{rtmp};",
            "listen          8080;": f"listen          127.0.0.1:{web};",
            "127.0.0.1:1985": f"127.0.0.1:{api}",
            "/var/log/srs.log": str(root / "srs.log"),
            "/run/srs/srs.pid": str(root / "srs.pid"),
            "./objs/nginx/html": str(root / "data"),
            "/data/vigil/recordings": str(root / "data/recordings"),
            "http://127.0.0.1:8765": f"http://127.0.0.1:{hooks}",
        }
        for old, new in replacements.items():
            assert old in config, f"config contract changed: {old}"
            config = config.replace(old, new)
        (root / "srs.conf").write_text("query_latest_version off;\n" + config)

        def start_srs():
            proc = spawn([binary, "-c", root / "srs.conf"], "srs-console.log")
            version = wait_for(
                lambda: ready(f"http://127.0.0.1:{api}/api/v1/versions", proc),
                "SRS startup failed",
            )
            assert version["data"]["version"] == "6.0.184", version
            return proc

        srs = start_srs()
        fixture = root / "fixture.flv"
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=10:duration=10",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-preset",
                "ultrafast",
                "-tune",
                "zerolatency",
                "-g",
                "10",
                "-pix_fmt",
                "yuv420p",
                "-an",
                "-f",
                "flv",
                str(fixture),
            ],
            check=True,
            timeout=30,
        )
        pubs = []
        # 25 real RTMP connections per ffmpeg process, without re-encoding.
        for offset in range(0, count, 25):
            outputs = "|".join(
                f"[f=flv]rtmp://127.0.0.1:{rtmp}/live-record/{CID}_repro{i}_{kind}"
                for i, kind in streams[offset : offset + 25]
            )
            pubs.append(
                spawn(
                    [
                        "ffmpeg",
                        "-nostdin",
                        "-hide_banner",
                        "-loglevel",
                        "warning",
                        "-stream_loop",
                        "-1",
                        "-re",
                        "-i",
                        fixture,
                        "-map",
                        "0:v",
                        "-c",
                        "copy",
                        "-f",
                        "tee",
                        outputs,
                    ],
                    f"publisher-{offset}.log",
                )
            )
        recordings = root / "data/recordings"

        def all_recording():
            assert all(p.poll() is None for p in pubs), "publisher exited before stop"
            files = list(recordings.glob("*.tmp"))
            return len(files) == count and all(p.stat().st_size > 2048 for p in files)

        wait_for(all_recording, "not all real RTMP streams reached DVR")
        time.sleep(args.seconds)
        assert len(completed("on_publish")) == count
        # Leave an incomplete RTMP handshake and an HTTP-FLV viewer open at stop.
        pending = socket.create_connection(("127.0.0.1", rtmp), timeout=5)
        sockets.append(pending)
        viewer = http.open(
            f"http://127.0.0.1:{web}/live-record/{CID}_repro0_screen.flv", timeout=5
        )
        viewers.append(viewer)
        assert viewer.read(3) == b"FLV"
        if args.mode == "rename-failure":
            assert count == 1 and not args.fail_first_dvr
            tmp = next(recordings.glob("*.tmp"))
            tmp.with_suffix("").mkdir()  # Force the actual rename syscall to fail.
        if args.mode in ("natural", "inflight"):
            for pub in pubs:
                pub.send_signal(signal.SIGINT)
            for pub in pubs:
                pub.wait(timeout=10)
            if args.mode == "natural":
                wait_for(
                    lambda: len(completed("on_dvr")) == count, "natural DVR missing"
                )
            else:
                wait_for(
                    lambda: any(
                        e["action"] == "on_dvr" and e["phase"] == "started"
                        for e in events()
                    ),
                    "DVR hook never started",
                )
                assert not completed("on_dvr"), (
                    "test did not catch an in-flight callback"
                )
        stopped = time.monotonic()
        srs.send_signal(signal.SIGTERM)
        exit_code = srs.wait(timeout=args.timeout)
        exited = time.monotonic()
        stop_seconds = exited - stopped
        expected_failure = args.fail_first_dvr or args.mode == "rename-failure"
        assert (exit_code != 0) == expected_failure, (
            f"SRS exit={exit_code}, expected failure={expected_failure}"
        )
        # No post-exit grace sleep: all hooks must already have returned.
        dvr = completed("on_dvr")
        assert len(completed("on_unpublish")) == count, "UNPUBLISH_NOT_DRAINED"
        expected_callbacks = count - (args.mode == "rename-failure")
        assert len(dvr) == expected_callbacks, "DVR_CALLBACK_NOT_DRAINED"
        assert all(e["at"] <= exited for e in dvr), (
            "callback completed after SRS exited"
        )
        mp4s = sorted(p for p in recordings.glob("*.mp4") if p.is_file())
        tmp_files = list(recordings.glob("*.tmp"))
        assert len(mp4s) == expected_callbacks, "DVR_NOT_FINALIZED"
        assert len(tmp_files) == int(args.mode == "rename-failure"), "UNFINISHED_DVR"
        with sqlite3.connect(f"file:{root / 'vigil.sqlite'}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            rows = [dict(row) for row in db.execute("SELECT * FROM recording")]
        expected_rows = expected_callbacks - args.fail_first_dvr
        assert len(rows) == expected_rows, (
            f"Recording count {len(rows)} != {expected_rows}"
        )
        assert len({r["filename"] for r in rows}) == len(rows), "duplicate Recording"
        for row in rows:
            path = Path(row["file_path"])
            assert path in mp4s and row["size_bytes"] == path.stat().st_size > 0
            assert row["exam_session_id"] == f"local-{row['machine_id'][5:]}"
            assert row["oj_user_id"] == int(row["machine_id"][5:]) + 1
        log = (root / "srs.log").read_text()
        if expected_failure:
            assert "DVR shutdown failed" in log
        else:
            assert "DVR shutdown: callbacks drained successfully" in log

        def decode(path):
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            assert probe.returncode == 0, probe.stderr
            duration = float(json.loads(probe.stdout)["format"]["duration"])
            assert duration >= args.seconds, (path.name, duration)
            full = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-xerror",
                    "-threads",
                    "1",
                    "-i",
                    str(path),
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                timeout=30,
            )
            assert full.returncode == 0, full.stderr.decode()
            seek = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-xerror",
                    "-ss",
                    str(duration / 2),
                    "-threads",
                    "1",
                    "-i",
                    str(path),
                    "-frames:v",
                    "1",
                    "-f",
                    "framemd5",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            assert seek.returncode == 0 and any(
                line and not line.startswith("#") for line in seek.stdout.splitlines()
            )
            return duration

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            durations = list(pool.map(decode, mp4s))
        # Restart the actual SRS binary and read the preserved MP4 over HTTP.
        srs = start_srs()
        for path in mp4s[:1] + mp4s[-1:]:
            playback_url = f"http://127.0.0.1:{web}/recordings/{path.name}"
            with http.open(playback_url, timeout=10) as response:
                assert response.read() == path.read_bytes(), (
                    "SRS playback bytes differ after restart"
                )
            playback = subprocess.run(
                [
                    "ffmpeg",
                    "-nostdin",
                    "-v",
                    "error",
                    "-xerror",
                    "-ss",
                    "1",
                    "-threads",
                    "1",
                    "-i",
                    playback_url,
                    "-frames:v",
                    "1",
                    "-f",
                    "framemd5",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            assert playback.returncode == 0, playback.stderr
            assert any(
                line and not line.startswith("#")
                for line in playback.stdout.splitlines()
            )
        # Use actual Vigil token issuance and FileResponse, including byte ranges.
        for row in rows:
            token = get_json(
                f"http://127.0.0.1:{hooks}/api/admin/vigil/proctor/contests/{CID}/download-token",
                {
                    "actor": {"uid": 1, "displayName": "Local test"},
                    "recordingId": row["recording_id"],
                },
                {
                    "Content-Type": "application/json",
                    "X-KVS-Token": "local-shutdown-test-only",
                },
            )
            url = f"http://127.0.0.1:{hooks}/api/admin/vigil/proctor{token['href']}?dl={token['dl']}"
            request = urllib.request.Request(url, headers={"Range": "bytes=0-1023"})
            with http.open(request, timeout=5) as response:
                assert response.status == 206
                assert response.read() == Path(row["file_path"]).read_bytes()[:1024]
        srs.send_signal(signal.SIGTERM)
        assert srs.wait(timeout=args.timeout) == 0, "empty restart shutdown failed"
        report = {
            "passed": True,
            "version": "6.0.184",
            "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
            "mode": args.mode,
            "screens": args.screens,
            "cameras": args.cameras,
            "delay_first_dvr": args.delay_first_dvr,
            "fail_first_dvr": args.fail_first_dvr,
            "exit_code": exit_code,
            "stop_seconds": stop_seconds,
            "mp4_files": len(mp4s),
            "tmp_files": len(tmp_files),
            "completed_dvr_callbacks": len(dvr),
            "recording_rows": len(rows),
            "decoded_and_seeked": len(durations),
            "duration_min": min(durations, default=0),
            "duration_max": max(durations, default=0),
            "vigil_range_206": len(rows),
            "srs_restart_playback": bool(mp4s),
            "artifacts": str(root),
        }
        (root / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2), flush=True)
    finally:
        for viewer in viewers:
            viewer.close()
        for sock in sockets:
            sock.close()
        for proc in reversed(procs):
            if proc.poll() is None:
                proc.kill()
            proc.wait(timeout=5)


if __name__ == "__main__":
    main()

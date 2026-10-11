#!/usr/bin/env python3
"""Build the pinned SRS DVR shutdown fix from an already downloaded release.

Requires Python 3.12+, compiler, make, patch, and SRS build prerequisites.
No fetching, installing, copying into /opt, or service actions in this script.
Configure/make run upstream build code: use a disposable build environment.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import tarfile
from pathlib import Path

ARCHIVE_SHA256 = "bf30446bcc18fec370b4988f809a2f18f3efaab1ec80c0e2b67469347d04630e"
ORIGINAL = {
    "src/app/srs_app_async_call.cpp": "f788570019883f36a9673db7677309f4654bf7191ee846961559dc548edf5b61",
    "src/app/srs_app_async_call.hpp": "e43a0af454dc100491116fd5c37a519ea8036fa906af1b1a0afaaa3d0f5096a3",
    "src/app/srs_app_dvr.cpp": "1f80b1bcc4d6415fcdbb8da8831dbd6a0baf17735c718b8685ef1d36a815af7b",
    "src/app/srs_app_server.cpp": "82a257a17d2887241e243909b1613f37f9f57876fb6bc32cae8588fc00a877bb",
    "src/main/srs_main_server.cpp": "2e935c9877a3aa8302575c7a50dde6185df31c09841053ec5fa9442d1b53019b",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument(
        "--work-dir", type=Path, required=True, help="must not already exist"
    )
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--configure-arg", action="append", default=[])
    parser.add_argument("--prepare-only", action="store_true")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("jobs must be positive")
    archive = args.archive.resolve(strict=True)
    if digest(archive) != ARCHIVE_SHA256:
        raise ValueError("source archive differs from official v6.0-r0 (SRS 6.0.184)")
    patch = Path(__file__).with_name("patches") / "6.0.184-dvr-shutdown.patch"
    work = args.work_dir.resolve()
    work.mkdir()  # Fail if a previous build or unrelated files exist.
    with tarfile.open(archive, "r:gz") as source:
        source.extractall(work, filter="data")
    trunk = work / "srs-server-6.0-r0/trunk"
    for name, expected in ORIGINAL.items():
        if digest(trunk / name) != expected:
            raise ValueError(f"unexpected source baseline: {name}")
    for dry in (True, False):
        command = ["patch", "--batch", "--fuzz=0", "-p1", "-i", str(patch.resolve())]
        if dry:
            command.append("--dry-run")
        subprocess.run(command, cwd=trunk, check=True)
    manifest = {
        "base_version": "6.0.184",
        "upstream_tag": "v6.0-r0",
        "fix": "krypton-dvr-shutdown-v1",
        "archive_sha256": ARCHIVE_SHA256,
        "patch_sha256": digest(patch),
        "platform": platform.platform(),
        "configure_args": args.configure_arg,
        "patched_sources": {name: digest(trunk / name) for name in ORIGINAL},
        "built": False,
    }
    if not args.prepare_only:
        env = {
            key: value
            for key, value in os.environ.items()
            if not key.startswith("SRS_")
        }
        for label, command in (
            ("configure", ["./configure", *args.configure_arg]),
            ("make", ["make", f"-j{args.jobs}"]),
        ):
            with (work / f"{label}.log").open("w") as log:
                subprocess.run(
                    command,
                    cwd=trunk,
                    env=env,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=True,
                )
        manifest["built"] = True
        manifest["binary_sha256"] = digest(trunk / "objs/srs")
    (work / "build-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()

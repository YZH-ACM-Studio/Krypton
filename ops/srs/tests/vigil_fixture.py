"""Disposable, loopback-only fixture using the real Vigil hooks and downloads.

No app.main lifespan, OJ sync, production settings, or production credentials.
Run through verify_shutdown.py with the Server virtualenv's Python.
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--server", type=Path, required=True)
parser.add_argument("--case", type=Path, required=True)
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--screens", type=int, required=True)
parser.add_argument("--delay-first-dvr", type=float, default=0)
parser.add_argument("--fail-first-dvr", action="store_true")
args = parser.parse_args()
case = args.case.resolve()
assert case.is_dir() and not (case / ".env").exists()
for key in list(os.environ):
    if key.startswith("KVS_"):
        del os.environ[key]
os.environ.update(
    KVS_DATABASE_URL="sqlite:///" + str(case / "vigil.sqlite"),
    KVS_DATA_DIR=str(case / "data"),
    KVS_SRS_HOOK_ALLOWED_IPS="127.0.0.1",
    KVS_DASHBOARD_TOKEN="local-shutdown-test-only",
)
os.chdir(case)
sys.path.insert(0, str(args.server.resolve()))
logging.basicConfig(level=logging.INFO)

import uvicorn  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from app.api.recording_downloads import download_router, token_router  # noqa: E402
from app.api.srs_callbacks import router  # noqa: E402
from app.models import ExamSession, OjContest  # noqa: E402
from app.services.database import get_session, init_db  # noqa: E402

init_db()
now = datetime.utcnow()
cid = "a" * 24
with get_session() as db:
    db.add(
        OjContest(
            oj_contest_id=cid,
            oj_domain_id="local-shutdown-test",
            title="Local SRS shutdown test",
            begin_at=now - timedelta(hours=1),
            end_at=now + timedelta(hours=1),
            record_enabled=True,
            last_synced_at=now,
            source="local-test",
        )
    )
    for index in range(args.screens):
        db.add(
            ExamSession(
                id=f"local-{index}",
                machine_id=f"repro{index}",
                oj_user_id=index + 1,
                oj_contest_id=cid,
                oj_domain_id="local-shutdown-test",
                status="active",
                began_at=now,
                created_at=now,
                updated_at=now,
            )
        )
    db.commit()

app = FastAPI()
app.include_router(router)
app.include_router(token_router)
app.include_router(download_router)
first_dvr = True


def event(data):
    with (case / "hooks.jsonl").open("a") as handle:
        handle.write(json.dumps({"at": time.monotonic(), **data}) + "\n")


@app.middleware("http")
async def observe(request: Request, call_next):
    global first_dvr
    if not request.url.path.startswith("/api/internal/srs/"):
        return await call_next(request)
    body = await request.json()
    data = {key: body.get(key) for key in ("action", "stream", "file")}
    event({"phase": "started", **data})
    if body.get("action") == "on_dvr" and first_dvr:
        first_dvr = False
        await asyncio.sleep(args.delay_first_dvr)
        if args.fail_first_dvr:
            event({"phase": "finished", "status": 503, **data})
            return JSONResponse({"code": 1}, status_code=503)
    response = await call_next(request)
    event({"phase": "finished", "status": response.status_code, **data})
    return response


@app.get("/health")
def health():
    return {"ok": True}


uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")

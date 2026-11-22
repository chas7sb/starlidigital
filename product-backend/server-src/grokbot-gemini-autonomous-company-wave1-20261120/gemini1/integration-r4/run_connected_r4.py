"""Connected R4 Verification Runner (GGB1-GEMINI1-INTEGRATION-R4).
Accepts --output-dir so independent reviewers can run without mutating frozen source files.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi.responses import FileResponse, JSONResponse

R4 = Path(__file__).resolve().parent
NODE = "/opt/starlidigital/node/bin/node"
COORD_R2 = "/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/coordinator/reproduce-progress-gate-R2.mjs"
GROKBOT1_DIR = Path("/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/grokbot1")


def _run_bounded(cmd: list[str], *, cwd: Path, env: dict | None = None, timeout: int = 60) -> tuple[int, str, str]:
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        out, err = proc.communicate(timeout=timeout)
        return proc.returncode, out, err
    except subprocess.TimeoutExpired:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            time.sleep(0.5)
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, err = proc.communicate()
        return 124, out, err + "\nBOUNDED_TIMEOUT"
    finally:
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()


def run_connected_browser_flow(out_dir: Path) -> tuple[bool, dict]:
    if str(GROKBOT1_DIR) not in sys.path:
        sys.path.insert(0, str(GROKBOT1_DIR))
    import grokbot1_routes

    gen_dir = R4 / "ui/.browser-generated"
    browser_ev = out_dir / "r4-connected-browser-evidence.json"

    with tempfile.TemporaryDirectory(prefix="grokbot1-w1-r4-", dir="/tmp") as tmp:
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        origin = f"http://127.0.0.1:{port}"

        app, svc, ns = grokbot1_routes.build_candidate_app(tmp, allowed_origins={origin})
        pw = "StrongR4BrowserPass123!"
        user_obj = ns.Auths.insert_new_auth("owner@r4.test", ns.auth.get_password_hash(pw), "Owner", "/user.png", "user")
        owner_token = ns.auth.create_token({"id": user_obj.id})

        @app.get("/api/v1/starli/public/session")
        def public_session():
            raw_ck = ns.public.new_cookie()
            ck = raw_ck[1] if isinstance(raw_ck, tuple) else raw_ck
            resp = JSONResponse({"ok": True})
            resp.set_cookie("starli_guest", ck, path="/api/v1/starli/public", httponly=True, samesite="lax")
            return resp

        @app.get("/homepage.html")
        def serve_homepage():
            return FileResponse(gen_dir / "homepage.html", media_type="text/html")

        @app.get("/homepage-bundle.js")
        def serve_bundle():
            return FileResponse(gen_dir / "homepage-bundle.js", media_type="application/javascript")

        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off", access_log=False))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            for _ in range(100):
                if server.started:
                    break
                time.sleep(0.04)
            env = os.environ.copy()
            env["STARLI_R4_ORIGIN"] = origin
            env["STARLI_R4_OWNER_TOKEN"] = owner_token
            env["STARLI_R4_OWNER_PASSWORD"] = pw
            env["STARLI_R4_BROWSER_EVIDENCE"] = str(browser_ev)
            rc, out, err = _run_bounded([NODE, str(R4 / "r4-browser-flow.cjs")], cwd=R4, env=env, timeout=45)
            print(out)
            if err:
                print(err, file=sys.stderr)
            if rc == 0 and browser_ev.exists():
                return True, json.loads(browser_ev.read_text(encoding="utf-8"))
            return False, {"exitCode": rc, "stderr": err[-400:]}
        finally:
            server.should_exit = True
            thread.join(timeout=6)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=str(R4 / "evidence"))
    args = parser.parse_args()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    steps = []
    all_ok = True

    def record(name: str, ok: bool, detail: dict):
        nonlocal all_ok
        if not ok:
            all_ok = False
        steps.append({"step": name, "status": "PASS" if ok else "FAIL", **detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")

    # 1. R4-04..R4-10 Node tests (durable portable authority, Grokbot4 Stop consumer, RemoteTrustedAppAuthority + app-server.ts restart/revoke/cross-tenant)
    rc, out, err = _run_bounded(
        [NODE, "--experimental-strip-types", "--test", "--test-force-exit", "tests_r4_all.mjs"],
        cwd=R4,
        timeout=30,
    )
    record("r4_defects_and_connected_serving_path", rc == 0, {"exitCode": rc, "executionClass": "COMBINED_CANDIDATE"})

    # 2. Coordinator R2 12-case UI progress gate
    rc, out, err = _run_bounded(
        [NODE, "--experimental-strip-types", COORD_R2, str(R4 / "ui/worker-task-progress.ts")],
        cwd=R4 / "ui",
        timeout=30,
    )
    r2_ok = False
    if rc == 0:
        d = json.loads(out)
        r2_ok = d.get("passed") == 12 and d.get("total") == 12
        (out_dir / "coordinator-progress-gate-R2-passed.json").write_text(out, encoding="utf-8")
    record("coordinator_r2_12_case_progress_gate", r2_ok, {"exitCode": rc, "executionClass": "CLIENT_VALIDATION_REPRODUCTION"})

    # 3. Coordinator 15-case revocation-store regression
    rev_ev = R4 / "app-authority-r4/evidence/regression-package.json"
    rc, out, err = _run_bounded(
        [NODE, "--experimental-strip-types", "tests/revocation-store-regression.mjs", "--package", "package", "--evidence", str(rev_ev)],
        cwd=R4 / "app-authority-r4",
        timeout=45,
    )
    record("revocation_store_15_case_regression", rc == 0, {"exitCode": rc, "executionClass": "FIXTURE"})

    # 4. Connected Headless Chromium browser flow (Grokbot1 431a6015 + inline /reauth + resumed claim + NAV_READY + 1440/834/390/320px)
    ok_b, det_b = run_connected_browser_flow(out_dir)
    record("connected_browser_grokbot1_reauth_and_claim_flow", ok_b, det_b)

    summary = {
        "schemaVersion": "starli.gemini1.integration-r4.summary.v1",
        "taskId": "GGB1-GEMINI1-INTEGRATION-R4",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "overall": "PASS" if all_ok else "FAIL",
        "steps": steps,
        "productionModified": False,
    }
    (out_dir / "run-connected-r4-summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print("OVERALL:", summary["overall"])
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())

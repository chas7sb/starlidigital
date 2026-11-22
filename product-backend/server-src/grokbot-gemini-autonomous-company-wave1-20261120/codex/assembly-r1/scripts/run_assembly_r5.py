#!/opt/starlidigital/webui-runtime/bin/python3
"""Reproducible Combined Assembly Runner for GGB1-GEMINI5-ASSEMBLY-R5.

Fixes R5-RUNNER-01 & R5-RUNNER-02:
- Acquires shared heavy-run lock (nonblocking by default, optional bounded --lock-wait).
- Verifies all pinned input manifests & file SHA-256 checksums before execution.
- Clones strictly manifest-listed files into --runtime-dir/staged/ (zero untracked .browser-generated).
- Rebuilds UI assets from pinned Svelte/TS source into --runtime-dir/built-ui/.
- Externalizes all generated files, regression receipts, SQLite DBs, and Chromium profiles.
- Enforces bounded startup, per-step, and total deadlines with scoped (pid, starttime) descendant cleanup.
- Verifies before/after SHA-256 of every frozen source tree; exits nonzero on any failure or mutation.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
sys.dont_write_bytecode = True
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
ASSEMBLY_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
import verify_pins  # noqa: E402

NODE = "/opt/starlidigital/node/bin/node"
DEFAULT_LOCK = Path(
    "/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/coordinator/candidate-review-R3.lock"
)
GROKBOT1_DIR = Path(
    "/srv/starlidigital/mcp-workspace/server/src/grokbot-gemini-autonomous-company-wave1-20261120/grokbot1"
)


def _read_proc_starttime(pid: int) -> int | None:
    """Read Linux /proc/<pid>/stat field 22 (starttime in clock ticks) for PID-reuse-safe signaling."""
    try:
        raw = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        rparen = raw.rfind(")")
        if rparen == -1:
            return None
        fields = raw[rparen + 2 :].split()
        # fields[0] is field 3 (state); field 22 is index 19
        return int(fields[19])
    except Exception:
        return None


def _list_descendants(root_pid: int) -> list[tuple[int, int]]:
    """Return [(pid, starttime)] for all current descendants of root_pid."""
    children_map: dict[int, list[int]] = {}
    starttimes: dict[int, int] = {}
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        pid = int(entry)
        try:
            raw = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
            rparen = raw.rfind(")")
            if rparen == -1:
                continue
            fields = raw[rparen + 2 :].split()
            ppid = int(fields[1])
            st = int(fields[19])
            children_map.setdefault(ppid, []).append(pid)
            starttimes[pid] = st
        except Exception:
            continue
    out: list[tuple[int, int]] = []
    stack = [root_pid]
    seen = {root_pid}
    while stack:
        cur = stack.pop()
        for ch in children_map.get(cur, []):
            if ch not in seen:
                seen.add(ch)
                if ch in starttimes:
                    out.append((ch, starttimes[ch]))
                stack.append(ch)
    return out


def _safe_kill_pid(pid: int, expected_starttime: int, sig: int) -> None:
    actual_st = _read_proc_starttime(pid)
    if actual_st is not None and actual_st == expected_starttime:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def _cleanup_tree(root_pid: int, root_starttime: int) -> None:
    """Terminate root_pid and all its descendants using verified (pid, starttime) identity."""
    descendants = _list_descendants(root_pid)
    targets = descendants + [(root_pid, root_starttime)]
    for pid, st in targets:
        _safe_kill_pid(pid, st, signal.SIGTERM)
    time.sleep(0.35)
    for pid, st in targets:
        _safe_kill_pid(pid, st, signal.SIGKILL)


def _run_bounded(
    cmd: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None,
    step_timeout: float,
    total_deadline: float,
) -> dict[str, Any]:
    remaining = total_deadline - time.monotonic()
    if remaining <= 0:
        return {"exitCode": 124, "stdout": "", "stderr": "TOTAL_DEADLINE_EXCEEDED", "durationSec": 0.0, "timedOut": True}
    timeout = min(step_timeout, remaining)
    t0 = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    root_st = _read_proc_starttime(proc.pid)
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout)
        rc = proc.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        if root_st is not None:
            _cleanup_tree(proc.pid, root_st)
        try:
            out, err = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            out, err = "", ""
        rc = 124
        err = (err or "") + f"\nBOUNDED_TIMEOUT({timeout:.1f}s)"
    finally:
        if proc.poll() is None and root_st is not None:
            _cleanup_tree(proc.pid, root_st)
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass
    return {
        "cmd": cmd,
        "cwd": str(cwd),
        "exitCode": rc,
        "durationSec": round(time.monotonic() - t0, 3),
        "timedOut": timed_out,
        "stdoutTail": (out or "")[-8000:],
        "stderrTail": (err or "")[-1500:],
    }


def _is_subpath(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _acquire_lock(lock_path: Path, wait_sec: float, total_deadline: float) -> Any:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lf = lock_path.open("a+", encoding="utf-8")
    deadline = min(time.monotonic() + wait_sec, total_deadline)
    while True:
        try:
            fcntl.flock(lf.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            lf.seek(0)
            lf.truncate()
            lf.write(json.dumps({"owner": "gemini5", "pid": os.getpid(), "acquiredAt": datetime.now(timezone.utc).isoformat()}) + "\n")
            lf.flush()
            return lf
        except BlockingIOError:
            if time.monotonic() >= deadline:
                lf.close()
                raise RuntimeError(f"LOCK_BUSY: {lock_path}")
            time.sleep(0.25)


def _run_staged_browser_flow(
    staged_grokbot1_dir: Path,
    built_ui_dir: Path,
    runtime_dir: Path,
    out_dir: Path,
    total_deadline: float,
) -> tuple[bool, dict[str, Any]]:
    import uvicorn
    from fastapi.responses import FileResponse, JSONResponse

    if str(staged_grokbot1_dir) not in sys.path:
        sys.path.insert(0, str(staged_grokbot1_dir))
    import grokbot1_routes

    browser_ev = out_dir / "r5-staged-browser-evidence.json"
    chrome_profile = runtime_dir / "chrome-profile"
    # Frozen grokbot1_routes enforces disposable root prefix /tmp/grokbot1-w1- to prevent prod DB access
    gb1_tmp = tempfile.TemporaryDirectory(prefix="grokbot1-w1-g5-", dir="/tmp")
    gb1_state_dir = Path(gb1_tmp.name)

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    origin = f"http://127.0.0.1:{port}"

    try:
        app, _svc, ns = grokbot1_routes.build_candidate_app(str(gb1_state_dir), allowed_origins={origin})
    except Exception:
        gb1_tmp.cleanup()
        raise
    pw = "StrongR5AssemblyPass123!"
    user_obj = ns.Auths.insert_new_auth("owner@r5.test", ns.auth.get_password_hash(pw), "Owner", "/user.png", "user")
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
        return FileResponse(built_ui_dir / "homepage.html", media_type="text/html")

    @app.get("/homepage-bundle.js")
    def serve_bundle():
        return FileResponse(built_ui_dir / "homepage-bundle.js", media_type="application/javascript")

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off", access_log=False)
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        start_wait = time.monotonic()
        while not server.started:
            if time.monotonic() - start_wait > 10.0 or time.monotonic() >= total_deadline:
                return False, {"error": "UVICORN_STARTUP_TIMEOUT"}
            time.sleep(0.05)

        env = os.environ.copy()
        env["STARLI_R5_ORIGIN"] = origin
        env["STARLI_R5_OWNER_TOKEN"] = owner_token
        env["STARLI_R5_OWNER_PASSWORD"] = pw
        env["STARLI_R5_BROWSER_EVIDENCE"] = str(browser_ev)
        env["STARLI_R5_CHROME_PROFILE"] = str(chrome_profile)

        res = _run_bounded(
            [NODE, str(SCRIPT_DIR / "r5-browser-flow.cjs")],
            cwd=runtime_dir,
            env=env,
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        if res["exitCode"] == 0 and browser_ev.exists():
            ev_data = json.loads(browser_ev.read_text(encoding="utf-8"))
            return True, {"process": res, "evidence": ev_data, "evidencePath": str(browser_ev)}
        return False, {"process": res, "evidencePath": str(browser_ev)}
    finally:
        server.should_exit = True
        thread.join(timeout=6.0)
        gb1_tmp.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description="Reproducible combined assembly runner for GGB1-GEMINI5-ASSEMBLY-R5")
    parser.add_argument("--pins", default=str(ASSEMBLY_DIR / "INPUT-PINS.json"))
    parser.add_argument("--output-dir", required=True, help="External output directory for evidence & receipts")
    parser.add_argument("--runtime-dir", required=True, help="External runtime directory for clean clone, built assets, DBs, and browser profile")
    parser.add_argument("--lock-file", default=str(DEFAULT_LOCK))
    parser.add_argument("--lock-wait", type=float, default=0.0, help="Seconds to wait for heavy-run lock (0 = nonblocking)")
    parser.add_argument("--total-timeout", type=float, default=180.0, help="Overall bounded wall-clock deadline in seconds")
    parser.add_argument("--keep-runtime", action="store_true", help="Keep --runtime-dir after completion (default cleans staged temp dirs)")
    args = parser.parse_args()

    total_deadline = time.monotonic() + args.total_timeout
    pins_path = Path(args.pins).resolve()
    out_dir = Path(args.output_dir).resolve()
    runtime_dir = Path(args.runtime_dir).resolve()
    pins = json.loads(pins_path.read_text(encoding="utf-8"))

    # Safety guard: --output-dir and --runtime-dir must NEVER be inside any frozen input directory
    for name, cfg in pins["frozenInputs"].items():
        frozen_dir = Path(cfg["dir"]).resolve() if "dir" in cfg else Path(cfg["filePath"]).resolve().parent
        if _is_subpath(out_dir, frozen_dir):
            print(f"ERROR: --output-dir ({out_dir}) is inside frozen input {name} ({frozen_dir})", file=sys.stderr)
            return 2
        if _is_subpath(runtime_dir, frozen_dir):
            print(f"ERROR: --runtime-dir ({runtime_dir}) is inside frozen input {name} ({frozen_dir})", file=sys.stderr)
            return 2
    if _is_subpath(runtime_dir, ASSEMBLY_DIR):
        print(f"ERROR: --runtime-dir ({runtime_dir}) must be outside assembly source ({ASSEMBLY_DIR})", file=sys.stderr)
        return 2

    out_dir.mkdir(parents=True, exist_ok=True)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    os.chdir(runtime_dir)

    lock_handle = None
    steps: list[dict[str, Any]] = []
    all_ok = True

    def record(name: str, ok: bool, detail: dict[str, Any]) -> None:
        nonlocal all_ok
        if not ok:
            all_ok = False
        steps.append({"step": name, "status": "PASS" if ok else "FAIL", "detail": detail})

    # Snapshot all frozen input directories + assembly scripts/docs BEFORE run
    frozen_dirs_to_watch: dict[str, Path] = {}
    for name, cfg in pins["frozenInputs"].items():
        if "dir" in cfg:
            frozen_dirs_to_watch[name] = Path(cfg["dir"]).resolve()
    before_snaps = {name: verify_pins.snapshot_tree(p) for name, p in frozen_dirs_to_watch.items()}
    before_single_files = {
        name: verify_pins.sha256_file(Path(cfg["filePath"]))
        for name, cfg in pins["frozenInputs"].items()
        if "filePath" in cfg
    }

    try:
        lock_handle = _acquire_lock(Path(args.lock_file), args.lock_wait, total_deadline)

        # Step 1: Verify all cryptographic pins
        pin_results = verify_pins.verify_all_pins(pins_path)
        record(
            "pin_verification",
            True,
            {k: {"fileCount": v["fileCount"], "sha256": v.get("manifestSha256") or v.get("sha256")} for k, v in pin_results.items()},
        )

        # Step 2: Clean manifest-only clone of R4 baseline & gemini1 orchestration-r5
        staged_r4 = runtime_dir / "staged" / "integration-r4"
        staged_g1_r5 = runtime_dir / "staged" / "orchestration-r5"
        staged_g1_r6 = runtime_dir / "staged" / "orchestration-r6"
        staged_gb1 = runtime_dir / "staged" / "grokbot1"
        r4_cfg = pins["frozenInputs"]["r4Baseline"]
        g1_r5_cfg = pins["frozenInputs"]["gemini1OrchestrationR5"]
        g1_r6_cfg = pins["frozenInputs"]["gemini1OrchestrationR6"]
        gb1_cfg = pins["frozenInputs"]["grokbot1Onboarding"]
        clone_r4 = verify_pins.clone_manifest_only(Path(r4_cfg["dir"]), Path(r4_cfg["manifestPath"]), staged_r4)
        clone_g1 = verify_pins.clone_manifest_only(Path(g1_r5_cfg["dir"]), Path(g1_r5_cfg["manifestPath"]), staged_g1_r5)
        clone_g1_r6 = verify_pins.clone_manifest_only(Path(g1_r6_cfg["dir"]), Path(g1_r6_cfg["manifestPath"]), staged_g1_r6)
        clone_gb1 = verify_pins.clone_manifest_only(Path(gb1_cfg["dir"]), Path(gb1_cfg["manifestPath"]), staged_gb1)
        record("clean_manifest_only_clone", True, {"r4": clone_r4, "gemini1OrchestrationR5": clone_g1, "gemini1OrchestrationR6": clone_g1_r6, "grokbot1": clone_gb1})

        # Step 3: Clean from-source UI asset rebuild into --runtime-dir/built-ui (closes R5-RUNNER-01)
        built_ui_dir = runtime_dir / "built-ui"
        build_res = _run_bounded(
            [NODE, str(SCRIPT_DIR / "build_ui_assets.cjs"), "--ui-dir", str(staged_r4 / "ui"), "--out-dir", str(built_ui_dir)],
            cwd=runtime_dir,
            env=os.environ.copy(),
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        build_receipt_path = built_ui_dir / "build-receipt.json"
        build_ok = build_res["exitCode"] == 0 and build_receipt_path.exists()
        build_detail: dict[str, Any] = {"process": build_res}
        if build_ok:
            shutil.copy2(build_receipt_path, out_dir / "ui-build-receipt.json")
            build_detail["receipt"] = json.loads(build_receipt_path.read_text(encoding="utf-8"))
        record("clean_clone_ui_rebuild", build_ok, build_detail)

        # Step 4: Coordinator UI 12-case progress gate (against clean clone worker-task-progress.ts)
        coord_out = out_dir / "coordinator-progress-gate-R2.json"
        coord_script = pins["frozenInputs"]["coordinatorProgressGateR2"]["filePath"]
        coord_res = _run_bounded(
            [NODE, "--experimental-transform-types", coord_script, str(staged_r4 / "ui" / "worker-task-progress.ts")],
            cwd=staged_r4 / "ui",
            env=os.environ.copy(),
            step_timeout=30.0,
            total_deadline=total_deadline,
        )
        coord_ok = False
        if coord_res["exitCode"] == 0 and coord_res["stdoutTail"]:
            try:
                parsed = json.loads(coord_res["stdoutTail"])
                coord_ok = parsed.get("passed") == 12 and parsed.get("total") == 12
                coord_out.write_text(json.dumps(parsed, indent=2) + "\n", encoding="utf-8")
            except Exception:
                coord_ok = False
        coord_res.pop("stdout", None)
        record("coordinator_progress_gate_r2", coord_ok, {"process": coord_res, "outputPath": str(coord_out)})

        # Step 5: R4 component suite inside clean clone
        r4_tests_res = _run_bounded(
            [NODE, "--experimental-transform-types", "--test", "--test-force-exit", str(staged_r4 / "tests_r4_all.mjs")],
            cwd=staged_r4,
            env=os.environ.copy(),
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        record("r4_component_suite", r4_tests_res["exitCode"] == 0, {"process": r4_tests_res})

        # Step 6: Externalized revocation store regression (closes R5-RUNNER-02: zero writes to frozen R4)
        staged_reg_ev = staged_r4 / "app-authority-r4" / "evidence" / "regression-package.json"
        reg_res = _run_bounded(
            [
                NODE,
                "--experimental-transform-types",
                str(staged_r4 / "app-authority-r4" / "tests" / "revocation-store-regression.mjs"),
                "--package",
                "package",
                "--evidence",
                str(staged_reg_ev),
            ],
            cwd=staged_r4 / "app-authority-r4",
            env=os.environ.copy(),
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        ext_reg_out = out_dir / "regression-package.json"
        reg_ok = reg_res["exitCode"] == 0 and staged_reg_ev.exists()
        if reg_ok:
            shutil.copy2(staged_reg_ev, ext_reg_out)
        record("externalized_revocation_regression", reg_ok, {"process": reg_res, "externalEvidencePath": str(ext_reg_out)})

        # Step 7: Gemini1 Orchestration R5 component tests inside clean clone
        g1_r5_res = _run_bounded(
            [NODE, "--experimental-transform-types", "--test", "--test-force-exit", str(staged_g1_r5 / "tests" / "test-orchestration-r5.mjs")],
            cwd=staged_g1_r5,
            env=os.environ.copy(),
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        record("gemini1_orchestration_r5_tests", g1_r5_res["exitCode"] == 0, {"process": g1_r5_res})

        # Step 7b: Gemini1 Orchestration R6 component tests inside clean clone (externalized evidence)
        g1_r6_env = os.environ.copy()
        g1_r6_env["ORCH_R6_EVIDENCE_OUT"] = str(out_dir / "orchestration-r6-test-results.json")
        g1_r6_res = _run_bounded(
            [NODE, "--experimental-transform-types", "--test", "--test-force-exit", str(staged_g1_r6 / "tests" / "test-orchestration-r6.mjs")],
            cwd=staged_g1_r6,
            env=g1_r6_env,
            step_timeout=45.0,
            total_deadline=total_deadline,
        )
        record("gemini1_orchestration_r6_tests", g1_r6_res["exitCode"] == 0, {"process": g1_r6_res})

        # Step 8: Staged Chromium browser flow serving cleanly built UI assets
        if build_ok:
            br_ok, br_detail = _run_staged_browser_flow(staged_gb1, built_ui_dir, runtime_dir, out_dir, total_deadline)
            record("staged_browser_flow", br_ok, br_detail)
        else:
            record("staged_browser_flow", False, {"error": "SKIPPED_DUE_TO_BUILD_FAILURE"})

    except Exception as exc:
        record("runner_exception", False, {"error": repr(exc), "traceback": traceback.format_exc()[-1500:]})
    finally:
        if lock_handle is not None:
            try:
                fcntl.flock(lock_handle.fileno(), fcntl.LOCK_UN)
                lock_handle.close()
            except Exception:
                pass
        if not args.keep_runtime:
            for sub in ("staged", "built-ui", "grokbot1-state", "chrome-profile"):
                shutil.rmtree(runtime_dir / sub, ignore_errors=True)

    # Step 9: Verify AFTER source hashes of every frozen input (fail nonzero on ANY mutation!)
    integrity_diffs: dict[str, Any] = {}
    mutations_detected = False
    for name, p in frozen_dirs_to_watch.items():
        after = verify_pins.snapshot_tree(p)
        diff = verify_pins.diff_snapshots(before_snaps[name], after)
        integrity_diffs[name] = diff
        if diff["added"] or diff["removed"] or diff["modified"]:
            mutations_detected = True
    for name, before_sha in before_single_files.items():
        after_sha = verify_pins.sha256_file(Path(pins["frozenInputs"][name]["filePath"]))
        changed = before_sha != after_sha
        integrity_diffs[name] = {"before": before_sha, "after": after_sha, "changed": changed}
        if changed:
            mutations_detected = True

    record("before_after_source_integrity", not mutations_detected, {"mutationsDetected": mutations_detected, "diffs": integrity_diffs})

    summary = {
        "schemaVersion": "starli.gemini5.assembly-run-summary.v1",
        "decision": pins["decision"],
        "taskId": "GGB1-GEMINI5-ASSEMBLY-R5",
        "executedAt": datetime.now(timezone.utc).isoformat(),
        "overallStatus": "PASS" if all_ok else "FAIL",
        "executionClass": "COMPONENT_AND_STAGED_BROWSER_FIXTURE",
        "fullConnectedChainComplete": False,
        "actualVmRun": False,
        "productionModified": False,
        "modelCalls": 0,
        "pinsFile": str(pins_path),
        "outputDir": str(out_dir),
        "runtimeDir": str(runtime_dir),
        "steps": steps,
        "chainCoverage": {
            "1_homepage_intent": "EXECUTED_STAGED_BROWSER_FIXTURE",
            "2_provisional_bootstrap": "EXECUTED_STAGED_BROWSER_FIXTURE",
            "3_required_reauth_and_same_claim_resume": "EXECUTED_STAGED_BROWSER_FIXTURE",
            "4_verified_claim_and_exact_app_room": "PARTIAL_NAV_LINK_ONLY_BLOCKED_BY_GEMINI4_FRONTEND_R5",
            "5_canonical_two_worker_runtime_and_agency_receipts": "COMPONENT_VERIFIED_VIA_GEMINI1_R6_PENDING_GEMINI3_GEMINI4_FULL_CHAIN",
            "6_claimed_company_doglove_app_rebuild": "BLOCKED_BY_GEMINI3_APP_AUTHORITY_R5",
            "7_actual_private_app_iframe": "BLOCKED_BY_GEMINI3_AND_GEMINI4",
            "8_browser_save_in_iframe": "BLOCKED_BY_GEMINI3_AND_GEMINI4",
            "9_independent_app_service_process_restart": "BLOCKED_BY_GEMINI3_APP_AUTHORITY_R5",
            "10_persisted_browser_read_after_restart": "BLOCKED_BY_GEMINI3_AND_GEMINI4",
            "11_second_usable_tenant_and_cross_tenant_denial": "BLOCKED_BY_GEMINI3_AND_GEMINI4",
            "12_current_authority_revoke403_and_truthful_stop": "STOP_COMPONENT_VERIFIED_VIA_GEMINI1_R6_REVOKE403_BLOCKED_BY_GEMINI3_R5_AND_GEMINI4_R5",
        },
    }

    summary_path = out_dir / "assembly-r5-run-summary.json"
    summary_path.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"overallStatus": summary["overallStatus"], "summaryPath": str(summary_path), "steps": [(s["step"], s["status"]) for s in steps]}, indent=2))
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

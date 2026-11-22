"""Bounded receipt tests. No subprocess, provider, production DB, or live tools."""
import asyncio
import importlib.util
from pathlib import Path

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "backend" / "open_webui" / "routers" / "starli_tool_receipts.py"


def _load(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("starli_tool_receipts_under_test", MODULE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "HOME", tmp_path)
    return mod


def test_same_owner_key_concurrent_executes_exactly_once(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    calls = {"n": 0}
    started = asyncio.Event()
    release = asyncio.Event()

    async def call():
        calls["n"] += 1
        started.set()
        await release.wait()
        return {"isError": False, "value": "once"}

    async def run():
        first = asyncio.create_task(mod.execute("owner-a", "op-1", "echo", {"n": 1}, call))
        await started.wait()
        second = asyncio.create_task(mod.execute("owner-a", "op-1", "echo", {"n": 1}, call))
        await asyncio.sleep(0.05)
        release.set()
        return await asyncio.gather(first, second)

    left, right = asyncio.run(run())
    assert calls["n"] == 1
    payloads = {left.get("value"), right.get("value")}
    assert "once" in payloads or left.get("status") in {"EXECUTING", "UNCERTAIN", "COMPLETED"}
    assert calls["n"] == 1


def test_reused_key_different_args_409(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)

    async def call():
        return {"isError": False, "value": "a"}

    async def run():
        await mod.execute("owner-a", "op-1", "echo", {"n": 1}, call)
        with pytest.raises(HTTPException) as exc:
            await mod.execute("owner-a", "op-1", "echo", {"n": 2}, call)
        return exc.value

    err = asyncio.run(run())
    assert err.status_code == 409


def test_foreign_owner_same_key_independent(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    calls = {"n": 0}

    async def call():
        calls["n"] += 1
        return {"isError": False, "value": calls["n"]}

    async def run():
        a = await mod.execute("owner-a", "shared", "echo", {"n": 1}, call)
        b = await mod.execute("owner-b", "shared", "echo", {"n": 1}, call)
        return a, b

    a, b = asyncio.run(run())
    assert calls["n"] == 2
    assert a["value"] == 1 and b["value"] == 2


def test_timeout_becomes_uncertain_no_replay(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)
    calls = {"n": 0}

    async def call():
        calls["n"] += 1
        raise TimeoutError("bounded timeout")

    async def run():
        first = await mod.execute("owner-a", "op-t", "echo", {"n": 1}, call)
        second = await mod.execute("owner-a", "op-t", "echo", {"n": 1}, call)
        return first, second

    first, second = asyncio.run(run())
    assert calls["n"] == 1
    assert first["status"] == "UNCERTAIN"
    assert second["status"] == "UNCERTAIN"
    assert "not replayed" in second["content"][0]["text"] or "no automatic retry" in first["content"][0]["text"]


def test_no_operation_key_400(tmp_path, monkeypatch):
    mod = _load(tmp_path, monkeypatch)

    async def call():
        raise AssertionError("must not execute")

    async def run():
        with pytest.raises(HTTPException) as exc:
            await mod.execute("owner-a", "", "echo", {}, call)
        return exc.value

    err = asyncio.run(run())
    assert err.status_code == 400

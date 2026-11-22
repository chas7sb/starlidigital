"""Pi master cancellation and tool-boundary tests. No providers, network, or real processes."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from open_webui.routers import starli_pi_master as pi


class _Stdin:
    def __init__(self):
        self.chunks = []

    def write(self, data):
        self.chunks.append(data)

    async def drain(self):
        return None


class FakeProcess:
    """Stand-in for asyncio subprocess: stdin write/drain, stdout readline, terminate/wait/kill."""

    def __init__(self, lines):
        self.stdin = _Stdin()
        self.stdout = self
        self._lines = list(lines)
        self.returncode = None
        self.terminated = False
        self.killed = False
        self.waited = 0

    async def readline(self):
        if not self._lines:
            return b""
        item = self._lines.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def terminate(self):
        self.terminated = True
        if self.returncode is None:
            self.returncode = -15

    def kill(self):
        self.killed = True
        self.returncode = -9

    async def wait(self):
        self.waited += 1
        return self.returncode


def _bind(monkeypatch, tmp_path, process, tool=None):
    user = SimpleNamespace(id="owner-1")
    monkeypatch.setattr(pi, "verified", lambda user_id: user)
    monkeypatch.setattr(pi, "current_user", lambda supplied: SimpleNamespace(id=supplied["id"],role="admin"))
    monkeypatch.setattr(pi, "CWD", str(tmp_path))
    monkeypatch.setattr(pi, "RECEIPTS", tmp_path / "primary-receipts.sqlite")
    monkeypatch.setattr(pi, "NODE", str(tmp_path / "node"))
    monkeypatch.setattr(pi, "WORKER", str(tmp_path / "worker.mts"))

    async def fake_exec(*args, **kwargs):
        assert kwargs.get("stdin") is asyncio.subprocess.PIPE
        assert kwargs.get("stdout") is asyncio.subprocess.PIPE
        return process

    monkeypatch.setattr(pi.asyncio, "create_subprocess_exec", fake_exec)
    if tool is not None:
        monkeypatch.setattr(pi, "_tool", tool)
    return user


def test_unknown_model_tool_rejected_without_backend(tmp_path, monkeypatch):
    process = FakeProcess([
        (json.dumps({"type": "tool", "tool": "shell.exec", "args": {"cmd": "id"}}) + "\n").encode()
    ])
    calls = []

    async def backend(user, op, args, key):
        calls.append(op)
        raise AssertionError("backend tool must not run")

    _bind(monkeypatch, tmp_path, process, backend)

    async def run():
        return await pi.pi_chat("owner-1", [{"role": "user", "content": "do not exec"}])

    result = asyncio.run(run())
    assert result.startswith("Starli AI execution stopped (")
    assert calls == []
    assert process.terminated
    assert process.waited >= 1
    assert b"shell.exec" not in b"".join(process.stdin.chunks)


def test_cancellation_propagates_and_terminates_child(tmp_path, monkeypatch):
    process = FakeProcess([asyncio.CancelledError()])
    _bind(monkeypatch, tmp_path, process)

    async def run():
        await pi.pi_chat("owner-1", [{"role": "user", "content": "stop"}])

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run())
    assert process.terminated
    assert process.waited >= 1
    assert process.returncode is not None


def test_screenshotimage_stripped_before_stdin(tmp_path, monkeypatch):
    secret = "iVBORw0kGgoAAAANSUhEUgAAAAEAAAAB"
    process = FakeProcess([
        (json.dumps({
            "type": "tool",
            "tool": "browser.read",
            "args": {"url": "https://example.test/page"},
        }) + "\n").encode(),
        b"",
    ])

    async def backend(user, op, args, key):
        assert op == "browser.read"
        assert user.id == "owner-1"
        return {"text": "visible summary", "screenshotimage": secret, "image": secret, "screenshot": secret}

    _bind(monkeypatch, tmp_path, process, backend)

    async def run():
        return await pi.pi_chat("owner-1", [{"role": "user", "content": "read page"}])

    result = asyncio.run(run())
    assert result.startswith("Starli AI execution stopped (")
    observed = b"".join(process.stdin.chunks).decode()
    assert "visible summary" in observed
    assert "screenshotimage" not in observed
    assert secret not in observed
    assert process.terminated

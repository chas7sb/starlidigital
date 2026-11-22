from open_webui.routers import starli_runtime_adapter as runtime


def test_receipt_exposes_checkpoint_and_budgets():
    task = {
        "taskId": "t1",
        "status": "RUNNING",
        "progress": "Using platform.call",
        "receipts": [],
        "connected": True,
        "stepsCompleted": 4,
        "checkpoint": {"step": 4, "phase": "after_tool", "tool": "platform.call"},
    }
    value = runtime.receipt(task)
    assert value["checkpoint"]["phase"] == "after_tool"
    assert value["stepsCompleted"] == 4
    assert value["maxSteps"] == 120
    assert value["maxDurationSeconds"] == 3600
    assert value["cancelRequested"] is False


def test_receipt_backward_compatible_for_existing_tasks():
    task = {"taskId": "t2", "status": "QUEUED", "progress": "Queued", "receipts": [], "connected": False}
    value = runtime.receipt(task)
    assert value["checkpoint"] is None
    assert value["stepsCompleted"] == 0


def test_orphan_recovery_fences_unknown_side_effects(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    monkeypatch.setattr(runtime, "_ACTIVE", {})
    task = {
        "taskId": "orphan1", "status": "RUNNING", "progress": "Writing",
        "connected": True, "checkpoint": {"step": 3, "phase": "before_tool", "tool": "platform.call"}
    }
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", ("orphan1", "owner", "key", "hash", json.dumps(task)))
    assert runtime.recover_orphaned_tasks(now=1234) == ["orphan1"]
    with runtime.db() as connection:
        recovered = json.loads(connection.execute("SELECT payload FROM tasks WHERE id='orphan1'").fetchone()[0])
    assert recovered["status"] == "INTERRUPTED"
    assert recovered["recoveryPolicy"] == "manual_review_required"
    assert recovered["checkpoint"]["phase"] == "before_tool"
    assert runtime.recover_orphaned_tasks(now=1235) == []


def test_orphan_recovery_respects_cancellation_and_active_workers(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    monkeypatch.setattr(runtime, "_ACTIVE", {"active1": {"task": None}})
    with runtime.db() as connection:
        for task_id, cancelled in (("active1", False), ("cancel1", True)):
            task = {"taskId": task_id, "status": "RUNNING", "cancelRequested": cancelled}
            connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", (task_id, "owner", task_id, "hash", json.dumps(task)))
    assert runtime.recover_orphaned_tasks() == ["cancel1"]
    with runtime.db() as connection:
        active = json.loads(connection.execute("SELECT payload FROM tasks WHERE id='active1'").fetchone()[0])
        cancelled = json.loads(connection.execute("SELECT payload FROM tasks WHERE id='cancel1'").fetchone()[0])
    assert active["status"] == "RUNNING"
    assert cancelled["status"] == "CANCELLED"


def test_durable_cancel_fence_detects_external_cancellation(tmp_path, monkeypatch):
    import asyncio, json, pytest
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    task = {"taskId": "fenced", "status": "RUNNING", "cancelRequested": False}
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", ("fenced", "owner", "idem", "hash", json.dumps(task)))
    runtime.cancellation_fence(task)
    with runtime.db() as connection:
        stored = dict(task, cancelRequested=True, status="CANCELLED")
        connection.execute("UPDATE tasks SET payload=? WHERE id=?", (json.dumps(stored), "fenced"))
    with pytest.raises(asyncio.CancelledError):
        runtime.cancellation_fence(task)
    assert task["cancelRequested"] is True


def test_stale_save_cannot_revive_interrupted_task(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    persisted = {"taskId": "fenced", "status": "INTERRUPTED", "cancelRequested": False}
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", ("fenced", "owner", "idem", "hash", json.dumps(persisted)))
    stale = {"taskId": "fenced", "status": "RUNNING", "progress": "stale worker"}
    runtime.save(stale)
    with runtime.db() as connection:
        updated = json.loads(connection.execute("SELECT payload FROM tasks WHERE id='fenced'").fetchone()[0])
    assert updated["status"] == "INTERRUPTED"
    assert updated["cancelRequested"] is False


def test_stale_completion_cannot_overwrite_cancelled_task(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    cancelled = {"taskId": "terminal", "status": "CANCELLED", "cancelRequested": True, "progress": "Cancelled"}
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", ("terminal", "owner", "idem", "hash", json.dumps(cancelled)))
    stale = {"taskId": "terminal", "status": "COMPLETED", "progress": "finished"}
    assert runtime.save(stale) is False
    assert stale["status"] == "CANCELLED"
    with runtime.db() as connection:
        persisted = json.loads(connection.execute("SELECT payload FROM tasks WHERE id='terminal'").fetchone()[0])
    assert persisted == cancelled


def test_external_mode_preserves_queued_task(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    monkeypatch.setattr(runtime, "EXTERNAL_WORKER", True)
    monkeypatch.setattr(runtime, "_ACTIVE", {})
    task={"taskId":"queued-external","status":"QUEUED","progress":"Queued","connected":False}
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",
                           ("queued-external","owner","key","hash",json.dumps(task)))
    assert runtime.recover_orphaned_tasks(now=1234)==[]
    with runtime.db() as connection:
        persisted=json.loads(connection.execute("SELECT payload FROM tasks WHERE id='queued-external'").fetchone()[0])
    assert persisted["status"]=="QUEUED"


def test_external_mode_respects_healthy_remote_lease(tmp_path, monkeypatch):
    import json
    from open_webui.routers import starli_worker_leases as leases
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    monkeypatch.setattr(runtime, "EXTERNAL_WORKER", True)
    monkeypatch.setattr(runtime, "_ACTIVE", {})
    task={"taskId":"remote","status":"QUEUED","progress":"Queued","connected":False}
    with runtime.db() as connection:
        connection.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",
                           ("remote","owner","key","hash",json.dumps(task)))
        connection.commit()
        token=leases.claim(connection,"remote","worker-remote",now=100,ttl=50)
    assert token
    assert runtime.recover_orphaned_tasks(now=110)==[]
    with runtime.db() as connection:
        persisted=json.loads(connection.execute("SELECT payload FROM tasks WHERE id='remote'").fetchone()[0])
    assert persisted["status"]=="RUNNING"
    assert runtime.recover_orphaned_tasks(now=151)==["remote"]


def test_worker_fence_rejects_expired_lease(tmp_path, monkeypatch):
    import asyncio, json, pytest, time
    from open_webui.routers import starli_worker_leases as leases
    monkeypatch.setattr(runtime, "ROOT", tmp_path)
    task={"taskId":"leased","status":"QUEUED","receipts":[],"connected":False}
    with runtime.db() as c:
        c.execute("INSERT INTO tasks VALUES(?,?,?,?,?)",("leased","owner","key","hash",json.dumps(task)))
    with runtime.db() as c:
        token=leases.claim(c,"leased","worker1",now=time.time(),ttl=10)
    assert token
    task.update(status="RUNNING",workerId="worker1",leaseToken=token)
    runtime.cancellation_fence(task)
    with runtime.db() as c:
        c.execute("UPDATE starli_worker_leases SET expires_at=0 WHERE task_id='leased'")
    with pytest.raises(asyncio.CancelledError):
        runtime.cancellation_fence(task)

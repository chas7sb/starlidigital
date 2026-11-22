"""SQLite-backed worker claims with fencing tokens. No automatic side-effect replay."""
import json
import sqlite3
import time
import uuid


def initialize(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS starli_worker_leases(
        task_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at REAL NOT NULL,
        heartbeat_at REAL NOT NULL
    )""")


def claim(connection, task_id, worker_id, *, now=None, ttl=30):
    now = time.time() if now is None else now
    if not worker_id or ttl <= 0:
        raise ValueError("Invalid worker lease")
    connection.execute("BEGIN IMMEDIATE")
    try:
        initialize(connection)
        task_row = connection.execute("SELECT payload FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not task_row:
            connection.rollback()
            return None
        task = json.loads(task_row[0])
        if task.get("cancelRequested") or task.get("status") not in ("QUEUED", "RUNNING"):
            connection.rollback()
            return None
        previous = connection.execute("SELECT expires_at FROM starli_worker_leases WHERE task_id=?", (task_id,)).fetchone()
        if previous and previous[0] > now:
            connection.rollback()
            return None
        # An expired RUNNING task may have executed an unacknowledged write.
        if task["status"] == "RUNNING":
            task.update(status="INTERRUPTED", progress="Lease expired; manual review required",
                        recoveryPolicy="manual_review_required", connected=False)
            connection.execute("UPDATE tasks SET payload=? WHERE id=?", (json.dumps(task), task_id))
            connection.execute("DELETE FROM starli_worker_leases WHERE task_id=?", (task_id,))
            connection.commit()
            return None
        token = uuid.uuid4().hex
        connection.execute("""INSERT INTO starli_worker_leases(task_id,worker_id,token,expires_at,heartbeat_at)
            VALUES(?,?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET
            worker_id=excluded.worker_id,token=excluded.token,
            expires_at=excluded.expires_at,heartbeat_at=excluded.heartbeat_at""",
            (task_id,worker_id,token,now+ttl,now))
        task.update(status="RUNNING", workerId=worker_id, leaseToken=token,
                    leaseUntil=now+ttl)
        connection.execute("UPDATE tasks SET payload=? WHERE id=?", (json.dumps(task),task_id))
        connection.commit()
        return token
    except BaseException:
        connection.rollback()
        raise


def heartbeat(connection, task_id, worker_id, token, *, now=None, ttl=30):
    now=time.time() if now is None else now
    connection.execute("BEGIN IMMEDIATE")
    try:
        initialize(connection)
        row=connection.execute("SELECT payload FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            connection.rollback()
            return False
        task=json.loads(row[0])
        if task.get("cancelRequested") or task.get("status") != "RUNNING" or task.get("leaseToken") != token or task.get("workerId") != worker_id:
            connection.rollback()
            return False
        updated=connection.execute("""UPDATE starli_worker_leases SET expires_at=?,heartbeat_at=?
            WHERE task_id=? AND worker_id=? AND token=? AND expires_at>?""",
            (now+ttl,now,task_id,worker_id,token,now)).rowcount
        if not updated:
            connection.rollback()
            return False
        task["leaseUntil"]=now+ttl
        connection.execute("UPDATE tasks SET payload=? WHERE id=?", (json.dumps(task),task_id))
        connection.commit()
        return True
    except BaseException:
        connection.rollback()
        raise


def owns(connection, task_id, worker_id, token, *, now=None):
    now=time.time() if now is None else now
    row=connection.execute("""SELECT 1 FROM starli_worker_leases l
        JOIN tasks t ON t.id=l.task_id WHERE l.task_id=? AND l.worker_id=?
        AND l.token=? AND l.expires_at>? AND json_extract(t.payload,'$.status')='RUNNING'
        AND coalesce(json_extract(t.payload,'$.cancelRequested'),0)=0""",
        (task_id,worker_id,token,now)).fetchone()
    return bool(row)


def release(connection, task_id, worker_id, token):
    with connection:
        return connection.execute("DELETE FROM starli_worker_leases WHERE task_id=? AND worker_id=? AND token=?",
                                  (task_id,worker_id,token)).rowcount == 1

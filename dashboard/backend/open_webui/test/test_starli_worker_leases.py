import json
import sqlite3

from open_webui.routers import starli_worker_leases as leases


def setup():
    connection=sqlite3.connect(":memory:")
    connection.execute("CREATE TABLE tasks(id TEXT PRIMARY KEY,payload TEXT)")
    for name,status in (("queued","QUEUED"),("running","RUNNING"),("cancelled","QUEUED")):
        connection.execute("INSERT INTO tasks VALUES(?,?)", (name,json.dumps({
            "taskId":name,"status":status,"cancelRequested":name=="cancelled"
        })))
    connection.commit()
    return connection


def test_claim_heartbeat_and_release():
    c=setup()
    token=leases.claim(c,"queued","worker1",now=100,ttl=20)
    assert token
    assert leases.claim(c,"queued","worker2",now=101) is None
    assert leases.owns(c,"queued","worker1",token,now=101)
    assert not leases.heartbeat(c,"queued","worker2",token,now=110)
    assert leases.heartbeat(c,"queued","worker1",token,now=110,ttl=20)
    assert leases.owns(c,"queued","worker1",token,now=125)
    assert leases.release(c,"queued","worker1",token)
    assert not leases.owns(c,"queued","worker1",token,now=125)


def test_expired_running_lease_is_fenced_not_replayed():
    c=setup()
    token=leases.claim(c,"queued","worker1",now=100,ttl=10)
    assert token
    assert leases.claim(c,"queued","worker2",now=111) is None
    state=json.loads(c.execute("SELECT payload FROM tasks WHERE id='queued'").fetchone()[0])
    assert state["status"]=="INTERRUPTED"
    assert state["recoveryPolicy"]=="manual_review_required"
    assert not leases.owns(c,"queued","worker1",token,now=111)


def test_cancelled_and_unowned_tasks_are_not_claimed():
    c=setup()
    assert leases.claim(c,"cancelled","worker",now=100) is None
    assert leases.claim(c,"missing","worker",now=100) is None
    assert leases.claim(c,"running","worker",now=100) is None


def test_cancellation_fences_heartbeat():
    c=setup()
    token=leases.claim(c,"queued","worker1",now=100)
    task=json.loads(c.execute("SELECT payload FROM tasks WHERE id='queued'").fetchone()[0])
    task["cancelRequested"]=True
    c.execute("UPDATE tasks SET payload=? WHERE id='queued'",(json.dumps(task),))
    c.commit()
    assert not leases.heartbeat(c,"queued","worker1",token,now=101)
    assert not leases.owns(c,"queued","worker1",token,now=101)

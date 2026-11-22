"""Native background tasks with server-derived ownership."""
import asyncio
from typing import Dict
from uuid import uuid4

tasks: Dict[str, asyncio.Task] = {}
chat_tasks = {}
task_owners = {}

def cleanup_task(task_id: str, id=None):
    tasks.pop(task_id, None)
    task_owners.pop(task_id, None)
    if id and task_id in chat_tasks.get(id, []):
        chat_tasks[id].remove(task_id)
        if not chat_tasks[id]:
            chat_tasks.pop(id, None)

def create_task(coroutine, id=None, user_id=None):
    task_id = str(uuid4())
    task = asyncio.create_task(coroutine)
    task.add_done_callback(lambda t: cleanup_task(task_id, id))
    tasks[task_id] = task
    task_owners[task_id] = user_id
    chat_tasks.setdefault(id, []).append(task_id)
    return task_id, task

def get_task(task_id: str):
    return tasks.get(task_id)

def list_tasks(user_id=None, admin=False):
    if admin:
        return list(tasks)
    return [ident for ident in tasks if user_id and task_owners.get(ident)==user_id]

def list_task_ids_by_chat_id(id):
    return list(chat_tasks.get(id, []))

async def stop_task(task_id: str, user_id=None, admin=False):
    task = tasks.get(task_id)
    if not task or (not admin and (not user_id or task_owners.get(task_id)!=user_id)):
        raise ValueError("Task not found")
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        cleanup_task(task_id)
        return {"status":True,"message":"Task stopped."}
    return {"status":False,"message":"Task already finished."}

"""Pi runtime task boundary. Coordinator mounts ``router`` at ``/api/v1/starli/runtime``.

Does not spawn processes, call providers, or trust client company identifiers.
Authorization, ownership, and cost policy live entirely in the injected adapter.
"""

from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictStr, ValidationError

from open_webui.utils.auth import get_verified_user

ALLOWED_OPERATIONS = frozenset({"capabilities", "tasks.create", "tasks.get", "tasks.cancel"})

RuntimeAdapter = Callable[[str, str, Dict[str, Any]], Union[Dict[str, Any], Awaitable[Dict[str, Any]]]]
_adapter: Optional[RuntimeAdapter] = None


class _Strict(BaseModel):
    class Config:
        extra = "forbid"


class TaskCreateBody(_Strict):
    prompt: StrictStr = Field(..., min_length=1, max_length=8000)
    model: Optional[StrictStr] = Field(None, min_length=1, max_length=128)
    idempotencyKey: StrictStr = Field(..., min_length=1, max_length=128)


class TaskIdBody(_Strict):
    taskId: StrictStr = Field(..., min_length=1, max_length=128)


class TaskReceipt(_Strict):
    taskId: StrictStr
    status: StrictStr
    progress: StrictStr
    receipts: List[StrictStr]
    connected: bool = False


def register_runtime_adapter(adapter: Optional[RuntimeAdapter]) -> None:
    """Bind the coordinator adapter. Identity is passed as user_id only."""
    global _adapter
    if adapter is not None and not callable(adapter):
        raise TypeError("adapter must be callable or None")
    _adapter = adapter


async def _authenticated_user_id(user: Any = Depends(get_verified_user)) -> str:
    user_id = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Authenticated user identity unavailable")
    return user_id


async def _call_adapter(user_id: str, operation: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if operation not in ALLOWED_OPERATIONS:
        raise HTTPException(status_code=400, detail="Unknown runtime operation")
    adapter = _adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="Starli runtime adapter unavailable")
    try:
        result = adapter(user_id, operation, payload)
        if inspect.isawaitable(result):
            result = await result
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Starli runtime adapter failed") from None
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data")
    # Never claim a live Pi connection unless the adapter explicitly reports one.
    result.setdefault("connected", False)
    return result


def _public_receipt(raw):
    # Internal adapters also return private execution/binding metadata. The legacy
    # HTTP response remains its explicit public receipt contract.
    if not isinstance(raw, dict):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data")
    allowed = {key: raw[key] for key in ("taskId", "status", "progress", "receipts", "connected") if key in raw}
    try:
        return TaskReceipt.parse_obj(allowed).dict()
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data") from None


async def dispatch_starli_task(user_id: str, prompt: str, idempotency_key: str) -> Dict[str, Any]:
    """Native Starli chat spawn path. Uses the same adapter as HTTP task create."""
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Authenticated user identity unavailable")
    body = TaskCreateBody(prompt=prompt, idempotencyKey=idempotency_key)
    raw = await _call_adapter(
        user_id,
        "tasks.create",
        {"prompt": body.prompt, "model": body.model, "idempotencyKey": body.idempotencyKey},
    )
    try:
        return _public_receipt(raw)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data") from None


router = APIRouter()


@router.get("/capabilities")
async def capabilities(user_id: str = Depends(_authenticated_user_id)) -> Dict[str, Any]:
    data = await _call_adapter(user_id, "capabilities", {})
    return {
        "operations": sorted(ALLOWED_OPERATIONS),
        "connected": bool(data.get("connected", False)),
        "runtime": "pi",
        "spawn": bool(data.get("spawn", False)),
        "detail": data.get("detail") if isinstance(data.get("detail"), str) else "adapter-reported",
    }


@router.post("/tasks", response_model=TaskReceipt)
async def create_task(body: TaskCreateBody, user_id: str = Depends(_authenticated_user_id)) -> Dict[str, Any]:
    raw = await _call_adapter(
        user_id,
        "tasks.create",
        {"prompt": body.prompt, "model": body.model, "idempotencyKey": body.idempotencyKey},
    )
    try:
        return _public_receipt(raw)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data") from None


@router.get("/tasks/{task_id}", response_model=TaskReceipt)
async def get_task(task_id: str, user_id: str = Depends(_authenticated_user_id)) -> Dict[str, Any]:
    ident = TaskIdBody(taskId=task_id)
    raw = await _call_adapter(user_id, "tasks.get", {"taskId": ident.taskId})
    try:
        return _public_receipt(raw)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data") from None


@router.post("/tasks/{task_id}/cancel", response_model=TaskReceipt)
async def cancel_task(task_id: str, user_id: str = Depends(_authenticated_user_id)) -> Dict[str, Any]:
    ident = TaskIdBody(taskId=task_id)
    raw = await _call_adapter(user_id, "tasks.cancel", {"taskId": ident.taskId})
    try:
        return _public_receipt(raw)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli runtime adapter returned invalid data") from None

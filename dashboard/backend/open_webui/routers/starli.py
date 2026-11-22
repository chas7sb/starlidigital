"""Read-only Starli overview endpoint; mount ``router`` at ``/api/v1/starli``."""

from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool, StrictFloat, StrictInt, StrictStr, ValidationError

from open_webui.utils.auth import get_verified_user


class _StrictModel(BaseModel):
    class Config:
        extra = "forbid"


class Company(_StrictModel):
    id: StrictStr
    name: StrictStr


class Agent(_StrictModel):
    id: StrictStr
    name: StrictStr
    status: StrictStr


class Tool(_StrictModel):
    id: StrictStr
    name: StrictStr
    description: Optional[StrictStr] = None


class Browser(_StrictModel):
    available: StrictBool
    reason: Optional[StrictStr] = None


class Credits(_StrictModel):
    available: StrictBool
    balance: Optional[Union[StrictInt, StrictFloat]]
    unit: StrictStr


class CompanyOverview(_StrictModel):
    company: Optional[Company]
    agents: List[Agent]
    tools: List[Tool]
    browser: Browser
    credits: Credits
    readOnly: StrictBool


OverviewAdapter = Callable[[str], Union[Dict[str, Any], Awaitable[Dict[str, Any]]]]
_adapter: Optional[OverviewAdapter] = None


def register_company_overview_adapter(adapter: Optional[OverviewAdapter]) -> None:
    """Bind the coordinator's real, membership-checked read source (or clear it).

    The adapter receives only the authenticated user's ID and must enforce company
    membership itself. No admin credentials or client-supplied company identifiers
    are passed through this boundary.
    """
    global _adapter
    if adapter is not None and not callable(adapter):
        raise TypeError("adapter must be callable or None")
    _adapter = adapter


async def _authenticated_user_id(user: Any = Depends(get_verified_user)) -> str:
    # Derive identity only from the authenticated principal, never request headers.
    user_id = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=401, detail="Authenticated user identity unavailable")
    return user_id


async def get_company_overview(
    user_id: str = Depends(_authenticated_user_id),
) -> Dict[str, Any]:
    """Resolve the configured company-scoped overview source; fail closed if absent."""
    adapter = _adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="Starli overview source unavailable")
    result = adapter(user_id)
    if inspect.isawaitable(result):
        result = await result
    try:
        return CompanyOverview.parse_obj(result).dict(exclude_unset=True)
    except (ValidationError, TypeError, ValueError):
        raise HTTPException(status_code=502, detail="Starli overview source returned invalid data") from None


router = APIRouter()


@router.get("/overview", response_model=CompanyOverview, response_model_exclude_unset=True)
async def overview(
    data: Dict[str, Any] = Depends(get_company_overview),
) -> Dict[str, Any]:
    return data

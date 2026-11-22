"""Read-only resource index for the Starli preview coordinator.

Mounted at /api/v1/starli/resources. Collections are a fixed map; kind is never interpolated into SQL.
"""
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query

from open_webui.routers.starli_platform import connection, customer_principal as principal, records
from open_webui.utils.auth import get_verified_user

router = APIRouter()

COLLECTIONS = {
    "projects": "projects",
    "proposals": "proposals",
    "mailbox": "mailbox-messages",
    "hosted-agents": "hosted-agent-agents",
    "videos": "video-projects",
    "activity": "crm_activities",
}
NAME_KEYS = ("name", "title", "businessName", "subject", "summary")
DESCRIPTION_KEYS = ("brief", "description", "snippet")
URL_KEYS = ("publicUrl", "deploymentUrl", "website")


def _text(value):
    if not isinstance(value, str):
        return ""
    return value.strip()


def _name(row):
    for key in NAME_KEYS:
        text = _text(row.get(key))
        if text:
            return text[:500]
    return ""


def _description(row):
    for key in DESCRIPTION_KEYS:
        text = _text(row.get(key))
        if text:
            return text[:1000]
    return ""


def _url(row):
    for key in URL_KEYS:
        text = _text(row.get(key))
        if not text:
            continue
        parts = urlsplit(text)
        if parts.scheme not in ("http", "https") or parts.username or parts.password:
            continue
        if not parts.hostname:
            continue
        return text
    return None


def project_row(row):
    item = {
        "id": _text(row.get("id")),
        "name": _name(row),
        "status": _text(row.get("status")) or "UNKNOWN",
        "description": _description(row),
        "updatedAt": _text(row.get("updatedAt")) or _text(row.get("createdAt")),
    }
    url = _url(row)
    if url:
        item["url"] = url
    return item


@router.get("/{kind}")
def list_resources(
    kind: str,
    q: str = Query("", max_length=200),
    limit: int = Query(30, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user=Depends(get_verified_user),
):
    _,binding=principal(user)
    collection = COLLECTIONS.get(kind)
    if not collection:
        raise HTTPException(404, "Unknown collection")
    with connection() as db:
        import json
        rows=[json.loads(row[0]) for row in db.execute("SELECT payload FROM records WHERE collection=? AND owner=?",(collection,binding["v2UserId"]))]
    items = [project_row(row) for row in rows if isinstance(row, dict)]
    needle = q.casefold().strip()
    if needle:
        items = [
            item
            for item in items
            if needle in f"{item['name']} {item['description']}".casefold()
        ]
    items.sort(key=lambda item: (item.get("updatedAt") or "", item.get("id") or ""), reverse=True)
    return {
        "items": items[offset : offset + limit],
        "total": len(items),
        "readOnly": True,
        "kind": kind,
    }

"""Installation-owner console; does not grant company-computer permissions."""
import importlib.util
import os
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from open_webui.utils.auth import get_verified_user
from open_webui.routers import starli_platform

router = APIRouter()
_adapter = None

def owner(request: Request, user=Depends(get_verified_user)):
    # Explicit token possession prevents cookie-only cross-site control requests.
    if not request.headers.get('authorization', '').startswith('Bearer '):
        raise HTTPException(401, 'Bearer authentication required')
    origin = request.headers.get('origin')
    if origin and origin.rstrip('/') != str(request.base_url).rstrip('/'):
        import starli_portable
        try:
            permitted = origin in starli_portable.allowed_origins()
        except ValueError:
            permitted = False
        if not permitted:
            raise HTTPException(403, 'Same-origin local VM access required')
    starli_platform.principal(user)  # Revalidates both roles and the private binding on every request.
    return user

def enabled():
    return os.environ.get('STARLI_LOCAL_VM_ENABLED') == '1'

def adapter():
    global _adapter
    if not enabled():
        raise HTTPException(503, 'Local VM console is not enabled for this installation')
    if _adapter is None:
        source = Path(__file__).resolve().parents[4] / 'runtime/dashboard_adapter.py'
        if not source.is_file() or source.is_symlink():
            raise HTTPException(503, 'Local VM runtime is not installed beside the dashboard')
        spec = importlib.util.spec_from_file_location('_starli_vm_dashboard', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _adapter = module
    return _adapter

def invoke(method, *args, **kwargs):
    target = adapter()
    try:
        return getattr(target, method)(*args, **kwargs)
    except target.Busy:
        raise HTTPException(429, 'Another VM operation is active; wait and refresh') from None
    except ValueError:
        raise HTTPException(400, 'Guest input or VM state is invalid') from None
    except (OSError, RuntimeError, KeyError, TypeError):
        # Local command lines, file paths, QMP errors and guest content stay out of errors/logs.
        raise HTTPException(503, 'VM operation unavailable; inspect the local runtime status') from None

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['pointer', 'key', 'text']
    x: StrictInt | None = Field(default=None, ge=0, le=8191)
    y: StrictInt | None = Field(default=None, ge=0, le=8191)
    button: Literal['left', 'right'] = 'left'
    key: StrictStr | None = Field(default=None, max_length=16)
    text: StrictStr | None = Field(default=None, min_length=1, max_length=1000)

@router.get('/status')
def status(user=Depends(owner)):
    if not enabled():
        return {'enabled': False, 'state': 'disabled', 'scope': 'installation-owner-local-vm'}
    return {'enabled': True, **invoke('status')}

@router.get('/frame')
def frame(user=Depends(owner)):
    return Response(invoke('frame'), media_type='image/png', headers={
        'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff'})

@router.post('/start')
def start(user=Depends(owner)):
    return invoke('lifecycle', 'start')

@router.post('/stop')
def stop(user=Depends(owner)):
    return invoke('lifecycle', 'stop')

@router.post('/input')
def input_event(body: Input, user=Depends(owner)):
    return invoke('input_event', body.kind, **body.model_dump(exclude={'kind'}, exclude_none=True))

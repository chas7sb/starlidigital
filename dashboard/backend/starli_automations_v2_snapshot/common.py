"""Starli-owned domain contracts. Tenant context is server-created, never JSON."""
import hashlib
import json
import re
import secrets
from dataclasses import dataclass, field

VERSION = 'starli.automations.v1'

class Fault(Exception):
    def __init__(self, code, status=403):
        self.code, self.status = code, status
        super().__init__(code)

def need(value, code, status=403):
    if not value: raise Fault(code, status)

def encoded(value):
    try: result = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError): raise Fault('INVALID_INPUT', 422) from None
    need(len(result.encode()) <= 65536, 'INPUT_LIMIT', 413)
    return result

def digest(value): return hashlib.sha256(encoded(value).encode()).hexdigest()
def identifier(): return secrets.token_hex(16)
def exact(value, required, optional=()):
    need(type(value) is dict and set(required) <= set(value) <= set(required) | set(optional), 'INVALID_FIELDS', 422)

def text(value, maximum=500):
    need(type(value) is str and 0 < len(value) <= maximum and not any(ord(c)<32 for c in value), 'INVALID_TEXT', 422)
    return value

def envelope(company, **fields): return dict(version=VERSION, companyId=company, **fields)

@dataclass(frozen=True)
class Context:
    company: str
    actor: str
    binding: str
    session: object = field(repr=False, compare=False)
    bot: str | None = None
    room: str | None = None
    native_scope: object = field(default=None, repr=False, compare=False)

@dataclass(frozen=True)
class WorkerContext(Context):
    workflow: str = ''
    workflow_version: int = 0

def public_error(error):
    return error.code if isinstance(error, Fault) else 'AUTOMATION_UNAVAILABLE'

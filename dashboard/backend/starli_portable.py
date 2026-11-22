"""Portable server-owned locations and origins; no production installation fallbacks.

Values come from operator environment only, never request input. Missing optional
runtime/config files remain missing so their existing readiness checks fail closed.
"""
import ipaddress
import os
import shutil
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
DASHBOARD = Path(__file__).resolve().parents[1]

def data_root():
    return Path(os.environ.get('STARLI_DATA_DIR') or os.environ.get('DATA_DIR') or DASHBOARD / 'backend/data').expanduser().resolve()

def config_file(name):
    return str(Path(os.environ.get('STARLI_CONFIG_DIR') or ROOT / 'config/private').expanduser().resolve() / name)

def data_file(name):
    return str(data_root() / name)

def platform_root():
    return str(Path(os.environ.get('STARLI_PLATFORM_SOURCE_ROOT') or ROOT / 'platform').expanduser().resolve())

def workspace_file(name=''):
    return str(Path(os.environ.get('STARLI_WORKSPACE_ROOT') or ROOT / 'workspace').expanduser().resolve() / name)

def runtime_file(name):
    return str(Path(os.environ.get('STARLI_RUNTIME_BUNDLE_DIR') or ROOT / 'runtime/vendor').expanduser().resolve() / name)

def node_binary():
    return os.environ.get('STARLI_NODE_BINARY') or shutil.which('node') or 'node'

def browser_binary():
    return os.environ.get('STARLI_BROWSER_EXECUTABLE_PATH') or shutil.which('chromium') or shutil.which('google-chrome') or 'chromium'

def origin(value):
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise ValueError("STARLI_PUBLIC_ORIGIN_INVALID")
    validated = service_origin(value)
    parsed = urlsplit(validated)
    try:
        local = parsed.hostname == 'localhost' or ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = False
    if (not parsed.hostname or parsed.username or parsed.password or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment or (parsed.scheme != 'https' and not (parsed.scheme == 'http' and local))):
        raise ValueError('STARLI_PUBLIC_ORIGIN_INVALID: use HTTPS or loopback HTTP without a path')
    # Access port to reject malformed port values.
    parsed.port
    return validated

def public_origin():
    return origin(os.environ.get('STARLI_PUBLIC_ORIGIN') or os.environ.get('WEBUI_URL') or 'http://localhost:8080')

def public_url(path=''):
    return public_origin() + path

def service_origin(value):
    """Validate a trusted operator service origin, including Compose HTTP DNS.

    Call only with server configuration. Browser destinations and OAuth issuers
    must continue to use origin(), which disallows external cleartext HTTP.
    """
    if not isinstance(value, str) or any(ord(c) <= 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise ValueError("STARLI_SERVICE_ORIGIN_INVALID")
    parsed = urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment
            or '?' in value or '#' in value):
        raise ValueError('STARLI_SERVICE_ORIGIN_INVALID: expected an HTTP(S) origin without credentials or a path')
    # Parsing hostname alone does not validate malformed DNS labels or ports.
    host = parsed.hostname
    try:
        ipaddress.ip_address(host)
    except ValueError:
        import re
        try:
            dns = host.encode('idna').decode('ascii')
        except UnicodeError:
            raise ValueError('STARLI_SERVICE_ORIGIN_INVALID') from None
        if len(dns) > 253 or not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in dns.rstrip('.').split('.')):
            raise ValueError('STARLI_SERVICE_ORIGIN_INVALID')
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError('STARLI_SERVICE_ORIGIN_INVALID')
    return value.rstrip('/')

def platform_url(path=''):
    return service_origin(os.environ.get('STARLI_PLATFORM_ORIGIN') or 'http://127.0.0.1:4100') + path

def platform_public_url(path=''):
    return origin(os.environ.get('STARLI_PLATFORM_PUBLIC_ORIGIN') or 'http://127.0.0.1:4100') + path


def allowed_origins():
    raw = os.environ.get('STARLI_ALLOWED_ORIGINS')
    return frozenset(origin(item.strip()) for item in raw.split(',') if item.strip()) if raw else frozenset({public_origin()})

def oauth_origins():
    return {urlsplit(item).netloc.lower(): item for item in allowed_origins()}


def control_plane_url(path=""):
    return service_origin(os.environ.get("STARLI_CONTROL_PLANE_ORIGIN") or "http://127.0.0.1:4120") + path


def company_platform_url(path=""):
    return service_origin(os.environ.get("STARLI_COMPANY_PLATFORM_ORIGIN") or platform_url()) + path


def control_plane_public_url(path=""):
    return origin(os.environ.get("STARLI_CONTROL_PLANE_PUBLIC_ORIGIN") or "http://127.0.0.1:4120") + path

import os, threading, logging
# Fail closed before importing SearXNG if local setup has not supplied a fresh secret.
from pathlib import Path
import yaml
settings_path = os.environ.get("SEARXNG_SETTINGS_PATH", "")
if not settings_path or not Path(settings_path).is_absolute():
    raise RuntimeError("SEARXNG_SETTINGS_PATH_REQUIRED")
settings = yaml.safe_load(Path(settings_path).read_text()) or {}
instance_secret = os.environ.get("SEARXNG_SECRET") or settings.get("server", {}).get("secret_key", "")
if not isinstance(instance_secret, str) or len(instance_secret) < 32 or instance_secret == "ultrasecretkey":
    raise RuntimeError("FRESH_SEARXNG_SECRET_REQUIRED")
from searx.webapp import app
# Queries, upstream URLs and content must never enter persistent application logs.
logging.disable(logging.CRITICAL)
slots = threading.BoundedSemaphore(2)
def application(environ, start_response):
    path, method = environ.get('PATH_INFO'), environ.get('REQUEST_METHOD')
    if path == '/healthz' and method == 'GET':
        start_response('200 OK', [('Content-Type','application/json')])
        return [b'{"status":"ready","schema":"starli.searxng.health.v1"}']
    if path != '/search' or method != 'POST':
        start_response('404 Not Found', [('Content-Type','application/json')]); return [b'{"error":"NOT_FOUND"}']
    try: length = int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError: length = -1
    if length < 1 or length > 8192:
        start_response('413 Payload Too Large', []); return [b'{}']
    if not slots.acquire(False):
        start_response('429 Too Many Requests', [('Retry-After','2')]); return [b'{"error":"SEARCH_BUSY"}']
    try:
        # Flask materializes bounded search responses; release after iteration.
        captured = {}
        def deferred(status, headers, exc_info=None):
            captured.update(status=status, headers=headers)
        result = app(environ, deferred)
        try:
            chunks, size = [], 0
            for chunk in result:
                size += len(chunk)
                if size > 1048576:
                    start_response('502 Bad Gateway', [('Content-Type','application/json')])
                    return [b'{"error":"SEARCH_OUTPUT_LIMIT"}']
                chunks.append(chunk)
            start_response(captured['status'], captured['headers'])
            return chunks
        finally:
            if hasattr(result, 'close'): result.close()
    finally: slots.release()

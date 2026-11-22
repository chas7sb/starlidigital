"""Fixed first-party MCP transport for Starli Control Plane, with no arbitrary HTTP egress.

The existing sandbox intentionally blocks this host's own public IP. Rather
than weaken the sandbox, this trusted native API adapter uses ONLY the fixed
loopback control-plane listener for the exact registered first-party MCP URL.
External MCP servers continue through the isolated root-reviewed network broker.

Native account registry (credential encryption, JWT fences, company/bot grants
and per-next-task consent) remains the sole authority. No secrets are logged.
"""
from __future__ import annotations
import starli_portable as _portable
import asyncio
import json
import re
from collections.abc import Callable

import aiohttp
from .registry import Fault

PUBLIC_URL = _portable.control_plane_public_url('/mcp')
LOOPBACK_URL = _portable.control_plane_url("/mcp")
PROTOCOL = "2025-06-18"
TOKEN = re.compile(r"^starli_mcp_[a-f0-9]{64}$")
MAX_RESPONSE_BYTES = 1_048_576
MAX_ARGUMENT_BYTES = 65_536
MAX_TOOLS = 200
MAX_PAGES = 20

class LocalFirstPartyMcp:
    """One fixed native bridge; never accepts a caller-supplied destination."""

    def __init__(self, *, _loopback_url: str = LOOPBACK_URL):
        # Kept injectable solely for isolated fixture tests; production
        # instantiation always uses the hardcoded exact server-configured service origin.
        self._loopback_url = _loopback_url

    @staticmethod
    def matches(configuration: dict) -> bool:
        return (type(configuration) is dict
                and configuration.get("url") == PUBLIC_URL
                and configuration.get("transport") == "streamable-http")

    def _credentials(self, configuration: dict, authorize: Callable):
        authorize()
        if not self.matches(configuration) or not isinstance(configuration.get("_owner"), str) or not configuration["_owner"]:
            raise Fault("MCP_FIRST_PARTY_SCOPE_DENIED", 403)
        bearer = configuration.get("credential")
        if type(bearer) is not str or TOKEN.fullmatch(bearer) is None:
            raise Fault("MCP_OAUTH_REAUTHORIZE_REQUIRED", 401)
        return bearer

    async def _rpc(self, configuration, authorize, ident, method, params=None, *, notify=False):
        token = self._credentials(configuration, authorize)
        if not isinstance(method, str) or method not in (
            "initialize", "notifications/initialized", "tools/list", "tools/call"
        ):
            raise Fault("MCP_PROTOCOL_DENIED", 400)
        body = {"jsonrpc": "2.0", "method": method}
        if not notify:
            body["id"] = ident
        if params is not None:
            body["params"] = params
        raw = json.dumps(body, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(raw) > MAX_ARGUMENT_BYTES:
            raise Fault("MCP_ARGUMENT_LIMIT", 413)
        headers = {
            "Authorization": "Bearer " + token,
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "MCP-Protocol-Version": PROTOCOL
        }
        # Literal loopback (no DNS), no proxy, no redirects, bounded time,
        # and bounded response bytes. No application-level SSRF path.
        timeout = aiohttp.ClientTimeout(total=12, connect=3, sock_read=10)
        try:
            async with aiohttp.ClientSession(
                timeout=timeout,
                trust_env=False,
                cookie_jar=aiohttp.DummyCookieJar()
            ) as session:
                authorize()
                async with session.post(
                    self._loopback_url, data=raw, headers=headers,
                    allow_redirects=False
                ) as response:
                    authorize()
                    if response.status in (301, 302, 303, 307, 308):
                        raise Fault("MCP_REDIRECT_DENIED", 502)
                    if response.status == 401:
                        raise Fault("MCP_OAUTH_REAUTHORIZE_REQUIRED", 401)
                    if response.status == 403:
                        raise Fault("MCP_OAUTH_SCOPE_DENIED", 403)
                    if response.status not in (200, 202):
                        raise Fault("MCP_FIRST_PARTY_REQUEST_FAILED", 502)
                    if notify and response.status == 202:
                        return None
                    content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
                    if content_type not in ("application/json", "text/event-stream"):
                        raise Fault("MCP_FIRST_PARTY_PROTOCOL_FAILED", 502)
                    chunks = bytearray()
                    # Iterate chunks and re-check the user's fresh session
                    # before consuming any remote response data.
                    async for chunk in response.content.iter_chunked(8192):
                        authorize()
                        chunks.extend(chunk)
                        if len(chunks) > MAX_RESPONSE_BYTES:
                            raise Fault("MCP_OUTPUT_LIMIT", 413)
                    authorize()
        except Fault:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
            raise Fault("MCP_FIRST_PARTY_UNAVAILABLE", 503) from None
        except asyncio.CancelledError:
            # An already-sent tool may have had external effects. The
            # caller must not automatically retry an uncertain operation.
            raise

        try:
            if content_type == "text/event-stream":
                messages = []
                parts = []
                for line in bytes(chunks).decode("utf-8").splitlines():
                    if line.startswith("data:"):
                        parts.append(line[5:].lstrip())
                    elif not line.strip() and parts:
                        messages.append(json.loads("\n".join(parts)))
                        parts.clear()
                if parts:
                    messages.append(json.loads("\n".join(parts)))
                matching = [m for m in messages if isinstance(m, dict) and m.get("id") == ident]
                result = matching[0] if matching else None
            else:
                result = json.loads(chunks)
        except (UnicodeDecodeError, ValueError, TypeError):
            raise Fault("MCP_FIRST_PARTY_RESPONSE_INVALID", 502) from None
        if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != ident:
            raise Fault("MCP_FIRST_PARTY_RESPONSE_INVALID", 502)
        if "error" in result:
            raise Fault("MCP_FIRST_PARTY_RPC_ERROR", 502)
        if "result" not in result:
            raise Fault("MCP_FIRST_PARTY_RESPONSE_INVALID", 502)
        return result["result"]

    async def _handshake(self, configuration, authorize):
        result = await self._rpc(configuration, authorize, 1, "initialize", {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "starli-first-party-native", "version": "1.0.0"}
        })
        if not isinstance(result, dict) or not isinstance(result.get("protocolVersion"), str):
            raise Fault("MCP_FIRST_PARTY_PROTOCOL_FAILED", 502)
        await self._rpc(configuration, authorize, None, "notifications/initialized", notify=True)

    async def discover(self, configuration, authorize):
        await self._handshake(configuration, authorize)
        tools = []
        cursor = None
        seen = set()
        for page_number in range(MAX_PAGES):
            params = {"cursor": cursor} if cursor else {}
            response = await self._rpc(configuration, authorize, page_number + 2, "tools/list", params)
            if not isinstance(response, dict) or not isinstance(response.get("tools"), list):
                raise Fault("MCP_DISCOVERY_INVALID", 502)
            tools.extend(response["tools"])
            if len(tools) > MAX_TOOLS:
                raise Fault("MCP_TOOL_LIMIT", 413)
            cursor = response.get("nextCursor")
            if cursor is None:
                authorize()
                return tools
            if type(cursor) is not str or not cursor or len(cursor) > 180 or cursor in seen:
                raise Fault("MCP_CURSOR_INVALID", 502)
            seen.add(cursor)
        raise Fault("MCP_TOOL_LIMIT", 413)

    async def invoke(self, configuration, name, args, authorize):
        if type(name) is not str or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,180}", name):
            raise Fault("MCP_TOOL_NAME_INVALID", 422)
        if type(args) is not dict or len(json.dumps(args, allow_nan=False).encode()) > 32_768:
            raise Fault("MCP_ARGUMENT_LIMIT", 413)
        await self._handshake(configuration, authorize)
        authorize()
        response = await self._rpc(configuration, authorize, 2, "tools/call",
                                   {"name": name, "arguments": args})
        authorize()
        return response

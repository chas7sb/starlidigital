#!/usr/bin/env python3
"""Call the authenticated local MCP without printing or passing its token in argv."""
import json
import pathlib
import sys
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
config = json.loads((root / 'state/config.json').read_text())
headers = {'Authorization': 'Bearer ' + config['mcpToken'], 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}

def send(payload):
    request = urllib.request.Request('http://127.0.0.1:17600/mcp', data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        session = response.headers.get('mcp-session-id')
        if session:
            headers['mcp-session-id'] = session
        text = response.read().decode()
    if not text.strip():
        return None
    if text.startswith('event:') or text.startswith('data:'):
        for line in text.splitlines():
            if line.startswith('data: '):
                return json.loads(line[6:])
        raise RuntimeError('MCP response contained no data')
    return json.loads(text)

send({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-03-26', 'capabilities': {}, 'clientInfo': {'name': 'StarliDigital-Codex', 'version': '1.0'}}})
send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
if len(sys.argv) < 2 or sys.argv[1] == '--list':
    result = send({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}})
else:
    arguments = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    result = send({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': sys.argv[1], 'arguments': arguments}})
print(json.dumps(result, ensure_ascii=False))

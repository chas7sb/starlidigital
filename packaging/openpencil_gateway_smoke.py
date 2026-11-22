"""Smoke the actual built OpenPencil gateway and npm-locked MCP in a scratch root."""
import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time


def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));return s.getsockname()[1]

def request(number,path,headers=None,payload=None,method='GET'):
    conn=http.client.HTTPConnection('127.0.0.1',number,timeout=10)
    try:
        conn.request(method,path,body=payload,headers=headers or {})
        response=conn.getresponse();return response.status,dict(response.getheaders()),response.read()
    finally:conn.close()

def rpc_payload(method,identifier=1):
    params={'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'starli-packaging-smoke','version':'1'}} if method=='initialize' else {}
    return json.dumps({'jsonrpc':'2.0','id':identifier,'method':method,'params':params})

def parse_rpc(body):
    text=body.decode()
    if text.startswith('event:') or text.startswith('data:'):
        text=next(line[5:].strip() for line in text.splitlines() if line.startswith('data:'))
    return json.loads(text)

def smoke(root):
    root=root.resolve()
    official=Path(__file__).resolve().parents[1]/'platform/extensions/openpencil'
    if root.is_relative_to(official.resolve()):raise ValueError('Gateway smoke must use a scratch root, never extracted source/runtime')
    assert (root/'site/index.html').is_file(),'Actual verified web build must be installed at site/'
    assert (root/'runtime/node_modules/@open-pencil/mcp/package.json').is_file(),'Run runtime npm ci first'
    if (root/'state/config.json').exists():raise ValueError('Use a fresh scratch root; never reuse existing private configuration')
    node=shutil.which('node');assert node,'Node24 required'
    web,mcp=port(),port()
    while web==mcp:mcp=port()
    env=dict(os.environ)
    env.update({'OPENPENCIL_USERNAME':'smoke-owner','OPENPENCIL_PASSWORD':secrets.token_urlsafe(32),
                'OPENPENCIL_WEB_PORT':str(web),'OPENPENCIL_MCP_PORT':str(mcp),
                'OPENPENCIL_MCP_CORS_ORIGIN':f'http://127.0.0.1:{web}',
                'OPENPENCIL_MCP_EVAL':'0'})
    flags=getattr(subprocess,'CREATE_NO_WINDOW',0)
    subprocess.run([node,str(root/'runtime/init-state.mjs')],env=env,check=True,capture_output=True,timeout=20,creationflags=flags)
    config=json.loads((root/'state/config.json').read_text())
    logs=[];children=[]
    try:
        for name in ['start-mcp.mjs','server.mjs']:
            log=(root/f'{name}.smoke.log').open('wb');logs.append(log)
            children.append(subprocess.Popen([node,str(root/'runtime'/name)],env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=flags))
        deadline=time.monotonic()+30
        while True:
            if any(p.poll() is not None for p in children):raise RuntimeError('OpenPencil child exited; inspect scratch logs without exposing config')
            try:
                if request(web,'/_health')[0]==200 and request(mcp,'/health')[0]==200:break
            except OSError:pass
            if time.monotonic()>deadline:raise TimeoutError('Gateway/MCP startup exceeded30seconds')
            time.sleep(.2)
        results=[]
        assert request(web,'/openpencil/')[0]==401;results.append('anonymous web rejected')
        assert request(mcp,'/mcp',{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},rpc_payload('initialize'),'POST')[0]==401;results.append('anonymous MCP rejected')
        basic=base64.b64encode(f'{config["username"]}:{config["password"]}'.encode()).decode()
        status,headers,body=request(web,'/openpencil/',{'Authorization':'Basic '+basic})
        assert status==200 and b'<html' in body.lower();assert config['mcpToken'].encode() not in body
        cookie=headers.get('Set-Cookie','');assert 'HttpOnly' in cookie and 'SameSite=Strict' in cookie
        cookie=cookie.split(';',1)[0];results.append('authenticated actual web served with private session cookie')
        assert request(web,'/openpencil/',{'Cookie':cookie})[0]==200;results.append('session authentication works')
        assert request(web,'/openpencil/',{'Cookie':cookie,'Origin':'https://foreign.invalid'})[0]==403;results.append('foreign origin rejected')
        assert request(web,'/openpencil/documents/%2e%2e%2fprivate.fig',{'Cookie':cookie})[0]==400;results.append('document traversal rejected')
        headers={'Authorization':'Bearer '+config['mcpToken'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
        status,response_headers,body=request(mcp,'/mcp',headers,rpc_payload('initialize'),'POST')
        assert status==200,(status,body[:80]);data=parse_rpc(body);assert data.get('result',{}).get('serverInfo')
        session=next((v for k,v in response_headers.items() if k.lower()=='mcp-session-id'),None)
        if session:headers['Mcp-Session-Id']=session
        request(mcp,'/mcp',headers,json.dumps({'jsonrpc':'2.0','method':'notifications/initialized'}),'POST')
        status,_,body=request(mcp,'/mcp',headers,rpc_payload('tools/list',2),'POST')
        data=parse_rpc(body);tools=data.get('result',{}).get('tools',[])
        assert status==200 and tools;assert 'eval' not in {t['name'] for t in tools}
        results.append(f'authenticated MCP initialized with{len(tools)}tools and eval disabled')
        proxy_headers={'Cookie':cookie,'Origin':f'http://127.0.0.1:{web}','Content-Type':'application/json','Accept':'application/json, text/event-stream'}
        status,_,body=request(web,'/openpencil/_automation/mcp',proxy_headers,rpc_payload('initialize',3),'POST')
        assert status==200 and parse_rpc(body).get('result');results.append('gateway authenticates and injects MCP bearer server-side')
        report={'status':'passed','checks':results,'node':subprocess.check_output([node,'--version'],text=True).strip(),'web_build_sha256':hashlib.sha256((root/'site/index.html').read_bytes()).hexdigest(),'limits':'No browser/editor drawing, AI provider, desktop or file-format parity claim'}
        (root/'gateway-smoke-report.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(report,indent=2))
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
        for log in logs:log.close()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('root',type=Path)
    smoke(parser.parse_args().root)

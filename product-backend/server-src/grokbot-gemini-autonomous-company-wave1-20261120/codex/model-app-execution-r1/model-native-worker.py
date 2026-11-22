"""Actual provider-generated source. Generated backend is declarative, never executed."""
import asyncio,hashlib,json,os,sys
from pathlib import Path
from model_provider import OpenRouterProvider,MODEL
async def main():
    raw=sys.stdin.buffer.read(262145)
    if len(raw)>262144:raise ValueError("WORKER_INPUT_LIMIT")
    job=json.loads(raw)
    for k in ["companyId","projectId","requestId","graphId","workPackageId","botId","roomId","objective"]:
        if not isinstance(job.get(k),str) or not job[k]:raise ValueError("WORKER_SCOPE_REQUIRED")
    kind=job["kind"]
    if kind=="BACKEND":
        instruction="""Return only valid JSON with keys app and routes.
app={schemaVersion:1,name:string,description:string,collections:[{name:lowercase_identifier,label:string,fields:[{name:lowercase_identifier,label:string,type:one of text,email,number,boolean,select,date,required:boolean,options:array only for select}]}]}.
Use 1 to 4 collections, 1 to 10 fields each, based on this exact requested app, never a preset dog app. Include sensible business fields explicitly requested. For a client tracker use its requested client details.
routes={schemaVersion:1,collections:[{name:same collection name,operations:["list","create","update","delete"]}]}.
No code, SQL, HTML, external APIs, credentials or comments. This is an executable declarative authenticated persistent CRUD backend."""
        tokens=1200
    elif kind=="FRONTEND":
        instruction="""Return only valid JSON with keys App and api, both strings containing complete source.
App is a React JSX module import React,{useState,useEffect} from 'react'; export default function App({api}).
api is an ES module export function createAppApi({baseUrl='',csrf}) with async describe(),list(collection),create(collection,record),update(collection,id,record),remove(collection,id). Use fetch credentials:'include'; writes Content-Type application/json and X-CSRF-Token:csrf. describe GET /api/app/schema -> schema object with name,description,collections. list GET /api/app/{collection}-> {items:[{id,...fields}]}. create POST samepath; update PATCH /api/app/{collection}/{id}; remove DELETE samepath.
App must call api.describe() on mount, then list each collection; dynamically render fields from schema, never hardcode domain field names. Field types text,email,date,number,boolean,select(options:string[]), required:boolean. Include working Add, Edit, Save, Cancel and Delete controls; display saved rows, loading and server errors. Keep list in sync after writes. Use schema.name/description/labels for copy. Initial no data is a real empty state. Render saved values safely as React text.
Give this requested business app a polished spacious clean interface with inline styles; responsive cards, tasteful blue/purple accent, readable typography. One simple component, no external dependencies except React, no imports beyond React, no external URLs, scripts or credentials, no unsupported actions. No markdown fences. Must be complete valid code, concise under 8500characters total."""
        tokens=4096
    else:raise ValueError("WORKER_KIND_INVALID")
    if kind=="FRONTEND":
        dependency=job.get("backendDependency")
        if not isinstance(dependency,dict) or not dependency.get("artifactDigest") or not dependency.get("app"):raise ValueError("VERIFIED_BACKEND_DEPENDENCY_REQUIRED")
        instruction+="\nActual completed backend schema and routes (use exactly these collections and fields): "+json.dumps({"app":dependency["app"],"routes":dependency["routes"]},ensure_ascii=False)
    provider=OpenRouterProvider(os.environ.get("STARLI_MODEL_KEY_FILE","/run/starlidigital-private-demo-r2/openrouter.key"))
    text,receipt=await provider.complete([{"role":m["role"],"content":m["content"]} for m in job.get("canonicalConversation",[{"role":"user","content":job["objective"]}])],instructions=instruction,max_tokens=tokens)
    if len(text.encode())>24000:raise ValueError("MODEL_SOURCE_TOO_LARGE")
    text=text.strip()
    if text.startswith("```"):
        text=chr(10).join(text.splitlines()[1:]).rsplit("```",1)[0].strip()
    result=json.loads(text)
    if kind=="BACKEND":
        files=[{"path":"backend/app.json","content":json.dumps(result["app"],ensure_ascii=False)},
               {"path":"backend/routes.json","content":json.dumps(result["routes"],ensure_ascii=False)}]
    else:
        if not isinstance(result.get("App"),str) or not isinstance(result.get("api"),str):raise ValueError("FRONTEND_SOURCE_REQUIRED")
        files=[{"path":"frontend/App.jsx","content":result["App"]},{"path":"frontend/api.mjs","content":result["api"]}]
    scope={k:job[k] for k in ["companyId","projectId","requestId","graphId","workPackageId"]}
    output={"provider":"OPENROUTER_MODEL","model":MODEL,"modelCalls":1,"providerReceipt":receipt,
        "scope":scope,"worker":{"pid":os.getpid(),"botId":job["botId"],"roomId":job["roomId"],"kind":kind},
        "files":files,"modelSourceDigest":hashlib.sha256(text.encode()).hexdigest(),
        "backendDependency":({"artifactDigest":job["backendDependency"]["artifactDigest"],"agencyReceiptId":job["backendDependency"]["agencyReceiptId"]} if kind=="FRONTEND" else None),"principalKind":job.get("principalKind","VERIFIED_NATIVE_COMPANY")}
    sys.stdout.write(json.dumps(output,ensure_ascii=False))
try:asyncio.run(main())
except Exception as error:
    code=str(error)
    sys.stderr.write(code if code.isupper() and len(code)<100 else "MODEL_APP_GENERATION_FAILED")
    raise SystemExit(1)

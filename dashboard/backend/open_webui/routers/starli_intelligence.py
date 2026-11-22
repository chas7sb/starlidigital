"""Owner-scoped local Starli Intelligence tools; model calls cannot grant location consent or write facts."""
import starli_portable as _portable
import asyncio,hashlib,json,os,math,re
from pathlib import Path
from fastapi import HTTPException
from open_webui.routers.starli_platform import customer_principal
from open_webui.routers.starli_state import runtime_code_dir,source_database
from open_webui.routers.starli_geo_tools import GEO_TOOL_SCHEMAS

def _schema(name,description,properties=None,required=None):
    return {"name":name,"displayName":name.removeprefix("intelligence_").replace("_"," ").title(),"category":"Starli Intelligence","description":description,"inputSchema":{"type":"object","properties":properties or {},"required":required or [],"additionalProperties":False}}
S={"type":"string","minLength":1,"maxLength":500}
IDS={"type":"array","items":{"type":"string","minLength":1,"maxLength":150},"maxItems":30}
TOOL_SCHEMAS=[
 _schema("social_live_location_context","Read only a reference to your own explicitly AI-shared fresh foreground location. Returns freshness/accuracy/precision, never coordinates. If unavailable ask for manual sharing; never assume a current location."),
 _schema("social_nearby_moments","Find currently authorized nearby shared Moments using a fresh owned AI location reference. Rechecks consent/session/ACL every call; returns rounded distance and context, never live coordinates. No external fetch or GPS start/extend/consent.",{"locationReference":{"type":"string","minLength":36,"maxLength":36,"pattern":"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"},"radiusKm":{"type":"integer","minimum":1,"maximum":50},"limit":{"type":"integer","minimum":1,"maximum":20}},["locationReference"]),
 _schema("social_watchlists","Read only your actual saved social topic/area/time notification watches."),
 _schema("social_watchlist_save","Save a social watch only for an actual user request. Preserve the requested topic/area, time window, cadence and notification choice. This does not publish/share anything.",{"id":S,"name":S,"topics":{"type":"array","items":{"type":"string","minLength":1,"maxLength":80},"maxItems":10},"bounds":{"type":"object","properties":{key:{"type":"number","minimum":-90 if key in ("south","north") else -180,"maximum":90 if key in ("south","north") else 180} for key in ("south","west","north","east")},"required":["south","west","north","east"],"additionalProperties":False},"from":S,"until":S,"enabled":{"type":"boolean"},"notificationsEnabled":{"type":"boolean"},"cadenceSeconds":{"type":"integer","minimum":60,"maximum":86400},"expectedVersion":{"type":"integer","minimum":1}},["name","from","until","cadenceSeconds","notificationsEnabled"]),
 _schema("social_notifications","Read your currently authorized social match notices with real moment evidence and chat references. Removed/private/expired content is filtered again.",{"limit":{"type":"integer","minimum":1,"maximum":30},"after":S,"unreadOnly":{"type":"boolean"}}),
 _schema("social_notification_mark_read","Mark an existing currently authorized notification as read in this account. No external message or publication.",{"id":S},["id"]),
 _schema("intelligence_context","Read your stored source-attributed fresh signals, concepts and actual connector coverage. No external fetch; unavailable evidence is not current knowledge.",{"conceptId":S,"sourceId":S,"limit":{"type":"integer","minimum":1,"maximum":30}}),
 _schema("intelligence_sources","List your configured Intelligence sources and implemented versus unconfigured connectors. No credentials or network fetch."),
 _schema("intelligence_source_create","Configure an implemented or provider-configurable Intelligence adapter; this does not fetch data or establish live coverage. No credentials accepted. Location needs existing explicit user consent; this tool cannot grant it.",{"name":S,"kind":S,"connector":S,"access":{"enum":["PUBLIC","OWNED"]},"config":{"type":"object"},"enabled":{"type":"boolean"}},["name","kind","connector"]),
 _schema("intelligence_watchlists","List your Intelligence watchlists."),
 _schema("intelligence_watchlist_save","Save your watchlist using existing owned source/entity IDs or catalog concept IDs.",{"id":S,"name":S,"sourceIds":IDS,"entityIds":IDS,"conceptIds":IDS,"enabled":{"type":"boolean"}},["name"]),
 _schema("intelligence_consent","Read the current user's explicit location-consent choice. Models cannot set or revoke consent."),
 _schema("intelligence_observation_add","Record a labeled INFERENCE derived from existing fresh owned evidence. Cannot create facts or fabricate observations.",{"sourceId":S,"conceptId":S,"title":S,"summary":{"type":"string","minLength":1,"maxLength":10000},"claimType":{"enum":["INFERENCE"]},"confidence":{"type":"number","minimum":0,"maximum":1},"evidenceObservationIds":{**IDS,"minItems":1}},["sourceId","summary","confidence","evidenceObservationIds"]),
 _schema("intelligence_insight_add","Save an INFERENCE grounded in existing fresh owned observations; expiry cannot outlive evidence.",{"title":S,"summary":{"type":"string","minLength":1,"maxLength":10000},"observationIds":{**IDS,"minItems":1},"confidence":{"type":"number","minimum":0,"maximum":1}},["title","summary","observationIds","confidence"])
]
def available():
    root=Path(os.getenv("STARLI_PLATFORM_SOURCE_ROOT",_portable.platform_root()))
    return all((root/"server/src/intelligence"/name).is_file() for name in ("service.ts","ontology.ts","runtime.ts","social.ts","matching.ts","worker.ts"))
TOOL_SCHEMAS.extend(GEO_TOOL_SCHEMAS)

def schema(name):return next((item for item in TOOL_SCHEMAS if item["name"]==name),None)
def _valid(value,schema,depth=0):
    # This validates the fixed local schema subset; no external schema dependency or remote references.
    if depth>12:return False
    if "enum" in schema and value not in schema["enum"]:return False
    kind=schema.get("type")
    if kind=="object":
        if not isinstance(value,dict):return False
        properties=schema.get("properties",{})
        if any(key not in value for key in schema.get("required",[])):return False
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):return False
        return all(_valid(item,properties[key],depth+1) for key,item in value.items() if key in properties)
    if kind=="array":return isinstance(value,list) and schema.get("minItems",0)<=len(value)<=schema.get("maxItems",250) and all(_valid(item,schema.get("items",{}),depth+1) for item in value)
    if kind=="string":return isinstance(value,str) and schema.get("minLength",0)<=len(value)<=schema.get("maxLength",20000) and ("pattern" not in schema or re.fullmatch(schema["pattern"],value) is not None)
    if kind=="boolean":return isinstance(value,bool)
    if kind in ("integer","number"):
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):return False
        if kind=="integer" and not isinstance(value,int):return False
        return schema.get("minimum",float("-inf"))<=value<=schema.get("maximum",float("inf"))
    return True

async def tool(user,name,args,operation_key=None):
    definition=schema(name)
    if not definition:raise HTTPException(404,"INTELLIGENCE_TOOL_UNAVAILABLE")
    _,binding=customer_principal(user)
    if not isinstance(args,dict) or not _valid(args,definition["inputSchema"]):raise HTTPException(422,"INTELLIGENCE_INVALID_INPUT")
    if not available():return {"ok":False,"error":"INTELLIGENCE_UNAVAILABLE","retryable":False,"detail":"The configured Node release does not include Starli Intelligence. No live signal coverage is claimed."}
    payload={"owner":binding["v2UserId"],"tool":name,"args":args,"operationKey":operation_key or hashlib.sha256(json.dumps({"name":name,"args":args},sort_keys=True).encode()).hexdigest()}
    encoded=json.dumps(payload).encode()
    if len(encoded)>128000:raise HTTPException(413,"INTELLIGENCE_INPUT_LIMIT")
    code=runtime_code_dir()
    from open_webui.routers.starli_subprocess import child_setup,check_child_guard
    guard_args,child_env=child_setup({"PATH":os.environ.get("PATH", ""),"LANG":"C.UTF-8","STARLI_PLATFORM_SOURCE_ROOT":os.getenv("STARLI_PLATFORM_SOURCE_ROOT",_portable.platform_root()),"STARLI_SOURCE_DATABASE":source_database()})
    process=await asyncio.create_subprocess_exec(_portable.node_binary(),*guard_args,"--import",str(code/"node_modules/tsx/dist/loader.mjs"),str(code/"intelligence-bridge.mts"),cwd=str(code),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,env=child_env)
    try:
        output,_=await asyncio.wait_for(process.communicate(encoded),25)
        check_child_guard(process,child_env)
        if len(output)>512000:raise HTTPException(502,"INTELLIGENCE_OUTPUT_LIMIT")
        try:result=json.loads(output)
        except (ValueError,UnicodeDecodeError):raise HTTPException(502,"INTELLIGENCE_UNAVAILABLE") from None
        if not isinstance(result,dict) or not isinstance(result.get("ok"),bool):raise HTTPException(502,"INTELLIGENCE_UNAVAILABLE")
        return result
    except asyncio.TimeoutError:return {"ok":False,"error":"INTELLIGENCE_TIMEOUT","retryable":False}
    finally:
        if process.returncode is None:process.kill();await process.wait()

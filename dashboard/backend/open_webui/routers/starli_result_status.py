"""Classify trusted tool result envelopes without persisting raw provider errors."""
import json
import re

_DENIED_WORDS=("unauthorized","forbidden","permission denied","access denied","full access required","administrator required","authorization required","scope denied","request denied")
_FAILURE={"FAILED","FAILURE","ERROR","REJECTED","INVALID"}
_DENIED={"DENIED","UNAUTHORIZED","FORBIDDEN","PERMISSION_DENIED","ACCESS_DENIED","SCOPE_DENIED"}
_UNCERTAIN={"UNCERTAIN","UNKNOWN_OUTCOME","UPSTREAM_TIMEOUT_UNCERTAIN"}
_PENDING={"PENDING","QUEUED","RUNNING","EXECUTING","IN_PROGRESS","ACCEPTED"}
_CANCELLED={"CANCELLED","CANCELED","INTERRUPTED"}

def _code(value):
    if not isinstance(value,str):return ""
    return value if re.fullmatch(r"[A-Z][A-Z0-9_]{1,47}",value) else ""

def classify_result(value):
    """Normalize MCP and native receipts. Never treat explicit failures as success.

    Inspect only envelope fields and MCP JSON text/structuredContent; never recurse
    into customer resource bodies, file contents, or arbitrary data fields.
    """
    findings=[]
    def inspect(item,depth=0):
        if depth>3 or not isinstance(item,dict):return
        status=item.get("status")
        state=str(status).strip().upper() if isinstance(status,(str,int)) else ""
        code=_code(item.get("errorCode")) or _code(item.get("code"))
        error=item.get("error")
        messages=[]
        if isinstance(error,dict):
            code=code or _code(error.get("code"))
            if isinstance(error.get("message"),str):messages.append(error["message"][:1000])
        elif isinstance(error,str) and error.strip():messages.append(error[:1000])
        explicit_error=bool(error) or item.get("isError") is True or item.get("ok") is False or item.get("success") is False
        error_text=" ".join(messages).lower()
        if state in _UNCERTAIN or code in _UNCERTAIN:findings.append(("UNCERTAIN",code))
        elif state in _DENIED or code in _DENIED or state in ("401","403") or code in ("HTTP_401","HTTP_403") or status in (401,403) or (explicit_error and any(w in error_text for w in _DENIED_WORDS)):findings.append(("DENIED",code))
        elif state in _CANCELLED:findings.append(("CANCELLED",code))
        elif explicit_error or state in _FAILURE or (isinstance(status,int) and status>=400) or (state.isdigit() and int(state)>=400):findings.append(("FAILED",code))
        elif state in _PENDING:findings.append(("PENDING",code))
        structured=item.get("structuredContent")
        if isinstance(structured,dict):inspect(structured,depth+1)
        for block in item.get("content",[]) if isinstance(item.get("content"),list) else []:
            if not isinstance(block,dict) or block.get("type")!="text" or not isinstance(block.get("text"),str):continue
            text=block["text"]
            if len(text)>250000:continue
            if explicit_error and any(word in text[:1000].lower() for word in _DENIED_WORDS):
                findings.append(("DENIED",code))
            try:parsed=json.loads(text)
            except (ValueError,TypeError):continue
            if isinstance(parsed,dict):inspect(parsed,depth+1)
    inspect(value)
    priority={"UNCERTAIN":0,"DENIED":1,"CANCELLED":2,"FAILED":3,"PENDING":4}
    status,code=min(findings,key=lambda v:priority[v[0]]) if findings else ("FAILED","EMPTY_RESULT") if value is None else ("COMPLETED","")
    return {"status":status,"outcome":status.lower(),"errorCode":code}

def public_paths(args):
    """Allow only relative code/document paths; exclude hidden/protected segments."""
    if not isinstance(args,dict):return []
    values=[]
    for key in ("path","filePath","file"):
        if isinstance(args.get(key),str):values.append(args[key])
    if isinstance(args.get("paths"),list):values.extend(v for v in args["paths"][:10] if isinstance(v,str))
    result=[]
    for value in values:
        if not value or len(value)>240 or value.startswith(("/", "\\")) or ":" in value or "\\" in value or any(ord(c)<32 for c in value):continue
        parts=value.split("/")
        if any(not p or p in (".","..","node_modules") or p.startswith(".") for p in parts):continue
        if any(word in value.lower() for word in ("credential","private-key","secret","password","access_token")):continue
        if not re.search(r"\.(?:html?|css|[cm]?js|jsx|tsx?|svelte|json|md|py|sql|ya?ml|toml|txt|svg)$",value,re.I):continue
        if value not in result:result.append(value)
    return result[:10]

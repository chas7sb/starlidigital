"""Phase2 native JWT logout fencing and durable, logout-only GPS cleanup.

No raw JWT, JWT payload, OAuth token or GPS coordinates are persisted.
"""
from __future__ import annotations
import starli_portable as _portable
import asyncio,hashlib,json,math,os,re,sqlite3,threading,time,secrets
from contextlib import contextmanager
from pathlib import Path
from fastapi import HTTPException
from open_webui.routers.starli_state import state_dir,runtime_code_dir,source_database,bindings_path

_INIT_LOCK=threading.Lock()
_INITIALIZED={}
_PENDING_LOCK=threading.Lock()
_PENDING_REVOCATIONS={}
_PENDING_ACCOUNT_CLEANUPS={}
SAFE_CODES={"CLEANUP_UNAVAILABLE","CLEANUP_TIMEOUT","CLEANUP_OUTPUT_INVALID","CLEANUP_IDENTITY_UNAVAILABLE","CLEANUP_OWNER_CHANGED","CLEANUP_PENDING","CLEANUP_STORAGE_UNAVAILABLE"}
def _now():return int(time.time()*1000)
def _path():return state_dir()/"session-revocations.sqlite"
def _ident(value):return isinstance(value,str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:@-]{0,149}",value))
def _digest(token):return hashlib.sha256(token.encode()).hexdigest()
def _storage_error():return HTTPException(503,"Session authorization storage is unavailable")
@contextmanager
def _db():
    path=_path()
    try:
        path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with _INIT_LOCK:
            known=_INITIALIZED.get(str(path))
            if known is not None and (not path.exists() or (path.stat().st_dev,path.stat().st_ino)!=known):
                raise _storage_error()
            db=sqlite3.connect(str(path),timeout=1.5)
            db.row_factory=sqlite3.Row
            db.execute("PRAGMA busy_timeout=1500")
            if known is None:
                db.execute("PRAGMA journal_mode=WAL")
                db.executescript("""CREATE TABLE IF NOT EXISTS revoked_sessions(
token_hash TEXT PRIMARY KEY,native_user_id TEXT NOT NULL,expires_at INTEGER,revoked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS revoked_session_families(
family_hash TEXT PRIMARY KEY,native_user_id TEXT NOT NULL,revoked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS session_location_cleanup(
token_hash TEXT PRIMARY KEY,native_user_id TEXT NOT NULL,owner_id TEXT,requested_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',
attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,lease_id TEXT,last_code TEXT,finished_at INTEGER);
CREATE INDEX IF NOT EXISTS session_cleanup_due ON session_location_cleanup(status,next_at,lease_until);
""")
                columns={row[1] for row in db.execute('PRAGMA table_info(session_location_cleanup)')}
                if 'lease_id' not in columns:db.execute('ALTER TABLE session_location_cleanup ADD COLUMN lease_id TEXT')
                db.commit()
                path.chmod(0o600)
                _INITIALIZED[str(path)]=(path.stat().st_dev,path.stat().st_ino)
        try:yield db
        finally:db.close()
    except HTTPException:raise
    except (sqlite3.Error,OSError,ValueError,TypeError,OverflowError):
        raise _storage_error() from None
def _expiry(payload):
    value=payload.get("exp")
    if value is None:return None
    try:
        number=float(value)
        if not math.isfinite(number) or number>253402300799:return None
        return int(number*1000)
    except (ValueError,TypeError,OverflowError):return None
def session_family(token, payload):
    # A login JWT starts its own family. Only signed native refreshes carry this binding.
    family = payload.get("starli_session_family")
    return family if isinstance(family, str) and re.fullmatch(r"[0-9a-f]{64}", family) else _digest(token)

def assert_session_allowed(token,payload):
    """Called only after cryptographic JWT verification, before canonical user lookup."""
    assert_session_hash_allowed(_digest(token), session_family(token,payload), payload["id"])

def assert_session_hash_allowed(digest,family,uid):
    """Also used to fence stored socket/stream identities without retaining credentials."""
    with _PENDING_LOCK:
        denied=digest in _PENDING_REVOCATIONS or any(r["family"]==family for r in _PENDING_REVOCATIONS.values())
    if denied:raise HTTPException(401,"Session has been signed out")
    with _db() as db:
        row=db.execute("SELECT 1 FROM revoked_sessions WHERE token_hash=? UNION ALL SELECT 1 FROM revoked_session_families WHERE family_hash=? AND native_user_id=? LIMIT 1",
                       (digest,family,uid)).fetchone()
    if row:raise HTTPException(401,"Session has been signed out")

def _persist(digest,native_user_id,expires_at,requested_at,family):
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO revoked_session_families VALUES(?,?,?)",(family,native_user_id,requested_at))
        inserted=db.execute("INSERT OR IGNORE INTO revoked_sessions VALUES(?,?,?,?)",(digest,native_user_id,expires_at,requested_at)).rowcount
        # Never re-enqueue an old, already-revoked JWT: it could otherwise stop a later session.
        if inserted:
            db.execute("INSERT OR IGNORE INTO session_location_cleanup(token_hash,native_user_id,requested_at) VALUES(?,?,?)",(digest,native_user_id,requested_at))
        db.commit()
    return bool(inserted)
def revoke_and_enqueue(token,payload):
    """payload must come from the existing signed-JWT decoder, never unverified client JSON."""
    uid=payload.get("id") if isinstance(payload,dict) else None
    if not _ident(uid) or not isinstance(token,str) or len(token)>16384 or token.startswith("sk-"):
        raise HTTPException(401,"A signed native session is required")
    digest=_digest(token);expires=_expiry(payload);requested=_now()
    family=session_family(token,payload)
    record={"native_user_id":uid,"expires_at":expires,"requested_at":requested,"family":family}
    try:
        inserted=_persist(digest,uid,expires,requested,family)
    except HTTPException:
        # Keep this JWT fenced if storage recovers before the operator/client retries logout.
        # A failed persistence is never acknowledged as a successful durable signout.
        with _PENDING_LOCK:_PENDING_REVOCATIONS[digest]=record
        raise
    with _PENDING_LOCK:_PENDING_REVOCATIONS.pop(digest,None)
    return {"tokenHash":digest,"familyHash":family,"newlyRevoked":inserted,"requestedAt":requested}
def _flush_memory_fences():
    with _PENDING_LOCK:pending=list(_PENDING_REVOCATIONS.items())
    for digest,record in pending[:20]:
        try:_persist(digest,record["native_user_id"],record["expires_at"],record["requested_at"],record["family"])
        except HTTPException:continue
        with _PENDING_LOCK:_PENDING_REVOCATIONS.pop(digest,None)
def selected_session_token(request):
    """Authorization has precedence; an invalid/header API key never adopts an ambient identity."""
    header=request.headers.get("authorization")
    if header:
        match=re.fullmatch(r"Bearer ([^\s]+)",header.strip(),re.IGNORECASE)
        return match.group(1) if match and len(match.group(1))<=16384 and not match.group(1).startswith("sk-") else None
    token=request.cookies.get("token")
    return token if isinstance(token,str) and not token.startswith("sk-") and len(token)<=16384 else None

def _source_user(db,owner):
    row=db.execute("SELECT payload FROM users WHERE id=?",(owner,)).fetchone()
    value=json.loads(row[0]) if row else None
    return value if isinstance(value,dict) and value.get("id")==owner else None
def _resolve_owner(native_id):
    """Active customer principal first; trusted persisted bindings only for inactive cleanup."""
    from open_webui.models.users import Users
    from open_webui.routers.starli_platform import customer_principal
    user=Users.get_user_by_id(native_id)
    if user:
        try:
            _,binding=customer_principal(user)
            owner=binding.get("v2UserId")
            if _ident(owner):return owner
        except HTTPException:pass
    owner=_existing_owner(native_id,user)
    if owner:return owner
    raise RuntimeError("CLEANUP_IDENTITY_UNAVAILABLE")

def _existing_owner(native_id,user=None):
    # Cleanup confers no read/start capability, so disabled/deleted account bindings may be used.
    with sqlite3.connect("file:"+source_database()+"?mode=ro",uri=True,timeout=1.5) as db:
        db.row_factory=sqlite3.Row
        exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='webui_customer_identities'").fetchone()
        if exists:
            mapping=db.execute("SELECT * FROM webui_customer_identities WHERE webui_id=?",(native_id,)).fetchone()
            if mapping and _ident(mapping["node_id"]):
                node=_source_user(db,mapping["node_id"])
                if node is None or (node.get("identityAuthority")=="OPENWEBUI_NATIVE" and node.get("webuiUserId")==native_id and node.get("identityBindingNonce")==mapping["binding_nonce"]):
                    return mapping["node_id"]
        subject=user.get("oauth_sub") if isinstance(user,dict) else getattr(user,"oauth_sub",None)
        if isinstance(subject,str) and subject.startswith("starli-node:"):
            owner=subject[len("starli-node:"):]
            node=_source_user(db,owner) if _ident(owner) else None
            email=user.get("email") if isinstance(user,dict) else getattr(user,"email",None)
            if node and str(node.get("email","")).lower()==str(email or "").lower():return owner
        binding_file=bindings_path()
        if binding_file:
            binding=json.loads(Path(binding_file).read_text()).get("memberships",{}).get(native_id)
            owner=binding.get("v2UserId") if isinstance(binding,dict) else None
            if _ident(owner) and _source_user(db,owner):return owner
    return None

def prepare_account_cleanup(user):
    """Resolve an existing canonical owner while the native target still exists; never provision one."""
    uid=user.get("id") if isinstance(user,dict) else getattr(user,"id",None)
    if not _ident(uid):return None
    try:
        owner=_existing_owner(uid,user)
        if not owner:return None
        from open_webui.routers.starli_platform import customer_principal
        try:
            _,binding=customer_principal(user)
            if binding.get("v2UserId")!=owner:raise RuntimeError("CLEANUP_OWNER_CHANGED")
        except HTTPException:
            # Persisted server bindings remain authoritative for cleanup-only inactive targets.
            pass
        return {"nativeUserId":uid,"ownerId":owner}
    except Exception:
        raise HTTPException(503,"Account cleanup authority is unavailable") from None

def _persist_account_cleanup(digest,prepared,requested_at):
    with _db() as db:
        db.execute("INSERT OR IGNORE INTO session_location_cleanup(token_hash,native_user_id,owner_id,requested_at) VALUES(?,?,?,?)",(digest,prepared["nativeUserId"],prepared["ownerId"],requested_at))
        db.commit()
async def account_mutation_completed(prepared):
    """Call only AFTER a successful native role mutation/deletion; never disables a Node account."""
    if prepared is None:return {"status":"NOT_APPLICABLE"}
    if not isinstance(prepared,dict) or not _ident(prepared.get("nativeUserId")) or not _ident(prepared.get("ownerId")):
        raise HTTPException(503,"Account cleanup authority is unavailable")
    digest=hashlib.sha256(("account-cleanup:"+secrets.token_hex(32)).encode()).hexdigest();requested=_now()
    try:_persist_account_cleanup(digest,prepared,requested)
    except HTTPException:
        with _PENDING_LOCK:_PENDING_ACCOUNT_CLEANUPS[digest]={"prepared":prepared,"requested_at":requested}
        raise HTTPException(503,"Account change applied; live cleanup storage is unavailable") from None
    try:await drain_cleanup(limit=1,token_hash=digest)
    except Exception:pass
    return {"status":cleanup_status(digest)}

def _claim(token_hash=None):
    now=_now()
    with _db() as db:
        db.execute("BEGIN IMMEDIATE")
        sql="SELECT * FROM session_location_cleanup WHERE ((status='PENDING' AND next_at<=?) OR (status='RUNNING' AND lease_until<=?))"
        values=[now,now]
        if token_hash:sql+=" AND token_hash=?";values.append(token_hash)
        row=db.execute(sql+" ORDER BY requested_at LIMIT 1",values).fetchone()
        if not row:db.commit();return None
        lease_id=secrets.token_hex(16)
        db.execute("UPDATE session_location_cleanup SET status='RUNNING',lease_until=?,lease_id=?,attempts=attempts+1 WHERE token_hash=?",(now+15000,lease_id,row["token_hash"]))
        db.commit();item=dict(row);item["lease_id"]=lease_id;return item
def _complete(item,owner,success,code=None):
    now=_now()
    with _db() as db:
        if success:
            changed=db.execute("UPDATE session_location_cleanup SET status='DONE',owner_id=?,lease_until=0,last_code=NULL,finished_at=?,lease_id=NULL WHERE token_hash=? AND lease_id=? AND status='RUNNING'",(owner,now,item["token_hash"],item["lease_id"])).rowcount
        else:
            delay=min(300000,5000*2**min(6,int(item["attempts"])))
            safe=code if code in SAFE_CODES else "CLEANUP_PENDING"
            changed=db.execute("UPDATE session_location_cleanup SET status='PENDING',owner_id=COALESCE(owner_id,?),lease_until=0,last_code=?,next_at=?,lease_id=NULL WHERE token_hash=? AND lease_id=? AND status='RUNNING'",(owner,safe,now+delay,item["token_hash"],item["lease_id"])).rowcount
        db.commit();return changed>0
async def _rpc(owner,requested_at):
    code=runtime_code_dir();process=None
    script=code/"live-location-session-bridge.mts"
    if not script.is_file():return {"ok":False,"error":"CLEANUP_UNAVAILABLE"}
    payload=json.dumps({"owner":owner,"operation":"logout","requestedAt":requested_at},separators=(",",":")).encode()
    try:
        from open_webui.routers.starli_subprocess import child_setup,check_child_guard
        guard_args,child_env=child_setup({"PATH":os.environ.get("PATH", ""),"LANG":"C.UTF-8","STARLI_PLATFORM_SOURCE_ROOT":os.getenv("STARLI_PLATFORM_SOURCE_ROOT",_portable.platform_root()),"STARLI_SOURCE_DATABASE":source_database()})
        process=await asyncio.create_subprocess_exec(_portable.node_binary(),*guard_args,"--import",str(code/"node_modules/tsx/dist/loader.mjs"),str(script),cwd=str(code),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,
            env=child_env)
        async def communicate():
            process.stdin.write(payload);await process.stdin.drain();process.stdin.close()
            output=bytearray()
            while True:
                chunk=await process.stdout.read(min(1024,4097-len(output)))
                if not chunk:break
                output.extend(chunk)
                if len(output)>4096:raise ValueError()
            await process.wait()
            check_child_guard(process,child_env)
            value=json.loads(output)
            if process.returncode!=0 or not isinstance(value,dict) or value.get("ok") is not True or value.get("operation")!="logout" or not isinstance(value.get("cleaned"),bool):raise ValueError()
            return {"ok":True,"operation":"logout","cleaned":value["cleaned"]}
        return await asyncio.wait_for(communicate(),5)
    except asyncio.TimeoutError:return {"ok":False,"error":"CLEANUP_TIMEOUT"}
    except (OSError,ValueError,TypeError,UnicodeError,AttributeError):return {"ok":False,"error":"CLEANUP_OUTPUT_INVALID"}
    finally:
        if process is not None and process.returncode is None:
            process.kill();await process.wait()
async def drain_cleanup(limit=3,token_hash=None):
    """Private lifecycle hook: bounded replay after restart; no model-facing tool is registered."""
    _flush_memory_fences()
    with _PENDING_LOCK:pending_account=list(_PENDING_ACCOUNT_CLEANUPS.items())
    for digest,record in pending_account[:20]:
        try:_persist_account_cleanup(digest,record["prepared"],record["requested_at"])
        except HTTPException:continue
        with _PENDING_LOCK:_PENDING_ACCOUNT_CLEANUPS.pop(digest,None)
    done=0
    for _ in range(max(1,min(5,limit))):
        item=_claim(token_hash)
        if not item:break
        owner=item.get("owner_id")
        try:
            resolved=_resolve_owner(item["native_user_id"]) if not owner else owner
            if not _ident(resolved):raise RuntimeError("CLEANUP_IDENTITY_UNAVAILABLE")
            with _db() as db:
                updated=db.execute("UPDATE session_location_cleanup SET owner_id=? WHERE token_hash=? AND lease_id=? AND (owner_id IS NULL OR owner_id=?)",(resolved,item["token_hash"],item["lease_id"],resolved)).rowcount
                db.commit()
            if not updated:continue
            result=await _rpc(resolved,item["requested_at"])
            if result.get("ok") is True:
                if _complete(item,resolved,True):done+=1
            else:_complete(item,resolved,False,result.get("error"))
        except asyncio.CancelledError:
            _complete(item,owner,False,"CLEANUP_PENDING");raise
        except Exception:
            _complete(item,owner,False,"CLEANUP_IDENTITY_UNAVAILABLE")
    return {"done":done}
def cleanup_status(token_hash):
    with _db() as db:
        row=db.execute("SELECT status FROM session_location_cleanup WHERE token_hash=?",(token_hash,)).fetchone()
    return "DONE" if row and row["status"]=="DONE" else "PENDING"
def prune_expired():
    now=_now()
    with _db() as db:
        db.execute("DELETE FROM revoked_sessions WHERE expires_at IS NOT NULL AND expires_at<=?",(now,))
        db.execute("DELETE FROM session_location_cleanup WHERE status='DONE' AND finished_at<?",(now-7*86400000,))
        db.commit()
async def cleanup_loop():
    while True:
        try:await drain_cleanup();prune_expired()
        except asyncio.CancelledError:raise
        except Exception:pass
        await asyncio.sleep(5)

"""Private per-account/per-agent Markdown memory. Canonical HEAD is the commit point."""
from __future__ import annotations
import dataclasses,datetime,hashlib,json,os,re,stat,uuid
if os.name != "nt":
    import fcntl
else:
    from . import windows_io as _windows
from contextlib import contextmanager
from pathlib import Path

class MemoryFault(Exception):
    def __init__(self,code:str,status:int=400):
        if not isinstance(code,str) or not re.fullmatch(r"MEMORY_[A-Z0-9_]{1,80}",code):code="MEMORY_STORAGE_UNAVAILABLE";status=503
        self.code=code;self.status=status;super().__init__(code)
@dataclasses.dataclass(frozen=True)
class MemoryScope:
    account_id:str
    agent_id:str
@dataclasses.dataclass(frozen=True)
class Provenance:
    kind:str
    actor_id:str
    run_id:str|None=None
    tool_call_id:str|None=None
_NAMES={"memory":"MEMORY.md","working":"WORKING.md"}
def _hash(value):return hashlib.sha256(value).hexdigest()
def _identifier(value,code):
    if not isinstance(value,str) or not 1<=len(value)<=180 or any(ord(c)<32 or ord(c)==127 for c in value) or "/" in value or "\\" in value or value in (".",".."):raise MemoryFault(code,422)
    return value
def _revision(value):
    if type(value) is not int or value<0 or value>2**53-1:raise MemoryFault("MEMORY_INVALID_REVISION",422)
    return value
def _provenance(value):
    if not isinstance(value,Provenance) or value.kind not in ("user","runtime"):raise MemoryFault("MEMORY_INVALID_PROVENANCE",422)
    _identifier(value.actor_id,"MEMORY_INVALID_PROVENANCE")
    if value.kind=="runtime":
        _identifier(value.run_id,"MEMORY_INVALID_PROVENANCE");_identifier(value.tool_call_id,"MEMORY_INVALID_PROVENANCE")
    elif value.run_id is not None or value.tool_call_id is not None:raise MemoryFault("MEMORY_INVALID_PROVENANCE",422)
    return {"kind":value.kind,"actorId":value.actor_id,"runId":value.run_id,"toolCallId":value.tool_call_id}
def _content(value,maximum):
    if not isinstance(value,str):raise MemoryFault("MEMORY_INVALID_CONTENT",422)
    try:raw=value.encode("utf-8")
    except UnicodeError:raise MemoryFault("MEMORY_INVALID_CONTENT",422) from None
    if len(raw)>maximum or "\x00" in value:raise MemoryFault("MEMORY_CONTENT_LIMIT",413)
    # Known credential/hidden-reasoning markers; ordinary visible working notes remain allowed.
    patterns=(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----",r"\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b",r"(?i)\b(?:authorization\s*:\s*bearer|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password)\s*[:=]\s*[\"']?[A-Za-z0-9_+/=-]{8,})",r"(?i)<\s*/?\s*(?:think|thinking|analysis|chain[_ -]?of[_ -]?thought)\s*>",r"(?i)\b(?:hidden chain of thought|private reasoning transcript|BEGIN PRIVATE REASONING)\b")
    if any(re.search(pattern,value) for pattern in patterns):raise MemoryFault("MEMORY_FORBIDDEN_CONTENT",422)
    return raw
def _pack(head):
    encoded=json.dumps(head,sort_keys=True,separators=(",",":")).encode()
    return json.dumps({**head,"checksum":_hash(encoded)},sort_keys=True,separators=(",",":")).encode()
def _safe_file(info):
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_nlink!=1 or info.st_mode&0o077:raise MemoryFault("MEMORY_UNSAFE_PATH",409)
def _read(fd,name,maximum):
    try:child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    except FileNotFoundError:return None
    except OSError:raise MemoryFault("MEMORY_UNSAFE_PATH",409) from None
    try:
        info=os.fstat(child);_safe_file(info)
        if info.st_size>maximum:raise MemoryFault("MEMORY_EXTERNAL_EDIT",409)
        chunks=[];size=0
        while True:
            part=os.read(child,min(65536,maximum+1-size))
            if not part:break
            chunks.append(part);size+=len(part)
            if size>maximum:raise MemoryFault("MEMORY_EXTERNAL_EDIT",409)
        return b"".join(chunks)
    finally:os.close(child)
def _write_new(fd,name,data):
    child=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
    try:
        offset=0
        while offset<len(data):offset+=os.write(child,data[offset:])
        os.fsync(child)
    finally:os.close(child)
def _replace(fd,name,data,committed_hook=None):
    # Refuse replacing an attacker-created link or unexpected file type.
    existing=_read(fd,name,16*1024*1024)
    temporary=".tmp-"+uuid.uuid4().hex
    try:
        _write_new(fd,temporary,data);os.replace(temporary,name,src_dir_fd=fd,dst_dir_fd=fd)
        if committed_hook:committed_hook()
        _sync(fd)
    finally:
        try:os.unlink(temporary,dir_fd=fd)
        except FileNotFoundError:pass
def _directory(parent,name):
    try:os.mkdir(name,0o700,dir_fd=parent);os.fsync(parent)
    except FileExistsError:pass
    try:fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent)
    except OSError:raise MemoryFault("MEMORY_UNSAFE_PATH",409) from None
    info=os.fstat(fd)
    if info.st_uid!=os.geteuid() or info.st_mode&0o077:os.close(fd);raise MemoryFault("MEMORY_UNSAFE_PATH",409)
    return fd
def _unlink(fd,name):
    if os.name == "nt":return _windows.unlink(fd,name)
    return os.unlink(name,dir_fd=fd)

def _sync(fd):
    if os.name != "nt":os.fsync(fd)
    # Windows files are flushed before MoveFileExW(REPLACE_EXISTING|WRITE_THROUGH).

def _free_bytes(fd):
    if os.name == "nt":return _windows.free_bytes(fd)
    free=os.fstatvfs(fd);return free.f_bavail*free.f_frsize

if os.name == "nt":
    _read=_windows.read
    _write_new=_windows.write_new
    _replace=_windows.replace

class MemoryStoreFactory:
    def __init__(self,root,*,max_content_bytes=65536,history_limit=20,receipt_limit=4096,min_free_bytes=1048576,fault_hook=None):
        for value,maximum in ((max_content_bytes,1048576),(history_limit,100),(receipt_limit,16384)):
            if type(value) is not int or not 1<=value<=maximum:raise MemoryFault("MEMORY_INVALID_CONFIGURATION",422)
        if type(min_free_bytes) is not int or min_free_bytes<0:raise MemoryFault("MEMORY_INVALID_CONFIGURATION",422)
        if fault_hook is not None and not callable(fault_hook):raise MemoryFault("MEMORY_INVALID_CONFIGURATION",422)
        self.root=Path(root);self.max_content_bytes=max_content_bytes;self.history_limit=history_limit;self.receipt_limit=receipt_limit;self.min_free_bytes=min_free_bytes;self.fault_hook=fault_hook
        if not self.root.is_absolute() or ".." in self.root.parts:raise MemoryFault("MEMORY_UNSAFE_PATH",409)
    def open(self,scope,authorize):
        if not isinstance(scope,MemoryScope) or not callable(authorize):raise MemoryFault("MEMORY_INVALID_SCOPE",422)
        _identifier(scope.account_id,"MEMORY_INVALID_SCOPE");_identifier(scope.agent_id,"MEMORY_INVALID_SCOPE")
        return _Store(self,scope,authorize)
    @contextmanager
    def _scope(self,scope):
        if os.name == "nt":
            with _windows.scope(self.root,scope.account_id,scope.agent_id) as directory:
                yield directory
            return
        # Anchor every component using no-follow dirfds; no resolve() symlink traversal.
        current=os.open("/",os.O_RDONLY|os.O_DIRECTORY)
        try:
            for index,name in enumerate(self.root.parts[1:]):
                try:following=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
                except FileNotFoundError:
                    # Existing parents may be shared; only create the requested root itself.
                    if index!=len(self.root.parts[1:])-1:raise MemoryFault("MEMORY_STORAGE_UNAVAILABLE",503)
                    following=_directory(current,name)
                except OSError:raise MemoryFault("MEMORY_UNSAFE_PATH",409) from None
                os.close(current);current=following
            info=os.fstat(current)
            if info.st_uid!=os.geteuid() or info.st_mode&0o077:raise MemoryFault("MEMORY_UNSAFE_PATH",409)
            for name in ("accounts",_hash(scope.account_id.encode()),"agents",_hash(scope.agent_id.encode())):
                following=_directory(current,name);os.close(current);current=following
            lock=os.open(".lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=current)
            try:
                _safe_file(os.fstat(lock));fcntl.flock(lock,fcntl.LOCK_EX);yield current
            finally:os.close(lock)
        finally:os.close(current)
class _Store:
    def __init__(self,factory,scope,authorize):self.factory=factory;self.scope=scope;self.authorize=authorize
    def _auth(self,action):
        try:
            if self.authorize(action) is False:raise MemoryFault("MEMORY_ACCESS_DENIED",403)
        except MemoryFault:raise
        except Exception:raise MemoryFault("MEMORY_ACCESS_DENIED",403) from None
    def _doc(self,document):
        if not isinstance(document,str) or document not in _NAMES:raise MemoryFault("MEMORY_INVALID_DOCUMENT",404)
        return document
    @contextmanager
    def _access(self,action,document):
        self._auth(action);self._doc(document)
        try:
            with self.factory._scope(self.scope) as fd:
                self._auth(action);yield fd
        except MemoryFault:raise
        except Exception:raise MemoryFault("MEMORY_STORAGE_UNAVAILABLE",503) from None
    def _head(self,fd,document):
        raw=_read(fd,document+".head.json",16*1024*1024)
        if raw is None:return {"version":1,"revision":0,"history":[],"receipts":{}}
        try:
            head=json.loads(raw)
            checksum=head.pop("checksum")
            if checksum!=_hash(json.dumps(head,sort_keys=True,separators=(",",":")).encode()):raise ValueError()
            if head["version"]!=1 or type(head["revision"]) is not int or head["revision"]<1 or not isinstance(head["history"],list) or not isinstance(head["receipts"],dict) or len(head["history"])>self.factory.history_limit or len(head["receipts"])>self.factory.receipt_limit:raise ValueError()
            hashes=head.get("projectionHashes",[])
            if not isinstance(hashes,list) or len(hashes)>2 or any(not isinstance(h,str) or not re.fullmatch(r"[a-f0-9]{64}",h) for h in hashes):raise ValueError()
            if not head["history"] or head["history"][-1]["revision"]!=head["revision"]:raise ValueError()
            for item in head["history"]:
                if not re.fullmatch(document+r"-[0-9]{16}-[a-f0-9]{32}\.md",item["file"]) or not re.fullmatch(r"[a-f0-9]{64}",item["contentSha256"]):raise ValueError()
                _revision(item["revision"])
            return head
        except (ValueError,TypeError,KeyError):raise MemoryFault("MEMORY_EXTERNAL_EDIT",409) from None
    def _prune(self,fd,document,head):
        kept={item["file"] for item in head["history"]}
        for name in os.listdir(fd):
            if re.fullmatch(document+r"-[0-9]{16}-[a-f0-9]{32}\.md",name) and name not in kept:
                _read(fd,name,self.factory.max_content_bytes)
                _unlink(fd,name)
        _sync(fd)
    def _projection(self,fd,document,head,raw=None):
        projected=_read(fd,_NAMES[document],self.factory.max_content_bytes)
        known={item["contentSha256"] for item in head["history"]}|set(head.get("projectionHashes",[]))
        if projected is not None and _hash(projected) not in known:raise MemoryFault("MEMORY_EXTERNAL_EDIT",409)
        if raw is None:return projected
        if projected==raw:return False
        _replace(fd,_NAMES[document],raw);return False
    def _view(self,fd,document,head,item=None):
        item=item or (head["history"][-1] if head["revision"] else None)
        content=""
        if item:
            raw=_read(fd,item["file"],self.factory.max_content_bytes)
            if raw is None or _hash(raw)!=item["contentSha256"]:raise MemoryFault("MEMORY_EXTERNAL_EDIT",409)
            try:content=raw.decode("utf-8")
            except UnicodeError:raise MemoryFault("MEMORY_EXTERNAL_EDIT",409) from None
        return {"version":"starli.memory.v1","agentId":self.scope.agent_id,"documentId":document,"filename":_NAMES[document],"revision":item["revision"] if item else 0,"revisionId":item["revisionId"] if item else None,"content":content,"contentSha256":item["contentSha256"] if item else _hash(b""),"updatedAt":item["updatedAt"] if item else None,"provenance":item["provenance"] if item else None,"renderPolicy":"native-sanitized-markdown","deleted":bool(item and item.get("deleted",False))}
    def read(self,document_id):
        with self._access("read",document_id) as fd:
            head=self._head(fd,document_id);self._projection(fd,document_id,head);view=self._view(fd,document_id,head);self._auth("read");return view
    def history(self,document_id):
        with self._access("history",document_id) as fd:
            head=self._head(fd,document_id);self._projection(fd,document_id,head)
            items=[]
            for item in reversed(head["history"]):
                view=self._view(fd,document_id,head,item);view.pop("content");items.append(view)
            self._auth("history");return {"version":"starli.memory.v1","agentId":self.scope.agent_id,"documentId":document_id,"currentRevision":head["revision"],"items":items,"retention":{"historyLimit":self.factory.history_limit,"receiptLimit":self.factory.receipt_limit,"policy":"bounded-content-permanent-receipts"}}
    def read_revision(self,document_id,revision):
        _revision(revision)
        with self._access("read_revision",document_id) as fd:
            head=self._head(fd,document_id);self._projection(fd,document_id,head)
            if revision==0 and head["revision"]==0:view=self._view(fd,document_id,head)
            else:
                item=next((item for item in head["history"] if item["revision"]==revision),None)
                if not item:raise MemoryFault("MEMORY_REVISION_RETIRED" if 0<=revision<head["revision"] else "MEMORY_REVISION_NOT_FOUND",410 if revision<head["revision"] else 404)
                view=self._view(fd,document_id,head,item)
            self._auth("read_revision");return view
    def _hook(self,name):
        if self.factory.fault_hook:self.factory.fault_hook(name)
    def write(self,document_id,content,expected_revision,client_write_id,provenance,*,operation="write"):
        if operation not in ("write","delete") or operation=="delete" and content!="":raise MemoryFault("MEMORY_INVALID_OPERATION",422)
        self._auth("write");self._doc(document_id)
        raw=_content(content,self.factory.max_content_bytes);_revision(expected_revision);_identifier(client_write_id,"MEMORY_INVALID_WRITE_ID");prov=_provenance(provenance)
        if len(client_write_id)>128:raise MemoryFault("MEMORY_INVALID_WRITE_ID",422)
        digest=_hash(json.dumps({"operation":operation,"contentSha256":_hash(raw),"expectedRevision":expected_revision,"provenance":prov},sort_keys=True,separators=(",",":")).encode());key=_hash(client_write_id.encode())
        with self._access("write",document_id) as fd:
            head=self._head(fd,document_id);projected=self._projection(fd,document_id,head)
            self._prune(fd,document_id,head)
            prior=head["receipts"].get(key)
            if prior:
                if prior["hash"]!=digest:raise MemoryFault("MEMORY_WRITE_ID_REUSED",409)
                view=self._view(fd,document_id,head);pending=False
                try:self._projection(fd,document_id,head,view["content"].encode())
                except MemoryFault:raise
                except Exception:pending=True
                self._auth("write");return {"version":"starli.memory.v1","document":view,"write":{"clientWriteId":client_write_id,"appliedRevision":prior["revision"],"deduplicated":True},"projectionPending":pending}
            if head["revision"]!=expected_revision:raise MemoryFault("MEMORY_REVISION_CONFLICT",409)
            if len(head["receipts"])>=self.factory.receipt_limit:raise MemoryFault("MEMORY_RECEIPT_QUOTA",429)
            if _free_bytes(fd)<self.factory.min_free_bytes+len(raw)+len(json.dumps(head))*2+8192:raise MemoryFault("MEMORY_STORAGE_FULL",507)
            if head["revision"]>=2**53-1:raise MemoryFault("MEMORY_REVISION_LIMIT",409)
            number=head["revision"]+1;ident=uuid.uuid4().hex;filename=f"{document_id}-{number:016d}-{ident}.md";committed=False
            item={"revision":number,"revisionId":ident,"contentSha256":_hash(raw),"updatedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"provenance":prov,"file":filename,"deleted":operation=="delete"}
            retained=[*head["history"],item][-self.factory.history_limit:]
            new={"version":1,"revision":number,"history":retained,"projectionHashes":list(dict.fromkeys([*([_hash(projected)] if projected is not None else []),item["contentSha256"]])),"receipts":{**head["receipts"],key:{"hash":digest,"revision":number}}}
            def mark_committed():
                nonlocal committed
                committed=True
            try:
                self._hook("before_revision");_write_new(fd,filename,raw);_sync(fd);self._hook("after_revision")
                self._hook("before_head");self._auth("write")
                _replace(fd,document_id+".head.json",_pack(new),mark_committed)
                self._hook("after_head");self._hook("before_projection");self._projection(fd,document_id,new,raw)
            except Exception:
                if not committed:
                    try:_unlink(fd,filename);_sync(fd)
                    except FileNotFoundError:pass
                    raise
            try:pending=_read(fd,_NAMES[document_id],self.factory.max_content_bytes)!=raw
            except Exception:pending=True
            # Content retirement is postcommit. Failure merely leaves bounded cleanup work.
            for old in head["history"]:
                if old not in retained:
                    try:
                        existing=_read(fd,old["file"],self.factory.max_content_bytes)
                        if existing is not None:_unlink(fd,old["file"])
                    except Exception:pass
            try:_sync(fd)
            except OSError:pending=True
            self._auth("write")
            return {"version":"starli.memory.v1","document":self._view(fd,document_id,new),"write":{"clientWriteId":client_write_id,"appliedRevision":number,"deduplicated":False},"projectionPending":pending}

    def delete(self,document_id,expected_revision,client_write_id,provenance):
        """CAS clear: durable empty tombstone; bounded prior revisions remain user-visible."""
        return self.write(document_id,"",expected_revision,client_write_id,provenance,operation="delete")
    def search(self,document_id,query,limit=10):
        if not isinstance(query,str) or not 1<=len(query.strip())<=200 or type(limit)is not int or not 1<=limit<=20:
            raise MemoryFault("MEMORY_INVALID_SEARCH",422)
        terms=list(dict.fromkeys(query.casefold().split()))[:16]
        if not terms:raise MemoryFault("MEMORY_INVALID_SEARCH",422)
        doc=self.read(document_id);matches=[]
        for line_no,line in enumerate(doc["content"].splitlines(),1):
            if all(term in line.casefold() for term in terms):
                matches.append({"line":line_no,"text":line[:300],"truncated":len(line)>300})
                if len(matches)==limit:break
        self._auth("read")
        return {"version":"starli.memory.v1","agentId":self.scope.agent_id,"documentId":document_id,"revision":doc["revision"],"matches":matches,"limit":limit,"currentOnly":True}

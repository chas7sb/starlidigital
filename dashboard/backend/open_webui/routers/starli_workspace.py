"""Account-scoped project files and preview, shared by chat tools and native UI."""
import hashlib,json,mimetypes,re,sqlite3,time,uuid,os,tempfile,stat
from pathlib import Path,PurePosixPath
from contextlib import contextmanager
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_platform import customer_principal
from open_webui.routers.starli_state import source_database,state_dir

router=APIRouter()
def owner(user):return customer_principal(user)[1]["v2UserId"]
def scoped_owner(user,ident=None,chat_id=None):
    uid=owner(user)
    if not chat_id:return uid
    from open_webui.models.chats import Chats
    if not Chats.get_chat_by_id_and_user_id(chat_id,user.id):raise HTTPException(404,"Conversation not found")
    from open_webui.routers import starli_v3_native as native
    from open_webui.routers.starli_execution_context import agent_scope,platform_enabled
    with native._db() as registry:
        bound=registry.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(native._owner(user),chat_id)).fetchone()
    if bound:
        with agent_scope(bound["agent_id"],chat_id):enabled=platform_enabled(user)
        if enabled:
            if ident is None:return None
            with db() as connection:row=connection.execute("SELECT owner FROM records WHERE collection='projects' AND id=?",(ident,)).fetchone()
            if row and isinstance(row["owner"],str):return row["owner"]
    return uid
@contextmanager
def db():
    c=sqlite3.connect(source_database(),timeout=10);c.row_factory=sqlite3.Row
    try:
        with c:yield c
    finally:c.close()
def get(c,uid,ident):
    row=c.execute("SELECT payload FROM records WHERE collection='projects' AND id=? AND owner=?",(ident,uid)).fetchone()
    if not row:raise HTTPException(404,"Project not found")
    value=json.loads(row["payload"])
    if value.get("ownerId")!=uid:raise HTTPException(404,"Project not found")
    return value
def save(c,uid,p):
    p["ownerId"]=uid;p["updatedAt"]=time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())
    c.execute("INSERT INTO records(collection,id,owner,payload) VALUES('projects',?,?,?) ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload WHERE owner=excluded.owner",(p["id"],uid,json.dumps(p)))
def file_path(value):
    if not isinstance(value,str) or not value or len(value)>240 or "\\" in value or "\x00" in value:raise HTTPException(422,"Invalid project file path")
    p=PurePosixPath(value)
    if value in (".","..") or value.endswith("/") or p.is_absolute() or any(v in ("..",".git","node_modules",".env") or v.startswith(".env.") for v in p.parts):raise HTTPException(422,"Protected project file path")
    if str(p)!=value:raise HTTPException(422,"Use a normalized relative path")
    return value
def summary(p):
    return {k:p.get(k) for k in ("id","name","brief","status","previewUrl","deploymentUrl","updatedAt","version")}
def manifest(p):return [{"path":f["path"],"size":len(f.get("content","").encode()),"sha256":hashlib.sha256(f.get("content","").encode()).hexdigest()} for f in p.get("files",[]) if isinstance(f,dict) and isinstance(f.get("path"),str)]
def _runtime_operation(value):
    if not isinstance(value,dict) or set(value)!={"key","bodySha256"} or any(not isinstance(value.get(k),str) or not re.fullmatch(r"[a-f0-9]{64}",value[k]) for k in ("key","bodySha256")):
        raise HTTPException(422,"Invalid internal project operation")
    return value
def runtime_project_id(uid,key):
    _runtime_operation({"key":key,"bodySha256":"0"*64})
    return "prj_"+hashlib.sha256((uid+":"+key).encode()).hexdigest()[:32]
def operation_receipt_from_project(project,key,body_hash):
    _runtime_operation({"key":key,"bodySha256":body_hash})
    receipts=project.get("_runtimeOperations") or {}
    if not isinstance(receipts,dict):raise HTTPException(409,"Invalid project operation ledger")
    prior=receipts.get(key)
    if prior is None:return None
    if not isinstance(prior,dict) or prior.get("bodySha256")!=body_hash:raise HTTPException(409,"Project operation key reused")
    return json.loads(json.dumps(prior["result"]))
def operation_receipt(uid,projectid,key,body_hash):
    with db() as connection:
        project=get(connection,uid,projectid)
        return operation_receipt_from_project(project,key,body_hash)
def record_operation(project,operation,result):
    operation=_runtime_operation(operation)
    prior=operation_receipt_from_project(project,operation["key"],operation["bodySha256"])
    if prior is not None:return
    receipts=dict(project.get("_runtimeOperations") or {})
    if len(receipts)>=10000:raise HTTPException(429,"Project operation receipt quota reached")
    try:raw=json.dumps(result,separators=(",",":"),allow_nan=False)
    except (ValueError,TypeError):raise HTTPException(422,"Invalid internal project receipt") from None
    if len(raw.encode())>262144:raise HTTPException(422,"Project operation receipt exceeds limit")
    receipts[operation["key"]]={"bodySha256":operation["bodySha256"],"result":json.loads(raw)}
    project["_runtimeOperations"]=receipts
def create(uid,name,brief="",*,runtime_operation=None,authorize=None):
    if authorize:authorize()
    operation=_runtime_operation(runtime_operation) if runtime_operation is not None else None
    ident=runtime_project_id(uid,operation["key"]) if operation else "prj_"+uuid.uuid4().hex[:20]
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        if operation:
            existing=c.execute("SELECT payload FROM records WHERE collection='projects' AND id=? AND owner=?",(ident,uid)).fetchone()
            if existing:
                project=get(c,uid,ident);receipt=operation_receipt_from_project(project,operation["key"],operation["bodySha256"])
                if receipt is None:raise HTTPException(409,"Project operation collision")
                if authorize:authorize()
                return receipt
            if c.execute("SELECT 1 FROM records WHERE collection='projects' AND id=?",(ident,)).fetchone():raise HTTPException(409,"Project operation collision")
        p={"id":ident,"ownerId":uid,"name":name[:160],"brief":brief[:8000],"status":"BRIEF","version":1,"files":[],"versions":[],"publishState":"never_deployed"}
        # Original create receipt is finite and never embeds its own receipt ledger.
        result=json.loads(json.dumps(p))
        if operation:record_operation(p,operation,result)
        save(c,uid,p)
        if authorize:authorize()
    return result if operation else p
def read(uid,ident):
    with db() as c:return get(c,uid,ident)
def _workspace_fault():
    return HTTPException(422,"Unsafe project filesystem state")
def _regular(fd,name):
    if isinstance(fd,_WindowsParent):return fd.regular(name)
    try:
        item=os.stat(name,dir_fd=fd,follow_symlinks=False)
    except FileNotFoundError:return None
    if not stat.S_ISREG(item.st_mode) or item.st_nlink!=1 or item.st_uid!=os.getuid():raise _workspace_fault()
    return item
def _same_file(left,right):
    return left is None and right is None or left is not None and right is not None and (left.st_dev,left.st_ino)==(right.st_dev,right.st_ino)

class _WindowsParent:
    """Held ancestor handles and root-relative NT opens prevent reparse traversal."""
    def __init__(self,path,links):self.path=path;self.links=links
    def child(self,name):
        # Reject Win32 normalization aliases, alternate streams and device names.
        if (not isinstance(name,str) or not name or name in ('.','..') or
            any(c in name for c in '\\/:<>"|?*') or any(ord(c)<32 for c in name) or
            name.endswith((' ','.')) or
            re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â²ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³]|LPT[1-9ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â²ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â³])',name.split('.')[0],re.I)):
            raise _workspace_fault()
        return self.path/name
    @staticmethod
    def info(handle):
        import ctypes
        import starli_private_fs as fs
        from types import SimpleNamespace
        item=fs.FileInfo()
        if not fs.kernel.GetFileInformationByHandle(handle,ctypes.byref(item)):raise _workspace_fault()
        return SimpleNamespace(st_dev=item.volume,st_ino=(item.indexHigh<<32)|item.indexLow,
                               st_size=(item.sizeHigh<<32)|item.sizeLow)
    def verify(self):
        import starli_private_fs as fs
        for path,handle,private in self.links:
            other=fs._open(path,directory=True,share=3)
            try:
                if not _same_file(self.info(handle),self.info(other)):raise _workspace_fault()
                if private:fs._validate_handle(other,True)
            finally:fs.kernel.CloseHandle(other)
    def regular(self,name):
        import starli_private_fs as fs
        try:handle=self.open_relative(name)
        except OSError as error:
            if getattr(error,"winerror",error.errno) in (2,3):return None
            raise _workspace_fault() from None
        try:
            fs._validate_handle(handle,False)
            return self.info(handle)
        except OSError:raise _workspace_fault() from None
        finally:fs.kernel.CloseHandle(handle)
    def read(self,name,known):
        if known is None:return None
        import starli_private_fs as fs
        import msvcrt
        handle=None
        try:
            handle=self.open_relative(name,access=0x80020080,share=1)
            fs._validate_handle(handle,False)
            held=self.info(handle)
            if not _same_file(known,held) or held.st_size>250000:raise _workspace_fault()
            descriptor=msvcrt.open_osfhandle(handle,os.O_RDONLY|os.O_BINARY);handle=None
            with os.fdopen(descriptor,'rb') as stream:data=stream.read(250001)
            if len(data)>250000:raise _workspace_fault()
            return data
        except OSError:raise _workspace_fault() from None
        finally:
            if handle is not None:fs.kernel.CloseHandle(handle)
    def open_relative(self,name,access=0x00020080,share=7,create=False,directory=False):
        # NtCreateFile RootDirectory uses the held directory object itself. An
        # ancestor changed into a junction cannot redirect this child access.
        import ctypes as C
        from ctypes import wintypes as W
        import starli_private_fs as fs
        self.child(name)
        class Unicode(C.Structure):
            _fields_=[('length',W.USHORT),('maximum',W.USHORT),('buffer',W.LPWSTR)]
        class Attributes(C.Structure):
            _fields_=[('length',W.ULONG),('root',W.HANDLE),('name',C.POINTER(Unicode)),('attributes',W.ULONG),('security',C.c_void_p),('qos',C.c_void_p)]
        class Status(C.Structure):
            _fields_=[('status',C.c_void_p),('information',C.c_size_t)]
        native=C.WinDLL('ntdll');function=native.NtCreateFile
        function.argtypes=[C.POINTER(W.HANDLE),W.DWORD,C.POINTER(Attributes),C.POINTER(Status),C.c_void_p,W.ULONG,W.ULONG,W.ULONG,W.ULONG,C.c_void_p,W.ULONG]
        function.restype=C.c_long
        size=len(name.encode('utf-16-le'));text=C.create_unicode_buffer(name,size//2+1)
        unicode=Unicode(size,size+2,C.cast(text,W.LPWSTR));descriptor=None
        if create:descriptor,_=fs._descriptor()
        attributes=Attributes(C.sizeof(Attributes),self.links[-1][1],C.pointer(unicode),0x40|0x1000,descriptor,None)
        handle=W.HANDLE();status=Status()
        try:
            code=function(C.byref(handle),access|0x100000,C.byref(attributes),C.byref(status),None,0x10 if directory else 0x80,share,2 if create else 1,0x200000|(0x1 if directory else 0x40)|0x20,None,0)
            if code<0:
                translate=native.RtlNtStatusToDosError;translate.argtypes=[C.c_long];translate.restype=W.ULONG
                raise C.WinError(translate(code))
            return handle.value
        finally:
            if descriptor:fs.kernel.LocalFree(descriptor)
    def replace(self,name,raw):
        import ctypes as C
        from ctypes import wintypes as W
        import starli_private_fs as fs
        import msvcrt
        self.child(name);temporary='.starli-save-'+uuid.uuid4().hex;handle=None
        try:
            self.verify();self.regular(name)
            handle=self.open_relative(temporary,access=0x40030080,create=True)
            fs._validate_handle(handle,False)
            created=self.info(handle)
            descriptor=msvcrt.open_osfhandle(handle,os.O_WRONLY|os.O_BINARY);handle=None
            with os.fdopen(descriptor,'wb') as stream:
                stream.write(raw);stream.flush();os.fsync(stream.fileno())
            handle=self.open_relative(temporary,access=0x00030080)
            fs._validate_handle(handle,False)
            if not _same_file(created,self.info(handle)):raise _workspace_fault()
            class Rename(C.Structure):
                _fields_=[('replace',C.c_ubyte),('root',W.HANDLE),('length',W.DWORD),('name',W.WCHAR*(len(name.encode('utf-16-le'))//2+1))]
            class Status(C.Structure):
                _fields_=[('status',C.c_void_p),('information',C.c_size_t)]
            rename=Rename();rename.replace=1;rename.root=self.links[-1][1];rename.length=len(name.encode('utf-16-le'));rename.name=name
            native=C.WinDLL('ntdll');function=native.NtSetInformationFile
            function.argtypes=[W.HANDLE,C.POINTER(Status),C.c_void_p,W.ULONG,C.c_int];function.restype=C.c_long
            status=Status();code=function(handle,C.byref(status),C.byref(rename),Rename.name.offset+rename.length,10)
            if code<0:
                translate=native.RtlNtStatusToDosError;translate.argtypes=[C.c_long];translate.restype=W.ULONG
                raise C.WinError(translate(code))
            self.verify()
            if not _same_file(created,self.regular(name)):raise _workspace_fault()
            return created
        except OSError:raise _workspace_fault() from None
        finally:
            if handle is not None:fs.kernel.CloseHandle(handle)
            self.unlink(temporary,missing_ok=True)
    def unlink(self,name,missing_ok=False):
        import ctypes as C
        from ctypes import wintypes as W
        import starli_private_fs as fs
        try:handle=self.open_relative(name,access=0x00030080)
        except OSError as error:
            if missing_ok and getattr(error,'winerror',error.errno) in (2,3):return
            raise _workspace_fault() from None
        try:
            fs._validate_handle(handle,False)
            remove=fs.kernel.SetFileInformationByHandle
            remove.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD];remove.restype=W.BOOL
            disposition=W.BOOL(True)
            if not remove(handle,4,C.byref(disposition),C.sizeof(disposition)):raise C.WinError(C.get_last_error())
        finally:fs.kernel.CloseHandle(handle)

@contextmanager
def _windows_parent(uid,ident,path):
    import ctypes
    import starli_private_fs as fs
    base=Path(os.path.abspath(str(state_dir())));handles=[];links=[]
    if not re.fullmatch(r'[A-Za-z]:\\',base.anchor):raise _workspace_fault()
    current=Path(base.anchor)
    parts=[*base.parts[1:],'projects',hashlib.sha256(uid.encode()).hexdigest(),ident,*PurePosixPath(path).parts[:-1]]
    try:
        # Pin the volume root too; all descendants are opened with OPEN_REPARSE_POINT.
        handle=fs._open(current,directory=True,share=3);handles.append(handle);links.append((current,handle,False))
        for index,name in enumerate(parts):
            parent=_WindowsParent(current,links);current=parent.child(name)
            private=index>=len(base.parts)-2
            if private:
                try:handle=parent.open_relative(name,directory=True,share=3,create=True)
                except OSError as error:
                    if getattr(error,'winerror',error.errno) not in (80,183):raise
                    handle=parent.open_relative(name,directory=True,share=3)
            else:handle=parent.open_relative(name,directory=True,share=3)
            handles.append(handle)
            info=fs.FileInfo()
            if not fs.kernel.GetFileInformationByHandle(handle,ctypes.byref(info)) or info.attributes&0x400 or not info.attributes&0x10:raise _workspace_fault()
            if private:fs._validate_handle(handle,True)
            links.append((current,handle,private))
        parent=_WindowsParent(current,links);parent.child(PurePosixPath(path).name)
        parent.verify();yield parent
    except OSError:raise _workspace_fault() from None
    finally:
        for handle in reversed(handles):fs.kernel.CloseHandle(handle)

def _unlink_workspace(directory,name):
    if isinstance(directory,_WindowsParent):
        directory.verify();directory.regular(name);directory.unlink(name)
    else:os.unlink(name,dir_fd=directory)

@contextmanager
def _anchored_parent(uid,ident,path):
    if os.name=='nt':
        with _windows_parent(uid,ident,path) as parent:yield parent,PurePosixPath(path).name,parent.verify
        return
    # Every component is opened relative to an already-held directory; never resolve/follow links.
    base=Path(os.path.abspath(str(state_dir())));parts=[*base.parts[1:],"projects",hashlib.sha256(uid.encode()).hexdigest(),ident,*PurePosixPath(path).parts[:-1]]
    handles=[];links=[];fd=os.open("/",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);handles.append(fd)
    try:
        for index,name in enumerate(parts):
            private=index>=len(base.parts)-2
            if private:
                try:os.mkdir(name,0o700,dir_fd=fd)
                except FileExistsError:pass
            child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);handles.append(child)
            info=os.fstat(child)
            if private and (info.st_uid!=os.getuid() or info.st_mode&0o077):raise _workspace_fault()
            links.append((fd,name,child));fd=child
        def verify():
            for parent,name,child in links:
                current=os.stat(name,dir_fd=parent,follow_symlinks=False);held=os.fstat(child)
                if not stat.S_ISDIR(current.st_mode) or (current.st_dev,current.st_ino)!=(held.st_dev,held.st_ino):raise _workspace_fault()
        verify();yield fd,PurePosixPath(path).name,verify
    except OSError:raise _workspace_fault() from None
    finally:
        for handle in reversed(handles):os.close(handle)
def _atomic_replace(fd,name,raw):
    if isinstance(fd,_WindowsParent):return fd.replace(name,raw)
    temporary=".starli-save-"+uuid.uuid4().hex
    handle=None
    try:
        handle=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
        with os.fdopen(handle,"wb") as stream:
            handle=None;stream.write(raw);stream.flush();os.fsync(stream.fileno());created=os.fstat(stream.fileno())
        os.replace(temporary,name,src_dir_fd=fd,dst_dir_fd=fd);os.fsync(fd)
        return created
    finally:
        if handle is not None:os.close(handle)
        try:os.unlink(temporary,dir_fd=fd)
        except FileNotFoundError:pass
def _read_regular(fd,name,known):
    if isinstance(fd,_WindowsParent):return fd.read(name,known)
    if known is None:return None
    handle=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
    try:
        held=os.fstat(handle)
        if not _same_file(held,known) or not stat.S_ISREG(held.st_mode) or held.st_nlink!=1 or held.st_uid!=os.getuid() or held.st_size>250000:raise _workspace_fault()
        with os.fdopen(handle,"rb") as stream:
            handle=None;value=stream.read(250001)
        if len(value)>250000:raise _workspace_fault()
        return value
    finally:
        if handle is not None:os.close(handle)
def write(uid,ident,path,content,expected=None,*,runtime_operation=None,authorize=None):
    if authorize:authorize()
    operation=_runtime_operation(runtime_operation) if runtime_operation is not None else None
    path=file_path(path)
    if not isinstance(ident,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}",ident):raise HTTPException(422,"Invalid project identifier")
    if not isinstance(content,str) or len(content.encode())>250000:raise HTTPException(422,"File exceeds 250 KB")
    # Authority/CAS is checked before creating any owner/project directory.
    with db() as c:
        c.execute("BEGIN IMMEDIATE");p=get(c,uid,ident)
        if operation:
            receipt=operation_receipt_from_project(p,operation["key"],operation["bodySha256"])
            if receipt is not None:
                if authorize:authorize()
                return receipt
        files=list(p.get("files") or [])
        old=next((f for f in files if f.get("path")==path),None)
        if old and expected!=hashlib.sha256(old.get("content","").encode()).hexdigest():raise HTTPException(409,"File changed; read its current hash before editing")
        if not old and expected:raise HTTPException(409,"File does not exist")
        before={"version":p.get("version",1),"files":files,"updatedAt":p.get("updatedAt")}
        new=[f for f in files if f.get("path")!=path]+[{"path":path,"content":content,"encoding":"utf8"}]
        if len(new)>200 or sum(len(f.get("content","").encode()) for f in new)>2000000:raise HTTPException(422,"Project file allowance exceeded")
        with _anchored_parent(uid,ident,path) as (directory,name,verify):
            known=_regular(directory,name);previous=_read_regular(directory,name,known);replaced=False
            try:
                verify()
                if not _same_file(known,_regular(directory,name)):raise _workspace_fault()
                replaced=True;written=_atomic_replace(directory,name,content.encode())
                verify()
                if not _same_file(written,_regular(directory,name)):raise _workspace_fault()
                p["versions"]=[*(p.get("versions") or [])[-9:],before];p["files"]=new;p["version"]=p.get("version",1)+1;p["status"]="SOURCE_READY"
                from open_webui.routers.starli_project_build import invalidate_preview
                invalidate_preview(p)
                result={"projectId":ident,"path":path,"sha256":hashlib.sha256(content.encode()).hexdigest(),"version":p["version"],"status":"SAVED"}
                if operation:record_operation(p,operation,result)
                save(c,uid,p)
                verify()
                if not _same_file(written,_regular(directory,name)):raise _workspace_fault()
                # Commit while directory descriptors remain open so failure recovery stays anchored.
                if authorize:authorize()
                c.commit()
            except BaseException:
                c.rollback()
                if replaced:
                    if previous is None:
                        try:_unlink_workspace(directory,name)
                        except FileNotFoundError:pass
                        if not isinstance(directory,_WindowsParent):os.fsync(directory)
                    else:_atomic_replace(directory,name,previous)
                raise
    return {"projectId":ident,"path":path,"sha256":hashlib.sha256(content.encode()).hexdigest(),"version":p["version"],"status":"SAVED"}
def preview_identity(project):
    """Artifact identity shared by authenticated GET and scoped readiness events."""
    from open_webui.routers.starli_project_build import source_digest
    digest=source_digest(project);version=project.get("version",1);report=project.get("previewBuild") or {}
    if not isinstance(report,dict):report={}
    build_id=hashlib.sha256(json.dumps([project.get("ownerId"),project.get("id"),version,digest,report.get("builtAt")],separators=(",",":")).encode()).hexdigest()
    return {"sourceVersion":version,"sourceDigest":digest,"buildId":build_id}
def preview(p):
    from open_webui.routers.starli_project_build import compiled_preview
    compiled=compiled_preview(p)
    identity=preview_identity(p)
    if compiled is not None:
        ready=compiled.get("available") is True and (p.get("previewBuild") or {}).get("status")=="PASSED" and (p.get("previewBuild") or {}).get("sourceDigest")==identity["sourceDigest"]
        return {**compiled,"project":summary(p),**identity,"compiledReady":ready,"buildId":identity["buildId"] if ready else None}
    files={f.get("path"):f.get("content","") for f in p.get("files",[]) if isinstance(f,dict)}
    html=files.get("index.html") or files.get("public/index.html") or p.get("previewHtml") or p.get("html")
    if not isinstance(html,str) or not html.strip():return {"available":False,"reason":"This project has no built HTML preview yet. Ask Starli to build or validate it.","project":summary(p),**identity,"compiledReady":False,"buildId":None}
    def resource(match):
        path=match.group(2).split("?")[0].lstrip("./")
        value=files.get(path)
        if value is None:return match.group(0)
        return "<style>"+value.replace("</style","<\\/style")+"</style>" if match.group(1)=="link" else "<script>"+value.replace("</script","<\\/script")+"</script>"
    html=re.sub(r'<(link)\b[^>]*href=["\']([^"\']+)["\'][^>]*>|<(script)\b[^>]*src=["\']([^"\']+)["\'][^>]*>\s*</script>',lambda m:resource(m) if m.group(1) else "<script>"+files.get(m.group(4).lstrip("./"),"").replace("</script","<\\/script")+"</script>" if m.group(4).lstrip("./") in files else m.group(0),html,flags=re.I)
    return {"available":True,"html":html,"project":summary(p),"version":p.get("version",1),**identity,"compiledReady":False,"buildId":None}
def bearer(request):
    if not request.headers.get("authorization","").startswith("Bearer "):raise HTTPException(403,"Bearer authentication required")
@router.get("/projects")
def projects(chatId:str|None=None,user=Depends(get_verified_user)):
    uid=scoped_owner(user,chat_id=chatId)
    with db() as c:
        rows=c.execute("SELECT payload FROM records WHERE collection='projects' "+("AND owner=? " if uid is not None else "")+"ORDER BY json_extract(payload,'$.updatedAt') DESC LIMIT 100",(uid,) if uid is not None else ()).fetchall()
    return {"items":[summary(json.loads(r[0])) for r in rows]}
class NewProject(BaseModel):
    name:str=Field(min_length=1,max_length=160)
    brief:str=Field(default="",max_length=8000)
@router.post("/projects")
def new_project(body:NewProject,request:Request,user=Depends(get_verified_user)):
    bearer(request);return summary(create(owner(user),body.name,body.brief))
@router.get("/projects/{ident}")
def project(ident:str,chatId:str|None=None,user=Depends(get_verified_user)):
    p=read(scoped_owner(user,ident,chatId),ident);return {**summary(p),"files":manifest(p),"versions":[{k:v.get(k) for k in ("version","updatedAt")} for v in p.get("versions",[])]}
@router.get("/projects/{ident}/preview")
def project_preview(ident:str,chatId:str|None=None,user=Depends(get_verified_user)):return preview(read(scoped_owner(user,ident,chatId),ident))
@router.get("/projects/{ident}/file")
def project_file(ident:str,path:str,chatId:str|None=None,user=Depends(get_verified_user)):
    p=read(scoped_owner(user,ident,chatId),ident);path=file_path(path)
    f=next((f for f in p.get("files",[]) if f.get("path")==path),None)
    if not f:raise HTTPException(404,"File not found")
    return {**f,"sha256":hashlib.sha256(f.get("content","").encode()).hexdigest()}
class FileWrite(BaseModel):
    path:str
    content:str=Field(max_length=250000)
    expectedSha256:str|None=None
@router.put("/projects/{ident}/file")
def put_file(ident:str,body:FileWrite,request:Request,chatId:str|None=None,user=Depends(get_verified_user)):
    bearer(request);return write(scoped_owner(user,ident,chatId),ident,body.path,body.content,body.expectedSha256)

TOOL_SCHEMAS=[
 {"name":"project_files","description":"List your actual project files and versions.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"required":["projectId"]}},
 {"name":"project_file_read","description":"Read one of your project files before editing.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"path":{"type":"string"}},"required":["projectId","path"]}},
 {"name":"project_file_write","description":"Create or update your actual project file. For updates supply the current expectedSha256. Saved HTML is shown in the live preview.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"path":{"type":"string"},"content":{"type":"string"},"expectedSha256":{"type":"string"}},"required":["projectId","path","content"]}},
 {"name":"project_preview","description":"Inspect the current built HTML preview from actual project files.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"required":["projectId"]}}
]
def schema(name):return next((t for t in TOOL_SCHEMAS if t["name"]==name),None)
def tool(user,name,args):
    uid=owner(user);ident=args.get("projectId")
    from open_webui.routers.starli_execution_context import platform_enabled
    if platform_enabled(user):
        with db() as c:row=c.execute("SELECT owner FROM records WHERE collection='projects' AND id=?",(ident,)).fetchone()
        if row:uid=row["owner"]
    p=read(uid,ident)
    if name=="project_files":return {**summary(p),"files":manifest(p)}
    if name=="project_file_write":return write(uid,ident,args.get("path"),args.get("content"),args.get("expectedSha256"))
    if name=="project_preview":
        data=preview(p);return {k:v for k,v in data.items() if k!="html"}
    if name=="project_file_read":
        path=file_path(args.get("path"));f=next((f for f in p.get("files",[]) if f.get("path")==path),None)
        if not f:raise HTTPException(404,"File not found")
        return {**f,"sha256":hashlib.sha256(f.get("content","").encode()).hexdigest()}
    raise HTTPException(404,"Unknown project tool")

@router.get("/chats/{chat_id}/activity")
def chat_activity(chat_id:str,before:float|None=None,before_id:str|None=None,user=Depends(get_verified_user)):
    from open_webui.models.chats import Chats
    if not Chats.get_chat_by_id_and_user_id(chat_id,user.id):raise HTTPException(404,"Conversation not found")
    from open_webui.routers.starli_v3_native import _db as registry_db,_owner
    with registry_db() as registry:
        binding=registry.execute("SELECT agent_id FROM agent_conversations WHERE owner=? AND chat_id=?",(_owner(user),chat_id)).fetchone()
    if not binding:return {"events":[],"hasMore":False}
    from open_webui.routers.starli_tool_trace import _db as trace_db
    cursor=before if before is not None else time.time()+1
    with trace_db() as connection:
        if before_id:
            rows=connection.execute("SELECT id,created,tool,status,arguments,task_id FROM events WHERE owner=? AND chat_id=? AND (created<? OR (created=? AND id<?)) ORDER BY created DESC,id DESC LIMIT 201",(user.id,chat_id,cursor,cursor,before_id[:100])).fetchall()
        else:
            rows=connection.execute("SELECT id,created,tool,status,arguments,task_id FROM events WHERE owner=? AND chat_id=? AND created<? ORDER BY created DESC,id DESC LIMIT 201",(user.id,chat_id,cursor)).fetchall()
    def phase(tool,status):
        if tool in ("runtime.task","runtime.primary"):
            return {"STARTED":"task_started","COMPLETED":"task_completed","FAILED":"task_failed","CANCELLED":"task_cancelled"}.get(status,"task_failed")
        return "tool_started" if status=="STARTED" else "tool_finished"
    from open_webui.routers.starli_result_status import public_paths
    items=[{"id":v[0],"timestamp":v[1],"tool":v[2],"status":v[3],"paths":public_paths(json.loads(v[4])),"chatId":chat_id,"agentId":binding["agent_id"],"taskId":v[5],"phase":phase(v[2],v[3])} for v in rows[:200]]
    return {"events":list(reversed(items)),"hasMore":len(rows)>200,"before":items[-1]["timestamp"] if items else before,"beforeId":items[-1]["id"] if items else before_id}

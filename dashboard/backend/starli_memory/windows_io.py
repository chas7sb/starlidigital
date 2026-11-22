"""Windows memory IO: private ACLs, held no-delete directory handles, byte locks.

The caller retains the platform-independent CAS/HEAD/history algorithm. Each new
file is exclusively created private, flushed, then atomically renamed with
MoveFileExW WRITE_THROUGH. POSIX dirfd implementation remains separate.
"""
import ctypes
import hashlib
import os
from pathlib import Path
import shutil
import uuid
from contextlib import contextmanager
import starli_private_fs as fs
from starli_file_lock import open_lock_file, bounded_exclusive_lock

def unsafe():
    from .store import MemoryFault
    return MemoryFault('MEMORY_UNSAFE_PATH',409)

def child(directory,name):
    if not isinstance(name,str) or Path(name).name != name or name in ('','.','..') or '/' in name or '\\' in name:
        raise unsafe()
    return Path(directory)/name

@contextmanager
def scope(root,account_id,agent_id):
    handles=[]
    try:
        root=Path(root)
        # Hold all ancestors without FILE_SHARE_DELETE. Refuse junction/reparse
        # traversal before creating or using any account-controlled file.
        current=Path(root.anchor)
        for part in root.parts[1:]:
            current=current/part
            if not current.exists():fs.ensure_private_directory(current)
            handle=fs._open(current,directory=True,share=3)
            handles.append(handle)
            info=fs.FileInfo()
            if not fs.kernel.GetFileInformationByHandle(handle,ctypes.byref(info)) or info.attributes & 0x400 or not info.attributes & 0x10:
                raise unsafe()
        fs.validate_private(root,True)
        for part in ('accounts',hashlib.sha256(account_id.encode()).hexdigest(),'agents',hashlib.sha256(agent_id.encode()).hexdigest()):
            current=current/part;fs.ensure_private_directory(current)
            handle=fs._open(current,directory=True,share=3);handles.append(handle)
            fs._validate_handle(handle,True)
        lock=current/'.lock';fs.ensure_private_file(lock)
        with open_lock_file(lock) as stream, bounded_exclusive_lock(stream):
            fs.require_private_file(lock)
            yield current
    except OSError:
        raise unsafe() from None
    finally:
        for handle in reversed(handles):fs.kernel.CloseHandle(handle)

def read(directory,name,maximum):
    path=child(directory,name)
    if not path.exists():
        # A dangling link must not be treated as a missing document.
        if path.is_symlink():raise unsafe()
        return None
    try:
        fs.require_private_file(path)
        handle=fs._open(path,share=3)
        try:
            fs._validate_handle(handle,False)
            import msvcrt
            # Open a separate read-only CRT descriptor while the no-delete handle
            # keeps the validated entry pinned against replacement.
            with path.open('rb') as stream:
                fs._validate_handle(msvcrt.get_osfhandle(stream.fileno()),False)
                data=stream.read(maximum+1)
        finally:fs.kernel.CloseHandle(handle)
        if len(data)>maximum:
            from .store import MemoryFault
            raise MemoryFault('MEMORY_EXTERNAL_EDIT',409)
        return data
    except OSError:raise unsafe() from None

def write_new(directory,name,data):
    try:fs.create_private_file(child(directory,name),data)
    except OSError:raise unsafe() from None

def replace(directory,name,data,committed_hook=None):
    path=child(directory,name);read(directory,name,16*1024*1024)
    temporary=child(directory,'.tmp-'+uuid.uuid4().hex)
    try:
        fs.create_private_file(temporary,data)
        move=fs.kernel.MoveFileExW
        move.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint32]
        move.restype=ctypes.c_int
        if not move(str(temporary),str(path),1|8):raise ctypes.WinError(ctypes.get_last_error())
        if committed_hook:committed_hook()
    finally:
        try:temporary.unlink()
        except FileNotFoundError:pass

def unlink(directory,name):
    path=child(directory,name)
    if path.exists():fs.require_private_file(path)
    path.unlink()

def free_bytes(directory):return shutil.disk_usage(directory).free

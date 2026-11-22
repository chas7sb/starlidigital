"""Private SQLite storage: POSIX modes or Windows owner/protected-DACL checks.

Existing permissive storage is rejected, never silently repaired. Newly created
Windows objects receive a protected, current-user-only DACL atomically.
"""
import os
import stat
from pathlib import Path

class PrivateStorageError(OSError):
    pass

def _require_posix_metadata(info, directory, uid):
    if (info.st_uid != uid or info.st_mode & 0o077
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or (not directory and info.st_nlink != 1)):
        raise PrivateStorageError('PRIVATE_STORAGE_OWNER_TYPE_OR_MODE_DENIED')

if os.name == 'nt':
    import ctypes as C
    from ctypes import wintypes as W
    advapi = C.WinDLL('advapi32', use_last_error=True)
    kernel = C.WinDLL('kernel32', use_last_error=True)
    P = C.c_void_p
    advapi.OpenProcessToken.argtypes = [W.HANDLE, W.DWORD, C.POINTER(W.HANDLE)]
    advapi.OpenProcessToken.restype = W.BOOL
    advapi.GetTokenInformation.argtypes = [W.HANDLE, C.c_int, P, W.DWORD, C.POINTER(W.DWORD)]
    advapi.GetTokenInformation.restype = W.BOOL
    advapi.ConvertSidToStringSidW.argtypes = [P, C.POINTER(W.LPWSTR)]
    advapi.ConvertSidToStringSidW.restype = W.BOOL
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [W.LPCWSTR,W.DWORD,C.POINTER(P),C.POINTER(W.DWORD)]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = W.BOOL
    advapi.GetSecurityInfo.argtypes = [W.HANDLE,C.c_int,W.DWORD,C.POINTER(P),C.POINTER(P),C.POINTER(P),C.POINTER(P),C.POINTER(P)]
    advapi.GetSecurityInfo.restype = W.DWORD
    advapi.GetSecurityDescriptorControl.argtypes = [P,C.POINTER(W.WORD),C.POINTER(W.DWORD)]
    advapi.GetSecurityDescriptorControl.restype = W.BOOL
    advapi.GetAce.argtypes = [P,W.DWORD,C.POINTER(P)]
    advapi.GetAce.restype = W.BOOL
    kernel.GetCurrentProcess.restype = W.HANDLE
    kernel.CloseHandle.argtypes = [W.HANDLE]
    kernel.LocalFree.argtypes = [P]
    kernel.LocalFree.restype = P
    class SecurityAttributes(C.Structure):
        _fields_ = [('nLength',W.DWORD),('lpSecurityDescriptor',P),('bInheritHandle',W.BOOL)]
    kernel.CreateDirectoryW.argtypes = [W.LPCWSTR,C.POINTER(SecurityAttributes)]
    kernel.CreateDirectoryW.restype = W.BOOL
    kernel.CreateFileW.argtypes = [W.LPCWSTR,W.DWORD,W.DWORD,C.POINTER(SecurityAttributes),W.DWORD,W.DWORD,W.HANDLE]
    kernel.CreateFileW.restype = W.HANDLE
    class FileInfo(C.Structure):
        _fields_ = [('attributes',W.DWORD),('creation',W.FILETIME),('access',W.FILETIME),('write',W.FILETIME),
                    ('volume',W.DWORD),('sizeHigh',W.DWORD),('sizeLow',W.DWORD),('links',W.DWORD),('indexHigh',W.DWORD),('indexLow',W.DWORD)]
    kernel.GetFileInformationByHandle.argtypes = [W.HANDLE,C.POINTER(FileInfo)]
    kernel.GetFileInformationByHandle.restype = W.BOOL
    class Acl(C.Structure):
        _fields_ = [('revision',W.BYTE),('reserved',W.BYTE),('size',W.WORD),('count',W.WORD),('reserved2',W.WORD)]
    class AceHeader(C.Structure):
        _fields_ = [('type',W.BYTE),('flags',W.BYTE),('size',W.WORD)]

    def _sid_text(sid):
        result = W.LPWSTR()
        if not sid or not advapi.ConvertSidToStringSidW(sid,C.byref(result)):
            raise PrivateStorageError('PRIVATE_STORAGE_SID_UNAVAILABLE')
        try:return result.value
        finally:kernel.LocalFree(C.cast(result,P))

    def current_user_sid():
        token=W.HANDLE()
        if not advapi.OpenProcessToken(kernel.GetCurrentProcess(),8,C.byref(token)):
            raise PrivateStorageError('PRIVATE_STORAGE_TOKEN_UNAVAILABLE')
        try:
            length=W.DWORD()
            advapi.GetTokenInformation(token,1,None,0,C.byref(length))
            buffer=C.create_string_buffer(length.value)
            if not advapi.GetTokenInformation(token,1,buffer,length,C.byref(length)):
                raise PrivateStorageError('PRIVATE_STORAGE_TOKEN_UNAVAILABLE')
            return _sid_text(C.cast(buffer,C.POINTER(P))[0])
        finally:kernel.CloseHandle(token)

    def _descriptor():
        sid=current_user_sid(); descriptor=P()
        # Protected ACL; children inherit current-user full control only.
        if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW('O:'+sid+'D:P(A;OICI;FA;;;'+sid+')',1,C.byref(descriptor),None):
            raise PrivateStorageError('PRIVATE_STORAGE_ACL_CREATION_FAILED')
        attrs=SecurityAttributes(C.sizeof(SecurityAttributes),descriptor,False)
        return descriptor,attrs

    def _open(path, directory=False, create=False, attrs=None, access=0x00020080, share=7):
        # OPEN_REPARSE_POINT + handle metadata prevents following a final symlink.
        flags=0x00200000 | (0x02000000 if directory else 0)
        handle=kernel.CreateFileW(str(path),access,share,attrs,1 if create else 3,flags,None)
        if handle == C.c_void_p(-1).value:
            raise PrivateStorageError(C.get_last_error(),'PRIVATE_STORAGE_OPEN_FAILED',str(path))
        return handle

    def _validate_handle(handle,directory):
        info=FileInfo()
        if not kernel.GetFileInformationByHandle(handle,C.byref(info)):
            raise PrivateStorageError('PRIVATE_STORAGE_METADATA_FAILED')
        if info.attributes & 0x400 or bool(info.attributes & 0x10) != directory or (not directory and info.links != 1):
            raise PrivateStorageError('PRIVATE_STORAGE_LINK_OR_TYPE_DENIED')
        owner=P(); dacl=P(); descriptor=P()
        result=advapi.GetSecurityInfo(handle,1,1|4,C.byref(owner),None,C.byref(dacl),None,C.byref(descriptor))
        if result:raise PrivateStorageError(result,'PRIVATE_STORAGE_ACL_READ_FAILED')
        try:
            sid=current_user_sid()
            if _sid_text(owner)!=sid or not dacl:
                raise PrivateStorageError('PRIVATE_STORAGE_OWNER_OR_DACL_DENIED')
            control=W.WORD();revision=W.DWORD()
            if not advapi.GetSecurityDescriptorControl(descriptor,C.byref(control),C.byref(revision)) or not control.value & 0x1000:
                raise PrivateStorageError('PRIVATE_STORAGE_INHERITED_ACL_DENIED')
            acl=C.cast(dacl,C.POINTER(Acl)).contents
            owner_full=False
            for i in range(acl.count):
                ace=P()
                if not advapi.GetAce(dacl,i,C.byref(ace)):raise PrivateStorageError('PRIVATE_STORAGE_ACE_INVALID')
                header=C.cast(ace,C.POINTER(AceHeader)).contents
                if header.type not in (0,1):raise PrivateStorageError('PRIVATE_STORAGE_ACE_UNSUPPORTED')
                mask=C.c_uint32.from_address(ace.value+4).value
                trustee=_sid_text(P(ace.value+8))
                # Allow no access grant to any other user/group, including Administrators.
                if header.type==0 and mask and trustee not in (sid,'S-1-5-18'):
                    raise PrivateStorageError('PRIVATE_STORAGE_BROAD_ACL_DENIED')
                if header.type==0 and trustee==sid and not header.flags & 0x08 and mask & 0x1f01ff == 0x1f01ff:
                    owner_full=True
            if not owner_full:raise PrivateStorageError('PRIVATE_STORAGE_OWNER_ACCESS_REQUIRED')
        finally:kernel.LocalFree(descriptor)

    def validate_private(path, directory=False):
        handle=_open(Path(path),directory)
        try:_validate_handle(handle,directory)
        finally:kernel.CloseHandle(handle)

    def ensure_private_directory(path):
        path=Path(path)
        if not path.is_absolute():raise PrivateStorageError('PRIVATE_STORAGE_ABSOLUTE_PATH_REQUIRED')
        if not path.exists():
            # Missing ancestors are also created privately. Existing ancestors are
            # not modified; the exact storage directory is always validated.
            if not path.parent.exists():ensure_private_directory(path.parent)
            descriptor,attrs=_descriptor()
            try:
                if not kernel.CreateDirectoryW(str(path),C.byref(attrs)) and C.get_last_error()!=183:
                    raise PrivateStorageError('PRIVATE_STORAGE_DIRECTORY_CREATION_FAILED')
            finally:kernel.LocalFree(descriptor)
        validate_private(path,True)

    def ensure_private_database(path):
        path=Path(path)
        if not path.is_absolute():raise PrivateStorageError('PRIVATE_STORAGE_ABSOLUTE_PATH_REQUIRED')
        ensure_private_directory(path.parent)
        if not path.exists():
            descriptor,attrs=_descriptor()
            try:
                try:handle=_open(path,create=True,attrs=C.byref(attrs))
                except PrivateStorageError as error:
                    if error.errno not in (80,183):raise
                else:
                    try:_validate_handle(handle,False)
                    finally:kernel.CloseHandle(handle)
            finally:kernel.LocalFree(descriptor)
        validate_private(path)
else:
    def ensure_private_directory(path):
        path=Path(path);path.mkdir(parents=True,exist_ok=True,mode=0o700)
        descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:_require_posix_metadata(os.fstat(descriptor),True,os.geteuid())
        finally:os.close(descriptor)

    def ensure_private_database(path):
        path=Path(path)
        if not path.is_absolute():raise PrivateStorageError('PRIVATE_STORAGE_PATH_DENIED')
        ensure_private_directory(path.parent)
        # NONBLOCK ensures attacker-created FIFOs/devices cannot hang startup;
        # fstat on the no-follow descriptor requires an owned regular file.
        fd=os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
        try:_require_posix_metadata(os.fstat(fd),False,os.geteuid())
        finally:os.close(fd)


def require_private_file(path):
    """Validate an existing owner-private file and its immediate directory.

    No creation, ACL repair, mode changes, network access or credential reads.
    Raises PrivateStorageError/OSError on absent, broad, unowned or linked storage.
    Windows permits grants only to the current token user and LocalSystem, with
    current-user ownership and a protected DACL. POSIX requires current uid,
    owner-only modes and one regular-file hard link.
    """
    path = Path(path)
    if not path.is_absolute():raise PrivateStorageError('PRIVATE_STORAGE_ABSOLUTE_PATH_REQUIRED')
    if os.name == 'nt':
        validate_private(path.parent, True)
        validate_private(path)
    else:
        for item, directory in ((path.parent, True), (path, False)):
            info = item.lstat()
            if (stat.S_ISLNK(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077
                    or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
                    or (not directory and info.st_nlink != 1)):
                raise PrivateStorageError('PRIVATE_STORAGE_OWNER_OR_MODE_DENIED')
    return path


# Generic spelling for callers storing private JSON/keys rather than SQLite.
ensure_private_file = ensure_private_database

def create_private_file(path, data):
    """Exclusively create and write a private file; never overwrite or repair."""
    path = Path(path)
    if not path.is_absolute():raise PrivateStorageError('PRIVATE_STORAGE_ABSOLUTE_PATH_REQUIRED')
    ensure_private_directory(path.parent)
    if os.name == 'nt':
        import msvcrt
        descriptor, attrs = _descriptor()
        try:
            try:handle = _open(path, create=True, attrs=C.byref(attrs), access=0x40020080)
            except PrivateStorageError as error:
                if error.errno in (80,183):raise FileExistsError(str(path)) from None
                raise
            try:
                _validate_handle(handle,False)
                fd=msvcrt.open_osfhandle(handle,os.O_WRONLY|os.O_BINARY)
            except BaseException:
                kernel.CloseHandle(handle)
                raise
            # The descriptor now owns the Windows handle.
            with os.fdopen(fd,'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        finally:kernel.LocalFree(descriptor)
    else:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    require_private_file(path)
    return path

"""Bounded private-blob writes and orphan collection for native Drive."""
import errno
import os
import re
import shutil
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from .drive import Drive, LocalBlobs

MiB=1024*1024

class StorageLimit(Exception):
    def __init__(self,code):
        self.code=code
        super().__init__(code)

@dataclass(frozen=True)
class UploadPolicy:
    enabled: bool=False
    company_bytes: int=64*MiB
    global_bytes: int=256*MiB
    reserve_bytes: int=2048*MiB
    max_objects: int=5000
    metadata_headroom: int=64*1024
    def __post_init__(self):
        for name in ("company_bytes","global_bytes","reserve_bytes","max_objects","metadata_headroom"):
            value=getattr(self,name)
            if type(value) is not int or value<=0:
                raise ValueError("invalid upload policy: "+name)
    @classmethod
    def from_env(cls):
        def number(name,default):
            return int(os.environ.get("STARLI_DRIVE_"+name,str(default)))
        enabled=os.environ.get("STARLI_DRIVE_UPLOADS_ENABLED","0")
        if enabled not in ("0","1"):
            raise ValueError("STARLI_DRIVE_UPLOADS_ENABLED must be 0 or 1")
        return cls(enabled=="1",number("COMPANY_BYTES",64*MiB),
                   number("GLOBAL_BYTES",256*MiB),number("RESERVE_BYTES",2048*MiB),
                   number("MAX_OBJECTS",5000),number("METADATA_HEADROOM",64*1024))

class SafeBlobs(LocalBlobs):
    def __init__(self,root,free_bytes=None,writer=None):
        candidate=Path(root)
        if candidate.is_symlink():
            raise ValueError("blob root must not be a symlink")
        super().__init__(candidate)
        self.root=self.root.resolve()
        self.free_bytes=free_bytes or (lambda:shutil.disk_usage(self.root).free)
        self.writer=writer or os.write

    def path(self,key):
        # Canonical UUID filenames only. No paths, temporary names or public URLs.
        if not isinstance(key,str) or re.fullmatch(r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}",key) is None:
            raise ValueError("invalid private blob key")
        return self.root/key

    def write(self,key,data):
        path=self.path(key)
        flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,"O_NOFOLLOW",0)
        descriptor=None
        created=False
        try:
            descriptor=os.open(path,flags,0o600)
            created=True
            view=memoryview(data)
            while view:
                amount=self.writer(descriptor,view[:1024*1024])
                if amount<=0:
                    raise OSError(errno.EIO,"short write")
                view=view[amount:]
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor=None
            # Persist directory entry before SQLite publishes the reference.
            directory=os.open(self.root,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
            try: os.fsync(directory)
            finally: os.close(directory)
            return key
        except BaseException:
            if descriptor is not None:
                os.close(descriptor)
            if created:
                try: path.unlink()
                except FileNotFoundError: pass
                except OSError: pass  # leave for grace-period orphan sweep
            raise

    def read(self,key):
        descriptor=os.open(self.path(key),os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
        with os.fdopen(descriptor,"rb") as stream:
            return stream.read()

    @staticmethod
    def referenced(db,key):
        return db.execute("SELECT 1 FROM drive_versions WHERE blob=? UNION ALL SELECT 1 FROM resource WHERE blob=? LIMIT 1",(key,key)).fetchone() is not None

    def discard_unreferenced(self,db,keys):
        # Caller holds BEGIN IMMEDIATE, excluding all cooperating upload commits.
        removed=0
        for key in keys:
            path=self.path(key)
            if not self.referenced(db,key) and not path.is_symlink():
                try: path.unlink();removed+=1
                except FileNotFoundError: pass
        return removed

class QuotaDrive(Drive):
    def __init__(self,path,authority_class,blobs,policy):
        super().__init__(path,authority_class,blobs.write,blobs.read)
        self.blobs,self.policy=blobs,policy
        self.created=[]

    def _write_blob(self,company,key,data):
        if not self.db.in_transaction:
            raise RuntimeError("upload requires serialized transaction")
        p=self.policy
        if not p.enabled:
            raise StorageLimit("uploads_disabled")
        # Never silently ignore pre-versioned records during accounting.
        unknown=self.db.execute("SELECT 1 FROM resource r WHERE r.blob IS NOT NULL AND NOT EXISTS(SELECT 1 FROM drive_versions v WHERE v.blob=r.blob) LIMIT 1").fetchone()
        if unknown:
            raise StorageLimit("storage_inventory_required")
        total,count=self.db.execute("SELECT coalesce(sum(size),0),count(*) FROM drive_versions").fetchone()
        company_total=self.db.execute("SELECT coalesce(sum(v.size),0) FROM drive_versions v JOIN resource r ON r.id=v.resource WHERE r.company=?",(company,)).fetchone()[0]
        if company_total+len(data)>p.company_bytes:
            raise StorageLimit("company_upload_quota")
        if total+len(data)>p.global_bytes or count>=p.max_objects:
            raise StorageLimit("global_upload_quota")
        if self.blobs.free_bytes()<p.reserve_bytes+len(data)+p.metadata_headroom:
            raise StorageLimit("storage_reserve")
        # Track only successfully created exclusive keys. Partial write cleanup is
        # the blob adapter's responsibility; never delete an existing collision.
        result=self.blobs.write(key,data)
        self.created.append(key)
        return result

    from contextlib import contextmanager
    @contextmanager
    def access(self,actor,company,action="read"):
        # Base access owns SQLite commit/rollback and authoritative recheck.
        start=len(self.created)
        try:
            with super().access(actor,company,action) as member:
                yield member
        except BaseException:
            keys=self.created[start:]
            if keys:
                try:
                    self.db.execute("BEGIN IMMEDIATE")
                    self.blobs.discard_unreferenced(self.db,keys)
                    self.db.commit()
                except Exception:
                    self.db.rollback()
                    # Database/disk errors can make safe reference checks impossible.
                    # Preserve bytes for bounded grace-period sweep, never guess.
            raise
        finally:
            del self.created[start:]

class OrphanSweep:
    """Operator-only incremental sweep. No HTTP cleanup endpoint or automatic purge."""
    def __init__(self,db_path,blobs,grace_seconds=86400,clock=time.time):
        if grace_seconds<3600:
            raise ValueError("orphan grace must be at least one hour")
        self.db=sqlite3.connect(db_path,timeout=5)
        self.blobs,self.grace,self.clock=blobs,grace_seconds,clock
        self.entries=os.scandir(blobs.root)
        self.done=False
    def close(self):
        self.entries.close()
        self.db.close()
    def batch(self,max_scan=256,max_delete=32,max_bytes=16*MiB):
        if not 1<=max_scan<=4096 or not 1<=max_delete<=256 or not 1<=max_bytes<=256*MiB:
            raise ValueError("cleanup budget out of range")
        scanned=deleted=freed=0
        self.db.execute("BEGIN IMMEDIATE")
        try:
            # Fail closed if reference tables are unavailable, including empty scans.
            self.db.execute("SELECT blob FROM drive_versions LIMIT 0")
            self.db.execute("SELECT blob FROM resource LIMIT 0")
            while scanned<max_scan and deleted<max_delete and not self.done:
                try: entry=next(self.entries)
                except StopIteration:
                    self.done=True
                    break
                scanned+=1
                try:
                    self.blobs.path(entry.name)
                    if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                        continue
                    stat=entry.stat(follow_symlinks=False)
                    if stat.st_mtime>self.clock()-self.grace or stat.st_size+freed>max_bytes:
                        continue
                    if not self.blobs.referenced(self.db,entry.name):
                        # Verify inode did not change since examination.
                        now=os.stat(entry.path,follow_symlinks=False)
                        if (now.st_dev,now.st_ino,now.st_mtime_ns,now.st_size)!=(stat.st_dev,stat.st_ino,stat.st_mtime_ns,stat.st_size):
                            continue
                        os.unlink(entry.path)
                        deleted+=1
                        freed+=stat.st_size
                except (FileNotFoundError,ValueError):
                    continue
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        return {"scanned":scanned,"deleted":deleted,"bytes":freed,"done":self.done}

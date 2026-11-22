"""Bounded stdlib exclusive vault locks for Windows and POSIX."""
from contextlib import contextmanager
import errno
import os
import stat
import time
from pathlib import Path


def open_lock_file(path):
    """Open only a regular single-link file; refuse symlinks/reparse points."""
    path = Path(path)
    def acceptable(metadata):
        return stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1 and not (
            getattr(metadata, "st_file_attributes", 0) & 0x400
        )
    try:
        before = path.lstat()
        if not acceptable(before):
            raise RuntimeError("VAULT_LOCK_REGULAR_FILE_REQUIRED")
    except FileNotFoundError:
        pass
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        opened = os.fstat(descriptor)
        current = path.lstat()
        if not acceptable(opened) or not acceptable(current) or (
            opened.st_ino, opened.st_dev
        ) != (current.st_ino, current.st_dev):
            raise RuntimeError("VAULT_LOCK_REGULAR_FILE_REQUIRED")
        return os.fdopen(descriptor, "a+b")
    except BaseException:
        os.close(descriptor)
        raise


@contextmanager
def bounded_exclusive_lock(stream, timeout=30.0, poll_interval=0.025):
    """Lock the first byte on Windows or the whole file on POSIX.

    The lock file stores no vault data. Every caller must use this protocol;
    this matches the per-owner lock file used by the inference helper.
    """
    if not isinstance(timeout, (int, float)) or not 0 < timeout <= 900:
        raise ValueError("VAULT_LOCK_TIMEOUT_INVALID")
    metadata = os.fstat(stream.fileno())
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise RuntimeError("VAULT_LOCK_REGULAR_FILE_REQUIRED")
    deadline = time.monotonic() + timeout
    acquired = False
    if os.name == "nt":
        import msvcrt
        if metadata.st_size == 0:
            stream.seek(0)
            stream.write(b"\0")
            stream.flush()
        def acquire():
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        def release():
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
    else:
        import fcntl
        def acquire():
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        def release():
            fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
    try:
        while True:
            try:
                acquire()
                acquired = True
                break
            except OSError as error:
                if error.errno not in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError("VAULT_LOCK_TIMEOUT") from None
                time.sleep(min(poll_interval, max(0, deadline-time.monotonic())))
        yield
    finally:
        if acquired:
            release()

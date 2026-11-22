"""Exercise the actual workspace IO helpers without starting application workers."""
import ast
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import unittest
import uuid
from contextlib import contextmanager

import starli_private_fs as fs


class WorkspaceFault(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        super().__init__(detail)


def helpers(root):
    source = Path(__file__).parents[1] / 'open_webui/routers/starli_workspace.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    names = {'_workspace_fault', '_regular', '_same_file', '_WindowsParent',
             '_windows_parent', '_unlink_workspace', '_anchored_parent',
             '_atomic_replace', '_read_regular'}
    tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    scope = dict(os=os, Path=Path, PurePosixPath=PurePosixPath, re=re, stat=stat,
                 hashlib=hashlib, uuid=uuid, contextmanager=contextmanager,
                 HTTPException=WorkspaceFault, state_dir=lambda: root)
    exec(compile(tree, str(source), 'exec'), scope)
    return scope


@unittest.skipUnless(os.name == 'nt', 'Windows handle/ACL integration tests')
class WorkspaceWindowsIO(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='starli-workspace-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'private-state'
        fs.ensure_private_directory(self.root)
        self.io = helpers(self.root)

    def parent(self, path='src/app.txt'):
        return self.io['_anchored_parent']('account-a', 'prj_test', path)

    def test_write_read_replace_and_private_acl(self):
        with self.parent() as (directory, name, verify):
            self.assertIsNone(self.io['_regular'](directory, name))
            written = self.io['_atomic_replace'](directory, name, b'first')
            self.assertEqual(self.io['_read_regular'](directory, name, written), b'first')
            fs.require_private_file(directory.child(name))
            second = self.io['_atomic_replace'](directory, name, b'second')
            self.assertFalse(self.io['_same_file'](written, second))
            self.assertEqual(self.io['_read_regular'](directory, name, second), b'second')
            verify()
            self.io['_unlink_workspace'](directory, name)
            self.assertIsNone(self.io['_regular'](directory, name))

    def test_ancestor_rename_is_blocked_while_scope_is_held(self):
        with self.parent() as (directory, name, verify):
            ancestor = directory.path.parent
            with self.assertRaises(OSError):
                ancestor.rename(ancestor.with_name('renamed-project'))
            verify()
            self.io['_atomic_replace'](directory, name, b'still anchored')
        self.assertFalse(ancestor.with_name('renamed-project').exists())

    def test_reparse_mutation_cannot_redirect_relative_io(self):
        import ctypes as C
        from ctypes import wintypes as W
        import struct
        outside = Path(self.temporary.name) / 'outside-junction'
        fs.ensure_private_directory(outside)
        with self.parent() as (directory, name, verify):
            handle = fs._open(directory.path, directory=True, access=0x40020080)
            control = fs.kernel.DeviceIoControl
            control.argtypes = [W.HANDLE,W.DWORD,C.c_void_p,W.DWORD,C.c_void_p,W.DWORD,C.POINTER(W.DWORD),C.c_void_p]
            control.restype = W.BOOL
            substitute = ('\\??\\' + str(outside)).encode('utf-16-le')
            display = str(outside).encode('utf-16-le')
            paths = substitute + b'\0\0' + display + b'\0\0'
            data = struct.pack('<IHHHHHH', 0xA0000003, len(paths)+8, 0, 0, len(substitute), len(substitute)+2, len(display)) + paths
            buffer = C.create_string_buffer(data); received = W.DWORD()
            try:
                if not control(handle,0x900A4,buffer,len(data),None,0,C.byref(received),None):
                    # Windows may reject reparse conversion while our handles
                    # are held; that is also the required safe outcome.
                    self.assertIn(C.get_last_error(), (5,32,145))
                    return
                with self.assertRaises((WorkspaceFault,OSError)):verify()
                # A root-relative open must fail closed or target the held
                # directory object, never traverse its new junction destination.
                try:
                    child = directory.open_relative('relative.txt', access=0x40020080, create=True)
                except OSError:pass
                else:fs.kernel.CloseHandle(child)
                self.assertFalse((outside / 'relative.txt').exists())
            finally:
                remove = C.create_string_buffer(struct.pack('<IHH',0xA0000003,0,0))
                control(handle,0x900AC,remove,8,None,0,C.byref(received),None)
                fs.kernel.CloseHandle(handle)

    def test_hardlinked_file_is_rejected_for_read_and_replace(self):
        with self.parent() as (directory, name, verify):
            written = self.io['_atomic_replace'](directory, name, b'protected')
            alias = directory.child('alias.txt')
            os.link(directory.child(name), alias)
            with self.assertRaises(WorkspaceFault):self.io['_regular'](directory, name)
            with self.assertRaises(WorkspaceFault):self.io['_read_regular'](directory, name, written)
            with self.assertRaises(WorkspaceFault):self.io['_atomic_replace'](directory, name, b'bad')
            self.assertEqual(alias.read_bytes(), b'protected')

    def test_symlink_ancestor_and_final_entry_are_rejected(self):
        outside = Path(self.temporary.name) / 'outside'
        fs.ensure_private_directory(outside)
        fs.create_private_file(outside / 'untouched.txt', b'outside')
        with self.parent() as (directory, name, verify):
            try:os.symlink(outside, directory.child('linked'), target_is_directory=True)
            except OSError as error:
                if getattr(error, 'winerror', None) == 1314:self.skipTest('Token lacks symlink creation privilege')
                raise
            os.symlink(outside / 'untouched.txt', directory.child(name))
            with self.assertRaises(WorkspaceFault):self.io['_regular'](directory, name)
            with self.assertRaises(WorkspaceFault):self.io['_atomic_replace'](directory, name, b'bad')
        with self.assertRaises(WorkspaceFault):
            with self.parent('src/linked/escape.txt'):pass
        self.assertEqual((outside / 'untouched.txt').read_bytes(), b'outside')
        self.assertFalse((outside / 'escape.txt').exists())

    def test_broad_file_acl_rejected_without_repair(self):
        with self.parent() as (directory, name, verify):
            self.io['_atomic_replace'](directory, name, b'private')
            path = directory.child(name)
            subprocess.run(['icacls', str(path), '/grant', '*S-1-1-0:(R)'], check=True, capture_output=True)
            with self.assertRaises(WorkspaceFault):self.io['_regular'](directory, name)

    def test_windows_aliases_are_rejected(self):
        for name in ['a.txt:stream', 'NUL.txt', 'CON', 'COM1.txt', 'trailing.', 'trailing ']:
            with self.subTest(name=name), self.assertRaises(WorkspaceFault):
                with self.parent('src/' + name):pass

    def test_unicode_filename_uses_utf16_length(self):
        with self.parent('src/notes-\U0001f680.txt') as (directory, name, verify):
            written = self.io['_atomic_replace'](directory, name, 'hello \U0001f680'.encode())
            self.assertEqual(self.io['_read_regular'](directory, name, written), 'hello \U0001f680'.encode())


if __name__ == '__main__':unittest.main()

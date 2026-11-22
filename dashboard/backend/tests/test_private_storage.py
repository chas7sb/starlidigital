"""Real filesystem privacy checks; Windows tests inspect actual DACLs."""
from contextlib import closing
import importlib.util
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import stat
from types import SimpleNamespace
import unittest

spec=importlib.util.spec_from_file_location('private_fs_under_test',Path(__file__).parents[1]/'starli_private_fs.py')
fs=importlib.util.module_from_spec(spec);spec.loader.exec_module(fs)

class PrivateStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.base=Path(self.temporary.name).resolve()
    def tearDown(self):self.temporary.cleanup()

    def test_posix_metadata_rejects_foreign_owner_and_special_file(self):
        for mode,owner,directory in [(stat.S_IFDIR|0o700,200,True),(stat.S_IFREG|0o600,200,False),
                                     (stat.S_IFIFO|0o600,100,False),(stat.S_IFREG|0o700,100,True)]:
            info=SimpleNamespace(st_mode=mode,st_uid=owner,st_nlink=1)
            with self.assertRaises(OSError):fs._require_posix_metadata(info,directory,100)
        fs._require_posix_metadata(SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=100,st_nlink=1),False,100)

    @unittest.skipUnless(hasattr(os,'mkfifo'),'POSIX FIFO filesystem check')
    def test_actual_fifo_is_rejected_before_sqlite(self):
        directory=self.base/'private';fs.ensure_private_directory(directory)
        fifo=directory/'database';os.mkfifo(fifo,0o600)
        with self.assertRaises(OSError):fs.ensure_private_database(fifo)

    def test_current_user_private_storage_accepts_sqlite(self):
        database=self.base/'private/accounts.sqlite'
        fs.ensure_private_database(database)
        fs.require_private_file(database)
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('CREATE TABLE example (id INTEGER)')
            connection.execute('INSERT INTO example VALUES (1)')
        fs.ensure_private_database(database)
        fs.require_private_file(database)
        if os.name=='nt':self.assertTrue(fs.current_user_sid().startswith('S-1-'))

    def test_exclusive_private_key_creation_never_overwrites(self):
        key=self.base/'private/master.key'
        fs.create_private_file(key,b'private-test-content')
        fs.require_private_file(key)
        self.assertEqual(key.read_bytes(),b'private-test-content')
        with self.assertRaises(FileExistsError):fs.create_private_file(key,b'replacement')
        self.assertEqual(key.read_bytes(),b'private-test-content')

    def test_existing_broad_directory_is_rejected_without_repair(self):
        directory=self.base/'broad';directory.mkdir()
        if os.name!='nt':directory.chmod(0o755)
        with self.assertRaises(OSError):fs.ensure_private_database(directory/'accounts.sqlite')
        self.assertFalse((directory/'accounts.sqlite').exists())

    @unittest.skipUnless(os.name=='nt','Windows ACL validation')
    def test_explicit_everyone_read_grant_is_rejected(self):
        database=self.base/'private/accounts.sqlite';fs.ensure_private_database(database)
        result=subprocess.run(['icacls',str(database),'/grant','*S-1-1-0:(R)'],capture_output=True)
        self.assertEqual(result.returncode,0)
        with self.assertRaises(OSError):fs.require_private_file(database)
        with self.assertRaises(OSError):fs.ensure_private_database(database)

    def test_hard_link_is_rejected(self):
        database=self.base/'private/accounts.sqlite';fs.ensure_private_database(database)
        os.link(database,database.with_name('second.sqlite'))
        with self.assertRaises(OSError):fs.require_private_file(database)

    def test_missing_file_is_not_created_by_validation(self):
        fs.ensure_private_directory(self.base/'private')
        target=self.base/'private/missing'
        with self.assertRaises(OSError):fs.require_private_file(target)
        self.assertFalse(target.exists())

    def test_symlink_is_rejected(self):
        database=self.base/'private/accounts.sqlite';fs.ensure_private_database(database)
        link=database.with_name('linked.sqlite')
        try:link.symlink_to(database)
        except OSError:self.skipTest('Symlink privilege unavailable')
        with self.assertRaises(OSError):fs.require_private_file(link)

if __name__=='__main__':unittest.main()

"""Persistent-memory Windows CAS, rollback and cross-process locking checks."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
sys.path.insert(0,str(Path(__file__).parents[1]))
from starli_memory.store import MemoryStoreFactory,MemoryScope,Provenance,MemoryFault

@unittest.skipUnless(os.name=='nt','Windows storage adapter')
class WindowsMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory()
        self.root=Path(self.temporary.name).resolve()/'memory'
        self.factory=MemoryStoreFactory(self.root)
        self.scope=MemoryScope('owner','agent')
        self.store=self.factory.open(self.scope,lambda action:True)
    def tearDown(self):self.temporary.cleanup()
    def test_cas_history_and_idempotency(self):
        self.assertEqual(self.store.read('memory')['revision'],0)
        self.store.write('memory','one',0,'one',Provenance('user','owner'))
        repeated=self.store.write('memory','one',0,'one',Provenance('user','owner'))
        self.assertTrue(repeated['write']['deduplicated'])
        with self.assertRaises(MemoryFault) as failure:self.store.write('memory','stale',0,'stale',Provenance('user','owner'))
        self.assertEqual(failure.exception.code,'MEMORY_REVISION_CONFLICT')
        self.store.write('memory','two',1,'two',Provenance('user','owner'))
        self.assertEqual(self.store.read_revision('memory',1)['content'],'one')
        self.assertEqual(self.store.read('memory')['content'],'two')
    def test_before_commit_failure_keeps_previous_head(self):
        self.store.write('memory','one',0,'one',Provenance('user','owner'))
        def fail(stage):
            if stage=='before_head':raise OSError('injected failure')
        self.factory.fault_hook=fail
        with self.assertRaises(MemoryFault):self.store.write('memory','two',1,'two',Provenance('user','owner'))
        self.factory.fault_hook=None
        self.assertEqual(self.store.read('memory')['content'],'one')
        self.assertEqual(self.store.read('memory')['revision'],1)
    def test_broad_root_is_rejected(self):
        self.root.mkdir()
        with self.assertRaises(MemoryFault):self.store.read('memory')
    def test_scope_holds_ancestor_against_rename(self):
        ancestor=self.root.parent
        moved=ancestor.with_name(ancestor.name+'-moved')
        try:
            with self.factory._scope(self.scope):
                with self.assertRaises(OSError):ancestor.rename(moved)
        finally:
            if moved.exists():moved.rename(ancestor)

    def test_hardlinked_revision_is_rejected(self):
        self.store.write('memory','one',0,'one',Provenance('user','owner'))
        revision=next(self.root.rglob('memory-*.md'))
        os.link(revision,revision.with_name('unexpected-hardlink'))
        with self.assertRaises(MemoryFault) as failure:self.store.read('memory')
        self.assertEqual(failure.exception.code,'MEMORY_UNSAFE_PATH')

    def test_three_processes_preserve_thirty_updates(self):
        self.store.write('memory','0',0,'initial',Provenance('user','owner'))
        script='''
import sys,uuid
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from starli_memory.store import MemoryStoreFactory,MemoryScope,Provenance,MemoryFault
store=MemoryStoreFactory(Path(sys.argv[2])).open(MemoryScope('owner','agent'),lambda action:True)
for update in range(10):
 for attempt in range(1000):
  prior=store.read('memory')
  try:
   store.write('memory',str(int(prior['content'])+1),prior['revision'],uuid.uuid4().hex,Provenance('user','owner'))
   break
  except MemoryFault as error:
   if error.code!='MEMORY_REVISION_CONFLICT':raise
 else:raise RuntimeError('retry limit')
'''
        processes=[subprocess.Popen([sys.executable,'-c',script,str(Path(__file__).parents[1]),str(self.root)],stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(3)]
        for process in processes:
            output,error=process.communicate(timeout=60)
            self.assertEqual(process.returncode,0,error.decode())
        final=self.store.read('memory')
        self.assertEqual(final['content'],'30')
        self.assertEqual(final['revision'],31)

if __name__=='__main__':unittest.main()

"""Synthetic lock tests; never open a provider vault or use credentials."""
import multiprocessing
import os
from pathlib import Path
import tempfile
import time
import unittest
from runtime_file_lock import bounded_exclusive_lock, open_lock_file


def increment(lock, counter, count):
    for _ in range(count):
        with open_lock_file(lock) as stream, bounded_exclusive_lock(stream, timeout=10):
            value = int(Path(counter).read_text())
            time.sleep(0.002)
            Path(counter).write_text(str(value+1))


def hold(lock, ready, release):
    with open_lock_file(lock) as stream, bounded_exclusive_lock(stream, timeout=10):
        Path(ready).write_text("ready")
        deadline = time.monotonic()+10
        while not Path(release).exists() and time.monotonic() < deadline:
            time.sleep(0.01)


class RuntimeLockTests(unittest.TestCase):
    def test_concurrent_processes_do_not_lose_updates(self):
        with tempfile.TemporaryDirectory(prefix="starli-lock-test-") as directory:
            root=Path(directory); counter=root/"counter"; counter.write_text("0")
            context=multiprocessing.get_context("spawn")
            children=[context.Process(target=increment,args=(root/"lock",counter,30)) for _ in range(3)]
            for child in children:child.start()
            for child in children:
                child.join(20)
                if child.is_alive():child.terminate();child.join();self.fail("Lock worker timed out")
                self.assertEqual(child.exitcode,0)
            self.assertEqual(counter.read_text(),"90")

    def test_wait_is_bounded_and_release_allows_next_owner(self):
        with tempfile.TemporaryDirectory(prefix="starli-lock-test-") as directory:
            root=Path(directory);ready=root/"ready";release=root/"release"
            child=multiprocessing.get_context("spawn").Process(target=hold,args=(root/"lock",ready,release));child.start()
            try:
                deadline=time.monotonic()+10
                while not ready.exists() and time.monotonic()<deadline:time.sleep(0.01)
                self.assertTrue(ready.exists())
                started=time.monotonic()
                with open_lock_file(root/"lock") as stream:
                    with self.assertRaises(TimeoutError):
                        with bounded_exclusive_lock(stream,timeout=0.2):pass
                self.assertLess(time.monotonic()-started,2)
            finally:
                release.write_text("release");child.join(10)
                if child.is_alive():child.terminate();child.join()
            self.assertEqual(child.exitcode,0)
            with open_lock_file(root/"lock") as stream, bounded_exclusive_lock(stream,timeout=1):pass

    def test_exception_releases_and_hardlinks_are_refused(self):
        with tempfile.TemporaryDirectory(prefix="starli-lock-test-") as directory:
            root=Path(directory)
            with self.assertRaises(ValueError):
                with open_lock_file(root/"lock") as stream, bounded_exclusive_lock(stream,timeout=1):
                    raise ValueError("synthetic")
            with open_lock_file(root/"lock") as stream, bounded_exclusive_lock(stream,timeout=1):pass
            os.link(root/"lock",root/"link")
            with self.assertRaises(RuntimeError):open_lock_file(root/"link")


if __name__=="__main__":unittest.main()

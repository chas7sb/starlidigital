"""Use only synthetic files to verify the shared native privacy boundary."""
import os
from pathlib import Path
import tempfile
import unittest
import json
import sqlite3
import subprocess
import sys
from cryptography.fernet import Fernet
from contextlib import closing
from runtime_private_fs import private_storage


class PrivateStorageTests(unittest.TestCase):
    def test_actual_inference_helper_reads_empty_synthetic_vault_on_windows(self):
        helper=private_storage()
        with tempfile.TemporaryDirectory(prefix="starli-runtime-helper-") as directory:
            state=Path(directory)/"private-state";providers=state/"providers"
            key=providers/"master.key";database=providers/"accounts.sqlite"
            helper.ensure_private_database(key);key.write_bytes(Fernet.generate_key())
            helper.ensure_private_database(database)
            cipher=Fernet(key.read_bytes())
            with closing(sqlite3.connect(database)) as connection, connection:
                connection.execute("CREATE TABLE accounts(owner TEXT PRIMARY KEY,sealed BLOB,updated REAL)")
                connection.execute("INSERT INTO accounts VALUES(?,?,0)",("synthetic-owner",cipher.encrypt(json.dumps({"selection":None,"credentials":{}}).encode())))
            result=subprocess.run([sys.executable,str(Path(__file__).with_name("provider-infer.py"))],
                input=json.dumps({"prompt":"synthetic fixture","timeoutSeconds":5}),capture_output=True,text=True,timeout=10,
                env={**os.environ,"STARLI_PROVIDER_OWNER":"synthetic-owner","STARLI_STATE_DIR":str(state)})
            self.assertEqual(result.returncode,0)
            self.assertEqual(json.loads(result.stdout),{"configured":False})
            self.assertEqual(result.stderr,"")

    def test_fresh_private_file_passes_and_hardlink_fails(self):
        helper=private_storage()
        with tempfile.TemporaryDirectory(prefix="starli-runtime-privacy-") as directory:
            root=Path(directory)/"private";path=root/"synthetic.key"
            helper.ensure_private_database(path)
            path.write_bytes(b"synthetic fixture; no provider credential")
            self.assertEqual(helper.require_private_file(path),path)
            os.link(path,root/"linked.key")
            with self.assertRaises(OSError):helper.require_private_file(path)

    @unittest.skipUnless(os.name=="nt","Windows inherited ACL rejection")
    def test_broad_inherited_acl_is_rejected_without_repair(self):
        helper=private_storage()
        with tempfile.TemporaryDirectory(prefix="starli-runtime-broad-") as directory:
            path=Path(directory)/"synthetic.key";path.write_bytes(b"synthetic")
            with self.assertRaises(OSError):helper.require_private_file(path)


if __name__=="__main__":unittest.main()

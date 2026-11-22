import json,sqlite3,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,"/srv/starlidigital/webui-releases/native-company-mcp-always-v33-20261119/backend")
from open_webui.company_authority.company_rbac import Authority
from starli_memory.registry import BotRegistry
from claimed_coordinator_name import initialize_claim_name,install_claimed_coordinator_name
class NameTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="starli-name-test-")
        self.path=Path(self.temp.name)/"authority.sqlite"
        a=Authority(str(self.path));self.company=a.create("owner","Fixture company","Fixture Owner")
        reg=BotRegistry(str(self.path),a.require_member);self.bot=reg.create_shared("owner",self.company,"BOSS")["id"]
        reg.db.execute("UPDATE bots SET purpose='company-boss' WHERE id=?",(self.bot,));reg.db.close()
        a.register_bot("owner",self.company,self.bot,"BOSS");a.db.close()
        self.result={"state":"CLAIM_COMMITTED","claimId":"fixture-claim","companyId":self.company,"bossBotId":self.bot,"ownerUserId":"owner"}
        self.nav={"stage":"ROOM_READY","verifiedBy":"native-store-readback","companyId":self.company,"bossBotId":self.bot,"claimId":"fixture-claim"}
        self.svc=SimpleNamespace(native_session=lambda token:(None,token),owner_navigation=lambda *args:self.nav,
            ns=SimpleNamespace(RbacAuthority=Authority),p=SimpleNamespace(authority=self.path),
            claim=lambda *args:self.result,resume=lambda *args:self.result)
    def tearDown(self):self.temp.cleanup()
    def names(self):
        with sqlite3.connect(self.path) as db:
            return (db.execute("SELECT name FROM members WHERE company_id=? AND user_id=?",(self.company,self.bot)).fetchone()[0],
                    db.execute("SELECT name FROM bots WHERE id=?",(self.bot,)).fetchone()[0])
    def test_atomic_real_native_names_and_audit(self):
        self.assertIs(initialize_claim_name(self.svc,"owner","fixture-intent",self.result),self.result)
        self.assertEqual(self.names(),("Starli","Starli"))
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM audit WHERE action='bot.coordinator_name.initialize'").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT state FROM starli_claim_name_defaults").fetchone()[0],"COMMITTED")
    def test_resume_never_overwrites_later_admin_name(self):
        install_claimed_coordinator_name(self.svc);self.svc.claim("owner","cookie","fixture-intent","idem",1)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE members SET name='Custom Atlas' WHERE user_id=?",(self.bot,))
            db.execute("UPDATE bots SET name='Custom Atlas' WHERE id=?",(self.bot,))
        self.svc.resume("owner","fixture-intent")
        self.assertEqual(self.names(),("Custom Atlas","Custom Atlas"))
        with sqlite3.connect(self.path) as db:self.assertEqual(db.execute("SELECT count(*) FROM audit WHERE action='bot.coordinator_name.initialize'").fetchone()[0],1)
    def test_other_user_cannot_impersonate_owner(self):
        with self.assertRaisesRegex(RuntimeError,"CLAIM_SCOPE_DENIED"):initialize_claim_name(self.svc,"other","fixture-intent",self.result)
        self.assertEqual(self.names(),("BOSS","BOSS"))
    def test_actual_revoked_owner_fails_native_permission(self):
        with sqlite3.connect(self.path) as db:db.execute("UPDATE members SET active=0 WHERE user_id='owner'")
        with self.assertRaises(Exception):initialize_claim_name(self.svc,"owner","fixture-intent",self.result)
        self.assertEqual(self.names(),("BOSS","BOSS"))
    def test_unverified_or_wrong_claim_denied(self):
        self.nav["verifiedBy"]="client-claim"
        with self.assertRaisesRegex(RuntimeError,"CLAIM_SCOPE_DENIED"):initialize_claim_name(self.svc,"owner","fixture-intent",self.result)
        self.assertEqual(self.names(),("BOSS","BOSS"))
    def test_custom_name_before_default_is_preserved(self):
        with sqlite3.connect(self.path) as db:db.execute("UPDATE bots SET name='Existing custom' WHERE id=?",(self.bot,))
        initialize_claim_name(self.svc,"owner","fixture-intent",self.result)
        self.assertEqual(self.names(),("BOSS","Existing custom"))
        with sqlite3.connect(self.path) as db:self.assertEqual(db.execute("SELECT state FROM starli_claim_name_defaults").fetchone()[0],"SKIPPED_CUSTOM")
    def test_registry_failure_rolls_back_member_and_marker(self):
        with sqlite3.connect(self.path) as db:db.execute("CREATE TRIGGER reject_name BEFORE UPDATE OF name ON bots BEGIN SELECT RAISE(ABORT,'fixture failure'); END;")
        with self.assertRaises(sqlite3.IntegrityError):initialize_claim_name(self.svc,"owner","fixture-intent",self.result)
        self.assertEqual(self.names(),("BOSS","BOSS"))
        with sqlite3.connect(self.path) as db:self.assertEqual(db.execute("SELECT count(*) FROM audit WHERE action='bot.coordinator_name.initialize'").fetchone()[0],0)
    def test_provisional_never_changes_names(self):
        r={**self.result,"state":"CLAIM_PREPARED"}
        initialize_claim_name(self.svc,"owner","fixture-intent",r)
        self.assertEqual(self.names(),("BOSS","BOSS"))
if __name__=="__main__":unittest.main(verbosity=2)

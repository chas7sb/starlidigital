"""Current native owner/room-bound existing app facts; no record data or new actions."""
import hashlib,json,re
from pathlib import Path
from contextlib import closing
def install_model_owner_facts(chat_runtime,authority,svc):
    def resolve(session,company,room):
        with svc.store.access(session,company,room,readonly=True) as (db,member,row):
            marks=[dict(x) for x in db.execute("SELECT * FROM guest_native_transfer_watermark WHERE company=? AND room=?",(company,room))]
        result=[]
        for mark in marks:
            # Use the identical current native readback that powers owner_navigation.
            # The verified NativeSession is passed by canonical runtime; no token extraction.
            with closing(authority.db()) as db:
                claim=db.execute("SELECT * FROM grokbot1_claim_journal WHERE intent_id=? AND owner_user_id=? AND txn=? AND state='COMMITTED'",(mark["intent"],session.user_id,mark["claim_id"])).fetchone()
                if not claim or claim["company_id"]!=company:continue
                receipts=json.loads(claim["receipts"])
                if receipts["doglovRoomId"]!=room:continue
                checks=svc.native_readback(session,session.user_id,claim)
                if not checks or not all(value is True for value in checks.values()):continue
                transfer=db.execute("SELECT * FROM guest_conversation_transfer WHERE intent=? AND owner=? AND claim_id=? AND state='COMPLETE'",(mark["intent"],session.user_id,mark["claim_id"])).fetchone()
                if not transfer or transfer["digest"]!=mark["digest"]:continue
                snapshot={"intentId":mark["intent"],"guestBinding":transfer["binding"],"binding":transfer["binding"],"principalKind":"VERIFIED_REGISTERED_PERSON"}
            value=authority.read_build_status(snapshot)
            if not value or not re.fullmatch(r"build-[a-f0-9]{40}",value.get("buildId","")):continue
            if not isinstance(value.get("artifactDigest"),str) or not re.fullmatch(r"[a-f0-9]{64}",value["artifactDigest"]):
                result.append({"status":value["status"],"verifiedExistingArtifact":False,"newActionExecutedThisTurn":False})
                continue
            root=Path(svc.p.root).resolve()/"model-app-state"/value["buildId"]/"build-r2"
            spec_path=root/"appspec.json";schema_path=root/"native-source/backend/app.json"
            if spec_path.resolve()!=spec_path or schema_path.resolve()!=schema_path:raise ValueError("APP_FACT_SOURCE_SYMLINK_DENIED")
            receipt=json.loads((root/"APP_BUILD_RECEIPT.json").read_text());raw=schema_path.read_bytes();spec_raw=spec_path.read_bytes()
            pin=next(x for x in receipt["nativeProvenance"]["sourceFiles"] if x["path"]=="backend/app.json")
            if receipt["artifactDigest"]!=value["artifactDigest"] or hashlib.sha256(raw).hexdigest()!=pin["sha256"] or hashlib.sha256(spec_raw).hexdigest()!=receipt["specSha256"]:raise ValueError("APP_FACT_SOURCE_DIGEST_MISMATCH")
            schema=json.loads(raw);spec=json.loads(spec_raw)
            result.append({"appName":spec["name"],"status":value["status"],"runtimeState":value.get("runtimeState","AVAILABLE"),"collections":[{"name":c["name"],"label":c["label"],"fields":[{"name":f["name"],"label":f["label"],"type":f["type"],"required":f["required"]} for f in c["fields"]]} for c in schema["collections"]],"verifiedExistingArtifact":True,"newActionExecutedThisTurn":False})
        return result
    chat_runtime.model_app_facts_resolver=resolve

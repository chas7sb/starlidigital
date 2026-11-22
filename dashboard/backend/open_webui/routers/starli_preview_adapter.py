import json
import sqlite3
from pathlib import Path
from fastapi import HTTPException
from open_webui.models.tools import Tools

from open_webui.routers.starli_state import source_database
SOURCE_DATABASE=source_database()
def build_preview_adapter(bindings_path):
    path=Path(bindings_path)
    def overview(user_id):
        from open_webui.models.users import Users
        from open_webui.routers.starli_platform import customer_principal
        from open_webui.routers.starli_v3_native import _db,_owner
        user=Users.get_user_by_id(user_id)
        if not user:raise HTTPException(401,"Account unavailable")
        _,binding=customer_principal(user);v2_user=binding["v2UserId"]
        with sqlite3.connect('file:'+SOURCE_DATABASE+'?mode=ro',uri=True,timeout=3) as db:
            row=db.execute('SELECT available FROM credit_wallets WHERE owner_id=?',(v2_user,)).fetchone()
        with _db() as db:
            agents=[{"id":a["id"],"name":a["name"],"status":a["status"]} for a in db.execute("SELECT id,name,status FROM agents WHERE owner=? AND archived_at IS NULL",(_owner(user),))]
        company=binding.get("company")
        if not isinstance(company,dict) or not company.get("id") or not company.get("name"):company=None
        return {"company":company,"agents":agents,"tools":[],
                "browser":{"available":False,"reason":"Start a research browser from chat."},
                "credits":{"available":row is not None,"balance":row[0] if row else None,"unit":"credits"},"readOnly":True}
    return overview

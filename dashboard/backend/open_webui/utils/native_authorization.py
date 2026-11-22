"""Authorization at native chat execution boundaries. Server records are authoritative."""
from fastapi import HTTPException
from open_webui.models.users import Users
from open_webui.models.chats import Chats
from open_webui.utils.access_control import has_access, has_permission

def current_user(user):
    uid = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    stored = Users.get_user_by_id(uid) if isinstance(uid, str) and uid else None
    if stored is None or stored.role not in ("user", "admin"):
        raise HTTPException(403, "Authenticated user unavailable")
    return stored

def require_chat_owner(user, chat_id):
    if not chat_id or chat_id == "local":
        return
    chat = Chats.get_chat_by_id(chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(403, "Chat unavailable")

def require_feature(user, feature, config):
    if user.role != "admin" and not has_permission(user.id, "features."+feature, getattr(config,"USER_PERMISSIONS",{})):
        raise HTTPException(403, "Feature unavailable")

def require_tool_access(user, tool):
    if user.role == "admin" or tool.user_id == user.id:
        return
    if not has_access(user.id, "read", tool.access_control):
        raise HTTPException(403, "Tool unavailable")

def require_connection_access(user, connection):
    if user.role == "admin":
        return
    acl = connection.get("access_control")
    # Connections without a configured ACL preserve the native shared-connection semantics.
    if acl is not None and not has_access(user.id, "read", acl):
        raise HTTPException(403, "Tool connection unavailable")

from pathlib import Path
import sqlite3,time
from open_webui.models.files import Files
from open_webui.models.knowledge import Knowledges
from open_webui.routers.starli_state import state_dir

def require_file(user, file_id, access="read"):
    file = Files.get_file_by_id(file_id)
    if file is None:
        raise HTTPException(403, "File unavailable")
    if user.role == "admin" or file.user_id == user.id:
        return file
    # Shared knowledge grants come from persisted membership and file references.
    if access == "read":
        for knowledge in Knowledges.get_knowledge_bases_by_user_id(user.id,"read"):
            ids=(knowledge.data or {}).get("file_ids",[])
            if file_id in ids:
                return file
    raise HTTPException(403,"File unavailable")

def require_knowledge(user, ident, access="read"):
    item=Knowledges.get_knowledge_by_id(ident)
    if item is None:
        raise HTTPException(403,"Knowledge unavailable")
    if item.user_id != user.id and user.role != "admin" and not has_access(user.id,access,item.access_control):
        raise HTTPException(403,"Knowledge unavailable")
    return item

def grant_database():
    root=state_dir();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    db=sqlite3.connect(str(root/"native-collection-grants.sqlite"),timeout=5)
    db.execute("CREATE TABLE IF NOT EXISTS grants(collection TEXT PRIMARY KEY,owner TEXT NOT NULL,created REAL NOT NULL)")
    return db

def require_collection(user, name, access="read", creating=False):
    if not isinstance(name,str) or not name or len(name)>256:
        raise HTTPException(403,"Collection unavailable")
    if user.role=="admin":
        return
    if name.startswith("file-"):
        require_file(user,name[5:],access);return
    if Knowledges.get_knowledge_by_id(name) is not None:
        require_knowledge(user,name,access);return
    with grant_database() as db:
        db.execute("BEGIN IMMEDIATE")
        row=db.execute("SELECT owner FROM grants WHERE collection=?",(name,)).fetchone()
        if row and row[0]==user.id:
            return
        if row is None and creating and access=="write":
            db.execute("INSERT INTO grants VALUES(?,?,?)",(name,user.id,time.time()));return
    raise HTTPException(403,"Collection unavailable")

def authorize_files(user, descriptors):
    if descriptors is None:
        return []
    if not isinstance(descriptors,list) or len(descriptors)>100:
        raise HTTPException(400,"Invalid file references")
    output=[]
    for item in descriptors:
        if not isinstance(item,dict):
            raise HTTPException(400,"Invalid file reference")
        # Explicit text/documents carry no authority to reference server resources.
        if item.get("docs") and not any(item.get(k) for k in ("id","collection_name","collection_names")):
            output.append({"type":"web_search","docs":item["docs"],"name":item.get("name","Web search")})
            continue
        if item.get("type")=="collection":
            names=item.get("collection_names") if item.get("legacy") else None
            names=names or [item.get("id") or item.get("collection_name")]
            if not isinstance(names,list):
                raise HTTPException(400,"Invalid collection references")
            for ident in names:
                require_collection(user,ident)
                knowledge=Knowledges.get_knowledge_by_id(ident)
                if knowledge:
                    output.append({"id":ident,"type":"collection","name":knowledge.name,"data":knowledge.data or {}})
                else:
                    output.append({"id":ident,"collection_names":[ident],"type":"collection","legacy":True,"name":item.get("name","Collection")})
            continue
        ident=item.get("id") or (item.get("file") or {}).get("id")
        if ident:
            stored=Files.get_file_by_id(ident)
            if stored is None:
                collection=item.get("collection_name") or ident
                require_collection(user,collection)
                output.append({"id":collection,"collection_name":collection,"legacy":True,"name":item.get("name","Document")})
                continue
            file=require_file(user,ident)
            output.append({**item,"type":"file","id":file.id,"file":file.model_dump(),"legacy":False,"collection_name":"file-"+file.id})
            continue
        name=item.get("collection_name")
        if name:
            require_collection(user,name)
            output.append({**item,"collection_name":name})
            continue
        raise HTTPException(403,"File reference unavailable")
    return output

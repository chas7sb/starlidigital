"""WSGI entry point, mounted behind native verified-session authentication."""
import errno
import sqlite3
from .quota import StorageLimit
import base64
import io
import json
from urllib.parse import parse_qs
from .drive import Drive, Denied, CONTRACT

BASE="/api/v1/companies/"

class App:
    def __init__(self, factory, authenticate, draft_policy, bot_policy):
        self.factory,self.authenticate,self.draft_policy,self.bot_policy=factory,authenticate,draft_policy,bot_policy

    def __call__(self, environ, start_response):
        db=None
        headers=[("Cache-Control","no-store"),("X-Content-Type-Options","nosniff"),
                 ("Content-Security-Policy","sandbox; default-src 'none'; frame-ancestors 'self'"),
                 ("Referrer-Policy","no-referrer")]
        status="200 OK"
        mime="application/json"
        try:
            actor=self.authenticate(environ)
            if not isinstance(actor,str) or not actor:
                raise Denied("session unavailable")
            path=environ.get("PATH_INFO","")
            if not path.startswith(BASE):
                raise Denied("route unavailable")
            bits=path[len(BASE):].strip("/").split("/")
            if len(bits)<2 or bits[1]!="drive":
                raise Denied("route unavailable")
            company=bits[0]
            route=bits[2:]
            method=environ["REQUEST_METHOD"]
            args=parse_qs(environ.get("QUERY_STRING",""))
            def q(key,default=None): return args.get(key,[default])[0]
            body={}
            if method in ("POST","PATCH"):
                length=int(environ.get("CONTENT_LENGTH") or 0)
                if length>23*1024*1024:
                    raise ValueError("request too large")
                body=json.loads(environ["wsgi.input"].read(length) or b"{}")
                if not isinstance(body,dict) or any(k in body for k in ("actor","company","user","owner","blob","path")):
                    raise ValueError("invalid request scope")
            db=self.factory()
            def upload(): return base64.b64decode(body.get("data",""),validate=True)
            if not route and method=="GET":
                out=db.browse(actor,company,parent=q("parent"),query=q("q"),recent=q("recent")=="1",trash=q("trash")=="1",kind=q("kind"))
            elif route==["items"] and method=="POST":
                out=db.create_item(actor,company,body["title"],body.get("kind","folder"),body.get("parent"),
                    upload() if body.get("kind")=="file" else None,body.get("mime","application/octet-stream"),body.get("body",""))
            elif route==["events"] and method=="GET":
                out=db.changes(actor,company,int(q("after","0")))
            elif route==["channels"] and method=="GET":
                out=db.channels(actor,company)
            elif route==["counters"] and method=="GET":
                out=db.dashboard(actor,company)
            elif route==["picker"] and method=="POST":
                out=db.picker(actor,company,body["bot"],body.get("query",""),self.bot_policy)
            elif route==["channel-attachments"] and method=="POST":
                out=db.channel_reference(actor,company,body["resource"],body["version"],body["channel"])
            elif len(route)==2 and route[0]=="channel-attachments" and method=="GET":
                out=db.channel_metadata(actor,company,route[1],q("room"))
            elif len(route)==3 and route[0]=="channel-attachments" and route[2]=="content" and method=="GET":
                out,mime=db.channel_content(actor,company,route[1],q("room"))
                headers.append(("Content-Disposition","attachment"))
            elif route==["attachments"] and method=="POST":
                out=db.attach(actor,company,body["draft"],body["resource"],body["version"],self.draft_policy)
            elif len(route)==2 and route[0]=="attachments" and method=="GET":
                out,mime=db.attachment(actor,company,route[1],self.draft_policy)
                headers.append(("Content-Disposition","attachment"))
            elif len(route)==2 and route[1] in ("content","preview","thumbnail") and method=="GET":
                out,mime=db.content(actor,company,route[0],int(q("version","0")))
                if route[1]=="thumbnail":
                    if mime not in ("image/png","image/jpeg"):
                        raise ValueError("thumbnail unavailable")
                    from PIL import Image
                    Image.MAX_IMAGE_PIXELS=16000000
                    image=Image.open(io.BytesIO(out))
                    image.thumbnail((256,256))
                    buffer=io.BytesIO()
                    image.convert("RGB").save(buffer,format="PNG")
                    out,mime=buffer.getvalue(),"image/png"
                    # Recheck current version/ACL after decoding; never persist/publicly cache derivative.
                    db.content(actor,company,route[0],int(q("version","0")))
                safe_inline=route[1] in ("preview","thumbnail") and mime in ("image/png","image/jpeg","text/plain")
                headers.append(("Content-Disposition","inline" if safe_inline else "attachment"))
            elif len(route)==2 and route[1]=="document" and method=="POST":
                out=db.document(actor,company,route[0],body["version"],body["title"],body["body"])
            elif len(route)==1 and method=="PATCH":
                out=db.mutate(actor,company,route[0],body["version"],body["operation"],body.get("value"))
            elif len(route)==2 and route[1]=="versions" and method=="POST":
                out=db.replace(actor,company,route[0],body["version"],upload(),body["mime"])
            else:
                raise Denied("route unavailable")
            payload=out if isinstance(out,bytes) else json.dumps({"contract":CONTRACT,"data":out}).encode()
        except StorageLimit as error:
            status,payload="507 Insufficient Storage",json.dumps({"error":error.code}).encode()
        except Denied:
            status,payload="404 Not Found",b'{"error":"unavailable"}'
        except (OSError,sqlite3.Error) as error:
            full=(getattr(error,"errno",None) in (errno.ENOSPC,errno.EDQUOT) or getattr(error,"sqlite_errorcode",None)==sqlite3.SQLITE_FULL)
            status,payload=("507 Insufficient Storage",b'{"error":"storage_capacity"}') if full else ("503 Service Unavailable",b'{"error":"storage_unavailable"}')
        except (ValueError,KeyError,TypeError,UnicodeError):
            status,payload="409 Conflict",b'{"error":"invalid request or version conflict"}'
        except Exception:
            status,payload="503 Service Unavailable",b'{"error":"service unavailable"}'
        finally:
            if db is not None:
                db.db.close()
        headers.extend([("Content-Type",mime),("Content-Length",str(len(payload)))])
        start_response(status,headers)
        return [payload]

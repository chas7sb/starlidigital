"""Raster-only avatars; remote fetches never receive OAuth credentials."""
import base64,io
from urllib.parse import urlsplit
from PIL import Image
from open_webui.utils.safe_http import canonical_url,safe_fetch,validate_target

MAX_AVATAR=2*1024*1024
RASTER={"PNG","JPEG","GIF","WEBP"}
def raster_png(data):
    if not isinstance(data,bytes) or len(data)>MAX_AVATAR:raise ValueError("Avatar exceeds limit")
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in RASTER or image.width*image.height>16000000:raise ValueError("Invalid avatar")
        image.load()
        result=io.BytesIO();image.convert("RGBA").save(result,format="PNG")
        if result.tell()>MAX_AVATAR:raise ValueError("Avatar exceeds limit")
        return result.getvalue()

def avatar_url(value,default="/user.png"):
    if not value:return default
    try:
        if not isinstance(value,str) or len(value)>MAX_AVATAR*2:raise ValueError()
        if value.startswith("/") and not value.startswith("//") and "\\" not in value and not any(ord(c)<32 for c in value):return value
        if value.startswith("data:"):
            head,payload=value.split(",",1)
            if head.lower() not in {"data:image/"+x+";base64" for x in ("png","jpeg","gif","webp")}:raise ValueError()
            png=raster_png(base64.b64decode(payload,validate=True))
            return "data:image/png;base64,"+base64.b64encode(png).decode()
        return validate_target(value)
    except Exception:return default

async def oauth_avatar(url):
    try:
        response=await safe_fetch(url,max_bytes=MAX_AVATAR)
        if response.status!=200:raise ValueError()
        png=raster_png(response.body)
        return "data:image/png;base64,"+base64.b64encode(png).decode()
    except Exception:return "/user.png"

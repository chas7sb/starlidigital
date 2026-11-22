"""Bounded server-side HTTP fetches with DNS pinned at the connector boundary."""
import asyncio,ipaddress,socket
from dataclasses import dataclass
from urllib.parse import urlsplit,urljoin
from concurrent.futures import ThreadPoolExecutor
import aiohttp
from aiohttp.abc import AbstractResolver
from yarl import URL

MAX_BODY=5*1024*1024
MAX_REDIRECTS=4
AZURE_PLATFORM=ipaddress.ip_address("168.63.129.16")
TRANSLATION_NETS=tuple(ipaddress.ip_network(x) for x in ("64:ff9b::/96","64:ff9b:1::/48","2002::/16","2001::/32","fec0::/10"))
class SafeHTTPError(ValueError):
    pass

def safe_address(value,allow_private=False):
    try: address=ipaddress.ip_address(str(value))
    except ValueError:return False
    if getattr(address,"ipv4_mapped",None):return safe_address(address.ipv4_mapped,allow_private)
    if address==AZURE_PLATFORM:return False
    if address.version==6 and any(address in net for net in TRANSLATION_NETS):return False
    if address.is_loopback or address.is_private:
        return bool(allow_private and not address.is_link_local and not address.is_unspecified)
    return address.is_global and not address.is_multicast and not address.is_reserved

def canonical_url(value):
    if not isinstance(value,str) or not value or len(value)>8192:
        raise SafeHTTPError("Invalid HTTP URL")
    if any(ord(c)<=32 or ord(c)==127 for c in value) or "\\" in value:
        raise SafeHTTPError("Invalid HTTP URL")
    try:
        url=URL(value)
        if url.scheme not in ("http","https") or not url.host or url.user is not None or url.password is not None:
            raise SafeHTTPError("Invalid HTTP URL")
        if "%" in url.host or not 1<=url.port<=65535:
            raise SafeHTTPError("Invalid HTTP URL")
        return str(url.with_fragment(None))
    except (ValueError,TypeError):
        raise SafeHTTPError("Invalid HTTP URL") from None

def origin(value):
    u=URL(canonical_url(value))
    return (u.scheme,u.host,u.port)

def validate_target(value,allow_private=False):
    value=canonical_url(value)
    host=URL(value).host
    try:address=ipaddress.ip_address(host)
    except ValueError:return value
    if not safe_address(address,allow_private):
        raise SafeHTTPError("Blocked HTTP destination")
    return value

class PinnedResolver(AbstractResolver):
    def __init__(self,allow_private=False):self.allow_private=allow_private
    async def resolve(self,host,port=0,family=socket.AF_INET):
        try:
            infos=await asyncio.get_running_loop().getaddrinfo(host,port,type=socket.SOCK_STREAM)
        except (OSError,ValueError):
            raise SafeHTTPError("HTTP destination unavailable") from None
        rows=[]
        for fam,_,proto,_,addr in infos:
            if not safe_address(addr[0],self.allow_private):
                raise SafeHTTPError("Blocked HTTP destination")
            rows.append({"hostname":host,"host":addr[0],"port":addr[1] or port,"family":fam,"proto":proto,"flags":socket.AI_NUMERICHOST})
        if not rows:raise SafeHTTPError("HTTP destination unavailable")
        return rows
    async def close(self):pass

@dataclass
class SafeResponse:
    url:str
    status:int
    headers:dict
    body:bytes
    def text(self):
        content=self.headers.get("content-type","")
        encoding="utf-8"
        if "charset=" in content:
            candidate=content.split("charset=",1)[1].split(";",1)[0].strip().strip(chr(34)+chr(39))
            if candidate:encoding=candidate
        try:return self.body.decode(encoding,errors="replace")
        except LookupError:return self.body.decode("utf-8",errors="replace")

def request_headers(headers,credentials=False):
    allowed={"accept","accept-language","user-agent","range"}
    if credentials:allowed.update({"authorization","x-api-key","api-key","x-goog-api-key"})
    return {str(k):str(v) for k,v in (headers or {}).items() if str(k).lower() in allowed}

async def safe_fetch(url,*,headers=None,method="GET",max_bytes=MAX_BODY,timeout=20,follow_redirects=True,verify_tls=True,trusted_origin=None):
    if method not in ("GET","HEAD"):raise SafeHTTPError("HTTP method unavailable")
    if not isinstance(max_bytes,int) or not 1<=max_bytes<=50*1024*1024:raise SafeHTTPError("Invalid response limit")
    trusted=origin(trusted_origin) if trusted_origin else None
    current=canonical_url(url)
    async def fetch():
        nonlocal current
        for hop in range(MAX_REDIRECTS+1):
            # Only a server-configured provider origin can opt into its private service.
            privileged=trusted is not None and origin(current)==trusted
            target=validate_target(current,allow_private=privileged)
            connector=aiohttp.TCPConnector(resolver=PinnedResolver(privileged),use_dns_cache=False,ssl=verify_tls)
            async with aiohttp.ClientSession(connector=connector,cookie_jar=aiohttp.DummyCookieJar(),trust_env=False,timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.request(method,target,headers=request_headers(headers,credentials=privileged),allow_redirects=False) as response:
                    response_headers={k.lower():v for k,v in response.headers.items() if k.lower() not in ("set-cookie","content-encoding","transfer-encoding","connection")}
                    if response.status in (301,302,303,307,308) and response_headers.get("location") and follow_redirects:
                        if hop==MAX_REDIRECTS:raise SafeHTTPError("HTTP redirect limit exceeded")
                        current=canonical_url(urljoin(target,response_headers["location"]))
                        continue
                    chunks=[];size=0
                    async for chunk in response.content.iter_chunked(65536):
                        size+=len(chunk)
                        if size>max_bytes:raise SafeHTTPError("HTTP response exceeds limit")
                        chunks.append(chunk)
                    body=b"".join(chunks)
                    response_headers["content-length"]=str(len(body))
                    return SafeResponse(target,response.status,response_headers,body)
        raise SafeHTTPError("HTTP redirect limit exceeded")
    try:
        async with asyncio.timeout(timeout):
            return await fetch()
    except asyncio.CancelledError:raise
    except SafeHTTPError:raise
    except Exception:
        raise SafeHTTPError("HTTP fetch failed") from None

def safe_fetch_sync(url,**kwargs):
    try:asyncio.get_running_loop()
    except RuntimeError:return asyncio.run(safe_fetch(url,**kwargs))
    # Compatibility for sync callers; async entrypoints should use safe_fetch directly.
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(lambda:asyncio.run(safe_fetch(url,**kwargs))).result(timeout=25)

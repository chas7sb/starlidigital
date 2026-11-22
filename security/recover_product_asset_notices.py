"""Recover official notices for newly selected product fonts; never downloads fonts."""
import hashlib
import json
from pathlib import Path
import struct
import urllib.request

dest=Path('security/THIRD_PARTY_NOTICES/product')
dest.mkdir(parents=True,exist_ok=True)
sources=[('google/fonts','ofl/archivo/OFL.txt','Archivo-OFL.txt'),('google/fonts','ofl/instrumentserif/OFL.txt','InstrumentSerif-OFL.txt'),('google/fonts','ofl/inter/OFL.txt','Inter-OFL.txt'),('github/mona-sans','LICENSE','MonaSans-OFL.txt')]
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'StarliDigital-notice-audit'}),timeout=30) as r:return r.read()
records=[]
commits={}
for repo,source,name in sources:
    if repo not in commits:commits[repo]=json.loads(get(f'https://api.github.com/repos/{repo}/commits/main'))['sha']
    url=f'https://raw.githubusercontent.com/{repo}/{commits[repo]}/{source}'
    raw=get(url);(dest/name).write_bytes(raw)
    records.append({'path':name,'url':url,'sha256':hashlib.sha256(raw).hexdigest()})
fonts=[]
for path in sorted(Path('product/static/assets/fonts').iterdir()):
    raw=path.read_bytes();names={}
    if path.suffix=='.ttf':
        count=struct.unpack_from('>H',raw,4)[0]
        tables={}
        for i in range(count):
            tag,_,offset,size=struct.unpack_from('>4sIII',raw,12+16*i);tables[tag]=(offset,size)
        offset,_=tables[b'name'];_,count,storage=struct.unpack_from('>HHH',raw,offset)
        for i in range(count):
            platform,encoding,language,name,size,pos=struct.unpack_from('>HHHHHH',raw,offset+6+12*i)
            if name in {0,1,5,13,14}:
                value=raw[offset+storage+pos:offset+storage+pos+size].decode('utf-16-be' if platform in {0,3} else 'mac_roman',errors='replace')
                names.setdefault(str(name),[])
                if value not in names[str(name)]:names[str(name)].append(value)
    fonts.append({'path':path.as_posix(),'sha256':hashlib.sha256(raw).hexdigest(),'metadata':names})
(dest/'font-metadata.json').write_text(json.dumps(fonts,indent=2)+'\n',encoding='utf-8')
(dest/'retrieval-manifest.json').write_text(json.dumps(records,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'official_notices_recovered':len(records),'font_files_mapped':len(fonts)}))

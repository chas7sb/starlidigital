import argparse,hashlib,json,tarfile
from pathlib import Path
a=argparse.ArgumentParser();a.add_argument('--source',required=True);a.add_argument('--artifact',required=True);v=a.parse_args()
source=Path(v.source).resolve();artifact=Path(v.artifact).resolve()
if artifact==source or source in artifact.parents:raise SystemExit('EXTERNAL_ARTIFACT_REQUIRED')
files=sorted(x for x in source.rglob('*') if x.is_file() and x.name!='SHA256SUMS.txt' and '__pycache__' not in x.parts)
manifest=''.join(hashlib.sha256(x.read_bytes()).hexdigest()+'  '+str(x.relative_to(source))+'\n' for x in files)
(source/'SHA256SUMS.txt').write_text(manifest)
artifact.parent.mkdir(parents=True,exist_ok=True)
with tarfile.open(artifact,'w:gz') as t:
 for x in files+[source/'SHA256SUMS.txt']:t.add(x,arcname=str(x.relative_to(source)),recursive=False)
print(json.dumps({'manifestSha256':hashlib.sha256(manifest.encode()).hexdigest(),'files':len(files),'artifactSha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}))

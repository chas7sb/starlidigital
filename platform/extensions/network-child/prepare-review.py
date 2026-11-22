"""Create a fresh flat review bundle. Never runs the installer or enables profiles."""
import hashlib,json,sys
from pathlib import Path

FILES = ("broker.py","worker.py","client.py","cleanup.py","profile_setup.py",
         "build_manifest.py","install_reviewed.py","network.nft","starli-network-child.service")

def prepare(destination):
    source=Path(__file__).resolve().parent
    destination=Path(destination).absolute()
    if destination.exists():
        raise FileExistsError("Review destination must be fresh")
    content={}
    for name in FILES:
        path=source/name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Regular source file required: "+name)
        content[name]=path.read_bytes()
    destination.mkdir(parents=True)
    manifest={}
    for name,data in content.items():
        (destination/name).write_bytes(data)
        manifest[name]=hashlib.sha256(data).hexdigest()
    raw=(json.dumps(manifest,sort_keys=True,indent=2)+"\n").encode()
    (destination/"FILES.json").write_bytes(raw)
    return {"manifestSha256":hashlib.sha256(raw).hexdigest(),"files":len(manifest),
            "installed":False,"profilesActivated":False}

if __name__=="__main__":
    if len(sys.argv)!=2:
        raise SystemExit("Usage: python prepare-review.py NEW_REVIEW_DIRECTORY")
    print(json.dumps(prepare(sys.argv[1]),indent=2))

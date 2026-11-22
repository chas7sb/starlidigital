"""Read-only Linux guest prerequisites; no installation, activation or provider calls."""
import ctypes,json,os,platform,shutil
from pathlib import Path

def inspect():
    checks = {
        "linux_x86_64": platform.system() == "Linux" and platform.machine() == "x86_64",
        "root": hasattr(os, "geteuid") and os.geteuid() == 0,
        "cgroup_v2": Path("/sys/fs/cgroup/cgroup.controllers").is_file(),
        "systemd": Path("/run/systemd/system").is_dir(),
        "nft": shutil.which("nft") is not None,
        "iproute2": shutil.which("ip") is not None,
        "python3": Path("/usr/bin/python3").is_file(),
        "resolver": Path("/run/systemd/resolve/stub-resolv.conf").is_file(),
        "elf_loader": Path("/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2").is_file(),
    }
    abi = ctypes.CDLL(None,use_errno=True).syscall(444,0,0,1) if checks["linux_x86_64"] else -1
    checks["landlock_abi4"] = abi >= 4
    controllers = Path("/sys/fs/cgroup/cgroup.subtree_control")
    checks["controllers_enabled"] = controllers.is_file() and {"cpu","memory","pids"} <= set(controllers.read_text().split())
    return {"checks":checks,"landlockAbi":abi,"prerequisitesPassed":all(checks.values()),
            "isolationValidated":False,"profilesActivated":False}

if __name__ == "__main__":
    result=inspect()
    print(json.dumps(result,indent=2))
    raise SystemExit(0 if result["prerequisitesPassed"] else 1)

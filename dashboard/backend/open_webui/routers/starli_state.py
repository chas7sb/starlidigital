"""Paths for immutable runtime code and separate durable platform state."""
import starli_portable as _portable
import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[3]

def state_dir() -> Path:
    """Keep legacy preview state when explicitly configured; never default to dev workspaces."""
    configured = os.getenv("STARLI_STATE_DIR") or os.getenv("STARLI_TASK_HOME")
    return Path(configured) if configured else Path(os.getenv("DATA_DIR", str(PACKAGE_ROOT / "backend/data"))) / "starli"

def runtime_code_dir() -> Path:
    return Path(os.getenv("STARLI_RUNTIME_CODE_DIR", str(PACKAGE_ROOT / "scripts/starli-runtime")))

def source_database() -> str:
    return os.getenv("STARLI_SOURCE_DATABASE", str(Path(_portable.platform_root()) / "server/data/starli.sqlite"))

def bindings_path() -> str:
    return os.getenv("STARLI_BINDINGS_PATH") or os.getenv("STARLI_PREVIEW_BINDINGS", "")

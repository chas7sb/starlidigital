"""Load the dashboard's shared private-storage validator from trusted local code."""
import importlib.util
import os
from pathlib import Path


def private_storage():
    dashboard = Path(os.environ.get("STARLI_DASHBOARD_ROOT", Path(__file__).resolve().parents[3]/"dashboard"))
    helper = dashboard/"backend/starli_private_fs.py"
    if not helper.is_absolute() or not helper.is_file() or helper.is_symlink():
        raise RuntimeError("STARLI_PRIVATE_STORAGE_VALIDATOR_REQUIRED")
    spec = importlib.util.spec_from_file_location("starli_runtime_private_storage", helper)
    if spec is None or spec.loader is None:
        raise RuntimeError("STARLI_PRIVATE_STORAGE_VALIDATOR_REQUIRED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

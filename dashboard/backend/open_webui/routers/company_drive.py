import os
from pathlib import Path
from open_webui.config import DATA_DIR
from open_webui.env import DATABASE_URL
from open_webui.utils.auth import get_verified_user
from open_webui.company_drive import build_native_router

native_database=os.getenv("STARLI_COMPANY_NATIVE_DATABASE")
if not native_database:
    if not DATABASE_URL.startswith("sqlite:///") or DATABASE_URL[len("sqlite:///"):]==":memory:":
        raise ValueError("company Drive requires configured native SQLite path")
    native_database=DATABASE_URL[len("sqlite:///"):]
router=build_native_router(
    get_verified_user,
    os.getenv("STARLI_COMPANY_DATABASE") or Path(DATA_DIR)/"company-authority.sqlite3",
    Path(DATA_DIR)/"company-drive-blobs",
    native_database=native_database,
)

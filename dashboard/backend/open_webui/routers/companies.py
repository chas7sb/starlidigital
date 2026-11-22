from pathlib import Path
from open_webui.config import DATA_DIR
from open_webui.utils.auth import get_verified_user
from open_webui.company_authority.company_routes import build_router
# Native verified session supplies the actor. No new unauthenticated identity mechanism.
router = build_router(get_verified_user, str(Path(DATA_DIR) / 'company-authority.sqlite3'))

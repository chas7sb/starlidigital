import os
from pathlib import Path
from open_webui.config import DATA_DIR
from open_webui.utils.auth import get_verified_user
from open_webui.routers.starli_session_fence import capture_request_fence
from open_webui.routers import starli_v3_native as native
from open_webui.company_authority.pilot_routes import build_router
router=build_router(get_verified_user,capture_request_fence,native._mutation_guard,os.getenv('STARLI_COMPANY_DATABASE') or str(Path(DATA_DIR)/'company-authority.sqlite3'))

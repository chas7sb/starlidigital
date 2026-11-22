"""Idempotent native owner onboarding, entered only from a verified company switch."""
import json
from pathlib import Path
import os
from starlette.requests import Request

from . import Authority
from .pilot_onboarding import Pilot
from starli_memory.native_directory import request_service_factory


async def initialize_company_pilot(request, user, company, database):
    if not os.environ.get("STARLI_PILOT_OWNER_ID") or (
        user.id != os.environ["STARLI_PILOT_OWNER_ID"]
        or company != os.environ.get("STARLI_PILOT_COMPANY_ID")
    ):
        return
    from open_webui.routers.starli_session_fence import capture_request_fence
    from open_webui.routers.starli_v3_native import _mutation_guard
    from fastapi import HTTPException
    _mutation_guard(request)
    fence = capture_request_fence(request, user)
    actor = fence.check().id
    context = Request({**request.scope, "path_params": {"company": company}}, request.receive)
    session = await request.app.state.company_messaging_session(context, user)
    key = "starlidigital2-agata-computer-v1"
    pilot = Pilot(database)
    pilot.company(actor, key + ":company", company_id=company)
    with request_service_factory(database, database, Authority)() as directory:
        installed = directory.install(fence.check().id, "agata", "company", company, key + ":bot")
        bot = installed["bot"]["id"]
    pilot.admit_bot(fence.check().id, company, bot, key + ":admit")
    room = request.app.state.company_messaging.create(
        session, company, key + ":channel", "channel", "public", "Starli Computer", [], [bot]
    )
    fence.check()
    return {"companyId": company, "botId": bot, "roomId": room["id"]}

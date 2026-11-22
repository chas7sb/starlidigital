import asyncio
import socketio
import logging
import sys
import time
from redis import asyncio as aioredis

from open_webui.models.users import Users, UserNameResponse
from open_webui.models.channels import Channels
from open_webui.models.chats import Chats
from open_webui.utils.redis import (
    get_sentinels_from_env,
    get_sentinel_url_from_env,
)

from open_webui.env import (
    ENABLE_WEBSOCKET_SUPPORT,
    WEBSOCKET_MANAGER,
    WEBSOCKET_REDIS_URL,
    WEBSOCKET_REDIS_LOCK_TIMEOUT,
    WEBSOCKET_SENTINEL_PORT,
    WEBSOCKET_SENTINEL_HOSTS,
)
from open_webui.utils.auth import decode_token
from open_webui.socket.utils import RedisDict, RedisLock

from open_webui.env import (
    GLOBAL_LOG_LEVEL,
    SRC_LOG_LEVELS,
)


logging.basicConfig(stream=sys.stdout, level=GLOBAL_LOG_LEVEL)
log = logging.getLogger(__name__)
log.setLevel(SRC_LOG_LEVELS["SOCKET"])


if WEBSOCKET_MANAGER == "redis":
    if WEBSOCKET_SENTINEL_HOSTS:
        mgr = socketio.AsyncRedisManager(
            get_sentinel_url_from_env(
                WEBSOCKET_REDIS_URL, WEBSOCKET_SENTINEL_HOSTS, WEBSOCKET_SENTINEL_PORT
            )
        )
    else:
        mgr = socketio.AsyncRedisManager(WEBSOCKET_REDIS_URL)
    sio = socketio.AsyncServer(
        cors_allowed_origins=[],
        async_mode="asgi",
        transports=(["websocket"] if ENABLE_WEBSOCKET_SUPPORT else ["polling"]),
        allow_upgrades=ENABLE_WEBSOCKET_SUPPORT,
        always_connect=True,
        client_manager=mgr,
    )
else:
    sio = socketio.AsyncServer(
        cors_allowed_origins=[],
        async_mode="asgi",
        transports=(["websocket"] if ENABLE_WEBSOCKET_SUPPORT else ["polling"]),
        allow_upgrades=ENABLE_WEBSOCKET_SUPPORT,
        always_connect=True,
    )


# Timeout duration in seconds
TIMEOUT_DURATION = 3

# Dictionary to maintain the user pool

if WEBSOCKET_MANAGER == "redis":
    log.debug("Using Redis to manage websockets.")
    redis_sentinels = get_sentinels_from_env(
        WEBSOCKET_SENTINEL_HOSTS, WEBSOCKET_SENTINEL_PORT
    )
    SESSION_POOL = RedisDict(
        "open-webui:session_pool",
        redis_url=WEBSOCKET_REDIS_URL,
        redis_sentinels=redis_sentinels,
    )
    USER_POOL = RedisDict(
        "open-webui:user_pool",
        redis_url=WEBSOCKET_REDIS_URL,
        redis_sentinels=redis_sentinels,
    )
    USAGE_POOL = RedisDict(
        "open-webui:usage_pool",
        redis_url=WEBSOCKET_REDIS_URL,
        redis_sentinels=redis_sentinels,
    )

    clean_up_lock = RedisLock(
        redis_url=WEBSOCKET_REDIS_URL,
        lock_name="usage_cleanup_lock",
        timeout_secs=WEBSOCKET_REDIS_LOCK_TIMEOUT,
        redis_sentinels=redis_sentinels,
    )
    aquire_func = clean_up_lock.aquire_lock
    renew_func = clean_up_lock.renew_lock
    release_func = clean_up_lock.release_lock
else:
    SESSION_POOL = {}
    USER_POOL = {}
    USAGE_POOL = {}
    aquire_func = release_func = renew_func = lambda: True


async def periodic_usage_pool_cleanup():
    if not aquire_func():
        log.debug("Usage pool cleanup lock already exists. Not running it.")
        return
    log.debug("Running periodic_usage_pool_cleanup")
    try:
        while True:
            if not renew_func():
                log.error(f"Unable to renew cleanup lock. Exiting usage pool cleanup.")
                raise Exception("Unable to renew usage pool cleanup lock.")

            now = int(time.time())
            send_usage = False
            for model_id, connections in list(USAGE_POOL.items()):
                # Creating a list of sids to remove if they have timed out
                expired_sids = [
                    sid
                    for sid, details in connections.items()
                    if now - details["updated_at"] > TIMEOUT_DURATION
                ]

                for sid in expired_sids:
                    del connections[sid]

                if not connections:
                    log.debug(f"Cleaning up model {model_id} from usage pool")
                    del USAGE_POOL[model_id]
                else:
                    USAGE_POOL[model_id] = connections

                send_usage = True

            if send_usage:
                # Emit updated usage information after cleaning
                await sio.emit("usage", {"models": get_models_in_use()})

            await asyncio.sleep(TIMEOUT_DURATION)
    finally:
        release_func()


app = socketio.ASGIApp(
    sio,
    socketio_path="/ws/socket.io",
)


def get_models_in_use():
    # List models that are currently in use
    models_in_use = list(USAGE_POOL.keys())
    return models_in_use


@sio.on("usage")
async def usage(sid, data):
    session=SESSION_POOL.get(sid)
    if not session or not session_belongs_to_user(sid,session.get("id")):
        return
    model_id = data["model"]
    # Record the timestamp for the last update
    current_time = int(time.time())

    # Store the new usage data and task
    USAGE_POOL[model_id] = {
        **(USAGE_POOL[model_id] if model_id in USAGE_POOL else {}),
        sid: {"updated_at": current_time},
    }

    # Broadcast the usage data to all clients
    await sio.emit("usage", {"models": get_models_in_use()})


@sio.event
async def connect(sid, environ, auth):
    from open_webui.routers.starli_session_fence import authenticate_socket,ensure_socket_fence_loop
    try:
        user,fields=authenticate_socket(auth.get("token") if isinstance(auth,dict) else None)
    except Exception:return False
    SESSION_POOL[sid]={**user.model_dump(),**fields}
    USER_POOL[user.id]=list(dict.fromkeys([*(USER_POOL.get(user.id,[]) or []),sid]))
    ensure_socket_fence_loop()
    await sio.emit("user-list",{"user_ids":list(USER_POOL.keys())})
    await sio.emit("usage",{"models":get_models_in_use()})


@sio.on("user-join")
async def user_join(sid, data):

    from open_webui.routers.starli_session_fence import authenticate_socket,ensure_socket_fence_loop
    try:
        auth=data.get("auth") if isinstance(data,dict) else None
        user,fields=authenticate_socket(auth.get("token") if isinstance(auth,dict) else None)
    except Exception:
        await sio.disconnect(sid)
        return
    previous=SESSION_POOL.get(sid)
    if isinstance(previous,dict) and previous.get("id")!=user.id:
        old=previous.get("id")
        USER_POOL[old]=[value for value in (USER_POOL.get(old,[]) or []) if value!=sid]
    SESSION_POOL[sid]={**user.model_dump(),**fields}
    USER_POOL[user.id]=list(dict.fromkeys([*(USER_POOL.get(user.id,[]) or []),sid]))
    ensure_socket_fence_loop()

    # Join all the channels
    channels = Channels.get_channels_by_user_id(user.id)
    log.debug(f"{channels=}")
    for channel in channels:
        await sio.enter_room(sid, f"channel:{channel.id}")

    # print(f"user {user.name}({user.id}) connected with session ID {sid}")

    await sio.emit("user-list", {"user_ids": list(USER_POOL.keys())})
    return {"id": user.id, "name": user.name}


@sio.on("join-channels")
async def join_channel(sid, data):
    auth = data["auth"] if "auth" in data else None
    if not auth or "token" not in auth:
        return

    data = decode_token(auth["token"])
    if data is None or "id" not in data:
        return

    user = Users.get_user_by_id(data["id"])
    if not user or user.role not in ("user","admin"):
        return

    if not session_belongs_to_user(sid,user.id):return

    # Join all the channels
    channels = Channels.get_channels_by_user_id(user.id)
    log.debug(f"{channels=}")
    for channel in channels:
        await sio.enter_room(sid, f"channel:{channel.id}")


async def emit_channel_event(event,data,to=None,room=None,**kwargs):
    # Room membership is only a delivery index, never an authorization cache.
    from open_webui.utils.native_object_authorization import channel_access
    channel=Channels.get_channel_by_id(data.get("channel_id"))
    if channel is None:return
    participants=list(sio.manager.get_participants(namespace="/",room=f"channel:{channel.id}"))
    for target,_ in participants:
        session=SESSION_POOL.get(target)
        if not session:continue
        user=Users.get_user_by_id(session.get("id"))
        if user is None or user.role not in ("user","admin"):continue
        try:channel_access(user,channel,"read")
        except Exception:continue
        await sio.emit(event,data,to=target)


@sio.on("channel-events")
async def channel_events(sid, data):
    from open_webui.utils.native_object_authorization import channel_access,channel_message
    from open_webui.models.messages import Messages
    session=SESSION_POOL.get(sid)
    if not session or not session_belongs_to_user(sid,session.get("id")):return
    if not isinstance(data,dict) or not isinstance(data.get("data"),dict):return
    user=Users.get_user_by_id(session["id"])
    channel=Channels.get_channel_by_id(data.get("channel_id"))
    try:
        channel_access(user,channel,"write")
        if data.get("message_id"):channel_message(channel,Messages.get_message_by_id(data["message_id"]))
    except Exception:return
    if data["data"].get("type")=="typing":
        await emit_channel_event("channel-events",{
            "channel_id":channel.id,"message_id":data.get("message_id"),
            "data":{"type":"typing"},"user":UserNameResponse(**user.model_dump()).model_dump(),
        })


@sio.on("user-list")
async def user_list(sid):
    session=SESSION_POOL.get(sid)
    if not session or not session_belongs_to_user(sid,session.get("id")):
        return
    await sio.emit("user-list", {"user_ids": list(USER_POOL.keys())})


@sio.event
async def disconnect(sid):
    if sid in SESSION_POOL:
        user = SESSION_POOL[sid]
        del SESSION_POOL[sid]

        user_id = user["id"]
        USER_POOL[user_id] = [_sid for _sid in USER_POOL[user_id] if _sid != sid]

        if len(USER_POOL[user_id]) == 0:
            del USER_POOL[user_id]

        await sio.emit("user-list", {"user_ids": list(USER_POOL.keys())})
    else:
        pass
        # print(f"Unknown session ID {sid} disconnected")


def session_belongs_to_user(session_id,user_id):
    from open_webui.routers.starli_session_fence import check_socket_session
    if not isinstance(session_id,str) or not isinstance(user_id,str):return False
    return check_socket_session(SESSION_POOL.get(session_id),user_id)


def event_context_belongs_to_user(request_info):
    uid=request_info.get("user_id")
    user=Users.get_user_by_id(uid) if isinstance(uid,str) else None
    if user is None or user.role not in ("user","admin"):
        return False
    chat_id=request_info.get("chat_id")
    if chat_id and chat_id != "local":
        chat=Chats.get_chat_by_id(chat_id)
        if chat is None or chat.user_id != uid:
            return False
    return True

def get_event_emitter(request_info, update_db=True):
    async def __event_emitter__(event_data):
        if not event_context_belongs_to_user(request_info):
            return
        user_id = request_info["user_id"]

        session_ids = list(
            set(
                USER_POOL.get(user_id, [])
                + (
                    [request_info.get("session_id")]
                    if request_info.get("session_id")
                    else []
                )
            )
        )

        for session_id in session_ids:
            if not session_belongs_to_user(session_id,user_id):
                continue
            await sio.emit(
                "chat-events",
                {
                    "chat_id": request_info.get("chat_id", None),
                    "message_id": request_info.get("message_id", None),
                    "data": event_data,
                },
                to=session_id,
            )

        if update_db and request_info.get("chat_id") not in (None,"local"):
            if "type" in event_data and event_data["type"] == "status":
                Chats.add_message_status_to_chat_by_id_and_message_id(
                    request_info["chat_id"],
                    request_info["message_id"],
                    event_data.get("data", {}),
                )

            if "type" in event_data and event_data["type"] == "message":
                message = Chats.get_message_by_id_and_message_id(
                    request_info["chat_id"],
                    request_info["message_id"],
                )

                if message:
                    content = message.get("content", "")
                    content += event_data.get("data", {}).get("content", "")

                    Chats.upsert_message_to_chat_by_id_and_message_id(
                        request_info["chat_id"],
                        request_info["message_id"],
                        {
                            "content": content,
                        },
                    )

            if "type" in event_data and event_data["type"] == "replace":
                content = event_data.get("data", {}).get("content", "")

                Chats.upsert_message_to_chat_by_id_and_message_id(
                    request_info["chat_id"],
                    request_info["message_id"],
                    {
                        "content": content,
                    },
                )

    return __event_emitter__


def get_event_call(request_info):
    async def __event_caller__(event_data):
        if not event_context_belongs_to_user(request_info) or not session_belongs_to_user(request_info.get("session_id"),request_info.get("user_id")):
            return {"error":"Client session unavailable."}
        response = await sio.call(
            "chat-events",
            {
                "chat_id": request_info.get("chat_id", None),
                "message_id": request_info.get("message_id", None),
                "data": event_data,
            },
            to=request_info["session_id"],
        )
        return response

    return __event_caller__


get_event_caller = get_event_call


def get_user_id_from_session_pool(sid):
    user = SESSION_POOL.get(sid)
    if user:
        return user["id"]
    return None


def get_user_ids_from_room(room):
    active_session_ids = sio.manager.get_participants(
        namespace="/",
        room=room,
    )

    active_user_ids = list(
        set(
            [SESSION_POOL.get(session_id[0])["id"] for session_id in active_session_ids]
        )
    )
    return active_user_ids


def get_active_status_by_user_id(user_id):
    if user_id in USER_POOL:
        return True
    return False

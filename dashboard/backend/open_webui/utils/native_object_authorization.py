"""Native collaborative objects: container permission and authorship are separate."""
from fastapi import HTTPException
from open_webui.utils.access_control import has_access

def channel_access(user,channel,access="read"):
    if channel is None:raise HTTPException(404,"Channel unavailable")
    if user.role=="admin" or channel.user_id==user.id:return channel
    if not has_access(user.id,access,channel.access_control):raise HTTPException(403,"Channel unavailable")
    return channel

def channel_message(channel,message):
    if message is None or message.channel_id!=channel.id:raise HTTPException(404,"Message unavailable")
    return message

def message_author(user,channel,message):
    channel_message(channel,message)
    if user.role!="admin" and channel.user_id!=user.id and message.user_id!=user.id:
        raise HTTPException(403,"Message modification unavailable")

def folder_parent(user,folder_id,parent_id,folders):
    seen={folder_id}
    while parent_id:
        if parent_id in seen:raise HTTPException(400,"Invalid folder parent")
        seen.add(parent_id)
        parent=folders.get_folder_by_id_and_user_id(parent_id,user.id)
        if parent is None:raise HTTPException(404,"Folder unavailable")
        parent_id=parent.parent_id

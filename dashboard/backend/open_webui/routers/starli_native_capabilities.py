"""Read-only inventory of native Open WebUI features. No secret values."""
from fastapi import APIRouter, Depends, Request
from open_webui.routers.starli_platform import customer_principal as principal
from open_webui.utils.auth import get_verified_user

router = APIRouter()
UNVERIFIED = 'source-present; runtime not verified'
CONFIGURED_ONLY = 'enable-flag configured state only; not E2E verified'
SECRET_MARKERS = ('API_KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'CREDENTIAL')
FEATURES = (
    {'id': 'chat_history_folders_search', 'name': 'Chat, history, folders, and search', 'prefixes': ('/api/v1/chats', '/api/v1/folders'), 'flags': ()},
    {'id': 'attachments_rag_knowledge', 'name': 'Attachments, RAG, and knowledge', 'prefixes': ('/api/v1/files', '/api/v1/retrieval', '/api/v1/knowledge'), 'flags': ()},
    {'id': 'models_prompts_tools_functions', 'name': 'Models, prompts, tools, and functions', 'prefixes': ('/api/v1/models', '/api/v1/prompts', '/api/v1/tools', '/api/v1/functions'), 'flags': ()},
    {'id': 'web_search', 'name': 'Web search', 'prefixes': ('/api/v1/retrieval',), 'flags': ('ENABLE_WEB_SEARCH',)},
    {'id': 'audio_stt_tts', 'name': 'Audio, STT, and TTS', 'prefixes': ('/api/v1/audio',), 'flags': ()},
    {'id': 'image_generation', 'name': 'Image generation', 'prefixes': ('/api/v1/images',), 'flags': ('ENABLE_IMAGE_GENERATION',)},
    {'id': 'code_interpreter', 'name': 'Code interpreter', 'prefixes': ('/api/v1/utils',), 'flags': ('ENABLE_CODE_INTERPRETER',)},
    {'id': 'sharing_export', 'name': 'Sharing and export', 'prefixes': ('/api/v1/chats',), 'flags': ('ENABLE_COMMUNITY_SHARING', 'ENABLE_ADMIN_EXPORT')},
    {'id': 'users_groups_admin', 'name': 'Users, groups, and admin', 'prefixes': ('/api/v1/users', '/api/v1/groups'), 'flags': ()},
)

def _paths(app):
    return [getattr(route, 'path', '') or '' for route in getattr(app, 'routes', [])]

def _mounted(paths, prefix):
    return any(path == prefix or path.startswith(prefix + '/') for path in paths)

def _flag(config, name):
    if not hasattr(config, name):
        return None
    value = getattr(config, name)
    return value if isinstance(value, bool) else None

def inventory(app):
    config = getattr(getattr(app, 'state', None), 'config', None)
    paths = _paths(app)
    features = []
    for spec in FEATURES:
        present = all(_mounted(paths, prefix) for prefix in spec['prefixes'])
        flags = [_flag(config, name) for name in spec['flags']]
        if not spec['flags'] or any(flag is None for flag in flags):
            configured, verification = None, UNVERIFIED
        else:
            configured = all(flags)
            verification = CONFIGURED_ONLY
        if not present:
            configured, verification = None, 'route not mounted'
        features.append({'id': spec['id'], 'name': spec['name'], 'present': present, 'configured': configured, 'verification': verification})
    return {
        'features': features,
        'limitations': [
            'Mounted native routes show source presence only.',
            'A route does not mean an external API is configured.',
            'configured is true only when every listed enable flag is a clear boolean true.',
            'Secret, token, URL, and password values are not read or returned.',
            'Runtime providers are not probed.',
            'Access uses the existing starli_platform.principal administrator guard.',
        ],
    }

@router.get('')
def native_capabilities(request: Request, user=Depends(get_verified_user)):
    principal(user)
    body = inventory(request.app)
    return body

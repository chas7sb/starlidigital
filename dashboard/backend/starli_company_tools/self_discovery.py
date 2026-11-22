"""Read-only, native-bot self-discovery of the owner's enabled MCP catalog.

Tool execution remains behind explicit, one-turn, human-approved
AccountDelegation. Never loads or decrypts a saved credential.
"""
import json
from .core import ToolSpec, obj, require
from open_webui.starli_account_mcp.account_mcp.runtime import supported
from open_webui.starli_account_mcp.account_mcp.native import value as identity

def install(runtime, company_tools):
    require(getattr(runtime, 'company_mcp', None) is not None,
            'COMPANY_MCP_DELEGATION_MISSING', 503)

    def search(bound, args):
        bound.check()
        ctx, session = bound.context, bound.session
        require(getattr(session, 'kind', None) == 'jwt'
                and session.user_id == ctx.actor_id
                and session.revalidate() is True,
                'COMPANY_MCP_NATIVE_JWT_REQUIRED')
        # Private owner+bot direct messages only. No account connector metadata
        # disclosed to another person in group rooms without explicit sharing.
        require(ctx.visibility == 'private'
                and len(ctx.audience) == 1
                and ctx.audience[0][0] == ctx.actor_id,
                'COMPANY_MCP_PRIVATE_ROOM_REQUIRED')
        for who in (ctx.actor_id, ctx.bot_id):
            runtime.authority.require_member(
                who, ctx.company_id, permission='tools.dispatch')
            runtime.authority.require_member(
                who, ctx.company_id, permission='integrations.run')

        delegation = runtime.company_mcp
        user = delegation.service.user_lookup(ctx.actor_id)
        require(user is not None and identity(user, 'id') == ctx.actor_id,
                'COMPANY_MCP_ACCOUNT_DENIED')

        class SessionFence:
            kind = 'jwt'
            def check(self):
                require(session.revalidate() is True,
                        'COMPANY_MCP_NATIVE_JWT_REQUIRED')
                bound.check()
                return user

        reg = delegation.service.registry_for(user, SessionFence())
        query = args.get('query', '').casefold().strip()
        offset = args.get('offset', 0)
        limit = args.get('limit', 10)
        with_schema = args.get('includeSchema', False)
        if with_schema:
            limit = min(limit, 5)
        matches = []
        total_matches = 0
        count = 0
        cursor = ''
        server_count = 0
        while True:
            page = reg.list(ctx.actor_id, after=cursor, limit=50)
            for server in page['items']:
                if not server['enabled']:
                    continue
                server_count += 1
                require(server_count <= 20, 'COMPANY_MCP_CATALOG_LIMIT', 413)
                with reg.db() as db:
                    row = reg.getrow(db, ctx.actor_id, server['id'])
                    catalog = json.loads(row['tools'])
                require(type(catalog) is list and len(catalog) <= 200,
                        'COMPANY_MCP_CATALOG_LIMIT', 413)
                for tool in catalog:
                    if not isinstance(tool, dict) or not supported(tool.get('inputSchema')):
                        continue
                    count += 1
                    require(count <= 1000, 'COMPANY_MCP_CATALOG_LIMIT', 413)
                    name = tool.get('name')
                    description = tool.get('description', '')
                    if not isinstance(name, str) or not isinstance(description, str):
                        continue
                    if query not in (name + ' ' + description).casefold():
                        continue
                    total_matches += 1
                    if len(matches) >= offset + limit + 1:
                        continue
                    item = {
                        'server': server['name'][:100],
                        'name': name[:128],
                        'publicName': tool['publicName'],
                        'description': description[:500],
                        'accountMcpRef': {
                            'serverId': server['id'],
                            'expectedRevision': server['revision'],
                            'toolName': tool['publicName']
                        },
                        'ownerApprovalRequired': True,
                        'executableInThisTurn': False,
                        'untrustedRemoteMetadata': True
                    }
                    if with_schema:
                        item['inputSchema'] = tool['inputSchema']
                    matches.append(item)
            if not page['hasMore']:
                break
            require(page['cursor'] > cursor,
                    'COMPANY_MCP_CURSOR_INVALID', 503)
            cursor = page['cursor']

        # Avoid confirming a stale/changed room after data has been accessed.
        from company_messaging.context import revalidate
        revalidate(runtime.store, session, ctx)
        bound.check()
        reg.auth(ctx.actor_id)
        return {
            'version': 'starli.company-mcp-self-discovery.v1',
            'companyId': ctx.company_id,
            'botId': ctx.bot_id,
            'conversationId': ctx.room_id,
            'query': query,
            'totalMatching': total_matches,
            'returned': matches[offset:offset+limit],
            'hasMore': len(matches) > offset + limit,
            'nextOffset': offset + limit if len(matches) > offset + limit else None,
            'execution': 'NOT_GRANTED',
            'nextAction': (
                'Ask the requesting human to open Chat actions -> Bot tools, '
                'find the exact MCP tool by name, choose Allow for next task, '
                'then submit a NEW turn. This catalog search never executes MCP tools.'
            ),
        }

    spec = ToolSpec(
        'company_mcp_search',
        'Search the currently enabled StarliDigital MCP tools yourself by name or purpose. '
        'Use this native read-only tool instead of the Automations connector catalog when '
        'the user requests MCP. You will discover real remote tool names and schemas, '
        'but tool execution requires the human owner to choose Allow for next task in '
        'Chat actions > Bot tools. Never claim tools were invoked just because found.',
        obj({
            'query': {'type': 'string', 'maxLength': 120},
            'offset': {'type': 'integer', 'minimum': 0, 'maximum': 1000},
            'limit': {'type': 'integer', 'minimum': 1, 'maximum': 20},
            'includeSchema': {'type': 'boolean'}
        }, []),
        'read', 'native-account-mcp-self-discovery', search,
        permission='integrations.run')
    company_tools.register(spec)
    return spec

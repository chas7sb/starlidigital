"""Additional company fence for Customer API v3; old personal grants unchanged.

This policy NEVER mints a grant from an input company/chat/agent ID. Stored token
scopes must be issued by an authenticated human and passed by the v3 verifier.
"""
from dataclasses import dataclass
from .authority import require, Member


@dataclass(frozen=True)
class CompanyGrant:
    company_id:str
    user_id:str
    membership_id:str
    join_epoch:int
    agents:tuple[str,...]
    chats:tuple[str,...]


OPERATIONS=frozenset(('chat.read','chat.send','chat.events','run.read','run.stop'))


def authorize(authority, grant, operation, agent_id, chat_id, resolve_chat):
    require(isinstance(grant,CompanyGrant) and operation in OPERATIONS,403,'TOKEN_OPERATION_DENIED')
    require(agent_id in grant.agents and chat_id in grant.chats,403,'TOKEN_SCOPE_DENIED')
    member=authority.require_member(grant.user_id,grant.company_id)
    require(isinstance(member,Member) and member.company_id==grant.company_id and member.user_id==grant.user_id
            and member.membership_id==grant.membership_id and member.join_epoch==grant.join_epoch,403,'TOKEN_MEMBERSHIP_CHANGED')
    authority.require_agent(member,agent_id)
    # Resolver must read authoritative existing company-agent conversation
    # binding and its fresh visibility ACL; a caller-provided ID is not evidence.
    chat=resolve_chat(member,agent_id,chat_id)
    require(isinstance(chat,dict) and chat.get('id')==chat_id and chat.get('companyId')==grant.company_id
            and chat.get('agentId')==agent_id and chat.get('visible') is True,403,'TOKEN_CHAT_DENIED')
    return member

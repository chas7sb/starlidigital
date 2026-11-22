"""Reviewed capabilities only. Listed does not mean provider authentication works."""
import copy
from .common import need, exact, text

DEFINITIONS = {
 'slack': ('Slack', 'oauth2', {'slack.channels.list':('read',['channels:read']), 'slack.approval.notify':('write',['chat:write']), 'slack.message.send':('write',['chat:write'])}, ['slack.message.received']),
 'shopify': ('Shopify', 'oauth2', {'orders.get':('read',['read_orders']), 'orders.refund':('write',['write_orders'])}, ['refund_request.received']),
 'woocommerce': ('WooCommerce', 'oauth1_setup', {'orders.get':('read',['read']), 'orders.refund':('write',['write'])}, ['refund_request.received']),
 'gmail': ('Gmail', 'oauth2', {'mail.messages.list':('read',['https://www.googleapis.com/auth/gmail.readonly']), 'mail.send':('write',['https://www.googleapis.com/auth/gmail.send'])}, ['mail.received']),
 'google-calendar': ('Google Calendar', 'oauth2', {'calendar.events.list':('read',['https://www.googleapis.com/auth/calendar.events.readonly']), 'calendar.events.create':('write',['https://www.googleapis.com/auth/calendar.events'])}, ['calendar.event.changed']),
 'google-drive': ('Google Drive', 'oauth2', {'files.search':('read',['https://www.googleapis.com/auth/drive.metadata.readonly'])}, ['file.changed']),
 'hubspot': ('HubSpot', 'oauth2', {'crm.contacts.list':('read',['crm.objects.contacts.read']), 'crm.contacts.create':('write',['crm.objects.contacts.write'])}, ['crm.contact.changed']),
 'zendesk': ('Zendesk', 'oauth2', {'support.ticket.create':('write',['tickets:write']), 'support.ticket.get':('read',['tickets:read'])}, ['support.ticket.created']),
 'github': ('GitHub', 'oauth2', {'repository.issues.list':('read',['repo']), 'repository.issue.create':('write',['repo'])}, ['repository.issue.opened']),
}
ORDER = ('slack','shopify','gmail','google-calendar','google-drive','hubspot','zendesk','github','woocommerce')
CONFIG_KEYS = {'requestSource','orderPlatform','ticketPlatform','notifySlack','approverId','slackChannelId'}

def catalog(ready=lambda p: False):
    return [dict(id=p, displayName=DEFINITIONS[p][0], authenticationType=DEFINITIONS[p][1],
                 capabilities=[dict(id=k,effect=v[0],requiredScopes=v[1]) for k,v in DEFINITIONS[p][2].items()],
                 triggers=DEFINITIONS[p][3], status='AVAILABLE' if ready(p) else 'REQUIRES_CONNECTION',
                 setupRequirements=[dict(id='oauth',kind='connection',providerId=p)]) for p in ORDER]

def validate_configuration(value):
    need(type(value) is dict and set(value) <= CONFIG_KEYS, 'INVALID_CONFIGURATION', 422)
    for key,item in value.items():
        if key=='notifySlack': need(type(item) is bool, 'INVALID_CONFIGURATION', 422)
        else: text(item,200)
    choices={'requestSource':{'starli','gmail','shopify','woocommerce'},'orderPlatform':{'shopify','woocommerce'},'ticketPlatform':{'zendesk','hubspot'}}
    for key,allowed in choices.items():
        if key in value: need(value[key] in allowed,'UNSUPPORTED_CAPABILITY',422)
    return copy.deepcopy(value)

def missing(configuration, connected):
    if configuration.get('__kind')=='internal_approval_test':
        return [] if configuration.get('approverId') else [dict(id='approverId',kind='question',question='Who should approve this internal test receipt?',options=[])]
    questions=[('requestSource','Where do refund requests arrive?',[('starli','StarliDigital'),('gmail','Gmail'),('shopify','Shopify'),('woocommerce','WooCommerce')]),
               ('orderPlatform','Which platform manages your orders?',[('shopify','Shopify'),('woocommerce','WooCommerce')]),
               ('ticketPlatform','Where should support tickets be created?',[('zendesk','Zendesk'),('hubspot','HubSpot')])]
    result=[dict(id=k,kind='question',question=q,options=[dict(value=v,label=l) for v,l in options]) for k,q,options in questions if k not in configuration]
    if 'approverId' not in configuration: result.append(dict(id='approverId',kind='question',question='Who should approve each exact refund or ticket?',options=[]))
    if 'notifySlack' not in configuration: result.append(dict(id='notifySlack',kind='question',question='Also notify Slack?',options=[dict(value='true',label='Yes'),dict(value='false',label='No')]))
    if configuration.get('notifySlack') and not configuration.get('slackChannelId'): result.append(dict(id='slackChannelId',kind='question',question='Which Slack channel should receive approval notifications?',options=[]))
    for provider in required_providers(configuration):
        if not connected(provider):
            scopes=workflow_scopes(configuration,provider)
            result.append(dict(id='connect:'+provider,kind='connection',providerId=provider,requestedScopes=scopes))
    return result

def required_providers(configuration):
    if configuration.get('__kind')=='internal_approval_test':return []
    result={configuration[k] for k in ('requestSource','orderPlatform','ticketPlatform') if configuration.get(k) and configuration[k]!='starli'}
    if configuration.get('notifySlack'): result.add('slack')
    return sorted(result)

def workflow_scopes(configuration,provider):
    if provider=='slack':return ['chat:write']
    if provider=='shopify':return ['read_orders','write_orders']
    if provider=='zendesk':return ['tickets:read','tickets:write']
    if provider=='gmail':return ['https://www.googleapis.com/auth/gmail.readonly']
    return sorted({scope for _,scopes in DEFINITIONS[provider][2].values() for scope in scopes})

def summary(configuration):
    if configuration.get('__kind')=='internal_approval_test':
        return dict(trigger='Controlled internal test request',actions=['Run the internal processing check','Ask the assigned human in this conversation','Save a verified internal test receipt; no external action'],approvalRequired=True)
    return dict(trigger='Incoming refund request', actions=['Look up the exact order','Ask the assigned human in StarliDigital'+(' and Slack' if configuration.get('notifySlack') else ''),'Refund the approved amount or create a support ticket','Verify and save the provider receipt'], approvalRequired=True)

def compile_ir(configuration):
    if configuration.get('__kind')=='internal_approval_test':
        return dict(kind='internal_approval_test',trigger={'capability':'starli.internal_test.requested','provider':'starli'},steps=[{'id':'approval','capability':'starli.approvals.request','approverId':configuration['approverId']},{'id':'receipt','capability':'starli.internal_test.receipt'}],configuration=copy.deepcopy(configuration))
    validate_configuration(configuration)
    return dict(kind='refund_request',trigger={'capability':'refund_request.received','provider':configuration['requestSource']},
                steps=[{'id':'lookup','capability':'orders.get','provider':configuration['orderPlatform']},
                       {'id':'approval','capability':'starli.approvals.request','approverId':configuration['approverId']},
                       {'id':'decision','type':'branch','branches':{'refund':'orders.refund','ticket':'support.ticket.create'}}],configuration=copy.deepcopy(configuration))

def discover(intent):
    """Bounded intent/capability matching over reviewed definitions only."""
    text(intent,1000);query=intent.casefold()
    terms={'slack':('slack','approval','approve','notify'),'shopify':('shopify','order','refund'),
           'woocommerce':('woocommerce','order','refund'),'gmail':('gmail','email','inbox'),
           'google-calendar':('calendar','meeting','appointment'),'google-drive':('drive','file','document'),
           'hubspot':('hubspot','crm','contact'),'zendesk':('zendesk','ticket','support'),'github':('github','repository','issue')}
    return [p for p in ORDER if any(word in query for word in terms[p])]

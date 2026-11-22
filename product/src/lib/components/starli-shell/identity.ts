import { writable } from 'svelte/store';
import { botChatPath,chatIdFromPath } from '$lib/utils/starli-chat-url';
export const portraits = ['Assistant','Developer','Marketing','Business','Analyst','Creator','Support','Automation','Designer'];
export function portraitIndex(agent: any) {
 const preset = /^p([0-8])$/.exec(agent?.avatarShape || '');
 if (preset) return Number(preset[1]);
 const role = String(agent?.role || '')+' '+String(agent?.name || '');
 const match = [/assistant|general/i,/develop|engineer|code/i,/market/i,/business|sales/i,/analy/i,/content|creat/i,/support/i,/automat/i,/design/i].findIndex(re=>re.test(role));
 if(match>=0)return match;
 return Array.from(String(agent?.id || '')).reduce((sum,c)=> (sum*31+c.charCodeAt(0))>>>0,0)%9;
}
export const avatarVersions = writable<Record<string,string>>({});
export const registryReady = writable<'loading'|'ready'|'error'>('loading');
export const artPosition = (index:number) => ((index%3)*50)+'% '+(Math.floor(index/3)*50)+'%';
export const nativePath = (agent:any) => agent.chatId ? botChatPath(agent.name,agent.chatId) : '/?starli='+encodeURIComponent(agent.id);
export type WindowItem = {key:string;path:string;name:string;min:boolean;full:boolean;agentId?:string;groupId?:string};
export function safeWindow(value:any):value is WindowItem {
 if(!value||typeof value.name!=='string'||typeof value.key!=='string'||typeof value.path!=='string')return false;
 return !!chatIdFromPath(value.path)&&/^\/[a-z0-9/-]+$/i.test(value.path)||/^\/\?starli=[a-zA-Z0-9_%.-]+$/.test(value.path)||!!value.groupId&&value.path==='/starli/groups?group='+encodeURIComponent(value.groupId);
}
export const navItems = [
 ['home','Home','/'],['chat','Chat','chats'],['agents','Agents','agents'],['projects','Projects','/starli/projects'],
 ['automations','Automations','automations'],['integrations','Integrations','integrations'],['billing','Billing','/starli/billing']
];
export const extraItems = [['account','Company','/starli/company'],['groups','CRM','/starli/crm'],['chat','Mailbox','/starli/mailbox'],['globe','Social media','/starli/social'],['book','Knowledge','/workspace/knowledge'],['globe','Browser','/starli/browser'],['tasks','Action reviews','/starli/approvals'],['settings','Tools','/starli/tools'],['files','Proposals','/starli/proposals'],['agents','Hosted agents','/starli/hosted-agents'],['computer','Video studio','/starli/videos'],['layers','Activity','/starli/activity'],['book','Documentation','/docs']];
export async function jsonApi(path:string,signal:AbortSignal,options:RequestInit={}) {
 const token=localStorage.token;
 const response=await fetch(path,{...options,signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,...options.headers}});
 if(signal.aborted||token!==localStorage.token)throw new DOMException('Session changed','AbortError');
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Service unavailable ('+response.status+').');
 const data=await response.json();
 if(signal.aborted||token!==localStorage.token)throw new DOMException('Session changed','AbortError');
 return data;
}

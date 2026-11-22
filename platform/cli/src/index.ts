import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync,renameSync,unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { stdin,stdout } from 'node:process';
import { createClient } from 'graphql-ws';
import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import {runOperatorChat} from './operator-chat.js';

export type CliConfig = {
  apiUrl: string;
  operatorToken?: string;
  activeConversationId?: string;
  activeJobId?: string;
  activeTaskId?: string;
  pendingTaskIds?:string[];
  taskCursors?:Record<string,number>;
  renderedTaskIds?:string[];
  pendingStarts?:Record<string,{text:string;conversationId?:string;createdAt:string}>;
  draftPrompt?:{text:string;conversationId?:string;createdAt:string;requestId?:string;error?:string};
  updatedAt?: string;
};

export function defaultConfigPath(): string {
  if (process.env.STARLI_OPERATOR_CONFIG) return process.env.STARLI_OPERATOR_CONFIG;
  return join(homedir(), '.config', 'starli-operator', 'config.json');
}

export function loadCliConfig(configPath = defaultConfigPath()): CliConfig {
  const apiUrl = (process.env.STARLI_API_URL || 'https://api.starlidigital.ro').replace(/\/$/, '');
  const envToken = process.env.STARLI_OPERATOR_TOKEN;
  if (!existsSync(configPath)) {
    return { apiUrl, operatorToken: envToken };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<CliConfig>;
    // Security guard: never load or retain admin passwords or provider API keys in CLI config
    return {
      apiUrl: (process.env.STARLI_API_URL || raw.apiUrl || apiUrl).replace(/\/$/, ''),
      operatorToken: envToken || raw.operatorToken,
      activeConversationId: raw.activeConversationId,
      activeJobId: raw.activeJobId,
      activeTaskId: raw.activeTaskId,
      pendingTaskIds:Array.isArray(raw.pendingTaskIds)?raw.pendingTaskIds.filter(v=>typeof v==='string').slice(-100):undefined,
      taskCursors:raw.taskCursors&&typeof raw.taskCursors==='object'?Object.fromEntries(Object.entries(raw.taskCursors).filter(([key,value])=>typeof key==='string'&&Number.isSafeInteger(value)&&value>=0).slice(-100)):undefined,
      renderedTaskIds:Array.isArray(raw.renderedTaskIds)?raw.renderedTaskIds.filter(v=>typeof v==='string').slice(-100):undefined,
      pendingStarts:raw.pendingStarts&&typeof raw.pendingStarts==='object'?Object.fromEntries(Object.entries(raw.pendingStarts).filter(([key,value])=>typeof key==='string'&&value&&typeof value.text==='string'&&value.text.length<=8000).slice(-100)):undefined,
      draftPrompt:raw.draftPrompt&&typeof raw.draftPrompt.text==='string'&&raw.draftPrompt.text.length<=8000?raw.draftPrompt:undefined,
      updatedAt: raw.updatedAt
    };
  } catch {
    return { apiUrl, operatorToken: envToken };
  }
}

export function saveCliConfig(config: CliConfig, configPath = defaultConfigPath()): void {
  const dir = dirname(configPath);
  mkdirSync(dir, { recursive: true });
  const sanitized: CliConfig = {
    apiUrl: config.apiUrl.replace(/\/$/, ''),
    operatorToken: config.operatorToken,
    activeConversationId: config.activeConversationId,
    activeJobId: config.activeJobId,
    activeTaskId: config.activeTaskId,
    pendingTaskIds:config.pendingTaskIds,
    taskCursors:config.taskCursors,
    renderedTaskIds:config.renderedTaskIds,
    pendingStarts:config.pendingStarts,
    draftPrompt:config.draftPrompt,
    updatedAt: new Date().toISOString()
  };
  const temporary=configPath+'.'+process.pid+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temporary,JSON.stringify(sanitized,null,2),{encoding:'utf8',mode:0o600});renameSync(temporary,configPath);}finally{if(existsSync(temporary))unlinkSync(temporary);}
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Ignore chmod on Windows
  }
}

export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
  json: boolean;
};

export function parseCliArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > 0) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        if(['json','new','help','reconnect','plain'].includes(key)){flags[key]=true;continue;}
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(token);
    }
  }
  return {
    positionals,
    flags,
    json: Boolean(flags.json)
  };
}

export async function operatorGraphql<T = any>(
  config: CliConfig,
  query: string,
  variables?: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  if (!config.operatorToken) {
    throw new Error('Tokenul de operator lipsește. Autentifică-te cu: starli auth token <starli_op_...> sau setează STARLI_OPERATOR_TOKEN.');
  }
  const endpoint = `${config.apiUrl.replace(/\/$/, '')}/graphql`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.operatorToken}`,
      'x-starli-operator-token': config.operatorToken
    },
    body: JSON.stringify({ query, variables }),signal:AbortSignal.timeout(120000)
  });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string;extensions?:{code?:string} }> };
  if (!response.ok || payload.errors?.length) {
    throw Object.assign(new Error(payload.errors?.[0]?.message || `Eroare HTTP ${response.status}`),{code:payload.errors?.[0]?.extensions?.code,httpStatus:response.status});
  }
  if (!payload.data) {
    throw new Error('Răspuns GraphQL gol de la platformă.');
  }
  return payload.data;
}

export function subscribeOperatorEvents(config:CliConfig,conversationId:string|undefined,onEvent:(event:any)=>void):()=>void{
 const client=createClient({url:config.apiUrl.replace(/^http/i,'ws').replace(/\/$/,'')+'/graphql',webSocketImpl:WebSocket,connectionParams:{authorization:config.operatorToken?`Bearer ${config.operatorToken}`:undefined},retryAttempts:5});
 const seen=new Map<string,string>();const sink=(field:string)=>({next:(result:any)=>{const value=result.data?.[field];if(field==='operatorJobsUpdated'){for(const job of value||[]){const state=job.status+job.updatedAt;if(seen.get(job.id)===state)continue;seen.set(job.id,state);onEvent({type:'JOB_UPDATED',jobId:job.id,message:job.kind+': '+job.status});}}else if(value?.agentStatus)onEvent({type:'TOOL_ACTIVITY',conversationId:value.id,message:value.agentStatus});},error:()=>onEvent({type:'ERROR',message:'Actualizările live nu sunt disponibile. Verifică autentificarea și permisiunile operatorului.'}),complete:()=>{}});
 const stops=[client.subscribe({query:'subscription{operatorJobsUpdated{id kind status updatedAt}}'},sink('operatorJobsUpdated'))];
 if(conversationId)stops.push(client.subscribe({query:'subscription($id:ID!){operatorConversationUpdated(id:$id){id agentStatus updatedAt}}',variables:{id:conversationId}},sink('operatorConversationUpdated')));
 return()=>{for(const stop of stops)stop();void client.dispose();};
}

function formatProgressivePrint(text: string): void {
  stdout.write(`${text}\n`);
}

export async function executeCliCommand(
  argv: string[],
  options: {
    configPath?: string;
    fetchImpl?: typeof fetch;
    output?: (text: string) => void;
  } = {}
): Promise<any> {
  const parsed = parseCliArgs(argv);
  const configPath = options.configPath || defaultConfigPath();
  const config = loadCliConfig(configPath);
  if (typeof parsed.flags.api === 'string') {
    config.apiUrl = parsed.flags.api.replace(/\/$/, '');
  }
  if (typeof parsed.flags.token === 'string') {
    config.operatorToken = parsed.flags.token.trim();
  }
  const fetchImpl = options.fetchImpl || fetch;
  const out = options.output || formatProgressivePrint;
  const [group = 'help', subcommand = 'list', ...rest] = parsed.positionals;

  const emit = (data: any, humanSummary: string) => {
    if (parsed.json) {
      out(JSON.stringify(data, null, 2));
    } else {
      out(humanSummary);
    }
    return data;
  };

  if (group === 'help' || parsed.flags.help) {
    const helpData = {
      binary: 'starli',
      description: 'STARLI OPERATOR — Agent global de administrare în linia de comandă (Ubuntu / screen / tmux)',
      commands: [
        'starli auth token <starli_op_...> [--api https://api.starlidigital.ro]',
        'starli auth status [--json]',
        'starli auth issue --label "Ubuntu CLI" [--days 30] [--json]',
        'starli auth revoke <tokenId> [--json]',
        'starli status [--json]',
        'starli chat [mesaj] [--new] [--conversation <id>] [--reconnect] [--plain] [--json]',
        'În chat: /help /new /sessions /use <id> /history /tasks /status /stop /resume /paste … /end /exit',
        'starli stop [taskId] [--json] — oprește sarcina curentă',
        'starli conversations [list|inspect <id> --reason <motiv>] [--json]',
        'starli projects [list|inspect <id>|explain-error <id>|create --name <n> --domain <d>] [--json]',
        'starli leads [list|add --name <n> --locality <l> --phone <p> --email <e>] [--json]',
        'starli proposals [list|create --lead <id> --summary <cerere>|build <id>|invite <id>|revoke-claim <id>] [--json]',
        'starli devices [list|pair --label <n>|revoke <id>|exec --device <id> --tool <t>|powershell --device <id> --command <c> --reason <m>] [--json]',
        'starli jobs [list|inspect <id>|approve <id>|cancel <id>] [--json]',
        'starli messages [list|prepare --proposal <id>|approve <id>|send <id>] [--json]',
        'starli changes [list|stage --title <t> --path <p> --content <c>|approve <id>|rollback <id>] [--json]'
      ]
    };
    return emit(
      helpData,
      [
        '╔══════════════════════════════════════════════════════════════════╗',
        '║ STARLI OPERATOR — Agent Global de Administrare (Ubuntu CLI)      ║',
        '╚══════════════════════════════════════════════════════════════════╝',
        ...helpData.commands.map((c) => `  • ${c}`)
      ].join('\n')
    );
  }

  // 1. AUTH COMMANDS
  if (group === 'auth') {
    if (subcommand === 'token' || subcommand === 'login-token') {
      const rawToken = rest[0] || (typeof parsed.flags.value === 'string' ? parsed.flags.value : '');
      if (!rawToken || !rawToken.startsWith('starli_op_')) {
        throw new Error('Furnizează un token valid de operator (începe cu starli_op_). Parola administratorului nu se stochează în CLI.');
      }
      config.operatorToken = rawToken.trim();
      const verification = await operatorGraphql(
        config,
        `{ me { id email username role } operatorTokens { id label tokenPrefix permissions expiresAt revokedAt } }`,
        undefined,
        fetchImpl
      );
      if (!verification.me || verification.me.role !== 'ADMIN') {
        throw new Error('Tokenul nu aparține unui cont cu rol ADMIN activ.');
      }
      saveCliConfig(config, configPath);
      return emit(
        { authenticated: true, user: verification.me, apiUrl: config.apiUrl },
        `Autentificare operator reușită pentru ${verification.me.email} (${verification.me.role}) pe ${config.apiUrl}.`
      );
    }
    if (subcommand === 'status') {
      const data = await operatorGraphql(
        config,
        `{ me { id email username role } operatorTokens { id label tokenPrefix permissions expiresAt lastUsedAt revokedAt } }`,
        undefined,
        fetchImpl
      );
      return emit(
        {
          authenticated: Boolean(data.me),
          user: data.me,
          activeConversationId: config.activeConversationId || null,
          activeJobId: config.activeJobId || null,
          tokens: data.operatorTokens
        },
        `Operator autentificat: ${data.me?.email || 'N/A'} (${data.me?.role || 'N/A'}) | Tokenuri emise: ${data.operatorTokens?.length || 0} | Conversație activă: ${config.activeConversationId || 'niciuna'}`
      );
    }
    if (subcommand === 'issue') {
      const label = typeof parsed.flags.label === 'string' ? parsed.flags.label : rest[0] || 'Ubuntu CLI Token';
      const days = Number(parsed.flags.days || 30);
      const perms = typeof parsed.flags.permissions === 'string' ? parsed.flags.permissions.split(',') : undefined;
      const data = await operatorGraphql(
        config,
        `mutation($label:String!,$permissions:[String!],$expiresInDays:Int){issueOperatorToken(label:$label,permissions:$permissions,expiresInDays:$expiresInDays){token record{id label tokenPrefix permissions expiresAt createdAt}}}`,
        { label, permissions: perms, expiresInDays: days },
        fetchImpl
      );
      return emit(
        data.issueOperatorToken,
        `Token emis: ${data.issueOperatorToken.record.label} (${data.issueOperatorToken.record.id})\nSecret (salvează acum, nu va mai fi afișat): ${data.issueOperatorToken.token}`
      );
    }
    if (subcommand === 'revoke') {
      const tokenId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($id:ID!){revokeOperatorToken(id:$id){id label revokedAt}}`,
        { id: tokenId },
        fetchImpl
      );
      return emit(data.revokeOperatorToken, `Tokenul ${data.revokeOperatorToken.id} a fost revocat la ${data.revokeOperatorToken.revokedAt}.`);
    }
    if (subcommand === 'logout') {
      config.operatorToken = undefined;
      saveCliConfig(config, configPath);
      return emit({ loggedOut: true }, 'Tokenul de operator a fost șters din configurația locală CLI.');
    }
  }

  // 2. STATUS COMMAND
  if (group === 'status') {
    const data = await operatorGraphql(
      config,
      `{
        operatorPlatformStatus
        operatorDemoBudget { day totalBuilds todayBuilds dailyLimit maxBuildsPerProposal remainingToday }
        operatorDevices { id name status adbStatus lastHeartbeatAt }
        operatorJobs { id kind status updatedAt }
      }`,
      undefined,
      fetchImpl
    );
    const summary = JSON.parse(data.operatorPlatformStatus);
    const result = {
      platform: summary,
      demoBudget: data.operatorDemoBudget,
      devices: data.operatorDevices,
      recentJobs: data.operatorJobs.slice(0, 10),
      activeConversationId: config.activeConversationId || null
    };
    return emit(
      result,
      [
        `=== STARE PLATFORMĂ STARLIDIGITAL ===`,
        `Utilizatori: ${summary.usersCount} | Proiecte: ${summary.projectsCount} (Publicate: ${summary.publishedProjectsCount}, Erori: ${summary.failedProjectsCount})`,
        `Leaduri: ${summary.leadsCount} | Propuneri: ${summary.proposalsCount}`,
        `Buget demonstrații azi: ${data.operatorDemoBudget.todayBuilds}/${data.operatorDemoBudget.dailyLimit} (Rămase azi: ${data.operatorDemoBudget.remainingToday})`,
        `Dispozitive online: ${summary.devicesOnline} | Lucrări active: ${summary.jobsRunning} | În așteptarea aprobării: ${summary.jobsAwaitingApproval}`,
        `Conversație CLI salvată pentru reconectare: ${config.activeConversationId || 'niciuna'}`
      ].join('\n')
    );
  }

  // 3. CONVERSATIONS COMMAND
  if (group === 'conversations') {
    if (subcommand === 'inspect') {
      const convId = rest[0] || String(parsed.flags.id || '');
      const reason = typeof parsed.flags.reason === 'string' ? parsed.flags.reason : 'Verificare tehnică suport solicitată de operator';
      const data = await operatorGraphql(
        config,
        `mutation($input:OperatorToolCallInput!){executeOperatorTool(input:$input){tool ok summary dataJson}}`,
        {
          input: {
            tool: 'conversation.inspect_client',
            argumentsJson: JSON.stringify({ conversationId: convId, reason })
          }
        },
        fetchImpl
      );
      const details = JSON.parse(data.executeOperatorTool.dataJson);
      return emit(details, `${data.executeOperatorTool.summary}\n${JSON.stringify(details, null, 2)}`);
    }
    const data = await operatorGraphql(
      config,
      `{ conversations { id title agent status updatedAt messages { id sender text timestamp } } }`,
      undefined,
      fetchImpl
    );
    if (subcommand === 'open' && rest[0]) {
      const found = data.conversations.find((c: any) => c.id === rest[0]);
      if (!found) throw new Error('Conversația nu a fost găsită.');
      config.activeConversationId = found.id;
      saveCliConfig(config, configPath);
      return emit(
        found,
        [
          `Reconectat la conversația ${found.id} (${found.title}):`,
          ...(found.messages || []).slice(-10).map((m: any) => `[${m.sender}] ${m.text}`)
        ].join('\n')
      );
    }
    return emit(
      data.conversations,
      data.conversations
        .map((c: any) => `• ${c.id} | ${c.title} | ${c.status} | actualizat: ${c.updatedAt}`)
        .join('\n') || 'Nu există conversații.'
    );
  }

  // 4. PROJECTS COMMAND
  if (group === 'projects') {
    if (subcommand === 'inspect') {
      const projectId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($input:OperatorToolCallInput!){executeOperatorTool(input:$input){tool ok summary dataJson}}`,
        { input: { tool: 'project.inspect', argumentsJson: JSON.stringify({ projectId }) } },
        fetchImpl
      );
      return emit(JSON.parse(data.executeOperatorTool.dataJson), `${data.executeOperatorTool.summary}\n${data.executeOperatorTool.dataJson}`);
    }
    if (subcommand === 'explain-error') {
      const projectId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($input:OperatorToolCallInput!){executeOperatorTool(input:$input){tool ok summary dataJson}}`,
        { input: { tool: 'project.explain_error', argumentsJson: JSON.stringify({ projectId }) } },
        fetchImpl
      );
      return emit(JSON.parse(data.executeOperatorTool.dataJson), data.executeOperatorTool.summary);
    }
    if (subcommand === 'create') {
      const name = typeof parsed.flags.name === 'string' ? parsed.flags.name : rest[0] || 'Proiect Operator';
      const domain = typeof parsed.flags.domain === 'string' ? parsed.flags.domain : 'demonstratie.starlidigital.ro';
      const brief = typeof parsed.flags.brief === 'string' ? parsed.flags.brief : name;
      const data = await operatorGraphql(
        config,
        `mutation($input:OperatorToolCallInput!){executeOperatorTool(input:$input){tool ok summary dataJson}}`,
        { input: { tool: 'project.create_operator', argumentsJson: JSON.stringify({ name, domain, brief }) } },
        fetchImpl
      );
      return emit(JSON.parse(data.executeOperatorTool.dataJson), data.executeOperatorTool.summary);
    }
    const queryText = typeof parsed.flags.search === 'string' ? parsed.flags.search : '';
    const data = await operatorGraphql(
      config,
      `mutation($input:OperatorToolCallInput!){executeOperatorTool(input:$input){tool ok summary dataJson}}`,
      { input: { tool: 'search.projects', argumentsJson: JSON.stringify({ query: queryText }) } },
      fetchImpl
    );
    const list = JSON.parse(data.executeOperatorTool.dataJson);
    return emit(
      list,
      list.map((p: any) => `• ${p.id} | ${p.name} (${p.domain}) | ${p.status} | v${p.activeVersion}`).join('\n') || 'Niciun proiect găsit.'
    );
  }

  // 5. LEADS COMMAND
  if (group === 'leads') {
    if (subcommand === 'add' || subcommand === 'create') {
      const input = {
        businessName: String(parsed.flags.name || rest[0] || ''),
        industry: typeof parsed.flags.industry === 'string' ? parsed.flags.industry : undefined,
        locality: typeof parsed.flags.locality === 'string' ? parsed.flags.locality : undefined,
        phone: typeof parsed.flags.phone === 'string' ? parsed.flags.phone : undefined,
        email: typeof parsed.flags.email === 'string' ? parsed.flags.email : undefined,
        existingWebsite: typeof parsed.flags.website === 'string' ? parsed.flags.website : undefined,
        source: typeof parsed.flags.source === 'string' ? parsed.flags.source : 'CLI Starli Operator',
        internalNotes: typeof parsed.flags.notes === 'string' ? parsed.flags.notes : undefined,
        consentStatus: typeof parsed.flags.consent === 'string' ? parsed.flags.consent : 'NONE',
        consentProvenance: typeof parsed.flags.provenance === 'string' ? parsed.flags.provenance : undefined
      };
      const data = await operatorGraphql(
        config,
        `mutation($input:LeadInput!){upsertOperatorLead(input:$input){id businessName industry locality normalizedPhone email existingWebsite consentStatus optedOutAt updatedAt}}`,
        { input },
        fetchImpl
      );
      return emit(
        data.upsertOperatorLead,
        `Lead salvat: ${data.upsertOperatorLead.businessName} (${data.upsertOperatorLead.id}) | Telefon: ${data.upsertOperatorLead.normalizedPhone || '-'} | Acord: ${data.upsertOperatorLead.consentStatus}`
      );
    }
    const search = typeof parsed.flags.search === 'string' ? parsed.flags.search : undefined;
    const data = await operatorGraphql(
      config,
      `query($search:String){operatorLeads(search:$search){id businessName industry locality normalizedPhone email existingWebsite consentStatus optedOutAt updatedAt}}`,
      { search },
      fetchImpl
    );
    return emit(
      data.operatorLeads,
      data.operatorLeads
        .map(
          (l: any) =>
            `• ${l.id} | ${l.businessName} (${l.locality || '-'}) | Tel: ${l.normalizedPhone || '-'} | Email: ${l.email || '-'} | Acord: ${l.consentStatus}${l.optedOutAt ? ' [DEZABONAT]' : ''}`
        )
        .join('\n') || 'Nu există leaduri înregistrate.'
    );
  }

  // 6. PROPOSALS COMMAND
  if (group === 'proposals') {
    if (subcommand === 'create') {
      const leadId = String(parsed.flags.lead || rest[0] || '');
      const requestedSummary = String(parsed.flags.summary || parsed.flags.prompt || 'Website demonstrativ simplu și rapid');
      const mode = typeof parsed.flags.mode === 'string' ? parsed.flags.mode : 'snapshot';
      const data = await operatorGraphql(
        config,
        `mutation($leadId:ID,$customBrief:String,$mode:String){prepareProposalDemo(leadId:$leadId,customBrief:$customBrief,mode:$mode){proposal{id leadId projectId publicSlug status generationMode leadScore costAiUnits} claimCode}}`,
        { leadId, customBrief: requestedSummary, mode },
        fetchImpl
      );
      const res = data.prepareProposalDemo;
      return emit(
        res,
        [
          `Propunere creată: ${res.proposal.id} [${res.proposal.generationMode.toUpperCase()}] | Stare: ${res.proposal.status}`,
          `Cost estimat: ${res.proposal.costAiUnits} unități (Scor lead: ${res.proposal.leadScore})`,
          `Link public: ${config.apiUrl.replace('api.', '')}/propunere/${res.proposal.publicSlug}`,
          `Cod unic de revendicare (salvează): ${res.claimCode}`
        ].join('\n')
      );
    }
    if (subcommand === 'promote') {
      const proposalId = rest[0] || String(parsed.flags.id || '');
      const targetMode = typeof parsed.flags.to === 'string' ? parsed.flags.to : 'bespoke';
      const data = await operatorGraphql(
        config,
        `mutation($proposalId:ID!,$targetMode:String){promoteProposal(proposalId:$proposalId,targetMode:$targetMode){id businessName generationMode costAiUnits status}}`,
        { proposalId, targetMode },
        fetchImpl
      );
      return emit(
        data.promoteProposal,
        `Propunerea ${data.promoteProposal.id} (${data.promoteProposal.businessName}) a fost promovată la ${data.promoteProposal.generationMode.toUpperCase()} (cost: ${data.promoteProposal.costAiUnits}u).`
      );
    }
    if (subcommand === 'build') {
      const proposalId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($proposalId:ID!){buildOperatorProposalDemo(proposalId:$proposalId){id publicSlug status buildVerified lastError updatedAt}}`,
        { proposalId },
        fetchImpl
      );
      return emit(
        data.buildOperatorProposalDemo,
        `Demonstrație construită pentru propunerea ${data.buildOperatorProposalDemo.id}: stare=${data.buildOperatorProposalDemo.status}, verificat=${data.buildOperatorProposalDemo.buildVerified}`
      );
    }
    if (subcommand === 'invite') {
      const proposalId = rest[0] || String(parsed.flags.id || '');
      const expiresInDays = Number(parsed.flags.days || 14);
      const data = await operatorGraphql(
        config,
        `mutation($proposalId:ID!,$expiresInDays:Int){issueOperatorProposalClaimCode(proposalId:$proposalId,expiresInDays:$expiresInDays){claimCode expiresAt proposal{id publicSlug status}}}`,
        { proposalId, expiresInDays },
        fetchImpl
      );
      return emit(
        data.issueOperatorProposalClaimCode,
        `Cod nou de revendicare emis pentru ${proposalId}: ${data.issueOperatorProposalClaimCode.claimCode} (expiră la ${data.issueOperatorProposalClaimCode.expiresAt})`
      );
    }
    if (subcommand === 'revoke-claim') {
      const proposalId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($proposalId:ID!){revokeOperatorProposalClaim(proposalId:$proposalId){id status claimRevokedAt}}`,
        { proposalId },
        fetchImpl
      );
      return emit(data.revokeOperatorProposalClaim, `Codul de revendicare pentru ${proposalId} a fost revocat.`);
    }
    const status = typeof parsed.flags.status === 'string' ? parsed.flags.status : undefined;
    const data = await operatorGraphql(
      config,
      `{ proposals { id leadId projectId publicSlug status generationMode leadScore costAiUnits viewCount claimedByUserId updatedAt } }`,
      undefined,
      fetchImpl
    );
    return emit(
      data.proposals,
      data.proposals
        .map(
          (p: any) =>
            `• ${p.id} | /propunere/${p.publicSlug} | mod: ${p.generationMode.toUpperCase()} | scor: ${p.leadScore} | cost: ${p.costAiUnits}u | stare: ${p.status} | vizualizări: ${p.viewCount}`
        )
        .join('\n') || 'Nu există propuneri.'
    );
  }

  // 7. DEVICES COMMAND
  if (group === 'devices') {
    if (subcommand === 'pair') {
      const label = typeof parsed.flags.label === 'string' ? parsed.flags.label : rest[0] || 'Calculator Windows';
      const roots = typeof parsed.flags.root === 'string' ? [parsed.flags.root] : undefined;
      const data = await operatorGraphql(
        config,
        `mutation($label:String!,$allowedRoots:[String!]){createDevicePairingCode(label:$label,allowedRoots:$allowedRoots){id pairingCode label allowedRoots expiresAt}}`,
        { label, allowedRoots: roots },
        fetchImpl
      );
      return emit(
        data.createDevicePairingCode,
        [
          `Cod temporar de asociere generat pentru "${data.createDevicePairingCode.label}":`,
          `  Cod: ${data.createDevicePairingCode.pairingCode}`,
          `  Expiră la: ${data.createDevicePairingCode.expiresAt}`,
          `Rulează pe Windows: starli-device pair --code ${data.createDevicePairingCode.pairingCode} --api ${config.apiUrl}`
        ].join('\n')
      );
    }
    if (subcommand === 'revoke') {
      const deviceId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($deviceId:ID!){revokeOperatorDevice(deviceId:$deviceId){id name status revokedAt}}`,
        { deviceId },
        fetchImpl
      );
      return emit(data.revokeOperatorDevice, `Dispozitivul ${data.revokeOperatorDevice.name} (${data.revokeOperatorDevice.id}) a fost revocat.`);
    }
    if (subcommand === 'exec') {
      const input = {
        deviceId: String(parsed.flags.device || rest[0] || ''),
        tool: String(parsed.flags.tool || 'adb'),
        action: String(parsed.flags.action || 'devices'),
        cwd: typeof parsed.flags.cwd === 'string' ? parsed.flags.cwd : undefined,
        targetPath: typeof parsed.flags.path === 'string' ? parsed.flags.path : undefined,
        args: typeof parsed.flags.args === 'string' ? parsed.flags.args.split(',') : []
      };
      const data = await operatorGraphql(
        config,
        `mutation($input:DeviceStructuredTaskInput!){enqueueDeviceTask(input:$input){id kind status requiresApproval updatedAt}}`,
        { input },
        fetchImpl
      );
      config.activeJobId = data.enqueueDeviceTask.id;
      saveCliConfig(config, configPath);
      return emit(data.enqueueDeviceTask, `Lucrare dispozitiv creată: ${data.enqueueDeviceTask.id} (${data.enqueueDeviceTask.status})`);
    }
    if (subcommand === 'powershell') {
      const deviceId = String(parsed.flags.device || rest[0] || '');
      const command = String(parsed.flags.command || '');
      const reason = String(parsed.flags.reason || 'Intervenție administrativă aprobată pentru o singură execuție');
      const data = await operatorGraphql(
        config,
        `mutation($deviceId:ID!,$command:String!,$reason:String!){enqueuePrivilegedPowerShellTask(deviceId:$deviceId,command:$command,reason:$reason){id kind status requiresApproval payloadJson}}`,
        { deviceId, command, reason },
        fetchImpl
      );
      config.activeJobId = data.enqueuePrivilegedPowerShellTask.id;
      saveCliConfig(config, configPath);
      return emit(
        data.enqueuePrivilegedPowerShellTask,
        `Lucrare PowerShell privilegiată pregătită (${data.enqueuePrivilegedPowerShellTask.id}) în starea ${data.enqueuePrivilegedPowerShellTask.status}.\nComanda exactă: ${command}\nAprobă pentru o singură execuție cu: starli jobs approve ${data.enqueuePrivilegedPowerShellTask.id}`
      );
    }
    const data = await operatorGraphql(
      config,
      `{ operatorDevices { id name platform version status adbStatus adbDevices { serial state model canSendSms } lastHeartbeatAt allowedRoots } }`,
      undefined,
      fetchImpl
    );
    return emit(
      data.operatorDevices,
      data.operatorDevices
        .map(
          (d: any) =>
            `• ${d.id} | ${d.name} (${d.platform} v${d.version}) | Stare: ${d.status} | ADB: ${d.adbStatus} (${(d.adbDevices || []).length} tel) | Heartbeat: ${d.lastHeartbeatAt || '-'}`
        )
        .join('\n') || 'Niciun dispozitiv asociat.'
    );
  }

  // 8. JOBS COMMAND
  if (group === 'jobs') {
    if (subcommand === 'approve') {
      const jobId = rest[0] || String(parsed.flags.id || config.activeJobId || '');
      const data = await operatorGraphql(
        config,
        `mutation($jobId:ID!){approveOperatorJob(jobId:$jobId){id kind status approvedBy approvedAt}}`,
        { jobId },
        fetchImpl
      );
      return emit(data.approveOperatorJob, `Lucrarea ${data.approveOperatorJob.id} a fost aprobată (${data.approveOperatorJob.status}).`);
    }
    if (subcommand === 'cancel') {
      const jobId = rest[0] || String(parsed.flags.id || config.activeJobId || '');
      const reason = typeof parsed.flags.reason === 'string' ? parsed.flags.reason : 'Anulat din CLI de operator';
      const data = await operatorGraphql(
        config,
        `mutation($jobId:ID!,$reason:String){cancelOperatorJob(jobId:$jobId,reason:$reason){id kind status error completedAt}}`,
        { jobId, reason },
        fetchImpl
      );
      return emit(data.cancelOperatorJob, `Lucrarea ${data.cancelOperatorJob.id} a fost anulată (${data.cancelOperatorJob.status}).`);
    }
    const data = await operatorGraphql(
      config,
      `{ operatorJobs { id kind targetType targetId deviceId status requiresApproval output error exitCode updatedAt completedAt } }`,
      undefined,
      fetchImpl
    );
    if (subcommand === 'inspect') {
      const jobId = rest[0] || String(parsed.flags.id || config.activeJobId || '');
      const found = data.operatorJobs.find((j: any) => j.id === jobId);
      if (!found) throw new Error(`Lucrarea ${jobId} nu a fost găsită.`);
      return emit(
        found,
        [
          `Lucrare: ${found.id} (${found.kind})`,
          `Stare: ${found.status} | Necesită aprobare: ${found.requiresApproval}`,
          found.output ? `Output:\n${found.output}` : '',
          found.error ? `Eroare: ${found.error}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
    return emit(
      data.operatorJobs,
      data.operatorJobs
        .map((j: any) => `• ${j.id} | ${j.kind} | ${j.status} | actualizat: ${j.updatedAt}`)
        .join('\n') || 'Nu există lucrări.'
    );
  }

  // 9. MESSAGES COMMAND
  if (group === 'messages') {
    if (subcommand === 'prepare') {
      const proposalId = String(parsed.flags.proposal || rest[0] || '');
      const channel = typeof parsed.flags.channel === 'string' ? parsed.flags.channel : 'SMS_ADB';
      const deviceId = typeof parsed.flags.device === 'string' ? parsed.flags.device : undefined;
      const customBody = typeof parsed.flags.body === 'string' ? parsed.flags.body : undefined;
      const data = await operatorGraphql(
        config,
        `mutation($input:ProposalInvitationInput!){prepareOperatorProposalInvitation(input:$input){id recipient channel status body updatedAt}}`,
        { input: { proposalId, channel, deviceId, customBody } },
        fetchImpl
      );
      return emit(
        data.prepareOperatorProposalInvitation,
        [
          `Mesaj pregătit (${data.prepareOperatorProposalInvitation.id}) către ${data.prepareOperatorProposalInvitation.recipient} [${data.prepareOperatorProposalInvitation.channel}]:`,
          `Text exact: "${data.prepareOperatorProposalInvitation.body}"`,
          `Aprobă expedierea cu: starli messages approve ${data.prepareOperatorProposalInvitation.id}`
        ].join('\n')
      );
    }
    if (subcommand === 'approve') {
      const messageId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($messageId:ID!){approveOperatorMessage(messageId:$messageId){id recipient status approvedAt}}`,
        { messageId },
        fetchImpl
      );
      return emit(
        data.approveOperatorMessage,
        `Mesajul ${data.approveOperatorMessage.id} către ${data.approveOperatorMessage.recipient} a fost APROBAT. Trimite cu: starli messages send ${data.approveOperatorMessage.id}`
      );
    }
    if (subcommand === 'send') {
      const messageId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($messageId:ID!){dispatchOperatorMessage(messageId:$messageId){id recipient channel status externalMessageId error updatedAt}}`,
        { messageId },
        fetchImpl
      );
      return emit(
        data.dispatchOperatorMessage,
        `Rezultat expediere mesaj ${data.dispatchOperatorMessage.id}: stare=${data.dispatchOperatorMessage.status}${data.dispatchOperatorMessage.error ? ` (${data.dispatchOperatorMessage.error})` : ''}`
      );
    }
    const data = await operatorGraphql(
      config,
      `{ operatorMessages { id leadId proposalId kind channel recipient status body error updatedAt } }`,
      undefined,
      fetchImpl
    );
    return emit(
      data.operatorMessages,
      data.operatorMessages
        .map((m: any) => `• ${m.id} | ${m.kind} [${m.channel}] -> ${m.recipient} | Stare: ${m.status}`)
        .join('\n') || 'Nu există mesaje.'
    );
  }

  // 10. PLATFORM CHANGES COMMAND
  if (group === 'changes') {
    if (subcommand === 'stage') {
      const title = String(parsed.flags.title || 'Modificare platformă');
      const targetPath = String(parsed.flags.path || '');
      const proposedContent = String(parsed.flags.content || '');
      const verificationCmd = typeof parsed.flags.verify === 'string' ? parsed.flags.verify : undefined;
      const data = await operatorGraphql(
        config,
        `mutation($title:String!,$targetPath:String!,$proposedContent:String!,$verificationCmd:String){stageOperatorPlatformChange(title:$title,targetPath:$targetPath,proposedContent:$proposedContent,verificationCmd:$verificationCmd){id title targetPath diff verificationOk verificationLog status}}`,
        { title, targetPath, proposedContent, verificationCmd },
        fetchImpl
      );
      return emit(
        data.stageOperatorPlatformChange,
        [
          `Modificare pregătită în workspace izolat: ${data.stageOperatorPlatformChange.id}`,
          `Verificare: ${data.stageOperatorPlatformChange.verificationOk ? 'REUȘITĂ' : 'EȘUATĂ'}`,
          `Diferențe:\n${data.stageOperatorPlatformChange.diff}`
        ].join('\n')
      );
    }
    if (subcommand === 'approve') {
      const changeId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($changeId:ID!){approveOperatorPlatformChange(changeId:$changeId){id title targetPath status approvedAt}}`,
        { changeId },
        fetchImpl
      );
      return emit(data.approveOperatorPlatformChange, `Modificarea ${data.approveOperatorPlatformChange.id} a fost aprobată.`);
    }
    if (subcommand === 'rollback') {
      const changeId = rest[0] || String(parsed.flags.id || '');
      const data = await operatorGraphql(
        config,
        `mutation($changeId:ID!){rollbackOperatorPlatformChange(changeId:$changeId){id title targetPath status rolledBackAt}}`,
        { changeId },
        fetchImpl
      );
      return emit(data.rollbackOperatorPlatformChange, `Modificarea ${data.rollbackOperatorPlatformChange.id} a fost anulată (rollback).`);
    }
    const data = await operatorGraphql(
      config,
      `{ operatorPlatformChanges { id title targetPath verificationOk status updatedAt } }`,
      undefined,
      fetchImpl
    );
    return emit(
      data.operatorPlatformChanges,
      data.operatorPlatformChanges
        .map((c: any) => `• ${c.id} | ${c.title} (${c.targetPath}) | Verificat: ${c.verificationOk} | Stare: ${c.status}`)
        .join('\n') || 'Nu există modificări de platformă.'
    );
  }

  if(group==='stop'){
    const taskId=subcommand!=='list'?subcommand:config.activeTaskId;
    if(!taskId)throw new Error('Nu există o sarcină activă salvată. Folosește starli stop <taskId>.');
    const data=await operatorGraphql(config,'mutation($id:ID!){stopOperatorTask(id:$id){id conversationId status error}}',{id:taskId},fetchImpl);
    return emit(data.stopOperatorTask,`Oprire solicitată: ${data.stopOperatorTask.status}. Verifică operațiunile deja pornite înainte de repetare.`);
  }

  if(group==='chat')return runOperatorChat({parsed,config,save:()=>saveCliConfig(config,configPath),query:(query,variables)=>operatorGraphql(config,query,variables,fetchImpl),out,tty:!options.output&&!parsed.json&&Boolean(stdout.isTTY)&&Boolean(stdin.isTTY)});

  throw new Error(`Comandă necunoscută: "${group}". Rulează "starli --help" pentru lista de comenzi.`);
}

export async function runCli(argv: string[]): Promise<void> {
  try {
    const result=await executeCliCommand(argv);
    if(['FAILED','INTERRUPTED','BLOCKED'].includes(result?.status))process.exitCode=1;
  } catch (error: any) {
    const isJson = argv.includes('--json');
    if (isJson) {
      stdout.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2)}\n`);
    } else {
      process.stderr.write(`Eroare Starli CLI: ${error?.message || String(error)}\n`);
    }
    process.exitCode = 1;
  }
}

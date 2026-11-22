import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {ToolContext} from './common.js';
import {registerAllControlPlaneTools} from './index.js';
import {realpathSync,statSync} from 'node:fs';
import {relative,isAbsolute,resolve} from 'node:path';

export function resolveWorkerWorkspace(name:string,base='/srv/starlidigital/mcp-workspace'):string{
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(name))throw Error('WORKSPACE_NAME_INVALID');
 const trusted=realpathSync(base),root=realpathSync(resolve(trusted,name)),rel=relative(trusted,root);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||!statSync(root).isDirectory())throw Error('WORKSPACE_OUTSIDE_DEVELOPMENT_ROOT');
 return root;
}


const ALLOWED=new Set([
'ops_health','platform_overview','platform_capabilities','platform_health','api_overview',
'projects_list','project_get','website_get_structure','file_read','code_search',
'git_status','git_diff','server_info','database_overview','config_overview',
'starli_status','assets_list','crm_search_prospects','crm_get_prospect',
'crm_list_opportunities','proposal_get_delivery_info','outreach_get_limits',
'outreach_get_thread','agency_overview','pipeline_get','interaction_list',
'inbox_search','inbox_read','suppression_check','agent_get',
'agent_list_conversations','agent_list_customer_leads','video_project_get',
'video_project_list','video_render_status','video_output_get','brand_profile_get',
'browser_devices_list','browser_sessions_list','browser_session_read',
'browser_command_status','audit_recent_actions',
'file_write','file_patch','project_build','project_test','project_verify_live'
]);
export class WorkerMcpBridge{
 private constructor(private client:Client,private server:McpServer,private allowed:Set<string>){}
 static async create(parent:ToolContext,options?:{workspaceRoot?:string}):Promise<WorkerMcpBridge>{
  const server=new McpServer({name:'starli-worker-delegated',version:'1'});
  const principal={...parent.principal,role:'operator' as const,scopes:['read','write']};
  const configured=options?.workspaceRoot||process.env.STARLI_AGENT_DEV_WORKSPACE_ROOT;
  // Never grant an autonomous worker writes against the live application root.
  const workspaceRoot=configured?realpathSync(configured):parent.workspaceRoot;
  const liveRoot=realpathSync(parent.workspaceRoot);
  const rel=relative(liveRoot,workspaceRoot);
  const trustedBase=realpathSync('/srv/starlidigital/mcp-workspace');
  const within=relative(trustedBase,workspaceRoot);
  const isolated=Boolean(configured)&&rel!==''&&within!==''&&!within.startsWith('..')&&!isAbsolute(within);
  const allowed=isolated?ALLOWED:new Set([...ALLOWED].filter(name=>!['file_write','file_patch','project_build'].includes(name)));
  registerAllControlPlaneTools({...parent,workspaceRoot,server,principal});
  const client=new Client({name:'starli-worker',version:'1'});
  const [a,b]=InMemoryTransport.createLinkedPair();
  await server.connect(b);await client.connect(a);
  return new WorkerMcpBridge(client,server,allowed);
 }
 async list(){const result=await this.client.listTools();return result.tools.filter(t=>this.allowed.has(t.name)).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema}));}
 async call(name:string,args:Record<string,unknown>){
  if(!this.allowed.has(name))throw Error('Tool not approved for autonomous execution');
  const result=await this.client.callTool({name,arguments:args},undefined,{signal:AbortSignal.timeout(20000)});
  return {isError:result.isError??false,content:result.content};
 }
 async close(){await this.client.close();await this.server.close();}
}

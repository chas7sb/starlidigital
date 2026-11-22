import {tenantStore,CUSTOMER_TOOLS} from './tenant-store.ts';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
const platformRoot=process.env.STARLI_PLATFORM_SOURCE_ROOT||'/srv/starlidigital/current';
const stateRoot=process.env.STARLI_STATE_DIR||'/srv/starlidigital/mcp-workspace/prime-platform-20261109/runtime';
mkdirSync(stateRoot,{recursive:true,mode:0o700});
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const {Store}=await import(join(platformRoot,'server/src/store.ts'));
const {Events}=await import(join(platformRoot,'server/src/events.ts'));
const {createCrmServices}=await import(join(platformRoot,'server/src/crm/services.ts'));
const {createAgencyMailbox}=await import(join(platformRoot,'server/src/mailbox/agency-mailbox.ts'));
const {AssetServices}=await import(join(platformRoot,'server/src/assets/service.ts'));
const {VideoServices}=await import(join(platformRoot,'server/src/video/service.ts'));
const {HostedAgentService}=await import(join(platformRoot,'server/src/hosted-agents/service.ts'));
const {registerScopedDomainTools}=await import(join(platformRoot,'control-plane/src/domain-tools.ts'));
const {SqliteAuditSink}=await import(join(platformRoot,'control-plane/src/audit.ts'));
const {HttpUpstreamHealthProbe}=await import(join(platformRoot,'control-plane/src/health.ts'));
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const line=await new Promise<string>(resolve=>input.once('line',resolve));input.close();
const req=JSON.parse(line);
const backingStore=new Store(process.env.STARLI_SOURCE_DATABASE||'/var/lib/starlidigital/starli.sqlite');
const store=req.customer?tenantStore(backingStore,req.owner):backingStore;
const user=req.customer?{id:req.owner,role:'USER',disabled:false}:store.user(req.owner);
if(!user||user.disabled||(!req.customer&&user.role!=='ADMIN'))throw Error('DENIED');
if(req.customer&&req.operation!=='catalog'&&!CUSTOMER_TOOLS.has(req.tool))throw Error('CUSTOMER_TOOL_DENIED');
const events=new Events();
const server=new McpServer({name:'starli-private-ui-bridge',version:'1'});
const auditSink=new SqliteAuditSink(join(stateRoot,'tool-audit.sqlite'));
const principal={id:user.id,role:'admin',scopes:['read','write','admin']};
const config={host:'127.0.0.1',port:4120,upstreamHealthUrl:'http://127.0.0.1:4119/health',controlDbPath:':memory:',allowedOrigins:[],publicResourceUrl:'https://api.starlidigital.ro/mcp'};
registerScopedDomainTools({server,principal,auditSink,store,events,workspaceRoot:'/srv/starlidigital/mcp-workspace',
 crmServices:createCrmServices({store,events}),mailboxServices:createAgencyMailbox({store,events,...(req.customer?{accountConfig:{id:'customer-'+req.owner,email:req.customerEmail||'unconnected@invalid.local',displayName:'Customer mailbox (not connected)',imapHost:'',imapPort:993,imapSecure:true,imapUser:'',imapPassword:'',smtpConfigured:false}}:{})}),
 assetServices:new AssetServices({store,events}),videoServices:new VideoServices({store,events,assetServices:new AssetServices({store,events}),storageDir:join(stateRoot,'video')}),hostedAgentService:new HostedAgentService({store,events}),config,
 healthProbe:new HttpUpstreamHealthProbe(config.upstreamHealthUrl)});
const client=new Client({name:'starli-private-preview',version:'1'});
const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
try{
 let result=req.operation==='catalog'?await client.listTools():await client.callTool({name:req.tool,arguments:req.args||{}});
 if(req.customer&&req.operation==='catalog')result={...result,tools:result.tools.filter((t:any)=>CUSTOMER_TOOLS.has(t.name))};
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stdout.write(JSON.stringify({isError:true,content:[{type:'text',text:'Platform operation failed; inspect authenticated audit.'}]})+'\n');process.exitCode=1;}
finally{await client.close();await server.close();auditSink.close();store.close();}

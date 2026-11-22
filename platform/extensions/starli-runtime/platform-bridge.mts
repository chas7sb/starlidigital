import {tenantStore,CUSTOMER_TOOLS} from './tenant-store.ts';
import {tenantBusinessEvents} from './tenant-business-events.ts';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync} from 'node:fs';
const platformRoot=process.env.STARLI_PLATFORM_SOURCE_ROOT||fileURLToPath(new URL('../../',import.meta.url));
const stateRoot=process.env.STARLI_STATE_DIR;
if(!stateRoot)throw Error('STARLI_STATE_DIR_REQUIRED');
const platformOrigin=new URL(process.env.STARLI_PLATFORM_ORIGIN||'http://127.0.0.1:4100');
if(!['http:','https:'].includes(platformOrigin.protocol)||platformOrigin.username||platformOrigin.password||platformOrigin.search||platformOrigin.hash||!['','/'].includes(platformOrigin.pathname))throw Error('STARLI_PLATFORM_ORIGIN_INVALID');
mkdirSync(stateRoot,{recursive:true,mode:0o700});
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
const {Store}=await import(pathToFileURL(join(platformRoot,'server/src/store.ts')).href);
const {Events}=await import(pathToFileURL(join(platformRoot,'server/src/events.ts')).href);
const {createCrmServices}=await import(pathToFileURL(join(platformRoot,'server/src/crm/services.ts')).href);
const {createAgencyMailbox}=await import(pathToFileURL(join(platformRoot,'server/src/mailbox/agency-mailbox.ts')).href);
const {AssetServices}=await import(pathToFileURL(join(platformRoot,'server/src/assets/service.ts')).href);
const {VideoServices}=await import(pathToFileURL(join(platformRoot,'server/src/video/service.ts')).href);
const {HostedAgentService}=await import(pathToFileURL(join(platformRoot,'server/src/hosted-agents/service.ts')).href);
const {registerScopedDomainTools}=await import(pathToFileURL(join(platformRoot,'control-plane/src/domain-tools.ts')).href);
const {SqliteAuditSink}=await import(pathToFileURL(join(platformRoot,'control-plane/src/audit.ts')).href);
const {HttpUpstreamHealthProbe}=await import(pathToFileURL(join(platformRoot,'control-plane/src/health.ts')).href);
import {createInterface} from 'node:readline';
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
const line=await new Promise<string>(resolve=>input.once('line',resolve));input.close();
const req=JSON.parse(line);
const backingStore=new Store(process.env.STARLI_SOURCE_DATABASE||process.env.DATABASE_PATH||join(stateRoot,'platform.sqlite'));
const store=req.customer?tenantStore(backingStore,req.owner):backingStore;
const user=req.customer?{id:req.owner,role:'USER',disabled:false}:store.user(req.owner);
if(!user||user.disabled||(!req.customer&&user.role!=='ADMIN'))throw Error('DENIED');
if(req.customer&&req.operation!=='catalog'&&!CUSTOMER_TOOLS.has(req.tool))throw Error('CUSTOMER_TOOL_DENIED');
const events=new Events();
const server=new McpServer({name:'starli-private-ui-bridge',version:'1'});
const auditSink=new SqliteAuditSink(join(stateRoot,'tool-audit.sqlite'));
const principal={id:user.id,role:'admin',scopes:['read','write','admin']};
const config={host:'127.0.0.1',port:4120,upstreamHealthUrl:new URL('/health',platformOrigin).href,controlDbPath:':memory:',allowedOrigins:[],publicResourceUrl:process.env.CONTROL_PLANE_PUBLIC_RESOURCE_URL||'http://127.0.0.1:4120/mcp'};
registerScopedDomainTools({server,principal,auditSink,store,events,workspaceRoot:process.env.STARLI_WORKSPACE_ROOT||join(stateRoot,'workspace'),
 crmServices:createCrmServices({store,events}),mailboxServices:createAgencyMailbox({store,events,...(req.customer?{accountConfig:{id:'customer-'+req.owner,email:req.customerEmail||'unconnected@invalid.local',displayName:'Customer mailbox (not connected)',imapHost:'',imapPort:993,imapSecure:true,imapUser:'',imapPassword:'',smtpConfigured:false}}:{})}),
 assetServices:new AssetServices({store,events}),videoServices:new VideoServices({store,events,assetServices:new AssetServices({store,events}),storageDir:join(stateRoot,'video')}),hostedAgentService:new HostedAgentService({store,events,...(req.customer?{businessEvents:tenantBusinessEvents(backingStore,store,req.owner,events)}:{})}),config,
 healthProbe:new HttpUpstreamHealthProbe(config.upstreamHealthUrl)});
const client=new Client({name:'starli-private-preview',version:'1'});
const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
try{
 let result=req.operation==='catalog'?await client.listTools():await client.callTool({name:req.tool,arguments:req.args||{}});
 if(req.customer&&req.operation==='catalog')result={...result,tools:result.tools.filter((t:any)=>CUSTOMER_TOOLS.has(t.name))};
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stdout.write(JSON.stringify({isError:true,content:[{type:'text',text:'Platform operation failed; inspect authenticated audit.'}]})+'\n');process.exitCode=1;}
finally{await client.close();await server.close();auditSink.close();store.close();}

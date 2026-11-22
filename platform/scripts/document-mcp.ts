import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createControlPlaneServer } from '../control-plane/src/server.js';
import { FixtureTokenVerifier } from '../control-plane/src/auth.js';
import { SqliteAuditSink } from '../control-plane/src/audit.js';
async function main(){
const verifier=new FixtureTokenVerifier();verifier.registerToken('documentation-fixture',{id:'documentation',role:'admin',scopes:['read','write','admin']});
const audit=new SqliteAuditSink(':memory:');
const server=createControlPlaneServer({config:{host:'127.0.0.1',port:0,controlDbPath:':memory:',upstreamHealthUrl:'http://127.0.0.1/health',allowedOrigins:[]},tokenVerifier:verifier,auditSink:audit,healthProbe:{async probe(){return {ready:false,service:'documentation',dependencies:{}};}}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const client=new Client({name:'catalog-generator',version:'1.0.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`),{requestInit:{headers:{Authorization:'Bearer documentation-fixture'}}}));
 const {tools}=await client.listTools();
 const header=`# StarliDigital MCP tool catalog\n\nGenerated from actual SDK tools/list on an isolated local server. ${tools.length} registered schemas. Registration is not proof of configured credentials or runtime readiness. No external tool actions were executed to generate this document.\n\n## Contract\n\nExisting tools preserve their response contracts. New agency tools return {success:true,result}; failures set MCP isError and contain {error:{code,message}}. Read and write scopes are enforced in handlers. Exact argument requirements are in each input schema below. Values returned as company_id/workspace_id/project IDs can be reused across the lifecycle.\n\n## Lifecycle example\n\ncrm_upsert_prospect -> company ID -> company_enrich/company_signal_record -> lead_score -> client_workspace_create -> project_manage(create, workspaceId) -> website_generate(projectId) -> deployment tools -> outreach_create_draft/outreach_send_email -> inbox_search/inbox_read -> pipeline_move. Read prospect_research for saved evidence; it does not perform a new web search.\n\n## Side effects and permissions\n\nAll tools require authentication. Mutations require write scope; privileged tools require admin scope as implemented. Sending is an external action and must follow the operator's explicit request. Use a stable idempotencyKey for send retries; UNCONFIRMED requires mailbox inspection rather than blind resending. SMTP_ACCEPTED is not delivery. Unsubscribe suppression and configured global/domain hourly limits apply. Do not execute shell/file/Git/deploy mutations without reviewing their concrete target and side effects.\n\n`;
 const body=tools.map(tool=>`## ${tool.name}\n\n${tool.description || ''}\n\nArguments:\n\n\`\`\`json\n${JSON.stringify(tool.inputSchema,null,2)}\n\`\`\`\n\nExample invocation: call \`${tool.name}\` using its required fields above. Inspect returned IDs before invoking dependent tools.\n`).join('\n');
 writeFileSync('MCP_TOOLS.md',header+body);writeFileSync('output/private/mcp-tool-catalog.json',JSON.stringify(tools,null,2));console.log(`Documented ${tools.length} real tool schemas.`);
}finally{await client.close();await new Promise<void>(resolve=>server.close(()=>resolve()));audit.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {compile} from 'svelte/compiler';
const root=new URL('../',import.meta.url);
const moduleUrl=source=>'data:text/javascript;base64,'+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText).toString('base64');
const helperSource=readFileSync(new URL('src/lib/utils/installation-origin.ts',root),'utf8');
const helperUrl=moduleUrl(helperSource);
const helper=await import(helperUrl);
const load=async path=>import(moduleUrl(readFileSync(new URL(path,root),'utf8').replaceAll('$lib/utils/installation-origin',helperUrl)));
const social=await load('src/lib/components/enterprise/social/company-social-client.ts');
const previews=await load('src/lib/components/enterprise/panes/published-preview.ts');
const origin='http://127.0.0.1:5186';
globalThis.window={location:{origin}};

test('public origins accept HTTPS and literal-loopback HTTP only',()=>{
 for(const [value,expected]of [['https://install.example/','https://install.example'],[origin,origin],['http://127.22.3.4:8080','http://127.22.3.4:8080'],['http://[::1]:8080','http://[::1]:8080']])assert.equal(helper.validatePublicOrigin(value),expected);
 for(const value of ["https://bad'host.example",'https://%65xample.com','http://localhost:5186','http://backend:8080','http://10.0.0.2','http://example.com','http://127.1','http://2130706433','http://0x7f000001','http://[::ffff:127.0.0.1]','https://user:pass@install.example','https://@install.example','https://install.example/path','https://install.example//','https://install.example?','https://install.example#','https://install.example:0','https://install.example:99999','https://install.example\n','https://install.example\\evil','file:///tmp/x'])assert.equal(helper.validatePublicOrigin(value),null,value);
});
test('explicit public override fails closed and never uses backend environment',()=>{
 process.env.STARLI_BACKEND_URL='http://private-service:18381';
 assert.equal(helper.installationPublicOrigin(origin,undefined),origin);
 assert.equal(helper.installationPublicOrigin(origin,'https://public.example'),'https://public.example');
 assert.equal(helper.installationPublicOrigin(origin,'http://private-service:18381'),null);
 assert.equal(helper.installationPublicUrl('/api/customer/v1',origin),origin+'/api/customer/v1');
 assert.equal(helper.installationPublicUrl('//attacker.example',origin),null);
 assert.equal(helper.installationPublicUrl('/api?token=x',origin),null);
});
function authorization(base=origin){const url=new URL('/oauth/authorize',base);url.searchParams.set('redirect_uri',origin+'/api/v1/starli/mcp/oauth/callback');url.searchParams.set('scope','read');url.searchParams.set('state','test-only');return {version:'starli.mcp-oauth.v1',scope:'read',issuer:base,authorizationUrl:url.href};}
test('MCP keeps exact issuer/path/scope/callback and rejects duplicate or untrusted URLs',()=>{
 const valid=authorization();assert.equal(helper.verifiedMcpAuthorization(valid,origin,origin),valid.authorizationUrl);
 for(const change of [{issuer:'https://attacker.example'},{scope:'read write'}, {authorizationUrl:authorization('https://attacker.example').authorizationUrl},{authorizationUrl:valid.authorizationUrl.replace('/oauth/authorize','/other')},{authorizationUrl:valid.authorizationUrl+'#fragment'},{authorizationUrl:valid.authorizationUrl+'&scope=read'},{authorizationUrl:valid.authorizationUrl+'&redirect_uri='+encodeURIComponent(origin+'/api/v1/starli/mcp/oauth/callback')}])assert.equal(helper.verifiedMcpAuthorization({...valid,...change},origin,origin),null);
 assert.equal(helper.verifiedMcpAuthorization(valid,'http://localhost:5186',origin),null);
});
test('social handoff uses configured installation and exact customer authorization path',()=>{
 assert.equal(social.socialAuthorizationUrl(origin+'/customer/oauth/authorize?state=test-only'),origin+'/customer/oauth/authorize?state=test-only');
 for(const value of ['https://api.starlidigital.ro/customer/oauth/authorize',origin+'/other',origin+'/extra/../customer/oauth/authorize',origin+'/customer/oauth/authorize#',origin.replace('://','://@')+'/customer/oauth/authorize'])assert.equal(social.socialAuthorizationUrl(value),null);
});
test('published previews retain exact lowercase32hex path and refuse cross-origin/link decoration',()=>{
 const good=origin+'/published/'+'a'.repeat(32)+'/';assert.equal(previews.publishedUrl(good),good);
 for(const value of [good.replace(origin,'https://attacker.example'),good+'?',good+'#',good.replace('a'.repeat(32),'g'.repeat(32)),good.replace('a'.repeat(32),'a'.repeat(31)),good.replace('published/','published/../'),good.replace('://','://@')])assert.equal(previews.publishedUrl(value),'',value);
});
test('four assigned modules have no production destination; edited Svelte compiles',()=>{
 for(const path of ['CompanyApps.svelte','social/company-social-client.ts','panes/published-preview.ts','account/CustomerAPI.svelte']){
  const filename=new URL('src/lib/components/enterprise/'+path,root);const source=readFileSync(filename,'utf8');
  assert.equal(/https?:\/\/[^\s'"`<>]*starlidigital\.(ro|com)/.test(source),false,path);
  if(path.endsWith('.svelte')){
   // Compile the TypeScript script through TypeScript before the Svelte parser.
   const plain=source.replace(/<script lang="ts">([\s\S]*?)<\/script>/,(full,script)=>'<script>'+ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText+'</script>');
   compile(plain,{filename:filename.pathname,generate:false});
  }
 }
});

import fs from 'node:fs';

let s = fs.readFileSync('server/src/index.ts', 'utf8');

if (!s.includes('handleOAuthAuthorize')) {
  s = s.replace("import { stripeWebhook } from './billing.js';",
    "import { stripeWebhook } from './billing.js';\r\nimport { handleOAuthMetadata, handleOAuthAuthorize, handleOAuthToken } from './oauth/index.js';");

  const anchor = "  const pathname=new URL(req.url||'/', 'http://localhost').pathname;\r\n";
  const oauthRoute = `  if(pathname==='/.well-known/oauth-authorization-server'||pathname==='/.well-known/openid-configuration'){handleOAuthMetadata(res);return;}
  if(pathname==='/oauth/authorize'){void handleOAuthAuthorize(req,res,store,sessionContext(store,req.headers.cookie||'',()=>{},'http:'+clientIP(req),String(req.headers.authorization||'')));return;}
  if(pathname==='/oauth/token'){void handleOAuthToken(req,res,store);return;}\r\n`;

  s = s.replace(anchor, anchor + oauthRoute);

  fs.writeFileSync('server/src/index.ts', s, 'utf8');
  console.log('Successfully wired OAuth routes into server/src/index.ts');
} else {
  console.log('Already contains handleOAuthAuthorize');
}

import {readFileSync,writeFileSync,chmodSync} from 'node:fs';
const name=process.argv[2];
if(!['RESEND_API_KEY','VERCEL_TOKEN','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'].includes(name))throw new Error('Unsupported secret name');
let input='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
process.stdin.on('data',chunk=>{input+=chunk;if(!/[\r\n]/.test(input))return;const value=input.split(/[\r\n]/)[0].trim();if(!value||value.length>2000||/[\r\n\0]/.test(value))throw new Error('Invalid credential');let text=readFileSync('.env','utf8');text=text.replace(new RegExp('^'+name+'=.*(?:\\r?\\n|$)','gm'),'');text+=`${name}=${JSON.stringify(value)}\n`;if(name==='RESEND_API_KEY'){text=text.replace(/^EMAIL_PROVIDER=.*(?:\r?\n|$)/gm,'');text+='EMAIL_PROVIDER=resend\n';}writeFileSync('.env',text);try{chmodSync('.env',0o600);}catch{}console.log('Credential saved to backend-only configuration.');process.exit(0);});

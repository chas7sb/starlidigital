import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
export const campaign={schema:'starli.email/1',identityId:'agata-marketing',to:['campaign-review@example.test'],cc:[],bcc:[],subject:'Agata · A little beauty for your everyday',preheader:'Discover the new collection and find your favourite piece.',brand:{color:'#7B3856'},attachments:[],blocks:[{id:'hero',type:'image',assetId:'agata-collection',alt:'Agata collection — rose, plum and gold botanical artwork'},{id:'title',type:'heading',text:'Made for your everyday moments'},{id:'intro',type:'text',text:'Hello,\nA thoughtful detail can change your whole day. Explore Agata’s new collection, made to bring a little beauty to the moments that matter.'},{id:'cta',type:'button',text:'Explore the collection',href:'https://agata.example.test/collection'},{id:'signature',type:'signature',text:'With care,\nThe Agata team\nAgata · Thoughtful details, beautifully made.'}]};
export const context={companyId:'agata-fixture',actorId:'alex-fixture'};
export function fixtureAdapters(directory){let active=true;const bytes=readFileSync(directory+'/agata.png');return {
 authorize(actor,company,permission){if(!active||company!=='agata-fixture'||!['alex-fixture','agata-bot'].includes(actor))throw Error('forbidden');return {kind:actor==='agata-bot'?'bot':'person',permission};},
 revoke(){active=false;},
 assets(ctx,id){if(id!=='agata-collection')throw Error('asset not found');return {companyId:'agata-fixture',bytes,sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',filename:'agata.png'};},
 identity(ctx,id){if(id!=='agata-marketing')throw Error('identity not found');return {id,companyId:'agata-fixture',verified:true,address:'agata@example.test',name:'The Agata team'};}
 };}

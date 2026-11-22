import type {ChatAttachmentInput} from './agent-turn.js';
import {GraphQLError} from 'graphql';
const invalid=(message:string):never=>{throw new GraphQLError(message,{extensions:{code:'BAD_USER_INPUT'}});};
export function validateChatAttachments(input:unknown):ChatAttachmentInput[]{
 if(input===undefined||input===null)return[];
 if(!Array.isArray(input)||input.length>5)invalid('Poți trimite cel mult cinci atașamente.');
 let total=0;
 return (input as any[]).map(item=>{
  if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>120||typeof item.mimeType!=='string'||item.mimeType.length>80)invalid('Atașamentul nu are un nume sau un tip valid.');
  const output:ChatAttachmentInput={name:item.name.trim(),mimeType:item.mimeType.toLowerCase()};
  if(item.dataUrl!==undefined&&item.dataUrl!==null){
   if(typeof item.dataUrl!=='string'||item.dataUrl.length>2800000)invalid('Imaginea trebuie să aibă maximum 2 MB.');
   const match=/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);
   if(!match||match[1]!==output.mimeType)invalid('Imaginea trebuie să fie PNG, JPEG, WebP sau GIF cu un conținut valid.');
   const image=Buffer.from(match![2],'base64');
   if(image.length>2*1024*1024||image.toString('base64')!==match![2])invalid('Imaginea este prea mare sau codificată incorect.');
   const valid=output.mimeType==='image/png'?image.subarray(0,8).toString('hex')==='89504e470d0a1a0a':output.mimeType==='image/jpeg'?image.subarray(0,3).toString('hex')==='ffd8ff':output.mimeType==='image/gif'?/^GIF8[79]a$/.test(image.subarray(0,6).toString()):image.subarray(0,4).toString()==='RIFF'&&image.subarray(8,12).toString()==='WEBP';
   if(!valid)invalid('Conținutul imaginii nu corespunde tipului declarat.');
   total+=image.length;output.dataUrl=item.dataUrl;
  }
  if(item.textExcerpt!==undefined&&item.textExcerpt!==null){if(typeof item.textExcerpt!=='string'||item.textExcerpt.length>8000)invalid('Fragmentul documentului trebuie să aibă maximum 8.000 de caractere.');output.textExcerpt=item.textExcerpt;total+=Buffer.byteLength(item.textExcerpt);}
  if(!output.dataUrl&&!output.textExcerpt)invalid('Atașamentul nu conține o imagine sau text utilizabil.');
  if(total>5*1024*1024)invalid('Atașamentele trebuie să aibă împreună maximum 5 MB.');
  return output;
 });
}

/** Bounded raster tool images for the pinned Pi 1.5 SDK. Never accepts URLs/SVG. */
import type {ImageContent, TextContent} from '@earendil-works/pi-ai';
export const MAX_TOOL_IMAGE_BYTES=1_000_000;
export const MAX_TOOL_IMAGE_BASE64=1_500_000;
function dimensions(bytes:Buffer,mime:string):[number,number]|undefined{
 if(mime==='image/png'){
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return;
  return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 }
 if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[bytes.length-2]!==0xff||bytes[bytes.length-1]!==0xd9)return;
 let offset=2;
 while(offset<bytes.length-1){
  if(bytes[offset++]!==0xff)return;
  while(bytes[offset]===0xff)offset++;
  const marker=bytes[offset++];
  if(marker===0xda||marker===0xd9)return;
  if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(offset+2>bytes.length)return;
  const length=bytes.readUInt16BE(offset);
  if(length<2||offset+length>bytes.length)return;
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(length<8)return;
   return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];
  }
  offset+=length;
 }
}
export function validToolImage(value:unknown):ImageContent|undefined{
 if(!value||typeof value!=='object')return;
 const item=value as any;
 if(item.type!=='image'||!['image/png','image/jpeg'].includes(item.mimeType)||typeof item.data!=='string'||item.data.length===0||item.data.length>MAX_TOOL_IMAGE_BASE64||item.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(item.data))return;
 const bytes=Buffer.from(item.data,'base64');
 if(bytes.length>MAX_TOOL_IMAGE_BYTES||bytes.toString('base64')!==item.data)return;
 const size=dimensions(bytes,item.mimeType);
 if(!size||size.some(n=>!Number.isSafeInteger(n)||n<1||n>4096)||size[0]*size[1]>16_777_216)return;
 return {type:'image',mimeType:item.mimeType,data:item.data};
}
export function receiptImages(observed:any):ImageContent[]{
 if(observed?.isError===true)return [];
 const content=Array.isArray(observed?.content)?observed.content:[];
 for(const item of content){const image=validToolImage(item);if(image)return [image];}
 // Retain the existing legacy browser.observe data-URL contract, but validate
 // it with the same MIME/magic/dimension/size bounds before provider delivery.
 const legacy=typeof observed?._vision_image==='string'?/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(observed._vision_image):null;
 const image=legacy&&validToolImage({type:'image',mimeType:legacy[1],data:legacy[2]});
 return image?[image]:[];
}
export function withoutReceiptImages(observed:any):any{
 if(!observed||typeof observed!=='object'||Array.isArray(observed))return observed;
 const result={...observed};delete result._vision_image;
 if(Array.isArray(result.content))result.content=result.content.filter((part:any)=>part?.type!=='image');
 return result;
}
export function nativeToolResult(observed:any,isError=false):{content:(TextContent|ImageContent)[];isError:boolean}{
 const failed=isError||observed?.isError===true;
 const content:(TextContent|ImageContent)[]=[{type:'text',text:JSON.stringify(withoutReceiptImages(observed)).slice(0,250000)}];
 if(!failed)content.push(...receiptImages(observed));
 return {content,isError:failed};
}

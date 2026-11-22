import {zipSync,strToU8} from 'fflate';
type SourceFile={path:string;content:string;encoding?:string};
export function projectArchive(files:SourceFile[]):Uint8Array{
 const archive:Record<string,Uint8Array>={};
 for(const file of files){
  if(file.path.startsWith('/')||file.path.split('/').includes('..')||file.path.includes('\\'))throw new Error('The file path is invalid.');
  archive[file.path]=file.encoding==='base64'?Uint8Array.from(atob(file.content),c=>c.charCodeAt(0)):strToU8(file.content);
 }
 return zipSync(archive);
}

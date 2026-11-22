import {createHash,randomUUID} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {basename,dirname,extname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from './security.js';
import {now,type Store} from './store.js';

export const platformContentHash=(content:string)=>createHash('sha256').update(content,'utf8').digest('hex');
export function platformWorkspace(){return realpathSync(process.env.STARLI_OPERATOR_WORKSPACE||fileURLToPath(new URL('../../',import.meta.url)));}

/** No ambient cwd, secret paths, traversal, symlink ancestors, or shared hardlinks. */
export function platformChangePath(root:string,candidate:string){
 if(!candidate||candidate.includes('\0')||isAbsolute(candidate)||/[:]/.test(candidate)||candidate.split(/[\\/]/).some(piece=>!piece||piece==='..'||piece.startsWith('.')))fail('Calea modificării nu este permisă.','FORBIDDEN');
 const target=resolve(root,candidate.replaceAll('\\','/')),rel=relative(root,target).replaceAll('\\','/');
 if(!rel||isAbsolute(rel)||rel.startsWith('../')||rel==='..')fail('Calea depășește workspace-ul aprobat.','FORBIDDEN');
 if(/(?:^|\/)(?:node_modules|data|private|secrets|credentials|attachments|output)(?:\/|$)|(?:\.env|\.sqlite|\.db|\.pem|\.key|\.p12|\.pfx|credentials|config\.json$)/i.test(rel))fail('Fișierele private nu pot fi modificate.','FORBIDDEN');
 if(!(/^(?:server\/src|web\/src|cli\/src|device\/src|scripts|infra|docs)\//.test(rel)||['package.json','package-lock.json','README.md'].includes(rel))||!['.ts','.tsx','.js','.mjs','.json','.md','.css','.html','.sh','.yml','.yaml','.txt'].includes(extname(target).toLowerCase()))fail('Modificările sunt limitate la surse și documentația aprobate.','FORBIDDEN');
 let segment=root;const pieces=rel.split('/');
 for(let i=0;i<pieces.length;i++){segment=join(segment,pieces[i]);try{const info=lstatSync(segment);if(info.isSymbolicLink()||i===pieces.length-1&&(!info.isFile()||info.nlink>1))fail('Legăturile simbolice, hardlink-urile și directoarele nu sunt ținte permise.','FORBIDDEN');if(i<pieces.length-1&&!info.isDirectory())fail('Directorul țintă nu este valid.','FORBIDDEN');}catch(error:any){if(error.code!=='ENOENT'||i!==pieces.length-1)throw error;}}
 return target;
}

export function readPlatformSnapshot(root:string,path:string){
 const target=platformChangePath(root,path);if(!existsSync(target))return{exists:false,content:'',hash:platformContentHash(''),mode:0o600};
 const info=lstatSync(target);if(info.size>200000)fail('Fișierul depășește limita de 200 KB.');const content=readFileSync(target,'utf8');
 if(content.includes('\0'))fail('Modificările binare nu sunt permise.','FORBIDDEN');
 return{exists:true,content,hash:platformContentHash(content),mode:info.mode&0o777};
}

export function writePlatformSnapshot(root:string,path:string,expected:{exists:boolean;hash:string},next:{exists:boolean;content:string;mode:number}){
 const target=platformChangePath(root,path),check=()=>{const current=readPlatformSnapshot(root,path);if(current.exists!==expected.exists||current.hash!==expected.hash)fail('Fișierul a fost schimbat după pregătirea modificării. Pregătește un diff nou.','CONFLICT');};check();
 if(!next.exists){unlinkSync(target);if(existsSync(target))throw Error('Ștergerea fișierului nu a fost confirmată.');return;}
 const temporary=join(dirname(target),'.'+basename(target)+'.starli-'+randomUUID()+'.tmp');let descriptor:number|undefined;
 try{descriptor=openSync(temporary,'wx',next.mode);writeFileSync(descriptor,next.content,'utf8');fsyncSync(descriptor);closeSync(descriptor);descriptor=undefined;check();renameSync(temporary,target);
  const verified=readPlatformSnapshot(root,path);if(!verified.exists||verified.hash!==platformContentHash(next.content))throw Error('Conținutul scris nu corespunde modificării aprobate.');
 }finally{if(descriptor!==undefined)closeSync(descriptor);if(existsSync(temporary))unlinkSync(temporary);}
}

/** Restart recovery never replays a file write or assumes that a disk mutation completed. */
export function recoverInterruptedPlatformChanges(store:Store){
 let recovered=0;for(const change of store.list('platform-changes')){if(!['APPLYING','ROLLING_BACK'].includes(change.status))continue;store.put('platform-changes',{...change,status:change.status==='APPLYING'?'APPLY_UNCERTAIN':'ROLLBACK_UNCERTAIN',verificationReport:'Procesul s-a întrerupt înainte de confirmarea scrierii pe disc. Fișierul trebuie verificat înainte de orice repetare.',updatedAt:now()},change.actorId);recovered++;}return recovered;
}

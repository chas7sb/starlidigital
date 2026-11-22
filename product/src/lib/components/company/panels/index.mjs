export const VERSION = 'starli.panel.v1';
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
export function resourceKey(ref) {
 if (!ref || !['company','personal'].includes(ref.scope) || !id(ref.ownerId) || !id(ref.kind) || !id(ref.id)) throw Error('Invalid canonical resource');
 return [ref.scope,ref.ownerId,ref.kind,ref.id].map(encodeURIComponent).join('/');
}
export class PanelRegistry {
 #entries = new Map();
 register(manifest, loader) {
  if(manifest.version!==VERSION || !id(manifest.type) || !Array.isArray(manifest.scopes) || !manifest.scopes.length || manifest.scopes.some(s=>!['company','personal'].includes(s)) || !Array.isArray(manifest.capabilities) || manifest.capabilities.some(c=>!id(c)) || typeof loader!=='function' || this.#entries.has(manifest.type)) throw Error('Invalid or duplicate trusted panel');
  this.#entries.set(manifest.type,{manifest:Object.freeze({...manifest,scopes:Object.freeze([...manifest.scopes]),capabilities:Object.freeze([...manifest.capabilities])}),loader});
 }
 get(type){const e=this.#entries.get(type);if(!e)throw Error('Unknown panel type');return e;}
}
// Storage contains layout and unsent drafts only. It never confers authority.
export class PanelHost {
 panels = new Map(); #epoch=0; #listeners=new Set(); #scope; #storage; #adapter; #registry;
 constructor(registry,adapter,storage){this.#registry=registry;this.#adapter=adapter;this.#storage=storage;}
 subscribe(fn){this.#listeners.add(fn);fn([...this.panels.values()]);return()=>this.#listeners.delete(fn);}
 #notify(){for(const fn of this.#listeners)fn([...this.panels.values()]);}
 #key(){return 'starli.panels.v1:'+JSON.stringify(this.#scope);}
 #save(){if(this.#scope)this.#storage.setItem(this.#key(),JSON.stringify([...this.panels.values()].map(({type,ref,mode,draft})=>({type,ref,mode,draft}))));}
 async switchScope(scope){
  if(!id(scope.userId)||!['company','personal'].includes(scope.kind)||!id(scope.ownerId))throw Error('Invalid actor scope');
  this.#epoch++;for(const p of this.panels.values()){p.abort.abort();p.dispose?.();}this.panels.clear();this.#scope=Object.freeze({...scope});this.#notify();
  let saved=[];try{saved=JSON.parse(this.#storage.getItem(this.#key())||'[]');}catch{}
  if(Array.isArray(saved))for(const p of saved.slice(0,20)){try{await this.open(p); }catch{}}
 }
 async open(command){
  if(!this.#scope)throw Error('Select a scope');
  const {type,ref}=command,{manifest,loader}=this.#registry.get(type),key=type+':'+resourceKey(ref);
  if(!manifest.scopes.includes(ref.scope)||ref.scope!==this.#scope.kind||ref.ownerId!==this.#scope.ownerId||manifest.resourceKinds&&!manifest.resourceKinds.includes(ref.kind))throw Error('Scope or resource kind mismatch');
  if(this.panels.has(key)){this.setMode(key,command.mode||'docked');return this.panels.get(key);}
  const epoch=this.#epoch,abort=new AbortController(),scope=this.#scope;
  const current=()=>epoch===this.#epoch&&!abort.signal.aborted&&this.panels.get(key)===p;
  const p={key,type,ref:Object.freeze({...ref}),mode:['docked','expanded','closed'].includes(command.mode)?command.mode:'docked',draft:command.draft??null,state:'loading',abort};
  this.panels.set(key,p);this.#notify();
  try {
   const grant=await this.#adapter.authorize(scope,p.ref,manifest.capabilities,abort.signal);
   if(!current())return;
   if(!grant.allowed){p.draft=null;p.state='capability';p.message='This panel is not available with your current permissions.';return p;}
   const renderer=await loader();if(!current())return;
   p.renderer=renderer.default??renderer;
   const data=await this.#adapter.read(scope,p.ref,abort.signal);if(!current())return;
   p.data=data.value;p.revision=data.revision;p.state=data.value==null?'empty':'ready';
   p.dispose=await this.#adapter.subscribe(scope,p.ref,event=>{if(!current())return;if(event.revoked){abort.abort();p.dispose?.();p.renderer=null;p.data=null;p.draft=null;p.state='capability';this.#save();this.#notify();return;}if(event.revision>p.revision){p.data=event.value;p.revision=event.revision;p.state=event.value==null?'empty':'ready';this.#notify();}},abort.signal);
   if(!current())p.dispose?.();
  }catch(error){if(current()){p.state=[401,403,404].includes(error.status)?'capability':'error';if(p.state==='capability')p.draft=null;p.message=error.message;p.renderer=null;p.data=null;}}
  finally{if(current()){this.#save();this.#notify();}}
  return p;
 }
 setMode(key,mode){if(!['docked','expanded','closed'].includes(mode))throw Error('Invalid mode');const p=this.panels.get(key);if(!p)return;p.mode=mode;this.#save();this.#notify();}
 draft(key,value){const p=this.panels.get(key);if(!p||p.state==='capability')return;p.draft=value;this.#save();this.#notify();}
 async edit(key,value){const p=this.panels.get(key);if(!p||p.state!=='ready')throw Error('Panel not editable');const epoch=this.#epoch;try{const result=await this.#adapter.edit(this.#scope,p.ref,value,p.revision,p.abort.signal);if(epoch!==this.#epoch||p.abort.signal.aborted)return;p.data=result.value;p.revision=result.revision;p.draft=null;this.#save();this.#notify();}catch(e){if(epoch===this.#epoch&&!p.abort.signal.aborted){if([401,403,404].includes(e.status)){p.abort.abort();p.dispose?.();p.state='capability';p.renderer=null;p.data=null;p.draft=null;this.#save();}p.message=e.status===409?'Resource changed. Reload before saving your draft.':e.message;this.#notify();}throw e;}}
 async assistantOutput(output){if(output?.version!==VERSION||output.action!=='open')throw Error('Invalid assistant panel output');return this.open(output);}
 destroy(){this.#epoch++;for(const p of this.panels.values()){p.abort.abort();p.dispose?.();}this.panels.clear();this.#scope=null;this.#notify();this.#listeners.clear();}
}

import { get, writable } from 'svelte/store';

type ViewState={projectId:string;open:boolean;tab:string;closedByUser:boolean;lastBuildKey:string;dismissedBuildKey:string};
type StorageLike={getItem(key:string):string|null;setItem(key:string,value:string):void};
type Options={namespace?:string;storage?:StorageLike};
export type ProjectPreviewEvent={chatId:string;agentId?:string;projectId:string;phase:'building'|'ready';showPreview?:boolean;explicitShow?:boolean;buildKey?:string;operationKey?:string;version?:string|number};
const empty=():ViewState=>({projectId:'',open:false,tab:'preview',closedByUser:false,lastBuildKey:'',dismissedBuildKey:''});
const validProject=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9:_-]{1,180}$/.test(value);
export function createProjectViewStore(options:Options={}){
 const projectPanel=writable(false),activeProject=writable(''),workspaceTab=writable('preview');
 const views=new Map<string,ViewState>();
 let owner='',conversation='',key='',applying=false;
 const storage=()=>options.storage??(typeof localStorage!=='undefined'?localStorage:null);
 const storageKey=(value:string)=>(options.namespace??'starli-project-view.v2')+':'+value;
 const viewKey=(who:string,chat:string)=>encodeURIComponent(who)+':'+encodeURIComponent(chat);
 function save(k:string,state:ViewState){
  views.set(k,state);
  try{storage()?.setItem(storageKey(k),JSON.stringify({...state,open:false}));}catch{}
 }
 function view(k:string){
  if(views.has(k))return views.get(k)!;
  let value=empty();
  try{const saved=JSON.parse(storage()?.getItem(storageKey(k))??'null');if(saved&&typeof saved==='object')value={...value,projectId:validProject(saved.projectId)?saved.projectId:'',tab:['preview','files','history','crm','mail','social','intelligence','computer'].includes(saved.tab)?saved.tab:'preview',closedByUser:saved.closedByUser===true,lastBuildKey:typeof saved.lastBuildKey==='string'?saved.lastBuildKey.slice(0,300):'',dismissedBuildKey:typeof saved.dismissedBuildKey==='string'?saved.dismissedBuildKey.slice(0,300):''};}catch{}
  views.set(k,value);return value;
 }
 function apply(state:ViewState){
  applying=true;activeProject.set(state.projectId);workspaceTab.set(state.tab);projectPanel.set(state.open);applying=false;
 }
 function update(patch:Partial<ViewState>){if(!key)return;const next={...view(key),...patch};save(key,next);apply(next);}
 activeProject.subscribe(value=>{if(!applying&&key)save(key,{...view(key),projectId:validProject(value)?value:''});});
 projectPanel.subscribe(value=>{if(!applying&&key)save(key,{...view(key),open:value});});
 workspaceTab.subscribe(value=>{if(!applying&&key)save(key,{...view(key),tab:value});});
 function activateConversation(chatId:string|null|undefined,account:string|null|undefined,flags:{startClosed?:boolean;inheritCurrent?:boolean}={}){
  const who=typeof account==='string'?account:'',chat=chatId||'__new__';
  if(!who){owner='';conversation='';key='';apply(empty());return;}
  const nextKey=viewKey(who,chat),same=nextKey===key;
  if(same){if(flags.startClosed)update({open:false});return;}
  const previous=key?view(key):null;
  const inherit=who===owner&&previous&&(flags.inheritCurrent||(conversation==='__new__'&&chat!=='__new__'))&&!views.has(nextKey);
  owner=who;conversation=chat;key=nextKey;
  let state=inherit?{...previous!}:chat==='__new__'?empty():view(key);
  if(flags.startClosed)state={...state,open:false};
  save(key,state);apply(state);
 }
 function selectProject(projectId:string,flags:{open?:boolean}={}){
  if(!validProject(projectId)){update({projectId:'',open:false});return;}
  update({projectId,...(flags.open?{open:true,tab:'preview',closedByUser:false,dismissedBuildKey:''}:{})});
 }
 function openProjectPanel(tab='preview'){
  if(tab==='preview'&&!get(activeProject))return false;
  update({open:true,tab,closedByUser:false,dismissedBuildKey:''});return true;
 }
 function dismissPreview(){const current=key?view(key):empty();update({open:false,closedByUser:true,dismissedBuildKey:current.lastBuildKey});}
 function requestProjectPreview(event:ProjectPreviewEvent){
  if(!owner||!event||typeof event.chatId!=='string'||!event.chatId||!validProject(event.projectId)||event.showPreview!==true||!['building','ready'].includes(event.phase))return false;
  const targetKey=viewKey(owner,event.chatId),state=view(targetKey);
  const build=String(event.buildKey??event.operationKey??(event.version!==undefined?'version:'+event.projectId+':'+event.version:'project:'+event.projectId)).slice(0,300);
  const changedProject=state.projectId!==event.projectId;
  const changedBuild=build!==state.lastBuildKey;
  const shouldOpen=event.explicitShow===true||!state.closedByUser||changedProject||changedBuild;
  const next={...state,projectId:event.projectId,lastBuildKey:build,...(shouldOpen?{open:true,tab:'preview',closedByUser:false,dismissedBuildKey:''}:{})};
  save(targetKey,next);
  if(targetKey===key)apply(next);
  return targetKey===key&&shouldOpen;
 }
 return {projectPanel,activeProject,workspaceTab,activateConversation,selectProject,openProjectPanel,dismissPreview,requestProjectPreview,snapshot:()=>key?{...view(key)}:empty(),currentConversation:()=>conversation};
}
const nativeView=createProjectViewStore();
export const {projectPanel,activeProject,workspaceTab,activateConversation,selectProject,openProjectPanel,dismissPreview,requestProjectPreview}=nativeView;

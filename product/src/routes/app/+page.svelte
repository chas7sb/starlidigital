<script lang="ts">
 import {onMount,onDestroy,tick} from 'svelte';
 import {listNativeCompanies,activateNativeCompany} from '$lib/utils/company-bootstrap';
 import {extractOnboardingIntentParam,resolveVerifiedAppOnboardingTarget} from '$lib/components/marketing/app-onboarding-target';
 import {modelRoomRecipient} from '$lib/components/marketing/model-room-recipient';
 import GuestModelAppPreview from '$lib/components/marketing/GuestModelAppPreview.svelte';
 import {readClaimedConversation} from '$lib/components/marketing/guest-authority-client';
 import {guestBuild} from '$lib/components/marketing/guest-workspace-extension';
 import ClaimedBuildConfirmation from '$lib/components/marketing/ClaimedBuildConfirmation.svelte';
 import {confirmClaimedBuild,resumeClaimedBuild,type ClaimedBuildScope,type ClaimedBuildAdmission} from '$lib/components/marketing/claimed-build-client';
 import WorkerTaskProgressPanel from '$lib/components/marketing/WorkerTaskProgressPanel.svelte';
 import PrivateAppPreviewPane from '$lib/components/marketing/PrivateAppPreviewPane.svelte';
 import {fetchAuthoritativeProgress,requestAuthoritativeStop} from '$lib/components/marketing/orchestration-progress-adapter';
 import {samePreviewSession} from '$lib/components/marketing/preview-session-binding';
 import {bootstrapPreviewSession} from '$lib/components/marketing/app-preview-bootstrap-adapter';
 import type {BoundPreviewReceipt,PreviewAuthorityState} from '$lib/components/marketing/app-preview-bootstrap-adapter';
 import {parseNativeAuthority,projectNativeDirectory} from '$lib/utils/company-authority';
 import {CompanyClient} from '$lib/utils/company-workspace';
 import {verifiedCompanyTurn,companyTurnPath,turnFinished,type CompanyTurn} from '$lib/utils/company-turn';
 import BotsDirectory from '$lib/components/enterprise/BotsDirectory.svelte';
 import BatchDispatchCard from '$lib/components/enterprise/messaging/BatchDispatchCard.svelte';
 import {botSidebar,nativeTimestamp} from '$lib/components/enterprise/messaging/bot-sidebar';
 import ChatMessageContent from '$lib/components/enterprise/artifacts/ChatMessageContent.svelte';
 import CompanyGeneratedImage from '$lib/components/enterprise/artifacts/CompanyGeneratedImage.svelte';
 import CompanyChatImage from '$lib/components/enterprise/artifacts/CompanyChatImage.svelte';
 import BotPurpose from '$lib/components/enterprise/agents/BotPurpose.svelte';
 import BotAvatar from '$lib/components/enterprise/agents/BotAvatar.svelte';
 import CustomerAPI from '$lib/components/enterprise/account/CustomerAPI.svelte';
 import CompanyChannels from '$lib/components/enterprise/company/CompanyChannels.svelte';
 import CompanyInvitations from '$lib/components/enterprise/company/CompanyInvitations.svelte';
 import StarliAutomations from '$lib/components/enterprise/automations/StarliAutomations.svelte';
 import AutomationChatFeedback from '$lib/components/enterprise/automations/AutomationChatFeedback.svelte';
 import AutomationChatConnection from '$lib/components/enterprise/automations/AutomationChatConnection.svelte';
 import AgentTriggerCard from '$lib/components/enterprise/automations/AgentTriggerCard.svelte';
 import CompanyConnectionCard from '$lib/components/enterprise/automations/CompanyConnectionCard.svelte';
 import {companyConnectionSelection} from '$lib/components/enterprise/automations/company-connections-client';
 import {agentTriggerSelection} from '$lib/components/enterprise/automations/agent-trigger-client';
 import AutomationGraphCard from '$lib/components/enterprise/automations/AutomationGraphCard.svelte';
 import {graphSelection} from '$lib/components/enterprise/automations/graph-client';
 import IntegrationsCatalog from '$lib/components/enterprise/integrations/IntegrationsCatalog.svelte';
 import CompanySmtpIntegrations from '$lib/components/enterprise/integrations/CompanySmtpIntegrations.svelte';
 import CompanySmtpApprovalCard from '$lib/components/enterprise/integrations/CompanySmtpApprovalCard.svelte';
 import {smtpApprovalSelection} from '$lib/components/enterprise/integrations/smtp-message';
 import {automationSelection} from '$lib/components/enterprise/automations/automation-message';
 import CompanyProviders from '$lib/components/enterprise/company/CompanyProviders.svelte';
 import LocalProviderConnection from '$lib/components/enterprise/company/LocalProviderConnection.svelte';
 import TeamCollaboration from '$lib/components/enterprise/messaging/TeamCollaboration.svelte';
 import PanelWorkspace from '$lib/components/enterprise/PanelWorkspace.svelte';
 import CompanySocialConnections from '$lib/components/enterprise/social/CompanySocialConnections.svelte';
 import CompanySocialPostReview from '$lib/components/enterprise/social/CompanySocialPostReview.svelte';
 import {socialConnectionSelection,socialPostSelection} from '$lib/components/enterprise/social/social-message';
 import {verifiedPreviews,type PublishedPreview} from '$lib/components/enterprise/panes/published-preview';
 import Profile from '$lib/components/enterprise/Profile.svelte';
 import CompanyApps from '$lib/components/enterprise/CompanyApps.svelte';
 import CompanyProjects from '$lib/components/enterprise/CompanyProjects.svelte';
 import MentionComposer from '$lib/components/enterprise/messaging/MentionComposer.svelte';
 import {uploadChatImage,chatImageLimits,type ChatImageDraft} from '$lib/components/enterprise/messaging/chat-images';
 import RoomMembersPane from '$lib/components/enterprise/messaging/RoomMembersPane.svelte';
 import {createRoomMembersApi} from '$lib/components/enterprise/messaging/native-room-members';
 import ToolPicker from '$lib/components/enterprise/ToolPicker.svelte';
 import AddBot from '$lib/components/enterprise/agents/AddBot.svelte';
 import AgentSettings from '$lib/components/enterprise/agents/AgentSettings.svelte';
 import Orb from '$lib/components/enterprise/Orb.svelte';import Activity from '$lib/components/enterprise/Activity.svelte';
 let actor:any=null,company:any=null,bots:any[]=[],people:any[]=[],bot:any=null,room:any=null,messages:any[]=[],turns:Record<string,CompanyTurn>={};
 let selectedSettingsBotId='';
 let appsInitialTab:'resources'|'connections'|'tools'='resources';
 function openTeamCollaboration(){if(!company||!actor||!room)return;showActions=false;registerPanel('team-collaboration:'+room.id,'Team conversation',TeamCollaboration,{conversationId:room.id,bots});}
 function openLocalProvider(){if(!company||!actor)return;showActions=false;registerPanel('local-provider:'+company.id,'Model connection',LocalProviderConnection,{bots});}
 function openCompanyMcp(){if(!company||!actor||!canAdminCompany)return;appsInitialTab='connections';view='Apps';menu=false;}
 let accountMenu=false;
 let invitationRoles:{id:string;name:string}[]=[];
 async function openInvitations(){
  accountMenu=false;if(!await verifyCompany()||!canAdminCompany)return;
  const id=company.id,version=epoch;
  try{const values=await api('/api/v1/companies/'+enc(id)+'/roles');if(company?.id!==id||version!==epoch)return;
   if(!Array.isArray(values))throw Error('Company roles could not be loaded.');
   invitationRoles=values.filter(role=>role.active&&role.kind==='person').map(role=>({id:role.id,name:role.name}));
   if(company.role==='owner')invitationRoles=[{id:'admin',name:'Administrator'},...invitationRoles];
   view='CompanyInvitations';menu=false;
  }catch(cause){error=(cause as Error).message;}
 }
 function openAutomations(){
  if(!company||!actor)return;
  showActions=false;
  registerPanel('automations:'+(room?.id||'company'),'Automations',StarliAutomations,{conversationId:room?.id||'',selectedBotId:bot?.id||'',people});
 }
 function openConnection(providerId:'slack'|'shopify'){
  if(!company||!actor||!room)return;
  showActions=false;
  registerPanel('connection:'+room.id+':'+providerId,'Connect '+(providerId==='slack'?'Slack':'Shopify'),AutomationChatConnection,{conversationId:room.id,providerId});
 }
 function openIntegrationCatalog(){
  if(!company||!actor)return;
  showActions=false;
  registerPanel('integration-catalog','Integration catalog',IntegrationsCatalog,{});
 }
 async function resumeAutomationConversation(){
  const url=new URL(location.href),id=url.searchParams.get('automationRoom'),returnCompany=url.searchParams.get('automationCompany');
  if(!id)return false;
  url.searchParams.delete('automationRoom');url.searchParams.delete('automationDraft');url.searchParams.delete('automationCompany');
  history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  if(returnCompany&&returnCompany!==company.id)throw Error('This connection belongs to another company session. Open its company workspace to continue.');
  if(!/^[a-zA-Z0-9-]{1,128}$/.test(id))throw Error('The returning conversation could not be verified.');
  const version=++epoch;stick=true;scroller?.dispatchEvent(new Event('starli-chat-room-open'));const currentCompany=company.id;
  const resumed=await client!.request('/rooms/'+enc(id));
  if(version!==epoch||company?.id!==currentCompany)return true;
  if(resumed.id!==id||resumed.companyId!==currentCompany||!Array.isArray(resumed.agentIds))throw Error('The returning conversation is not available in this company.');
  room=resumed;channel=resumed.kind==='channel'?resumed:null;
  bot=channel?null:bots.find(item=>resumed.agentIds.includes(item.id))||null;
  humanTarget=null;view=channel?'Channel':'Bots';draft='';mentionRanges=[];messages=[];turns={};liveTexts={};
  await refresh(version);return true;
 }
 $: canAdminCompany=company?.scope?.capabilities?.includes('roles.manage')===true&&['owner','admin'].includes(company?.role);
 async function openCompanyAdmin(){accountMenu=false;if(await verifyCompany()&&canAdminCompany){view='CompanyAdmin';menu=false;}}
 let liveTexts:Record<string,string>={};let hiddenActivityRuns=new Set<string>();
 $: automationCard=room&&company?messages.map(message=>automationSelection(message,room.id,company.id)).filter(Boolean).at(-1):null;
 let selectedResource:any=null;
 let hiddenSocialMessages=new Set<string>();
 let openPanels:any[]=[],activePanelKey='',panelsMinimized=false;
 let previewScope='',previewGeneration=0,previewLastRead=0,previewsReading=false,previewForce=false,previewItems:PublishedPreview[]=[];let PublishedPreviewPane:any=null;const previewDismissed=new Set<string>(),previewRevisions=new Map<string,number>();
 let BrowserPane:any=null,browserReading=false,browserLastRead=0,browserForce=false;const browserDismissed=new Set<string>(),browserSequences=new Map<string,number>();
 $: nextPreviewScope=company&&room?company.id+':'+room.id:'';
 $: if(previewScope!==nextPreviewScope)resetPreviewScope(nextPreviewScope);
 function registerPanel(key:string,title:string,component:any,props:any){
  if(!openPanels.some(panel=>panel.key===key))openPanels=[...openPanels,{key,title,component,props}];
  activePanelKey=key;panelsMinimized=false;
 }
 function openSocialConnections(){if(!company||!actor||!room)return;showActions=false;registerPanel('company-social:'+company.id+':'+room.id,'Facebook & Instagram',CompanySocialConnections,{companyName:company.name,conversationId:room.id,platform:'both'});}
 function resetPreviewScope(scope:string){previewScope=scope;previewGeneration++;previewLastRead=0;previewsReading=false;previewForce=false;previewItems=[];browserLastRead=0;browserReading=false;browserForce=false;const previous=activePanelKey;openPanels=openPanels.filter(panel=>!panel.key.startsWith('website-preview:')&&!panel.key.startsWith('browser:')&&!panel.key.startsWith('model-app:'));if(previous.startsWith('website-preview:')||previous.startsWith('browser:')||previous.startsWith('model-app:'))activePanelKey=openPanels.at(-1)?.key||'';}
 async function presentPublishedPreview(preview:PublishedPreview,explicit=false){const scope=preview.companyId+':'+preview.conversationId;if(scope!==previewScope||!company||company.id!==preview.companyId||room?.id!==preview.conversationId)return;if(previewDismissed.has(scope)&&!explicit)return;const key='website-preview:'+scope+':'+preview.id,known=previewRevisions.get(key)||0;if(preview.revision<known)return;previewRevisions.set(key,preview.revision);if(explicit)previewDismissed.delete(scope);if(!PublishedPreviewPane)PublishedPreviewPane=(await import('$lib/components/enterprise/panes/PublishedAppPreview.svelte')).default;if(scope!==previewScope||company?.id!==preview.companyId||room?.id!==preview.conversationId||ctrl.signal.aborted)return;const props={preview,conversationId:preview.conversationId},existing=openPanels.find(panel=>panel.key===key);if(existing)openPanels=openPanels.map(panel=>panel.key===key?{...panel,props}:panel);else openPanels=[...openPanels,{key,title:preview.title||'Website preview',component:PublishedPreviewPane,props}];if(explicit||!panelsMinimized&&(!activePanelKey||activePanelKey.startsWith('website-preview:'))){activePanelKey=key;if(explicit)panelsMinimized=false;}}
 async function refreshAppPreviews(explicit=false){if(explicit)previewForce=true;if(!previewForce&&Date.now()-previewLastRead<2000)return;if(!client||!company||!room||previewsReading||!['Bots','Channel','HumanChat'].includes(view)||document.hidden)return;const current=client,id=company.id,conversation=room.id,generation=previewGeneration;previewsReading=true;previewLastRead=Date.now();try{const result=await current.request('/rooms/'+enc(conversation)+'/app-previews');if(current!==client||generation!==previewGeneration||company?.id!==id||room?.id!==conversation)return;previewItems=verifiedPreviews(result,id,conversation);const force=previewForce;previewForce=false;const latest=previewItems.at(-1);if(latest)await presentPublishedPreview(latest,force);else if(force)error='No published website preview is available for this conversation yet.';}catch(cause){if(current===client&&generation===previewGeneration){if(previewForce)error='Published website previews could not be checked. Try again.';previewForce=false;if((cause as any).status===401)await accessDenied(401,epoch);}}finally{if(current===client&&generation===previewGeneration)previewsReading=false;}}
 async function presentBrowserWorkspace(target:{companyId:string;conversationId:string;botId:string;runId:string;sequence?:number},explicit=false){const scope=target.companyId+':'+target.conversationId;if(scope!==previewScope||!company||company.id!==target.companyId||room?.id!==target.conversationId||!target.botId||!target.runId)return;const key='browser:'+scope,seq=target.sequence??0,known=browserSequences.get(key)||0;if(seq>known){browserSequences.set(key,seq);browserDismissed.delete(scope);}if(browserDismissed.has(scope)&&!explicit)return;if(explicit)browserDismissed.delete(scope);if(!BrowserPane)BrowserPane=(await import('$lib/components/enterprise/panes/BrowserWorkspacePane.svelte')).default;if(scope!==previewScope||company?.id!==target.companyId||room?.id!==target.conversationId||ctrl.signal.aborted)return;const props={roomId:target.conversationId,botId:target.botId,runId:target.runId},existing=openPanels.find(panel=>panel.key===key);if(existing)openPanels=openPanels.map(panel=>panel.key===key?{...panel,props}:panel);else openPanels=[...openPanels,{key,title:'Browser',component:BrowserPane,props}];if(explicit||!panelsMinimized&&(!activePanelKey||activePanelKey===key||activePanelKey.startsWith('website-preview:'))){activePanelKey=key;if(explicit)panelsMinimized=false;}}
 async function refreshBrowserWorkspace(explicit=false){if(explicit)browserForce=true;if(!browserForce&&Date.now()-browserLastRead<2000)return;if(!company||!room||browserReading||!['Bots','Channel','HumanChat'].includes(view)||document.hidden)return;const id=company.id,conversation=room.id,generation=previewGeneration,preferredBot=bot?.id||'';browserReading=true;browserLastRead=Date.now();try{const q=new URLSearchParams({roomId:conversation,...(preferredBot?{botId:preferredBot}:{})});const result=await api('/api/v1/starli/companies/'+enc(id)+'/browser/room-session?'+q);if(generation!==previewGeneration||company?.id!==id||room?.id!==conversation)return;const force=browserForce;browserForce=false;if(result?.version==='starli.browser.v1'&&result.companyId===id&&result.roomId===conversation&&result.botId&&result.runId&&(result.available===true||force))await presentBrowserWorkspace({companyId:id,conversationId:conversation,botId:result.botId,runId:result.runId,sequence:Number(result.sequence)||0},force);}catch(cause){if(generation===previewGeneration){browserForce=false;if((cause as any).status===401)await accessDenied(401,epoch);}}finally{if(generation===previewGeneration)browserReading=false;}}
 function nativeImageReferences(message:any){return Array.isArray(message.attachments)?message.attachments.filter((attachment:any)=>typeof attachment?.id==='string'&&/^drive\.[A-Za-z0-9-]{1,128}\.v[1-9][0-9]*$/.test(attachment.id)):[];}
 function generatedAttachments(message:any){if(!company||!Array.isArray(message.attachments))return [];const prefix='/api/v1/companies/'+enc(company.id)+'/generated-images/';return message.attachments.filter((a:any)=>typeof a?.id==='string'&&typeof a.url==='string'&&a.url.startsWith(prefix)&&/^[-a-zA-Z0-9]{1,128}\/content$/.test(a.url.slice(prefix.length)));}
 async function openChatArtifact(messageId:string,artifact:{code:string;language:string;filename:string;blockIndex:number}){
  if(!company||!actor||!room)return;const id=company.id,roomId=room.id;
  const component=(await import('$lib/components/enterprise/artifacts/ChatArtifactEditor.svelte')).default;
  if(company?.id!==id||room?.id!==roomId||ctrl.signal.aborted)return;
  registerPanel('chat-artifact:'+roomId+':'+messageId+':'+artifact.blockIndex,artifact.filename,component,{code:artifact.code,language:artifact.language,filename:artifact.filename});
 }
 function closePanel(key:string){if(key.startsWith('website-preview:'))previewDismissed.add(previewScope);if(key.startsWith('browser:'))browserDismissed.add(previewScope);openPanels=openPanels.filter(panel=>panel.key!==key);if(activePanelKey===key)activePanelKey=openPanels.at(-1)?.key||'';}

 let ResourcePane:any=null;
 let FilePicker:any=null;
 let pickerKinds:string[]=['file','knowledge'];
 let showFiles=false;
 let showActions=false,showTools=false;
 let auxiliaryPane:any=null,auxiliaryKind='',browserTurn:CompanyTurn|null=null;
 async function openWorkspacePane(kind:string){
  if(!company)return;
  const companyId=company.id,currentToken=token;
  if(kind==='browser'){
   showActions=false;showFiles=false;
   if(!room){error='Open a bot or channel conversation first.';return;}
   const roomTurns=Object.values(turns).filter(t=>t.conversationId===room.id&&['RUNNING','ANSWERED'].includes(t.status)&&(!bot?.id||t.botId===bot.id));
   const fallbackTurn=roomTurns.at(-1)||Object.values(turns).filter(t=>t.conversationId===room.id&&['RUNNING','ANSWERED'].includes(t.status)).at(-1)||null;
   const targetBotId=fallbackTurn?.botId||bot?.id||(Array.isArray(room.agentIds)&&room.agentIds[0])||bots[0]?.id||'';
   if(!targetBotId){error='Add a company bot to this conversation to use the AI browser.';return;}
   browserTurn=fallbackTurn;auxiliaryKind='browser';
   await presentBrowserWorkspace({companyId,conversationId:room.id,botId:targetBotId,runId:fallbackTurn?.runId||('direct-'+room.id)},true);
   void refreshBrowserWorkspace(true);
   return;
  }
  const component=(await import('$lib/components/enterprise/panes/ComputerWorkspacePane.svelte')).default;
  if(company?.id!==companyId||token!==currentToken)return;
  showActions=false;showFiles=false;auxiliaryKind=kind;registerPanel('computer','Computer',component,{});
 }

 async function toggleFiles(){
  if(!company)return;
  if(!FilePicker)FilePicker=(await import('$lib/components/enterprise/panes/CompanyFiles.svelte')).default;
  showFiles=!showFiles;
 }
 async function openResource(ref:any){
  if(!company||ref?.scope!=='company'||ref.ownerId!==company.id||!['file','knowledge','project','task','sheet','email'].includes(ref.kind)||typeof ref.id!=='string')return;
  const identity=company.id,currentToken=token;
  const pane=['task','sheet','email'].includes(ref.kind)?(await import('$lib/components/enterprise/panes/StructuredResourcePane.svelte')).default:(await import('$lib/components/enterprise/panes/FileWorkspacePane.svelte')).default;
  if(company?.id!==identity||token!==currentToken)return;
  ResourcePane=pane;selectedResource=null;registerPanel(ref.kind+':'+ref.id,ref.title||ref.kind.charAt(0).toUpperCase()+ref.kind.slice(1),pane,{resource:ref});showFiles=false;
 }

 let dispatchBatches:Record<string,{roomId:string;items:any[];settled:boolean}>={},dispatchReading=false;
 let botRoomActivity:Record<string,number>={},notificationCursor='',notificationsReading=false;const activityCursors=new Map<string,number>();
 $: sidebarBots=botSidebar(bots,roomIndex,botRoomActivity);
 let chatImageDrafts:Record<string,ChatImageDraft[]>={};const imageUploads=new Map<string,AbortController>();
 $: chatImages=room?chatImageDrafts[room.id]||[]:[];
 let channels:any[]=[],channel:any=null,dispatchBot='',humanTarget:any=null,roomIndex:any[]=[],roomRoster:any=null,membershipApi:ReturnType<typeof createRoomMembersApi>|null=null;
 let mentionRanges:any[]=[],enterpriseMessagingReady=false,indexReading=false,lastIndexRead=0,rosterReading=false,rosterGeneration=0;
 const mentionDrafts=new Map<string,any[]>(),humanRoomIds=new Map<string,string>(),humanDmKeys=new Map<string,string>(),readThrough=new Map<string,number>(),indexedRoomCursors=new Map<string,number>();let lastDirectoryRead=0;
 let token='',email='',password='',draft='',error='',loading=true,sending=false,signing=false,stopping=false,view='Bots',menu=false;
 let client:CompanyClient|null=null,ctrl=new AbortController(),epoch=0,reading=false,timer:ReturnType<typeof setInterval>,refreshTimer:ReturnType<typeof setTimeout>,scroller:HTMLElement,stick=true;
 // Keep following incoming messages and streamed responses while the viewer is at the bottom.
 // A user scrolling up intentionally disables follow until they return to the bottom.
 function followChatHeight(node:HTMLElement){
  const content=node.querySelector('.chat-column');
  if(!content||typeof ResizeObserver==='undefined')return {destroy(){}};
  let frame=0,inputUntil=0,pointerActive=false;
  const nearBottom=()=>node.scrollHeight-node.scrollTop-node.clientHeight<90;
  const markInput=()=>{inputUntil=performance.now()+450;};
  const onScroll=()=>{
   // A content growth or programmatic scroll must never be interpreted as a
   // deliberate upward scroll. Only human input temporarily arms this fence.
   if(pointerActive||performance.now()<inputUntil)stick=nearBottom();
  };
  const onWheel=()=>markInput();
  const onTouch=()=>markInput();
  const onPointerDown=(event:PointerEvent)=>{
   if(event.pointerType==='mouse')pointerActive=true;
   markInput();
  };
  const onPointerUp=()=>{pointerActive=false;markInput();};
  const onRoomOpen=()=>{inputUntil=0;pointerActive=false;};
  node.addEventListener('starli-chat-room-open',onRoomOpen);
  const onKeyDown=(event:KeyboardEvent)=>{
   if(['PageUp','PageDown','ArrowUp','ArrowDown','Home','End',' '].includes(event.key))markInput();
  };
  node.addEventListener('scroll',onScroll,{passive:true});
  node.addEventListener('wheel',onWheel,{passive:true});
  node.addEventListener('touchstart',onTouch,{passive:true});
  node.addEventListener('touchmove',onTouch,{passive:true});
  node.addEventListener('pointerdown',onPointerDown,{passive:true});
  window.addEventListener('pointerup',onPointerUp,{passive:true});
  node.addEventListener('keydown',onKeyDown);
  const observer=new ResizeObserver(()=>{
   if(!stick||!node.isConnected)return;
   cancelAnimationFrame(frame);
   frame=requestAnimationFrame(()=>{if(stick&&node.isConnected)node.scrollTop=node.scrollHeight;});
  });
  observer.observe(content);
  return {destroy(){
   observer.disconnect();cancelAnimationFrame(frame);
   node.removeEventListener('scroll',onScroll);
   node.removeEventListener('wheel',onWheel);
   node.removeEventListener('touchstart',onTouch);
   node.removeEventListener('touchmove',onTouch);
   node.removeEventListener('pointerdown',onPointerDown);
   window.removeEventListener('pointerup',onPointerUp);
   node.removeEventListener('keydown',onKeyDown);
   node.removeEventListener('starli-chat-room-open',onRoomOpen);
  }};
 }

 let pending:{key:string,fingerprint:string}|null=null;const drafts=new Map<string,string>(),writeKeys=new Map<string,string>(),enc=encodeURIComponent;
 const draftKey=()=>humanTarget?'human:'+humanTarget.id:channel?'channel:'+channel.id:bot?'bot:'+bot.id:'';
 $: active=Object.values(turns).filter(t=>!turnFinished(t.status)&&!hiddenActivityRuns.has(t.runId)&&room?.agentIds?.includes(t.botId));$: working=active.length>0;$: index=Math.max(0,bots.findIndex(b=>b.id===bot?.id));
 async function api(path:string,signal=ctrl.signal,options:RequestInit={}){const current=token,lifecycle=ctrl;const r=await fetch(path,{...options,signal,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(current?{Authorization:'Bearer '+current}:{}),...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});if(signal.aborted||lifecycle!==ctrl||token!==current)throw new DOMException('Session changed','AbortError');if(!r.ok){
 let message=r.status===401?'Please sign in to continue.':r.status===403?'Access to this company resource is unavailable.':'Request failed (HTTP '+r.status+').';
 if(path==='/api/v1/auths/signin'){
  const detail=await r.json().catch(()=>null);
  if(typeof detail?.detail==='string'&&detail.detail.length<=240)message=detail.detail;
  else if(r.status===400)message='Check your email and password and try again.';
  else if(r.status===429)message='Please wait before trying to sign in again.';
 }
 const e:any=new Error(message);e.status=r.status;throw e;
}if(!r.headers.get('content-type')?.includes('application/json'))throw Error('Unexpected service response.');const data=await r.json();if(signal.aborted||lifecycle!==ctrl||token!==current)throw new DOMException('Session changed','AbortError');return data;}

 let claimedBuildIntentId='';
 let claimedOriginalPromptId='';
 $: claimedOriginalMessages=claimedBuildScope&&company?.id===claimedBuildScope.companyId&&room?.id===claimedBuildScope.roomId
  ?messages.filter((message:any)=>message.roomId===claimedBuildScope!.roomId&&message.speaker?.kind==='system'&&message.speaker?.id==='starli-guest-intake'&&(!claimedOriginalPromptId||message.id===claimedOriginalPromptId)):[];
 $: claimedOriginalPrompt=claimedOriginalMessages.length===1?claimedOriginalMessages[0]:null;

 let modelWorkspace:any=null;
 let modelCoordinatorId='';
 let modelConversationMode:'CHECKING'|'MODEL'|'LEGACY'|'DENIED'='CHECKING';
 let modelReadError='';
 $: isModelRoom=modelConversationMode==='MODEL'&&modelWorkspace?.claimTransfer?.companyId===company?.id&&modelWorkspace?.claimTransfer?.roomId===room?.id;
 let modelPollTimer:ReturnType<typeof setTimeout>|undefined;
 let modelPollGeneration=0;
 function stopModelPolling(){modelPollGeneration++;clearTimeout(modelPollTimer);}
 onDestroy(stopModelPolling);
 function presentModelApp(){
  const build=guestBuild(modelWorkspace),transfer=modelWorkspace?.claimTransfer;
  if(modelConversationMode!=='MODEL'||!build||!transfer?.complete||
    transfer.companyId!==company?.id||transfer.roomId!==room?.id)return;
  const key='model-app:'+company.id+':'+room.id;
  const props={build,intentId:claimedBuildIntentId,companyId:transfer.companyId,projectId:transfer.projectId,owner:true};
  if(openPanels.some(panel=>panel.key===key))openPanels=openPanels.map(panel=>panel.key===key?{...panel,props}:panel);
  else registerPanel(key,'Application',GuestModelAppPreview,props);
  activePanelKey=key;panelsMinimized=false;
 }
 async function readModelConversation(lifecycle:AbortController){
  const intent=claimedBuildIntentId,companyId=company?.id,roomId=room?.id;
  const result=await readClaimedConversation(intent,localStorage.token||token||'',lifecycle.signal);
  if(lifecycle!==ctrl||company?.id!==companyId||room?.id!==roomId)return false;
  const transfer=(result as any).claimTransfer;
  if(transfer?.complete!==true||transfer.companyId!==companyId||transfer.roomId!==roomId)
   throw Error('Claimed conversation binding could not be verified.');
  modelWorkspace=result;
  if((result as any).build&&!guestBuild(result))throw Error('Model application state could not be verified.');
  modelConversationMode=guestBuild(result)?'MODEL':'LEGACY';
  modelReadError='';
  if(modelConversationMode==='MODEL')presentModelApp();
  return true;
 }
 function beginModelPolling(lifecycle:AbortController){
  stopModelPolling();const generation=modelPollGeneration,deadline=Date.now()+90000;
  async function poll(){
   if(lifecycle!==ctrl||lifecycle.signal.aborted||generation!==modelPollGeneration)return;
   try{
    if(!await readModelConversation(lifecycle))return;
    if(!['QUEUED','RUNNING'].includes(guestBuild(modelWorkspace)?.status||''))return;
   }catch(cause){if(lifecycle===ctrl)modelReadError=(cause as Error).message;return;}
   if(Date.now()>=deadline)return;
   if(generation===modelPollGeneration)modelPollTimer=setTimeout(poll,2000);
  }
  modelPollTimer=setTimeout(poll,2000);
 }
 let claimedBuildScope:ClaimedBuildScope|null=null;
 let claimedBuildAdmission:ClaimedBuildAdmission|null=null;
 let claimedBuildBusy=false,claimedBuildError='',claimedBuildUnavailable=false;
 let claimedBuildKey='';
 async function startClaimedBuild(){
  const scope=claimedBuildScope,lifecycle=ctrl;
  if(modelConversationMode!=='LEGACY'||!scope||!actor?.id||claimedBuildBusy||claimedBuildAdmission||
    company?.id!==scope.companyId||room?.id!==scope.roomId)return;
  claimedBuildBusy=true;claimedBuildError='';
  if(!claimedBuildKey)claimedBuildKey=crypto.randomUUID();
  const request=new AbortController();
  const abort=()=>request.abort();
  lifecycle.signal.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,15000);
  try{
   if(!await verifyCompany(epoch)||lifecycle!==ctrl)return;
   const admission=await confirmClaimedBuild({
    scope,authToken:localStorage.token||token||'',idempotencyKey:claimedBuildKey,
    signal:request.signal,fetcher:fetch
   });
   if(lifecycle!==ctrl||company?.id!==scope.companyId||room?.id!==scope.roomId)return;
   claimedBuildAdmission=admission;
   wave1GraphId=admission.graphId;
   wave1ProgressItems=[];wave1ProgressContext={};wave1ProgressOverride=null;
   beginWave1Polling(scope.companyId,scope.roomId,lifecycle);
   await refresh(epoch);
  }catch(cause){
   if(lifecycle!==ctrl)return;
   const status=(cause as any).status;
   claimedBuildError=(cause as Error).name==='AbortError'?'Confirmation timed out. Retry uses the same request.':(cause as Error).message;
   if(status===401||status===403){claimedBuildUnavailable=true;stopWave1Polling();}
  }finally{
   clearTimeout(timeout);lifecycle.signal.removeEventListener('abort',abort);
   if(lifecycle===ctrl)claimedBuildBusy=false;
  }
 }


 let claimedPreviewReading=false;
 async function refreshClaimedPreview(lifecycle:AbortController){
  const admission=claimedBuildAdmission,intent=claimedBuildIntentId;
  if(!admission||!intent||claimedPreviewReading||lifecycle!==ctrl||company?.id!==admission.companyId||room?.id!==admission.roomId)return;
  claimedPreviewReading=true;
  try{
   const response=await fetch('/api/v1/starli/grokbot1/claims/'+encodeURIComponent(intent)+'/preview'+(wave1Preview?.trustedFrameUrl?'/bootstrap':''),{
    method:'POST',headers:{Authorization:'Bearer '+(localStorage.token||token||''),'Content-Type':'application/json'},
    body:'{}',signal:lifecycle.signal
   });
   if(lifecycle!==ctrl||claimedBuildAdmission!==admission)return;
   if(!response.ok){
    if(wave1Preview&&(response.status===401||response.status===403))wave1Preview={...wave1Preview,authorityState:'REVOKED',statusMessage:'Current preview authority denied access.'};
    return;
   }
   const pd=await response.json();
   if(response.status===202&&pd.authorityState==='PENDING')return;
   if(pd.companyId!==admission.companyId||pd.projectId!==admission.projectId||pd.graphId!==admission.graphId||pd.sourceMessageId!==admission.sourceMessageId)throw Error('Preview build scope mismatch');
   const previous=wave1Preview;
   const sameSession=samePreviewSession(previous,pd);
   if(previous&&!sameSession)wave1Preview={...previous,authorityState:'LOADING',trustedFrameUrl:null,previewOrigin:pd.previewOrigin,statusMessage:'Reconnecting to the restarted private app.'};
   if(!sameSession){
    if(typeof pd.bootstrapTicket!=='string'||typeof pd.previewOrigin!=='string')throw Error('Preview bootstrap transport missing');
    const boot=await bootstrapPreviewSession({previewOrigin:pd.previewOrigin,bootstrapTicket:pd.bootstrapTicket,signal:lifecycle.signal,fetcher:fetch});
    if(!boot.ok)throw Error('Private preview session bootstrap denied');
    if(lifecycle!==ctrl||claimedBuildAdmission!==admission)return;
   }
   wave1Preview={receipt:pd.receipt??null,expectedCompanyId:admission.companyId,expectedProjectId:admission.projectId,authorizedPreviewId:String(pd.authorizedPreviewId||pd.previewId||''),expectedRevision:Number(pd.expectedRevision??pd.receipt?.revision??0),receiptSignatureValid:pd.receiptSignatureValid===true,ticketValidatedByNativeServer:pd.ticketValidatedByNativeServer===true,isolatedStorageAttested:pd.isolatedStorageAttested===true,authorityState:pd.authorityState||'PENDING',previewOrigin:pd.previewOrigin||null,parentOrigin:location.origin,trustedFrameUrl:sameSession?previous!.trustedFrameUrl:(pd.trustedFrameUrl||pd.previewUrl||null),allowStagingLoopback:pd.allowStagingLoopback===true,statusMessage:pd.statusMessage||''};
  }catch(cause){if(lifecycle===ctrl&&wave1Preview)wave1Preview={...wave1Preview,authorityState:'ERROR',statusMessage:'Preview authority could not be checked.'};}
  finally{claimedPreviewReading=false;}
 }
 let wave1PollTimer:ReturnType<typeof setTimeout>|undefined;
 let wave1PollGeneration=0;
 function stopWave1Polling(){
  wave1PollGeneration++;
  clearTimeout(wave1PollTimer);
 }
 function beginWave1Polling(companyId:string,roomId:string,lifecycle:AbortController){
  stopWave1Polling();
  const generation=wave1PollGeneration;
  async function poll(){
   if(generation!==wave1PollGeneration||lifecycle!==ctrl||lifecycle.signal.aborted||
      company?.id!==companyId||room?.id!==roomId)return;
   if(!document.hidden){
    const request=new AbortController();
    const abort=()=>request.abort();
    lifecycle.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,10000);
    try{
     if(wave1GraphId){
      const graphId=wave1GraphId;
      const progress=await fetchAuthoritativeProgress({
       graphId,authToken:localStorage.token||token||'',expectedCompanyId:companyId,
       fetcher:fetch,signal:request.signal
      });
      if(generation!==wave1PollGeneration||lifecycle!==ctrl||
         company?.id!==companyId||room?.id!==roomId||graphId!==wave1GraphId)return;
      if(claimedBuildAdmission&&progress.envelope){
       const expected=progress.envelope.expectedContext;
       if(expected.projectId!==claimedBuildAdmission.projectId||
          expected.requestId!==claimedBuildAdmission.requestId||
          expected.sourceMessageId!==claimedBuildAdmission.sourceMessageId||
          expected.graphId!==claimedBuildAdmission.graphId){
        wave1ProgressItems=[];wave1ProgressOverride=null;
        wave1StopError='Worker progress does not match this confirmed build.';
        stopWave1Polling();return;
       }
      }
      if(progress.ok)await refreshClaimedPreview(lifecycle);
      wave1ProgressItems=progress.envelope?.items||[];
      wave1ProgressContext=progress.envelope?.expectedContext||{};
      wave1ProgressOverride=progress.summary;
      if(progress.httpStatus===401||progress.httpStatus===403){
       wave1StopDisposition='REVOKED';stopWave1Polling();return;
      }
     }
    }finally{clearTimeout(timeout);lifecycle.signal.removeEventListener('abort',abort);}
   }
   if(generation===wave1PollGeneration)wave1PollTimer=setTimeout(poll,2500);
  }
  wave1PollTimer=setTimeout(poll,2500);
 }
 onDestroy(stopWave1Polling);
 let wave1GraphId='';
 let wave1ProgressItems:any[]=[];
 let wave1ProgressContext:any={};
 let wave1ProgressOverride:any=null;
 let wave1Stopping=false;
 let wave1StopDisposition:'NONE'|'STOP_PENDING'|'STOPPED'|'ALREADY_COMPLETED'|'REVOKED'|'HOLD_UNCERTAIN'='NONE';
 let wave1StopError='';
 let wave1Preview:{
  receipt:BoundPreviewReceipt|null;
  expectedCompanyId:string;
  expectedProjectId:string;
  authorizedPreviewId:string;
  expectedRevision:number;
  receiptSignatureValid:boolean;
  ticketValidatedByNativeServer:boolean;
  isolatedStorageAttested:boolean;
  authorityState:PreviewAuthorityState;
  previewOrigin:string|null;
  parentOrigin:string|null;
  trustedFrameUrl:string|null;
  allowStagingLoopback:boolean;
  statusMessage:string;
 }|null=null;

 function resetWave1Panels(markRevoked=false){
  stopModelPolling();modelWorkspace=null;modelCoordinatorId='';modelConversationMode='CHECKING';modelReadError='';
  stopWave1Polling();
  claimedBuildIntentId='';claimedOriginalPromptId='';
  claimedBuildScope=null;claimedBuildAdmission=null;claimedBuildBusy=false;
  claimedBuildError='';claimedBuildUnavailable=false;claimedBuildKey='';
  wave1Stopping=false;
  wave1StopError='';
  if(markRevoked){
   if(wave1GraphId){
    wave1StopDisposition='REVOKED';
    wave1ProgressContext={...wave1ProgressContext,revoked:true};
    wave1ProgressOverride=null;
   }
   if(wave1Preview){
    wave1Preview={...wave1Preview,authorityState:'REVOKED',statusMessage:'Session or company authority revoked.'};
   }
  }else{
   wave1GraphId='';
   wave1ProgressItems=[];
   wave1ProgressContext={};
   wave1ProgressOverride=null;
   wave1StopDisposition='NONE';
   wave1Preview=null;
  }
 }

 async function loadWave1OrchestrationAndPreview(targetCompanyId:string,lifecycle:AbortController){
  const authToken=localStorage.token||token||'';
  if(!authToken||!targetCompanyId||lifecycle!==ctrl)return;
  const params=new URLSearchParams(location.search);
  let graphId=params.get('graphId')||'';
  if(!graphId){
   try{
    const ar=await fetch('/api/v1/starli/orchestration/active?companyId='+encodeURIComponent(targetCompanyId),{
     headers:{Authorization:'Bearer '+authToken,Accept:'application/json'},
     signal:lifecycle.signal
    });
    if(ar.ok){
     const ad=await ar.json();
     if(typeof ad?.graphId==='string'&&ad.graphId)graphId=ad.graphId;
    }
   }catch{}
  }
  if(graphId&&lifecycle===ctrl){
   wave1GraphId=graphId;
   const prog=await fetchAuthoritativeProgress({
    graphId,
    authToken,
    expectedCompanyId:targetCompanyId,
    fetcher:fetch,
    signal:lifecycle.signal
   });
   if(lifecycle===ctrl){
    if(prog.ok&&prog.envelope){
     wave1ProgressItems=prog.envelope.items;
     wave1ProgressContext=prog.envelope.expectedContext;
     wave1ProgressOverride=null;
    }else{
     wave1ProgressItems=[];
     wave1ProgressOverride=prog.summary;
     if(prog.httpStatus===401||prog.httpStatus===403)wave1StopDisposition='REVOKED';
    }
   }
  }
  try{
   const pr=await fetch('/api/v1/starli/preview/active?companyId='+encodeURIComponent(targetCompanyId),{
    headers:{Authorization:'Bearer '+authToken,Accept:'application/json'},
    signal:lifecycle.signal
   });
   if(lifecycle!==ctrl)return;
   if(pr.status===401||pr.status===403){
    wave1Preview={
     receipt:null,expectedCompanyId:targetCompanyId,expectedProjectId:'',authorizedPreviewId:'',expectedRevision:0,
     receiptSignatureValid:false,ticketValidatedByNativeServer:false,isolatedStorageAttested:false,
     authorityState:pr.status===401?'REVOKED':'DENIED',previewOrigin:null,parentOrigin:location.origin,
     trustedFrameUrl:null,allowStagingLoopback:false,statusMessage:'Preview access denied or revoked by authority.'
    };
   }else if(pr.ok){
    const pd=await pr.json();
    if(pd&&pd.active!==false){
     wave1Preview={
      receipt:pd.receipt??null,
      expectedCompanyId:targetCompanyId,
      expectedProjectId:String(pd.expectedProjectId||pd.receipt?.projectId||''),
      authorizedPreviewId:String(pd.authorizedPreviewId||pd.receipt?.previewId||''),
      expectedRevision:Number(pd.expectedRevision??pd.receipt?.revision??0),
      receiptSignatureValid:pd.receiptSignatureValid===true,
      ticketValidatedByNativeServer:pd.ticketValidatedByNativeServer===true,
      isolatedStorageAttested:pd.isolatedStorageAttested===true,
      authorityState:(pd.authorityState||'PENDING') as PreviewAuthorityState,
      previewOrigin:typeof pd.previewOrigin==='string'?pd.previewOrigin:null,
      parentOrigin:location.origin,
      trustedFrameUrl:typeof pd.trustedFrameUrl==='string'?pd.trustedFrameUrl:null,
      allowStagingLoopback:pd.allowStagingLoopback===true,
      statusMessage:typeof pd.statusMessage==='string'?pd.statusMessage:''
     };
    }
   }
  }catch{}
 }

 async function handleWave1Stop(event:CustomEvent<{graphId:string}>){
  const gid=event.detail?.graphId||wave1GraphId;
  const authToken=localStorage.token||token||'';
  if(!gid||!authToken||wave1Stopping)return;
  wave1Stopping=true;
  wave1StopError='';
  try{
   const res=await requestAuthoritativeStop({
    graphId:gid,
    authToken,
    reason:'user_requested_stop',
    fetcher:fetch,
    signal:ctrl.signal
   });
   wave1StopDisposition=res.disposition;
   if(res.disposition==='ALREADY_COMPLETED'){wave1StopError='';return;}
   if(res.envelope){
    wave1ProgressItems=res.envelope.items;
    wave1ProgressContext=res.envelope.expectedContext;
    wave1ProgressOverride=res.summary;
   }else{
    wave1ProgressOverride=res.summary;
   }
   if(!res.ok&&res.error)wave1StopError=res.error;
  }finally{
   wave1Stopping=false;
  }
 }

 function handleWave1PreviewMessage(ev:MessageEvent){
  if(!wave1Preview||!wave1Preview.previewOrigin)return;
  if(ev.origin!==wave1Preview.previewOrigin)return;
  const d=ev.data;
  if(d&&d.type==='STARLI_PREVIEW_AUTHORITY_REVOKED'){
   wave1Preview={...wave1Preview,authorityState:'REVOKED',statusMessage:String(d.message||'Preview authority revoked.')};
  }
 }

 function revoke(status:number,message:string){resetWave1Panels(status===401||status===403);clearPastedImages();hiddenSocialMessages=new Set();previewGeneration++;previewDismissed.clear();previewRevisions.clear();previewItems=[];previewForce=false;previewsReading=false;browserDismissed.clear();browserSequences.clear();browserLastRead=0;browserForce=false;browserReading=false;dispatchBatches={};dispatchReading=false;botRoomActivity={};notificationCursor='';notificationsReading=false;activityCursors.clear();membershipApi?.close();membershipApi=null;roomRoster=null;roomIndex=[];humanTarget=null;mentionRanges=[];mentionDrafts.clear();humanRoomIds.clear();humanDmKeys.clear();readThrough.clear();indexedRoomCursors.clear();lastDirectoryRead=0;enterpriseMessagingReady=false;rosterReading=false;indexReading=false;accountMenu=false;openPanels=[];activePanelKey='';panelsMinimized=false;auxiliaryPane=null;showActions=false;showTools=false;browserTurn=null;selectedResource=null;showFiles=false;selectedSettingsBotId='';epoch++;ctrl.abort();client?.close();client=null;ctrl=new AbortController();clearTimeout(refreshTimer);company=null;bots=[];people=[];channels=[];bot=null;channel=null;room=null;messages=[];turns={};liveTexts={};hiddenActivityRuns=new Set();draft='';dispatchBot='';pending=null;drafts.clear();writeKeys.clear();reading=false;sending=false;stopping=false;signing=false;loading=false;menu=false;view='Bots';if(status===401){actor=null;token='';localStorage.removeItem('token');}error=message;}
 async function verifyCompany(version=epoch){if(!company||!actor)return false;const companyId=company.id,actorId=actor.id;let raw;try{raw=await api('/api/v1/companies/'+enc(companyId)+'/capabilities');}catch(e){if(version!==epoch||(e as Error).name==='AbortError')return false;const status=(e as any).status;if([401,403,404].includes(status)){revoke(status,status===401?'Your session expired. Sign in to continue.':'Company access changed. Reload to open an available workspace.');return false;}throw e;}if(version!==epoch)return false;try{const scope=parseNativeAuthority(raw,companyId,actorId);company={...company,scope,role:scope.role,revision:scope.membership_revision};return true;}catch{revoke(403,'Company authority could not be verified. Reload to continue.');return false;}}
 async function accessDenied(status:number,version=epoch){if(version!==epoch)return;if(status===401){revoke(401,'Your session expired. Sign in to continue.');return;}if(![403,404].includes(status))return;try{if(!await verifyCompany(version)||version!==epoch)return;}catch{if(version!==epoch)return;revoke(403,'Access could not be verified. Reload to continue.');return;}if(version!==epoch)return;const key=draftKey();drafts.delete(key);mentionDrafts.delete(key);mentionRanges=[];roomRoster=null;epoch++;room=null;messages=[];turns={};liveTexts={};hiddenActivityRuns=new Set();draft='';dispatchBot='';pending=null;error='This conversation is no longer available. Select another conversation.';}
 async function initialize(){const lifecycle=ctrl;loading=true;error='';try{const who=await api('/api/v1/auths/');if(lifecycle!==ctrl)return;actor=who;const list=await listNativeCompanies(api,ctrl.signal);
  const {intentId:onboardingIntentId,cleanedPath:onboardingCleanPath}=extractOnboardingIntentParam(location.href);
  if(onboardingIntentId){
   // Retain opaque intent route across reload; server freshly authorizes every resume.
   const targetRes=await resolveVerifiedAppOnboardingTarget({
    intentId:onboardingIntentId,
    companies:list,
    getBearerToken:()=>localStorage.token||token||null,
    fetcher:fetch,
    activateCompany:async(targetCompany)=>{
     const selectedCompany=await activateNativeCompany(api,actor.id,targetCompany,ctrl.signal);
     if(lifecycle!==ctrl)return;
     company=selectedCompany;
     bots=company.directory.filter((x:any)=>x.kind==='bot');
     people=company.directory.filter((x:any)=>x.kind==='person');
     client?.close();client=new CompanyClient(company.id,()=>localStorage.token||'',fetch,true);
     membershipApi?.close();membershipApi=createRoomMembersApi(company.id,actor.id,ctrl.signal);
    },
    verifyCompanyAuthority:async(targetCompanyId)=>company?.id===targetCompanyId&&await verifyCompany(epoch),
    openVerifiedRoom:async(targetCompanyId,channelRoomId)=>{
     const rooms=await client!.request('/rooms');
     if(lifecycle!==ctrl)return false;
     roomIndex=(rooms.rooms||[]).filter((r:any)=>r.companyId===targetCompanyId);
     channels=roomIndex.filter((r:any)=>r.companyId===targetCompanyId&&r.kind==='channel');
     const targetChannel=channels.find((c:any)=>c.id===channelRoomId);
     if(!targetChannel)return false;
     await chooseChannel(targetChannel);
     return room?.id===channelRoomId;
    }
   });
   if(lifecycle!==ctrl)return;
   if(targetRes.activated){
    claimedBuildIntentId=onboardingIntentId;
    modelCoordinatorId=targetRes.navigation?.bossBotId||'';
    claimedOriginalPromptId=(targetRes.navigation as any)?.originalPromptMessageId||'';
    if(targetRes.navigation?.projectId&&targetRes.companyId&&targetRes.channelRoomId){
     claimedBuildScope={intentId:onboardingIntentId,companyId:targetRes.companyId,
      projectId:targetRes.navigation.projectId,roomId:targetRes.channelRoomId};
    }
    if(company?.id&&room?.id&&claimedBuildScope){
     try{
      if(!await readModelConversation(lifecycle))return;
      if(modelConversationMode==='MODEL'){beginModelPolling(lifecycle);return;}
     }catch(cause){
      // Historical projects may have a canonical legacy admission but predate guest-history transfer.
      let legacy=false;
      if((cause as any).status===409){
       try{
        const existing=await resumeClaimedBuild({scope:claimedBuildScope,authToken:localStorage.token||token||'',signal:lifecycle.signal,fetcher:fetch});
        legacy=Boolean(existing);
       }catch{}
      }
      if(lifecycle!==ctrl)return;
      if(legacy)modelConversationMode='LEGACY';
      else{modelConversationMode='DENIED';modelReadError=(cause as Error).message;return;}
     }

     claimedBuildBusy=true; // disable new admission until persisted execution lookup finishes
     try{
      const persisted=await resumeClaimedBuild({scope:claimedBuildScope,authToken:localStorage.token||token||'',signal:lifecycle.signal,graphId:new URLSearchParams(location.search).get('graphId')||undefined,fetcher:fetch});
      if(lifecycle!==ctrl)return;
      if(persisted){claimedBuildAdmission=persisted;claimedOriginalPromptId=persisted.originalPromptMessageId;wave1GraphId=persisted.graphId;beginWave1Polling(company.id,room.id,lifecycle);}
     }catch(cause){if(lifecycle===ctrl){claimedBuildUnavailable=true;claimedBuildError=(cause as Error).message;}}
     finally{if(lifecycle===ctrl)claimedBuildBusy=false;}
    }
    return;
   }
   if(targetRes.error){error=targetRes.error;return;}
  }
  const chosen=list.find(c=>c.name.trim().toLowerCase()==='starlidigital')||list.find(c=>c.name.trim().toLowerCase()==='starlidigital2')||list[0];if(lifecycle!==ctrl)return;if(!chosen){error='No company membership is available.';return;}const selectedCompany=await activateNativeCompany(api,actor.id,chosen,ctrl.signal);if(lifecycle!==ctrl)return;company=selectedCompany;bots=company.directory.filter((x:any)=>x.kind==='bot');people=company.directory.filter((x:any)=>x.kind==='person');client?.close();client=new CompanyClient(company.id,()=>localStorage.token||'',fetch,true);membershipApi?.close();membershipApi=createRoomMembersApi(company.id,actor.id,ctrl.signal);const rooms=await client.request('/rooms');if(lifecycle!==ctrl)return;roomIndex=(rooms.rooms||[]).filter((r:any)=>r.companyId===company.id);channels=roomIndex.filter((r:any)=>r.companyId===company.id&&r.kind==='channel');if(!await resumeAutomationConversation()){if(bots.length)await choose(bots[0]);else if(channels.length)await chooseChannel(channels[0]);}if(company?.id)void loadWave1OrchestrationAndPreview(company.id,lifecycle);}catch(e){if((e as Error).name==='AbortError')return;if([401,403,404].includes((e as any).status)){revoke((e as any).status,(e as Error).message);return;}error=(e as Error).message;}finally{if(lifecycle===ctrl)loading=false;}}
 async function signin(){if(ctrl.signal.aborted)ctrl=new AbortController();const lifecycle=ctrl;signing=true;error='';try{const d=await api('/api/v1/auths/signin',ctrl.signal,{method:'POST',body:JSON.stringify({email:email.trim(),password})});if(lifecycle!==ctrl)return;if(!d.token)throw Error('No session returned.');token=d.token;localStorage.token=token;password='';await initialize();}catch(e){if(lifecycle===ctrl&&(e as Error).name!=='AbortError')error=(e as Error).message;}finally{if(lifecycle===ctrl)signing=false;}}
 async function choose(b:any){showTools=false;showActions=false;if(auxiliaryKind==='browser'){auxiliaryPane=null;browserTurn=null;}stashDraft();const version=++epoch;stick=true;scroller?.dispatchEvent(new Event('starli-chat-room-open'));sending=false;stopping=false;humanTarget=null;channel=null;rosterReading=false;rosterGeneration++;roomRoster=null;dispatchBot='';bot=b;draft=drafts.get('bot:'+b.id)||'';mentionRanges=mentionDrafts.get('bot:'+b.id)||[];room=null;messages=[];turns={};liveTexts={};hiddenActivityRuns=new Set();pending=null;error='';menu=false;try{let r=await client!.request('/rooms','POST',{kind:'dm',visibility:'private',name:b.name,inviteUserIds:[],agentIds:[b.id]},crypto.randomUUID());if(version!==epoch)return;if(r.companyId!==company.id||r.kind!=='dm'||!Array.isArray(r.agentIds))throw Error('Bot conversation scope could not be verified.');if(!r.agentIds.includes(b.id)){if(r.agentIds.length||!membershipApi)throw Error('This conversation is not connected to the selected bot.');await membershipApi.add(r.id,b.id,ctrl.signal);if(version!==epoch)return;r=await client!.request('/rooms/'+enc(r.id));if(version!==epoch)return;}if(r.companyId!==company.id||r.kind!=='dm'||!Array.isArray(r.agentIds)||r.agentIds.length!==1||r.agentIds[0]!==b.id)throw Error('The selected bot is not authorized or ready for this conversation. Ask a company administrator to check its messaging/run permissions and provider selection. Your message has not been sent.');room=r;await refresh(version);}catch(e){if(version===epoch){error=(e as Error).message;await accessDenied((e as any).status,version);}}}

 async function chooseChannel(c:any){showTools=false;showActions=false;if(auxiliaryKind==='browser'){auxiliaryPane=null;browserTurn=null;}stashDraft();const version=++epoch;stick=true;scroller?.dispatchEvent(new Event('starli-chat-room-open'));sending=false;stopping=false;humanTarget=null;rosterReading=false;rosterGeneration++;roomRoster=null;channel=c;view='Channel';bot=null;dispatchBot='';draft=drafts.get('channel:'+c.id)||'';mentionRanges=mentionDrafts.get('channel:'+c.id)||[];room=null;messages=[];turns={};liveTexts={};hiddenActivityRuns=new Set();pending=null;error='';menu=false;try{const r=await client!.request('/rooms/'+enc(c.id));if(version!==epoch)return;if(r.companyId!==company.id||r.kind!=='channel'||r.id!==c.id)throw Error('Channel scope could not be verified.');room=r;await refresh(version);}catch(e){if(version===epoch){error=(e as Error).message;await accessDenied((e as any).status,version);}}}
 async function refresh(version=epoch){if(!company||reading||ctrl.signal.aborted)return;reading=true;const lifecycle=ctrl;try{if(!await verifyCompany(version)||version!==epoch||!room)return;const id=room.id;const r=await client!.request('/rooms/'+enc(id));if(version!==epoch)return;if(r.companyId!==company.id||r.id!==id)throw Error('Conversation access changed.');room=r;if(channel?.id===id)channel=r;void refreshAppPreviews();void refreshBrowserWorkspace();void refreshRoster(version);void refreshIndex(version);const after=Math.max(0,(Number.isSafeInteger(r.lastMessageSequence)?r.lastMessageSequence:0)-99);const d=await client!.request('/rooms/'+enc(id)+'/messages?after='+after+'&limit=100');if(version!==epoch)return;if(!Array.isArray(d.messages)||d.messages.some((m:any)=>m.roomId!==id))throw Error('Message scope changed.');messages=d.messages;void refreshDispatches(version);if(r.kind==='dm'){const timestamp=Math.max(0,...messages.map((m:any)=>Math.max(nativeTimestamp(m.updatedAt),nativeTimestamp(m.createdAt))));botRoomActivity={...botRoomActivity,[id]:Math.max(botRoomActivity[id]||0,timestamp)};}void markRead(id,Math.max(0,...messages.map(m=>Number.isSafeInteger(m.sequence)?m.sequence:0)),version);await Promise.all(messages.filter(m=>m.speaker?.kind==='agent'&&m.runId&&!turns[m.id]).map(async m=>{try{const t=verifiedCompanyTurn(await api('/api/v1/starli/companies/'+enc(company.id)+'/rooms/'+enc(id)+'/bots/'+enc(m.speaker.id)+'/runtime/turns/'+enc(m.runId)),company.id,id,m.id);if(t&&version===epoch)turns={...turns,[m.id]:t};}catch{}}));await tick();if(stick&&scroller)scroller.scrollTop=scroller.scrollHeight;}catch(e){if(version===epoch){error=(e as Error).message;await accessDenied((e as any).status,version);}}finally{if(lifecycle===ctrl)reading=false;}}
 async function createdBot(result:any){
 if(!company||result.companyId!==company.id||!result.botId)return;
 const id=company.id,version=epoch;
 try{const raw=await api('/api/v1/companies/'+enc(id)+'/directory');if(version!==epoch||company?.id!==id)return;
 const list=projectNativeDirectory(raw,company.scope);
 if(!Array.isArray(list))throw Error('The company directory could not be refreshed.');
 const next=list.filter((item:any)=>item.kind==='bot');
 if(!next.some((item:any)=>item.id===result.botId))throw Error('The new bot is not visible in the company directory yet. Reload before trying again.');
 bots=next;selectedSettingsBotId=result.botId;view='AgentSettings';
 }catch(e){error=(e as Error).message;}
 }
 function selectBotSettings(detail:{botId:string}){const selected=bots.find(b=>b.id===detail.botId);if(!selected||!company)return;selectedSettingsBotId=selected.id;view='AgentSettings';window.dispatchEvent(new CustomEvent('starli-enterprise-agent-settings',{detail:{companyId:company.id,botId:selected.id,membershipRevision:company.revision}}));}
 function closeAgentSettings(dirty:boolean){
  if(dirty&&!confirm('Discard unsaved agent settings?'))return;
  selectedSettingsBotId='';view='BotDirectory';
 }
 function savedAgentProfile(event:any){
  if(event.companyId!==company?.id||event.botId!==selectedSettingsBotId)return;
  bots=bots.map(item=>item.id===event.botId?{...item,name:event.name}:item);
  if(bot?.id===event.botId)bot={...bot,name:event.name};
 }
 function refreshSoon(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>void refresh(),120);}
 function streamContent(value:any){
  const turn=turns[value.assistantMessageId];
  if(!turn||turn.runId!==value.runId||turn.companyId!==company?.id||turn.conversationId!==room?.id||typeof value.text!=='string')return;
  liveTexts={...liveTexts,[value.assistantMessageId]:value.text};
  void tick().then(()=>{if(stick&&scroller)scroller.scrollTop=scroller.scrollHeight;});
 }
 function messageContent(message:any){
  const saved=message.content||'',live=liveTexts[message.id];
  return typeof live==='string'&&live.length>=saved.length&&live.startsWith(saved)?live:saved;
 }
 async function activityDenied(turn:CompanyTurn,status:number){if(!turn||turn.conversationId!==room?.id)return;const version=epoch,id=room.id;if(status===401){await accessDenied(401,version);return;}try{if(!await verifyCompany(version)||version!==epoch)return;const fresh=await client!.request('/rooms/'+enc(id));if(version!==epoch)return;if(fresh.companyId!==company.id||fresh.id!==id)throw Error('Room scope changed.');room=fresh;hiddenActivityRuns=new Set([...hiddenActivityRuns,turn.runId]);void refreshRoster(version);}catch(e){if(version===epoch)await accessDenied((e as any).status||403,version);}}
 function state(t:CompanyTurn){if(turns[t.assistantMessageId]?.runId===t.runId)turns={...turns,[t.assistantMessageId]:t};}

 function stashDraft(){const key=draftKey();if(key){drafts.set(key,draft);mentionDrafts.set(key,mentionRanges.map(r=>({...r})));}}
 function composerDraft(detail:any){if(detail.roomId!==room?.id)return;draft=detail.draft;mentionRanges=Array.isArray(detail.mentionRanges)?detail.mentionRanges:[];stashDraft();}
 async function chooseHuman(person:any){if(!company||!client||!people.some(p=>p.id===person.id)||person.id===actor?.id)return;stashDraft();const version=++epoch;stick=true;scroller?.dispatchEvent(new Event('starli-chat-room-open'));humanTarget=person;bot=null;channel=null;rosterReading=false;rosterGeneration++;roomRoster=null;view='HumanChat';room=null;messages=[];turns={};liveTexts={};hiddenActivityRuns=new Set();pending=null;sending=false;stopping=false;showActions=false;showTools=false;draft=drafts.get('human:'+person.id)||'';mentionRanges=mentionDrafts.get('human:'+person.id)||[];error='';menu=false;if(!humanDmKeys.has(person.id))humanDmKeys.set(person.id,crypto.randomUUID());try{const r=await client.request('/direct-messages/'+enc(person.id),'POST',{},humanDmKeys.get(person.id));if(version!==epoch)return;if(r.companyId!==company.id||r.kind!=='dm'||r.visibility!=='private')throw Error('Direct conversation scope could not be verified.');room=r;humanRoomIds.set(person.id,r.id);await refresh(version);}catch(e){if(version===epoch){error=(e as Error).message+' Direct messaging is not confirmed. Your draft is kept.';if((e as any).status===401)await accessDenied(401,version);}}}
 async function refreshRoster(version=epoch){const current=membershipApi,id=room?.id;if(!current||!id||rosterReading)return;rosterReading=true;const generation=++rosterGeneration;try{const roster=await current.snapshot(id,ctrl.signal);if(version!==epoch||current!==membershipApi||room?.id!==id)return;roomRoster=roster;enterpriseMessagingReady=true;const humans=roster.members.filter(m=>m.kind==='human'&&m.id!==actor.id);if(room.kind==='dm'&&humans.length===1)humanRoomIds.set(humans[0].id,id);}catch(e){if(version!==epoch)return;roomRoster=null;if((e as any).status===401)await accessDenied(401,version);}finally{if(current===membershipApi&&generation===rosterGeneration)rosterReading=false;}}
 async function refreshIndex(version=epoch,force=false){if(!client||indexReading||!force&&Date.now()-lastIndexRead<5000)return;const current=client,members=membershipApi;indexReading=true;try{const data=await current.request('/rooms?limit=100');if(current!==client||!company)return;if(!Array.isArray(data.rooms)||data.rooms.some((r:any)=>r.companyId!==company.id))throw Error('Room index scope changed.');roomIndex=data.rooms;channels=roomIndex.filter(r=>r.kind==='channel');lastIndexRead=Date.now();const changedDMs=roomIndex.filter(r=>r.kind==='dm'&&Array.isArray(r.agentIds)&&r.agentIds.length===1&&activityCursors.get(r.id)!==r.cursor);for(let offset=0;offset<changedDMs.length;offset+=4){await Promise.allSettled(changedDMs.slice(offset,offset+4).map(async r=>{const after=Math.max(0,(Number.isSafeInteger(r.lastMessageSequence)?r.lastMessageSequence:0)-99);const result=await current.request('/rooms/'+enc(r.id)+'/messages?after='+after+'&limit=100');if(current!==client||!company||r.companyId!==company.id)return;if(!Array.isArray(result.messages)||result.messages.some((m:any)=>m.roomId!==r.id))return;const timestamp=Math.max(0,...result.messages.map((m:any)=>Math.max(nativeTimestamp(m.updatedAt),nativeTimestamp(m.createdAt))));botRoomActivity={...botRoomActivity,[r.id]:Math.max(botRoomActivity[r.id]||0,timestamp)};activityCursors.set(r.id,r.cursor);}));}if(Date.now()-lastDirectoryRead>15000){const identity=company.id,raw=await api('/api/v1/companies/'+enc(identity)+'/directory');if(current!==client||company?.id!==identity)return;const directory=projectNativeDirectory(raw,company.scope);people=directory.filter(p=>p.kind==='person');bots=directory.filter(p=>p.kind==='bot');openPanels=openPanels.map(p=>p.key.startsWith('members:')?{...p,props:{...p.props,bots}}:p);lastDirectoryRead=Date.now();}if(enterpriseMessagingReady&&members){const pending=roomIndex.filter(r=>r.kind==='dm'&&indexedRoomCursors.get(r.id)!==r.cursor);for(let i=0;i<pending.length;i+=4){const results=await Promise.allSettled(pending.slice(i,i+4).map(async r=>({room:r,roster:await members.snapshot(r.id,ctrl.signal)})));if(current!==client||members!==membershipApi)return;for(const result of results){if(result.status!=='fulfilled')continue;const {room:r,roster}=result.value,others=roster.members.filter(m=>m.kind==='human'&&m.id!==actor?.id);if(others.length===1)humanRoomIds.set(others[0].id,r.id);indexedRoomCursors.set(r.id,r.cursor);}}}}catch(e){if(current===client&&(e as any).status===401)await accessDenied(401,epoch);}finally{if(current===client)indexReading=false;}}
 async function refreshDispatches(version=epoch){if(!client||!company||!room||dispatchReading)return;const current=client,id=room.id;dispatchReading=true;try{for(const [source,batch] of Object.entries(dispatchBatches).filter(([,batch])=>batch.roomId===id&&!batch.settled)){const result=await current.request('/rooms/'+enc(id)+'/dispatches/'+enc(source));if(version!==epoch||current!==client||room?.id!==id)return;if(result.companyId!==company.id||result.conversationId!==id||result.sourceMessageId!==source||!Array.isArray(result.items))continue;const expected=new Set(batch.items.map(item=>item.agentId));if(result.items.some((item:any)=>!expected.has(item.agentId)||typeof item.status!=='string'))continue;dispatchBatches={...dispatchBatches,[source]:{roomId:id,items:result.items,settled:result.settled===true}};for(const item of result.items){if(item.status!=='SUBMITTED'||!item.receipt)continue;const turn=verifiedCompanyTurn(item.receipt,company.id,id);if(turn)turns={...turns,[turn.assistantMessageId]:turn};}}}catch(e){if(current===client&&(e as any).status===401)await accessDenied(401,version);}finally{if(current===client)dispatchReading=false;}}
 async function refreshNotifications(){if(!client||!company||notificationsReading||ctrl.signal.aborted)return;const current=client,id=company.id;notificationsReading=true;try{for(let page=0;page<2;page++){const result=await current.request('/notifications?after='+enc(notificationCursor)+'&limit=100','GET',undefined,undefined,true);if(current!==client||company?.id!==id)return;if(!Array.isArray(result.notifications)||typeof result.next!=='string'||!/^[0-9]+$/.test(result.next))return;for(const notice of result.notifications){if(notice.companyId!==id||typeof notice.roomId!=='string'||notice.message?.roomId!==notice.roomId)continue;const timestamp=Math.max(nativeTimestamp(notice.message.updatedAt),nativeTimestamp(notice.message.createdAt));if(timestamp>0)botRoomActivity={...botRoomActivity,[notice.roomId]:Math.max(botRoomActivity[notice.roomId]||0,timestamp)};}notificationCursor=result.next;if(result.notifications.length)void refreshIndex(epoch,true);if(!result.hasMore)break;}}catch(e){if(current===client&&(e as any).status===401)await accessDenied(401,epoch);}finally{if(current===client)notificationsReading=false;}}
 function refreshVisibleWorkspace(){if(document.hidden)return;void refresh();void refreshNotifications();void refreshIndex(epoch,true);void refreshAppPreviews();void refreshBrowserWorkspace();}
 async function markRead(id:string,sequence:number,version:number){if(!client||sequence<=0||version!==epoch||room?.id!==id||document.hidden||!['Bots','Channel','HumanChat'].includes(view)||sequence<=(readThrough.get(id)||0))return;const current=client;readThrough.set(id,sequence);try{const d=await current.request('/rooms/'+enc(id)+'/read','POST',{throughSequence:sequence});if(version!==epoch||current!==client)return;const fresh=await current.request('/rooms/'+enc(id));if(version!==epoch||current!==client||fresh.companyId!==company?.id||fresh.id!==id)return;roomIndex=roomIndex.map(r=>r.id===id?fresh:r);channels=channels.map(r=>r.id===id?fresh:r);}catch{if(current===client)readThrough.delete(id);}}
 function unreadHuman(id:string){const rid=humanRoomIds.get(id);return rid?roomIndex.find(r=>r.id===rid)?.unread||0:0;}
 function openRoomMembers(){if(!company||!actor||!room||!membershipApi)return;const key='members:'+room.id,props={roomId:room.id,currentRoom:room,membersApi:membershipApi,bots};openPanels=openPanels.map(p=>p.key===key?{...p,props}:p);registerPanel(key,room.kind==='channel'?'# '+room.name:'Conversation members',RoomMembersPane,props);}
 function clearPastedImages(){for(const controller of imageUploads.values())controller.abort();imageUploads.clear();for(const images of Object.values(chatImageDrafts))for(const image of images)if(image.url)URL.revokeObjectURL(image.url);chatImageDrafts={};}
 function removePastedImage(localId:string){if(!room||sending)return;const id=room.id,entry=(chatImageDrafts[id]||[]).find(image=>image.localId===localId);imageUploads.get(localId)?.abort();imageUploads.delete(localId);if(entry?.url)URL.revokeObjectURL(entry.url);chatImageDrafts={...chatImageDrafts,[id]:(chatImageDrafts[id]||[]).filter(image=>image.localId!==localId)};}
 async function pasteImages(detail:{roomId:string;files:File[]}){if(!company||!room||detail.roomId!==room.id||sending)return;const companyId=company.id,roomId=room.id,lifecycle=ctrl;for(const file of detail.files){const localId=crypto.randomUUID(),prior=chatImageDrafts[roomId]||[];let error='';if(!chatImageLimits.mimeTypes.includes(file.type))error='Use PNG, JPEG or WebP.';else if(file.size>chatImageLimits.maxBytesPerImage)error='Each image must be at most 8 MiB.';else if(prior.length>=chatImageLimits.maxImages)error='Attach at most four images.';else if(prior.reduce((sum,image)=>sum+image.size,0)+file.size>chatImageLimits.maxTotalBytes)error='Attached images must total at most 16 MiB.';const entry:ChatImageDraft={localId,name:file.name||'Pasted image',mime:file.type,size:file.size,file,url:chatImageLimits.mimeTypes.includes(file.type)?URL.createObjectURL(file):'',status:error?'error':'uploading',...(error?{error}:{})};chatImageDrafts={...chatImageDrafts,[roomId]:[...prior,entry]};if(error)continue;const controller=new AbortController();imageUploads.set(localId,controller);const abort=()=>controller.abort();lifecycle.signal.addEventListener('abort',abort,{once:true});void uploadChatImage(file,companyId,roomId,controller.signal,()=>localStorage.token||'').then(attachmentId=>{if(lifecycle!==ctrl||controller.signal.aborted||company?.id!==companyId)return;chatImageDrafts={...chatImageDrafts,[roomId]:(chatImageDrafts[roomId]||[]).map(image=>image.localId===localId?{...image,status:'ready',attachmentId}:image)};}).catch(cause=>{if(lifecycle!==ctrl||controller.signal.aborted)return;chatImageDrafts={...chatImageDrafts,[roomId]:(chatImageDrafts[roomId]||[]).map(image=>image.localId===localId?{...image,status:'error',error:(cause as Error).message}:image)};}).finally(()=>{lifecycle.signal.removeEventListener('abort',abort);imageUploads.delete(localId);});}}
 async function checkImageVision(targets:string[],roomId:string){if(!company)return;if(!targets.length)throw Error('Choose a bot with an image-capable model before sending images.');const result=await api('/api/v1/starli/companies/'+enc(company.id)+'/chat-vision?roomId='+enc(roomId)+'&botIds='+enc(targets.join(',')));if(result.companyId!==company.id||result.roomId!==roomId||!Array.isArray(result.items)||targets.some(id=>!result.items.some((item:any)=>item.botId===id)))throw Error('Image support could not be verified. Your images are kept.');const unsupported=targets.filter(id=>!result.items.some((item:any)=>item.botId===id&&item.supportsImages===true&&Array.isArray(item.input)&&item.input.includes('image')));if(unsupported.length)throw Error(unsupported.map(id=>bots.find(bot=>bot.id===id)?.name||'Selected bot').join(', ')+' needs an image-capable model. Change its model or remove it from the mentions. Your images are kept.');}
 function normalizeMentions(value:any[]){const result:any[]=[],seen=new Set();for(const m of value||[]){if(!m||!['human','agent'].includes(m.kind)||typeof m.id!=='string'||!(m.kind==='human'?people:bots).some(p=>p.id===m.id))throw Error('A mentioned person or bot is no longer available. Choose the mention again.');const key=m.kind+':'+m.id;if(!seen.has(key)){seen.add(key);result.push({kind:m.kind,id:m.id});}}return result;}
 async function send(detail?:any){if(view==='Bots'&&bot&&(!room||!Array.isArray(room.agentIds)||!room.agentIds.includes(bot.id))){error='This conversation is not connected to '+bot.name+'. Reopen it before sending; your draft is kept.';return;}if(!draft.trim()&&!chatImages.length||sending||working||!room||detail?.roomId&&detail.roomId!==room.id)return;if(chatImages.some(image=>image.status!=='ready'||!image.attachmentId)){error='Finish uploading or remove the unavailable images before sending. Your draft is kept.';return;}const images=[...chatImages],attachmentIds=images.map(image=>image.attachmentId!),raw=draft,content=draft.trim()||(images.length===1?'Please analyze the attached image.':'Please analyze the attached images.'),id=room.id,version=epoch,key=draftKey();let mentions:any[];try{mentions=normalizeMentions(detail?.mentions||mentionRanges.map(r=>({kind:r.kind,id:r.id})));if(!channel&&!humanTarget&&bot&&room.agentIds?.includes(bot.id)&&!mentions.some(m=>m.kind==='agent'))mentions.push({kind:'agent',id:bot.id});if(view==='Channel'&&isModelRoom&&modelWorkspace?.intentId===claimedBuildIntentId){
 const recipient=modelRoomRecipient(modelCoordinatorId,room.agentIds,bots,mentions);
 if(recipient)mentions.push({kind:'agent',id:recipient});
}}catch(e){error=(e as Error).message;return;}const targets=mentions.filter(m=>m.kind==='agent').map(m=>m.id);if(targets.length>16){error='A message supports up to 16 bot mentions. Your draft is kept.';return;}const fingerprint=JSON.stringify([id,content,mentions,targets,attachmentIds]);if(!writeKeys.has(fingerprint))writeKeys.set(fingerprint,crypto.randomUUID());pending={key:writeKeys.get(fingerprint)!,fingerprint};sending=true;error='';try{if(attachmentIds.length&&targets.length){await checkImageVision(targets,id);if(version!==epoch||room?.id!==id)return;}const d=await client!.request('/rooms/'+enc(id)+'/messages','POST',{content,parentId:null,mentions,dispatchAgentIds:targets,attachmentIds},pending.key);if(version!==epoch)return;if(d.message?.roomId!==id)throw Error('Delivery could not be verified.');if(images.length){const sent=new Set(images.map(image=>image.localId));for(const image of images)if(image.url)URL.revokeObjectURL(image.url);chatImageDrafts={...chatImageDrafts,[id]:(chatImageDrafts[id]||[]).filter(image=>!sent.has(image.localId))};}if(draft===raw){draft='';mentionRanges=[];drafts.delete(key);mentionDrafts.delete(key);}pending=null;writeKeys.delete(fingerprint);stick=true;messages=[...messages.filter(m=>m.id!==d.message.id),d.message];const dispatchItems=(d.botDispatch||[]).map((entry:any)=>({...entry,agentId:entry.agentId||entry.botId||entry.receipt?.agentId}));if(dispatchItems.length)dispatchBatches={...dispatchBatches,[d.message.id]:{roomId:id,items:dispatchItems,settled:dispatchItems.every((item:any)=>!['QUEUED','SUBMITTED'].includes(item.status))}};for(const entry of dispatchItems){const t=verifiedCompanyTurn(entry.receipt,company.id,id);if(t&&entry.status==='SUBMITTED')turns={...turns,[t.assistantMessageId]:t};else if(!['SUBMITTED','QUEUED'].includes(entry.status))error='Your message was saved, but at least one requested bot did not start. Review each bot’s status before retrying.';}if(targets.some((target:string)=>!dispatchItems.some((item:any)=>item.agentId===target)))error='Your message was saved, but not every requested bot has a dispatch receipt. No unconfirmed reply is shown as started.';await refresh(version);void refreshRoster(version);}catch(e){if(version===epoch){error=(e as Error).message+' Your draft is kept. Refresh before retrying unconfirmed delivery.';if((e as any).status===401)await accessDenied(401,version);}}finally{if(version===epoch)sending=false;}}
 async function stop(){if(stopping)return;const version=epoch;stopping=true;error='';try{for(const turn of active){const d=await api(companyTurnPath(turn)+'/cancel',ctrl.signal,{method:'POST'});if(version!==epoch||!company||!room)return;const t=verifiedCompanyTurn(d,company.id,room.id,turn.assistantMessageId);if(t)state(t);}await refresh();}catch(e){if(version===epoch){error=(e as Error).message+' Stop is unconfirmed. Refresh to check the run.';await accessDenied((e as any).status,version);}}finally{if(version===epoch)stopping=false;}}
 function key(e:KeyboardEvent){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}}
 function session(e:StorageEvent){if(e.key==='token'||e.key===null){revoke(0,'Your session changed. Sign in to continue.');actor=null;token='';password='';}}
 onMount(()=>{token=localStorage.token||'';if(token)void initialize();else loading=false;timer=setInterval(()=>{if(!document.hidden){void refresh();void refreshNotifications();void refreshIndex();void refreshAppPreviews();void refreshBrowserWorkspace();}},2500);window.addEventListener('storage',session);window.addEventListener('focus',refreshVisibleWorkspace);document.addEventListener('visibilitychange',refreshVisibleWorkspace);});onDestroy(()=>{clearPastedImages();ctrl.abort();client?.close();clearInterval(timer);clearTimeout(refreshTimer);window.removeEventListener('storage',session);window.removeEventListener('focus',refreshVisibleWorkspace);document.removeEventListener('visibilitychange',refreshVisibleWorkspace);});
</script>
<svelte:window on:message={handleWave1PreviewMessage} on:keydown={event=>{if(event.key==='Escape')accountMenu=false;}} on:click={event=>{if(accountMenu&&!(event.target instanceof Element&&event.target.closest('.account-area')))accountMenu=false;}}/>
<svelte:head><title>Starli — Company workspace</title><meta name="color-scheme" content="light"/></svelte:head>
<div class="enterprise">
{#if !actor&&!loading}<main class="signin"><section class="signin-story"><span class="story-brand">✦ Starli AI</span><h2>Your world, connected.<br/>Your next move, clearer.</h2><p>One company workspace for your people, AI teammates and the work that matters.</p><span class="story-company">StarliDigital</span></section><div class="signin-card"><div class="brand"><span class="brand-star">✦</span><strong>Starli AI</strong></div><h1>Sign in to your company</h1><p>Sign in to your company workspace.</p><form on:submit|preventDefault={signin}><label>Email<input type="email" autocomplete="username" bind:value={email} required/></label><label>Password<input type="password" autocomplete="current-password" bind:value={password} required/></label><button class="primary" disabled={signing}>{signing?'Signing in…':'Sign in'}</button></form>{#if error}<p class="error" role="alert">{error}</p>{/if}</div></main>
{:else}<aside class:open={menu}><a class="workspace-brand" href="/" aria-label="StarliDigital home"><span>✦</span>StarliDigital</a><div class="company-pill"><span>{company?.name||'Loading company…'}</span></div><nav aria-label="Company navigation">{#each ['Company','Bots','Projects','Apps','Team'] as item,i}<button class:chosen={view===(item==='Bots'?'BotDirectory':item)} on:click={()=>{if(item==='Apps')appsInitialTab='resources';view=item==='Bots'?'BotDirectory':item;menu=false;}}><svg class="nav-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{#if item==='Company'}<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>{:else if item==='Bots'}<circle cx="12" cy="12" r="8"/><path d="M8 10h.01M16 10h.01M8 15c2 2 6 2 8 0M12 4V2"/>{:else if item==='Projects'}<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>{:else if item==='Team'}<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>{:else}<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>{/if}</svg>{item}</button>{/each}</nav><div class="channels"><div class="roster-title">CHANNELS</div>{#each channels as c(c.id)}<button class:chosen={channel?.id===c.id&&view==='Channel'} on:click={()=>void chooseChannel(c)}><span>#</span>{c.name}{#if c.unread>0}<small class="unread-badge">{c.unread}</small>{/if}</button>{:else}<p>No visible company channels.</p>{/each}</div><div class="roster-title">Bots <button class="add-bot-button" aria-label="Add bot" on:click={()=>view='AddBot'}>+</button></div><div class="roster">{#each sidebarBots as b,i(b.id)}<button class:selected={view==='Bots'&&bot?.id===b.id} on:click={()=>{view='Bots';void choose(b);}}><BotAvatar companyId={company.id} botId={b.id} index={b.sidebarIndex} name={b.name} avatar={b.avatar||''} size={29} accessSignal={ctrl.signal}/><span><strong>{b.name}</strong><BotPurpose companyId={company.id} botId={b.id} purpose={b.purpose||''} accessSignal={ctrl.signal}/></span>{#if b.nativeUnread>0}<small class="bot-unread" aria-label={b.nativeUnread+' unread messages'}>{b.nativeUnread}</small>{/if}</button>{:else}<p>{loading?'Loading bots…':'No company bots available.'}</p>{/each}</div><button class="add-bot-link" on:click={()=>view='AddBot'}>＋ Add a bot</button><div class="direct-list"><div class="roster-title">DIRECT MESSAGES</div>{#each people.filter(p=>p.id!==actor?.id) as person(person.id)}<button class:selected={humanTarget?.id===person.id&&view==='HumanChat'} on:click={()=>void chooseHuman(person)}><span class="direct-avatar">{person.name.slice(0,1)}</span><span>{person.name}</span>{#if unreadHuman(person.id)>0}<small>{unreadHuman(person.id)}</small>{/if}</button>{:else}<p>No other company members.</p>{/each}</div><div class="account-area">{#if accountMenu}<div class="account-popup" role="menu" aria-label="Account menu"><button role="menuitem" on:click={()=>{accountMenu=false;view='Profile';menu=false;}}>Profile</button>{#if canAdminCompany}<button role="menuitem" on:click={()=>void openCompanyAdmin()}>Company</button>{/if}<button role="menuitem" on:click={()=>{accountMenu=false;view='CustomerAPI';menu=false;}}>API</button></div>{/if}<button class="account" aria-label="Open account menu" aria-expanded={accountMenu} aria-haspopup="menu" on:click={()=>accountMenu=!accountMenu}><span class="user-avatar">{actor?.name?.slice(0,1)||'·'}</span><span><strong>{actor?.name||'Loading account…'}</strong><small>{company?.role||'Company workspace'}</small></span><span class="account-more" aria-hidden="true">···</span></button></div></aside>
<main class="workspace"><header><button class="menu" aria-label="Open navigation" on:click={()=>menu=!menu}>☰</button>{#if room&&['Bots','Channel','HumanChat'].includes(view)}<button class="room-heading" on:click={openRoomMembers} aria-label="Open conversation members"><span class="header-avatar">{#if bot}<BotAvatar companyId={company.id} botId={bot.id} {index} name={bot.name} avatar={bot.avatar||''} size={30} accessSignal={ctrl.signal}/>{:else if channel}<span class="header-hash">#</span>{:else}<span class="user-avatar">{humanTarget?.name?.slice(0,1)||'·'}</span>{/if}</span><span><strong>{channel?'# '+channel.name:humanTarget?.name||bot?.name||room.name}<span class="heading-chevron">⌄</span></strong><small>{typeof room.description==='string'&&room.description?room.description:channel?'Company channel':'Private conversation'}{#if working}<span class="working-dot"/>Working{/if}</small></span></button><button class="member-stack" aria-label="Open conversation members" on:click={openRoomMembers}>{#if roomRoster}{#each roomRoster.members.slice(0,3) as member(member.kind+member.id)}<span class:bot={member.kind==='agent'}>{member.name.slice(0,1)}</span>{/each}<strong>{roomRoster.members.length}</strong>{:else}<span class="member-icon">♧</span><strong>Members</strong>{/if}</button>{:else}<div class="header-identity"><h1>{view==='BotDirectory'?'Bots':view==='CompanyChannels'?'Manage channels':view==='CompanyInvitations'?'Company invitations':view==='CustomerAPI'?'API':view==='CompanyIntegrations'?'Company integrations':view==='CompanyProviders'?'Company providers':view==='CompanyAdmin'?'Company administration':view==='AddBot'?'Add bot':view==='AgentSettings'?'Bot settings':view}</h1></div>{/if}</header>{#if openPanels.length&&(view==='Bots'||view==='Channel'||view==='HumanChat')}<div class="open-panel-rail" aria-label="Open workspace panels">{#each openPanels as panel(panel.key)}<button class:active={!panelsMinimized&&activePanelKey===panel.key} on:click={()=>{activePanelKey=panel.key;panelsMinimized=false;}}>{panel.title}</button>{/each}<button class="minimize" on:click={()=>panelsMinimized=!panelsMinimized}>{panelsMinimized?'Show panels':'Minimize panels'}</button></div>{/if}{#if claimedBuildIntentId&&modelReadError}<p class="error" role="alert">{modelReadError}</p>{/if}
 {#if isModelRoom&&guestBuild(modelWorkspace)}
  <div class="wave1-workspace-strip" role="status">
   <strong>{{QUEUED:'App queued',RUNNING:'Building your app',READY:'App ready',INTERRUPTED:'Build interrupted'}[guestBuild(modelWorkspace).status]}</strong>
   <button on:click={presentModelApp}>Open application panel</button>
  </div>
 {/if}
 {#if actor&&modelConversationMode==='LEGACY'&&claimedBuildScope&&company?.id===claimedBuildScope.companyId&&room?.id===claimedBuildScope.roomId}
 {#if claimedOriginalPrompt}
 <section class="claimed-original-request" data-testid="claimed-original-request" data-message-id={claimedOriginalPrompt.id} data-provenance="system" data-room-id={claimedOriginalPrompt.roomId}>
  <h2>Your request</h2>
  <p>{claimedOriginalPrompt.content}</p>
  <small>Original request saved during company setup</small>
 </section>
 {/if}
 <ClaimedBuildConfirmation busy={claimedBuildBusy} accepted={Boolean(claimedBuildAdmission)}
  unavailable={claimedBuildUnavailable} error={claimedBuildError}
  executionSourceMessageId={claimedBuildAdmission?.sourceMessageId||''}
  on:confirm={()=>void startClaimedBuild()}/>
 {/if}{#if company&&(modelConversationMode==='LEGACY'||!claimedBuildIntentId)&&(wave1GraphId||wave1Preview)}<div class="wave1-workspace-strip" data-testid="starli-wave1-workspace-strip">{#if wave1GraphId}<WorkerTaskProgressPanel rawItems={wave1ProgressItems} expectedCompanyId={wave1ProgressContext.companyId||company.id} expectedProjectId={wave1ProgressContext.projectId||''} expectedSourceMessageId={wave1ProgressContext.sourceMessageId||''} expectedRequestId={wave1ProgressContext.requestId||''} expectedGraphId={wave1ProgressContext.graphId||wave1GraphId} expectedRoomId={wave1ProgressContext.roomId||room?.id||''} expectedAuthorizationRevision={wave1ProgressContext.authorizationRevision} expectedRunGeneration={wave1ProgressContext.runGeneration} expectedTaskIds={wave1ProgressContext.expectedTaskIds||[]} graphCompletionVerified={wave1ProgressContext.graphCompletionVerified===true} revoked={wave1ProgressContext.revoked===true} canStop={true} stopping={wave1Stopping} stopDisposition={wave1StopDisposition} stopError={wave1StopError} overrideSummary={wave1ProgressOverride} on:stopRequested={handleWave1Stop}/>{/if}{#if wave1Preview}<PrivateAppPreviewPane receipt={wave1Preview.receipt} expectedCompanyId={wave1Preview.expectedCompanyId} expectedProjectId={wave1Preview.expectedProjectId} authorizedPreviewId={wave1Preview.authorizedPreviewId} expectedRevision={wave1Preview.expectedRevision} receiptSignatureValid={wave1Preview.receiptSignatureValid} ticketValidatedByNativeServer={wave1Preview.ticketValidatedByNativeServer} isolatedStorageAttested={wave1Preview.isolatedStorageAttested} authorityState={wave1Preview.authorityState} previewOrigin={wave1Preview.previewOrigin} parentOrigin={wave1Preview.parentOrigin} trustedFrameUrl={wave1Preview.trustedFrameUrl} allowStagingLoopback={wave1Preview.allowStagingLoopback} statusMessage={wave1Preview.statusMessage}/>{/if}</div>{/if}
{#if view==='CompanyChannels'&&company&&actor&&canAdminCompany}<CompanyChannels companyId={company.id} actorId={actor.id} {people} {bots} accessSignal={ctrl.signal} on:open={event=>{const target=channels.find(item=>item.id===event.detail.roomId);if(target)void chooseChannel(target);}} on:changed={()=>void refresh()} on:accesschanged={event=>void accessDenied(event.detail.status)}/>{:else if view==='CompanyInvitations'&&company&&actor&&canAdminCompany}<section class="admin-invitations"><CompanyInvitations companyId={company.id} actorId={actor.id} {token} roles={invitationRoles} canManage={company.scope.capabilities.includes('invites.manage')} accessSignal={ctrl.signal}/></section>{:else if view==='CustomerAPI'&&actor&&company}<CustomerAPI actorId={actor.id} companyId={company.id} accessSignal={ctrl.signal} on:close={()=>view='Bots'} on:denied={event=>void accessDenied(event.detail.status)}/>{:else if view==='CompanyIntegrations'&&company&&actor&&canAdminCompany}<CompanySmtpIntegrations companyId={company.id} actorId={actor.id} accessSignal={ctrl.signal} on:close={()=>view='CompanyAdmin'} on:denied={event=>void accessDenied(event.detail.status)}/>{:else if view==='CompanyProviders'&&company&&canAdminCompany}<section class="company-providers-scroll" aria-label="Company provider management"><CompanyProviders companyId={company.id} {bots} accessSignal={ctrl.signal}/></section>{:else if view==='CompanyAdmin'&&company&&canAdminCompany}<section class="company-admin section-view"><p class="admin-eyebrow">COMPANY ADMINISTRATION</p><h2>{company.name}</h2><p>Manage your company’s people, AI agent bots, tools and connections.</p><div class="admin-summary"><span><strong>{people.length}</strong> People</span><span><strong>{bots.length}</strong> AI agent bots</span><span><strong>{channels.length}</strong> Channels</span></div><div class="admin-actions"><button on:click={()=>view='CompanyChannels'}>Channels <span>Create channels and manage membership →</span></button><button on:click={()=>void openInvitations()}>Invitations <span>Invite people by email with a company role →</span></button><button on:click={openAutomations}>Automations <span>Connections, routines and approvals →</span></button><button on:click={()=>view='CompanyIntegrations'}>Integrations <span>Connect company SMTP email and business apps →</span></button><button on:click={()=>view='CompanyProviders'}>Providers <span>Company models, subscriptions and defaults →</span></button><button on:click={()=>view='Team'}>People and team <span>View company members →</span></button><button on:click={()=>view='BotDirectory'}>AI agent bots <span>Profiles, models and permissions →</span></button><button on:click={openCompanyMcp}>MCP connections <span>Manage owner account MCP servers for approved company bot tasks →</span></button></div><h3>Your company access</h3><div class="admin-caps">{#each company.scope.capabilities as capability}<span>{capability}</span>{/each}</div></section>{:else if view==='Profile'&&actor&&company}<Profile {actor} companyName={company.name} accessSignal={ctrl.signal} on:close={()=>view='Bots'} on:denied={event=>void accessDenied(event.detail.status)}/>{:else if view==='AddBot'&&company}
<AddBot companyId={company.id} companyName={company.name} membershipRevision={company.revision} accessSignal={ctrl.signal} on:created={event=>void createdBot(event.detail)} on:close={event=>{if(!event.detail.dirty||confirm('Leave bot creation?'))view='BotDirectory';}} on:accesschanged={event=>void accessDenied(event.detail.status)}/>
{:else if view==='AgentSettings'&&company&&selectedSettingsBotId}
 {#key company.id+':'+selectedSettingsBotId}<AgentSettings companyId={company.id} botId={selectedSettingsBotId} botName={bots.find(item=>item.id===selectedSettingsBotId)?.name||''} membershipRevision={company.revision} accessSignal={ctrl.signal} on:close={event=>closeAgentSettings(event.detail.dirty)} on:saved={event=>savedAgentProfile(event.detail)} on:accesschanged={event=>void accessDenied(event.detail.status)}/>{/key}
{:else if view==='Projects'&&company&&actor}<CompanyProjects companyId={company.id} actorId={actor.id} accessSignal={ctrl.signal} on:open={event=>void openResource(event.detail)} on:denied={event=>void accessDenied(event.detail.status)}/>{:else if view==='Apps'&&company&&actor}<CompanyApps companyId={company.id} actorId={actor.id} initialTab={appsInitialTab} accessSignal={ctrl.signal} on:denied={event=>void accessDenied(event.detail.status)} on:tool={event=>{view='Bots';draft='Use '+event.detail.toolName+' to ';}} on:resource={event=>{view='Bots';void toggleFiles(event.detail.kinds||[]);}}/>{:else if view==='BotDirectory'}<BotsDirectory {bots} companyId={company.id} accessSignal={ctrl.signal} selectedId={selectedSettingsBotId} on:select={e=>selectBotSettings(e.detail)}/>{:else if view==='Bots'||view==='Channel'||view==='HumanChat'}<div class="chat-scroll" bind:this={scroller} use:followChatHeight role="region" aria-label="Conversation messages"><div class="chat-column" role="log" aria-live="polite">{#if !messages.length&&(!room||loading)}<div class="empty"><Orb {index} size={48}/><h2>{loading?'Opening your workspace':channel?'Start the conversation':bot?'What can we move forward?':'No bots available'}</h2><p>{channel?'Messages in #'+channel.name+'.':bot?'Start a conversation with '+bot.name+'.':loading?'Loading your company and bots.':'Your company directory has no accessible bots.'}</p></div>{/if}{#each messages as m(m.id)}<article class:human={m.speaker?.kind==='human'&&m.speaker.id===actor?.id}>{#if m.speaker?.kind==='agent'}<div class="speaker"><BotAvatar companyId={company.id} botId={m.speaker.id} {index} name={bots.find(b=>b.id===m.speaker.id)?.name||bot?.name||''} size={22} accessSignal={ctrl.signal}/><strong>{bots.find(b=>b.id===m.speaker.id)?.name||bot?.name||'Company bot'}</strong></div>{:else if m.speaker?.kind==='system'&&m.speaker.id==='registration'}<div class="speaker"><span class="user-avatar" aria-hidden="true">✦</span><strong>BOSS · Automated registration alert</strong></div>{:else if m.speaker?.kind==='system'}<div class="speaker"><span class="user-avatar" aria-hidden="true">✦</span><strong>StarliDigital system</strong></div>{:else if m.speaker?.id!==actor?.id}<div class="speaker"><span class="user-avatar">{people.find(p=>p.id===m.speaker?.id)?.name?.slice(0,1)||'�'}</span><strong>{people.find(p=>p.id===m.speaker?.id)?.name||'Company member'}</strong></div>{/if}<div class="message-text">{#if m.deleted}Message deleted{:else}<ChatMessageContent content={messageContent(m)} hiddenImageUrls={generatedAttachments(m).map(a=>a.url)} allowOpen={!!company&&!!actor&&!!room} on:artifact={event=>void openChatArtifact(m.id,event.detail)}/>{/if}</div>{#if dispatchBatches[m.id]}<BatchDispatchCard items={dispatchBatches[m.id].items} settled={dispatchBatches[m.id].settled} {bots}/>{/if}{#if !m.deleted&&company&&room}{#each nativeImageReferences(m) as attachment(attachment.id)}<CompanyChatImage companyId={company.id} conversationId={room.id} attachmentId={attachment.id} accessSignal={ctrl.signal}/>{/each}{#each generatedAttachments(m) as attachment(attachment.id)}<CompanyGeneratedImage companyId={company.id} {attachment} accessSignal={ctrl.signal}/>{/each}{/if}{#if company&&actor&&room}{@const socialConnection=socialConnectionSelection(m,room.id,company.id)}{@const socialPost=socialPostSelection(m,room.id,company.id)}{#if socialConnection&&!hiddenSocialMessages.has(m.id)}<CompanySocialConnections platform={socialConnection.providerId} companyId={company.id} actorId={actor.id} companyName={company.name} conversationId={room.id} accessSignal={ctrl.signal} on:close={()=>hiddenSocialMessages=new Set([...hiddenSocialMessages,m.id])} on:changed={refreshSoon} on:denied={event=>void accessDenied(event.detail.status)}/>{/if}{#if socialPost}{#key socialPost.postId}<CompanySocialPostReview companyId={company.id} actorId={actor.id} conversationId={room.id} postId={socialPost.postId} requestingBotId={socialPost.requestingBotId} accessSignal={ctrl.signal}/>{/key}{/if}{@const smtpApproval=smtpApprovalSelection(m,room.id,company.id)}{#if smtpApproval}{#key smtpApproval.approvalId}<CompanySmtpApprovalCard companyId={company.id} actorId={actor.id} conversationId={room.id} approvalId={smtpApproval.approvalId} requestingBotId={smtpApproval.requestingBotId} accessSignal={ctrl.signal}/>{/key}{/if}{@const triggerCard=agentTriggerSelection(m,room.id,company.id)}{@const companyConnection=companyConnectionSelection(m,room.id,company.id)}{#if companyConnection}<CompanyConnectionCard companyId={company.id} actorId={actor.id} conversationId={room.id} requestId={companyConnection.requestId} credentialType={companyConnection.credentialType} accessSignal={ctrl.signal} on:denied={event=>void accessDenied(event.detail.status)}/>{/if}{@const graphCard=graphSelection(m,room.id,company.id)}{#if triggerCard}<AgentTriggerCard botName={bots.find(b=>b.id===m.speaker?.id)?.name||'Your bot'} companyId={company.id} actorId={actor.id} conversationId={room.id} triggerId={triggerCard.triggerId} accessSignal={ctrl.signal} on:denied={event=>void accessDenied(event.detail.status)}/>{/if}{#if graphCard}<AutomationGraphCard companyId={company.id} actorId={actor.id} conversationId={room.id} graphId={graphCard.graphId} accessSignal={ctrl.signal} on:denied={event=>void accessDenied(event.detail.status)}/>{/if}{/if}{#if automationCard&&automationCard.assistantMessageId===m.id&&company&&actor&&room}{#key company.id+':'+room.id+':'+m.id}{#if automationCard.providerId}<AutomationChatConnection companyId={company.id} actorId={actor.id} conversationId={room.id} providerId={automationCard.providerId} accessSignal={ctrl.signal} on:changed={refreshSoon} on:denied={event=>void accessDenied(event.detail.status)}/>{:else}<AutomationChatFeedback companyId={company.id} actorId={actor.id} conversationId={room.id} accessSignal={ctrl.signal} {people} draftId={automationCard.draftId||''} workflowId={automationCard.workflowId||''} executionId={automationCard.executionId||''} on:manage={openAutomations} on:changed={refreshSoon} on:denied={event=>void accessDenied(event.detail.status)}/>{/if}{/key}{/if}{#if turns[m.id]&&!hiddenActivityRuns.has(turns[m.id].runId)&&room?.agentIds?.includes(turns[m.id].botId)}{#key turns[m.id].runId}<Activity accessSignal={ctrl.signal} turn={turns[m.id]} on:denied={e=>void activityDenied(turns[m.id],e.detail.status)} on:content={event=>streamContent(event.detail)} on:browser={event=>void presentBrowserWorkspace(event.detail,event.detail.toolName==='browser.navigate')} on:refresh={refreshSoon} on:state={e=>state(e.detail)}/>{/key}{/if}</article>{/each}{#each active.filter(t=>!messages.some(m=>m.id===t.assistantMessageId)) as turn(turn.runId)}<article><div class="speaker"><BotAvatar companyId={company.id} botId={turn.botId} {index} name={bots.find(b=>b.id===turn.botId)?.name||bot?.name||''} size={22} accessSignal={ctrl.signal}/><strong>{bots.find(b=>b.id===turn.botId)?.name||'Company bot'}</strong></div><div class="message-text">{liveTexts[turn.assistantMessageId]||''}</div><Activity accessSignal={ctrl.signal} {turn} on:denied={e=>void activityDenied(turn,e.detail.status)} on:content={event=>streamContent(event.detail)} on:browser={event=>void presentBrowserWorkspace(event.detail,event.detail.toolName==='browser.navigate')} on:refresh={refreshSoon} on:state={e=>state(e.detail)}/></article>{/each}</div></div><div class="composer-area"><div class="composer-column">{#if showTools&&company&&bot&&room}{#key company.id+':'+bot.id+':'+room.id}<ToolPicker companyId={company.id} botId={bot.id} conversationId={room.id} accessSignal={ctrl.signal} on:close={()=>showTools=false} on:select={event=>{draft=(draft?draft+'\n':'')+'Use '+event.detail.name+' to ';showTools=false;}}/>{/key}{/if}{#if showActions}<div class="chat-actions" role="group" aria-label="Chat tools"><button type="button" on:click={openTeamCollaboration}>Team conversation <small>Choose a Boss and teammates for this conversation</small></button><button type="button" on:click={openLocalProvider}>Model connection <small>Save your company key and choose each bot’s model</small></button><button type="button" on:click={openAutomations}>Automations <small>Connect apps and set up a routine</small></button><button type="button" on:click={openSocialConnections}>Facebook & Instagram <small>Connect your account and review company destinations</small></button><button type="button" on:click={openIntegrationCatalog}>Integration catalog <small>Browse workflow tools, connectors and available actions</small></button>{#if canAdminCompany}<button type="button" on:click={()=>{showActions=false;view='CompanyIntegrations';}}>Company SMTP email <small>Connect SMTP relay credentials and view receipts</small></button>{/if}{#if room}<button type="button" on:click={()=>openConnection('slack')}>Connect Slack <small>Share a workspace connection with your company</small></button><button type="button" on:click={()=>openConnection('shopify')}>Connect Shopify <small>Connect your store for reviewed automations</small></button>{/if}{#if bot&&room}<button type="button" on:click={()=>{showActions=false;showTools=true;}}>Bot tools <small>Browse available tools and MCP capabilities</small></button>{/if}<button type="button" on:click={()=>{showActions=false;void toggleFiles();}}>Files and documents <small>Open or upload company files</small></button><button type="button" on:click={()=>void openWorkspacePane('computer')}>Starli Computer <small>Watch the company desktop</small></button><button type="button" on:click={()=>{showActions=false;void refreshAppPreviews(true);}}>Website preview <small>Open this conversation’s verified published website</small></button><button type="button" on:click={()=>void openWorkspacePane('browser')}>AI browser <small>Open the browser for this bot’s task</small></button><button type="button" on:click={()=>{showActions=false;view='Apps';}}>Tools and connections <small>Manage MCP servers and integrations</small></button></div>{/if}{#if showFiles&&FilePicker&&company}<svelte:component this={FilePicker} companyId={company.id} actorId={actor.id} accessSignal={ctrl.signal} kinds={pickerKinds} on:open={event=>void openResource(event.detail)} on:close={()=>showFiles=false}/>{/if}{#if error}<div class="error" role="alert">{error}<button on:click={()=>{error='';void refresh();}}>Refresh</button></div>{/if}<MentionComposer images={chatImages} on:images={event=>void pasteImages(event.detail)} on:removeimage={event=>removePastedImage(event.detail)} {people} {bots} currentRoom={room} {draft} {mentionRanges} accessSignal={ctrl.signal} disabled={!room} busy={sending} {working} {stopping} placeholder={channel?'Message #'+channel.name+'…':humanTarget?'Message '+humanTarget.name+'…':bot?'Message '+bot.name+'…':'Select a conversation'} on:draft={event=>composerDraft(event.detail)} on:send={event=>void send(event.detail)} on:stop={stop}><button slot="tools" class="file-toggle" type="button" aria-label="Open chat tools" aria-expanded={showActions} on:click={()=>showActions=!showActions}>+</button></MentionComposer><p class="disclaimer">{bot?.name||'Starli'} uses your company context. Review important work.</p></div></div>
{:else}<section class="section-view"><h2>{view==='Company'?company?.name||'Company':view}</h2>{#if view==='Team'}<button class="primary" on:click={openLocalProvider}>Connect team models</button><p>People in your company</p>{#each people as person}<div class="person-row"><span class="user-avatar">{person.name.slice(0,1)}</span><strong>{person.name}</strong>{#if person.role}<small>{person.role}</small>{/if}</div>{:else}<p>No visible team members.</p>{/each}{:else if view==='Company'}<div class="company-welcome"><p class="welcome-eyebrow">YOUR COMPANY WORKSPACE</p><h3>Good to see you, {actor?.name?.split(' ')[0]||'there'}.</h3><p>Your people, AI teammates and company knowledge, together.</p></div><div class="company-shortcuts"><button on:click={()=>view='BotDirectory'}><span>✦</span><strong>Your AI team</strong><small>{bots.length} company bots</small></button><button on:click={()=>view='CompanyChannels'}><span>#</span><strong>Company channels</strong><small>Keep the conversation moving</small></button><button on:click={()=>view='Team'}><span>♧</span><strong>Your people</strong><small>{people.length} company members</small></button></div><button class="primary" on:click={()=>view='Bots'}>Open conversations →</button>{:else}<p>{view} are not connected to this local workspace yet.</p>{/if}</section>{/if}</main>{#if company&&actor}<PanelWorkspace panels={openPanels} activeKey={activePanelKey} minimized={panelsMinimized} companyId={company.id} actorId={actor.id} accessSignal={ctrl.signal} on:select={event=>{activePanelKey=event.detail.key;panelsMinimized=false;}} on:minimize={()=>panelsMinimized=true} on:close={event=>closePanel(event.detail.key)} on:denied={event=>void accessDenied(event.detail.status||403)}/>{/if}{/if}
</div>
<style>
.claimed-original-request{max-width:760px;margin:16px auto;padding:16px 20px;background:#f7f9fc;border:1px solid #e5eaf3;border-radius:12px;color:#17243f}.claimed-original-request h2{font-size:13px;font-weight:600;margin:0 0 8px}.claimed-original-request p{white-space:pre-wrap;font-size:15px;line-height:1.6;margin:0}.claimed-original-request small{display:block;color:#71809b;margin-top:8px;font-size:11px}

.composer-column{position:relative}.file-toggle{background:none;border:0;color:#7083a4;font-size:22px;width:26px;padding:0;line-height:1;flex:none}

:global(body){margin:0;background:#fff!important}.enterprise{--enterprise-primary:#3466f6;--enterprise-border:#e6ebf4;--enterprise-muted:#71809a;--enterprise-surface:#fff;--enterprise-on-primary:#fff;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#292c32;background:#fff;display:flex;height:100dvh;width:100%;font-size:14px;line-height:1.5}.enterprise :global(button),.enterprise :global(input),.enterprise :global(textarea){font:inherit}.enterprise :global(button){cursor:pointer}.enterprise :global(button:disabled){cursor:default;opacity:.45}.enterprise :global(button:focus-visible),.enterprise :global(textarea:focus-visible),.enterprise :global(input:focus-visible){outline:2px solid #6196f4;outline-offset:3px}aside{width:194px;flex:none;display:flex;flex-direction:column;padding:24px 12px 16px;background:#f6f7f9;border-right:1px solid #eceef1}.brand{display:flex;align-items:center;gap:9px;color:#1f2531;text-decoration:none;padding:0 9px;font-size:24px;letter-spacing:-1px}.brand strong{font-weight:650}.company-pill{display:flex;align-items:center;gap:8px;border:1px solid #e5e7ec;background:#fff;border-radius:8px;padding:9px 8px;margin:58px 0 23px;font-size:12px;font-weight:600;min-width:0}.company-pill>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}nav{display:flex;flex-direction:column;gap:3px}nav button{display:flex;gap:12px;align-items:center;padding:10px 12px;background:transparent;border:0;border-radius:7px;text-align:left;color:#747b88;font-size:13px}nav button.chosen{background:#e9edf4;color:#353c4b;font-weight:600}.nav-icon{width:20px;height:20px;flex:none}.roster-title{display:flex;justify-content:space-between;font-size:9px;letter-spacing:1px;font-weight:650;color:#989eaa;margin:30px 10px 13px}.roster{overflow:auto;flex:1;min-height:0}.roster>button{display:flex;align-items:center;gap:9px;padding:10px 8px;text-align:left;border:0;border-radius:8px;width:100%;background:transparent}.roster>button.selected{background:#e9edf4}.roster strong,.account strong{font-size:11px;font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:112px}.roster small,.account small{display:block;font-size:9px;color:#9197a3;margin-top:1px}.roster>p{font-size:11px;color:#9197a3;padding:8px}.account{border-top:1px solid #e8ebf0;padding:17px 7px 0;display:flex;align-items:center;gap:8px}.user-avatar{height:28px;width:28px;border-radius:50%;background:#e2e7ef;color:#788297;display:grid;place-items:center;font-size:11px;flex:none}.workspace{flex:1;min-width:0;display:flex;flex-direction:column}.workspace>header{height:72px;flex:none;border-bottom:1px solid #eff0f3;padding:0 35px;display:flex;align-items:center;justify-content:space-between;gap:15px}.header-identity{display:flex;align-items:center;gap:10px}.header-identity h1{font-size:13px;font-weight:600;margin:0}.working-dot{height:5px;width:5px;background:#6199d5;border-radius:50%;margin-left:4px}.chat-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain}.chat-column{max-width:680px;margin:auto;padding:45px 26px 20px;min-height:100%}article{margin:0 0 30px;font-size:13px;line-height:1.85;overflow-wrap:anywhere}.speaker{display:flex;align-items:center;gap:8px;margin-bottom:10px}.speaker strong{font-size:11px;font-weight:600}.message-text{white-space:pre-wrap}.human{display:flex;flex-direction:column;align-items:flex-end;margin:0 0 30px}.human .message-text{max-width:88%;background:#f1f3f6;border-radius:15px 15px 3px 15px;padding:10px 16px;color:#474d58;font-size:12px}.composer-area{flex:none;padding:14px 26px 16px;background:#fff}.composer-column{max-width:628px;margin:auto}.disclaimer{color:#b2b6bf;font-size:9px;text-align:center;margin:10px 0 0}.empty{min-height:42vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#969da9}.empty h2{font-size:19px;font-weight:500;color:#444e60;margin:18px 0 6px;letter-spacing:-.4px}.empty p{font-size:12px;margin:0}.error{font-size:12px;color:#a23f3f;padding:10px 0;overflow-wrap:anywhere}.error button{margin-left:8px;background:none;border:0;text-decoration:underline;color:inherit}.menu{display:none}.section-view{padding:48px;max-width:800px}.section-view h2{font-size:25px;font-weight:500;letter-spacing:-.7px}.section-view p{color:#9199a6;margin:10px 0 25px;font-size:13px}.person-row{display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid #f0f1f4}.person-row strong{font-weight:500;font-size:13px}.person-row small{margin-left:auto;color:#969da9}.primary{background:#5485e7;color:#fff;border:0;border-radius:8px;padding:10px 17px;font-size:12px}.signin{width:100%;display:grid;place-items:center;background:#f8f9fb}.signin-card{width:min(380px,calc(100vw - 42px));padding:36px;background:#fff;border:1px solid #edf0f5;border-radius:18px}.signin-card .brand{padding:0;margin-bottom:35px}.signin h1{font-size:22px;letter-spacing:-.6px;font-weight:550}.signin p{font-size:12px;color:#969da9;margin:8px 0 25px}.signin label{display:flex;flex-direction:column;font-size:12px;gap:7px;margin:15px 0;color:#727b8b}.signin input{padding:10px 12px;border:1px solid #e1e5ec;border-radius:8px;background:white;color:#323b4a;width:100%}.signin form>.primary{width:100%;margin-top:10px}.signin .error{color:#a23f3f;margin-bottom:0}@media(min-width:1500px){.chat-column{padding-top:65px}}@media(max-width:700px){aside{position:fixed;inset:0 auto 0 0;z-index:30;box-shadow:10px 0 40px #17203920;transform:translateX(-105%);transition:transform .2s}aside.open{transform:translateX(0)}.menu{display:block;background:none;border:0;font-size:18px;color:#748095}.workspace>header{padding:0 18px;height:64px;justify-content:flex-start}.chat-column{padding:28px 20px 12px}.composer-area{padding:12px 16px max(14px,env(safe-area-inset-bottom))}.section-view{padding:30px 24px}.human .message-text{max-width:94%}}
.channels>button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:0;border-radius:7px;background:none;padding:8px 12px;font-size:12px;color:#828a99}.channels>button span{color:#a4aaba;font-size:16px}.channels>button.chosen{background:#e9edf4;color:#353c4b}.channels>p{font-size:10px;color:#a0a6b1;padding:0 10px}.channels .roster-title{margin-bottom:7px}
/* Adobe XD enterprise shell: quiet surfaces and compact proportions. */
aside{width:clamp(150px,15vw,194px);padding:20px 10px 14px;background:#f6f8fb;border-color:#edf0f6}
.company-pill{align-self:flex-start;max-width:100%;padding:8px 10px;margin:30px 0 26px;font-size:10px;font-weight:400;border-color:#e5ebf5;border-radius:9px;color:#263752}
nav{gap:3px}nav button{padding:7px 9px;gap:9px;font-size:11px;font-weight:400;color:#60718e;border-radius:6px}
nav button.chosen, .roster>button.selected{background:#eaf1ff;color:#275df4;font-weight:400}
.nav-icon{width:15px;height:15px}.roster-title{font-size:8px;letter-spacing:1.3px;font-weight:500;color:#617491;margin:24px 8px 12px}
.roster>button{padding:8px;gap:9px;min-height:45px}.roster strong{font-size:10px;font-weight:400;color:#24354f}.roster small{font-size:8px;color:#8190a8}
.account{padding:15px 3px 0;gap:7px}.account strong{font-size:9px;font-weight:400}.account small{font-size:8px}.account .user-avatar{border-radius:7px;width:25px;height:25px;font-size:9px}
.workspace>header{height:clamp(56px,8.8vh,72px);padding:0 26px;border-color:#edf0f6}.header-identity{gap:10px}.header-identity h1{display:flex;align-items:center;gap:10px;font-size:11px;font-weight:400;color:#1f304a}
.composer-area{padding:12px 26px 36px}.composer-column{width:min(100%,680px);max-width:68%;margin:0 auto}.file-toggle{font-size:19px;color:#7589a9;width:18px}.disclaimer{font-size:7px;color:#7e8da6;margin-top:10px}.chat-column{max-width:760px}.human .message-text{border-radius:15px;background:#f3f5f8}
@media(max-width:700px){.composer-column{max-width:100%}.composer-area{padding:12px 16px max(18px,env(safe-area-inset-bottom))}.workspace>header{padding:0 18px}.company-pill{margin-top:30px}}

.chat-actions{position:absolute;bottom:calc(100% + 10px);left:0;z-index:20;background:#fff;border:1px solid #e6ebf4;border-radius:12px;box-shadow:0 8px 30px #17243f0c;padding:6px;width:min(310px,100%)}.chat-actions button{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 12px;border-radius:7px;font-size:12px;color:#17243f}.chat-actions button:hover{background:#f6f8fc}.chat-actions small{display:block;margin-top:3px;font-size:10px;color:#71809a}
.add-bot-button{border:0;background:none;font-size:17px;color:#71809a;line-height:1;padding:0 3px}.add-bot-link{text-align:left;border:0;background:none;font-size:10px;color:#71809a;padding:10px 8px;margin-bottom:16px}
.account{width:100%;border-right:0;border-left:0;border-bottom:0;background:none;text-align:left;cursor:pointer}.account:hover{background:#edf2fb;border-radius:8px}.account:focus-visible{outline:2px solid #9ab5ff;outline-offset:2px}
.account-area{position:relative}.account-popup{position:absolute;bottom:calc(100% + 8px);left:0;right:0;border:1px solid #e6ebf4;border-radius:9px;background:#fff;box-shadow:0 8px 30px #17243f12;padding:5px;z-index:35}.account-popup button{width:100%;display:block;padding:10px 12px;background:none;border:0;border-radius:6px;text-align:left;color:#17243f;font-size:12px}.account-popup button:hover{background:#f0f4fc}.account-more{margin-left:auto;color:#71809a;font-size:16px}.admin-eyebrow{font-size:9px!important;letter-spacing:1.4px;color:#71809a!important;margin:0 0 14px!important}.company-admin{width:100%;overflow:auto}.company-admin h2{margin:0}.admin-summary{display:flex;gap:28px;border:1px solid #e6ebf4;border-radius:10px;padding:20px;margin:25px 0}.admin-summary span{font-size:11px;color:#71809a}.admin-summary strong{font-size:22px;color:#17243f;display:block;font-weight:500;margin-bottom:4px}.admin-actions{display:grid;gap:10px;margin-bottom:30px}.admin-actions button{text-align:left;padding:17px;border:1px solid #e6ebf4;border-radius:10px;background:#fff;font-size:13px;color:#17243f}.admin-actions button:hover{background:#f6f8fc}.admin-actions span{display:block;margin-top:6px;font-size:11px;color:#71809a}.company-admin h3{font-size:13px;font-weight:500}.admin-caps{display:flex;flex-wrap:wrap;gap:6px;margin-top:15px}.admin-caps span{background:#f6f8fc;border:1px solid #e6ebf4;padding:5px 8px;border-radius:6px;font-size:10px;color:#71809a}
@font-face{font-family:'Starli Sans';src:url('/assets/fonts/Mona-Sans.woff2') format('woff2');font-weight:200 900;font-style:normal;font-display:swap}.enterprise{font-family:'Starli Sans',Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:'ss01' on,'cv11' on}.enterprise nav button{font-size:12px}.roster strong{font-size:11px}.roster small{font-size:9px}.channels>button{font-size:12px}.header-identity h1{font-size:13px}.account strong{font-size:11px}.account small{font-size:9px}
.open-panel-rail{display:flex;gap:6px;align-items:center;overflow:auto;padding:9px 26px;border-bottom:1px solid #edf0f6;flex:none}.open-panel-rail button{white-space:nowrap;border:1px solid #e6ebf4;border-radius:7px;background:#fff;padding:5px 9px;color:#71809a;font-size:10px}.open-panel-rail button.active{background:#eef3ff;color:#3466f6;border-color:#dce7ff}.open-panel-rail .minimize{margin-left:auto;border:0}
.room-heading{display:flex;align-items:center;gap:10px;text-align:left;border:0;background:none;color:#17243f;min-width:0}.room-heading strong{font-size:14px;font-weight:600;display:flex;align-items:center;gap:8px}.room-heading small{display:flex;align-items:center;gap:7px;font-size:10px;color:#97a5ba;margin-top:4px}.heading-chevron{color:#9daabf;font-size:12px}.header-avatar{flex:none}.header-hash{font-size:27px;color:#9bacbf}.member-stack{display:flex;align-items:center;gap:0;border:1px solid #e6ebf4;background:#fff;border-radius:7px;padding:5px 8px;margin-left:auto;color:#8e9db4}.member-stack>span{width:22px;height:22px;border:2px solid white;border-radius:6px;background:#edf1f7;display:grid;place-items:center;font-size:9px;margin-left:-4px}.member-stack>span:first-child{margin-left:0}.member-stack>span.bot{border-radius:50%;background:#dce7fa}.member-stack strong{font-size:10px;font-weight:500;margin-left:7px}.direct-list{margin:10px 0;max-height:180px;overflow:auto}.direct-list .roster-title{margin-top:10px}.direct-list>button{display:flex;align-items:center;gap:8px;border:0;background:none;width:100%;text-align:left;padding:8px;border-radius:7px;color:#7c8ca7;font-size:11px}.direct-list>button.selected{background:#e9edf4}.direct-avatar{width:23px;height:23px;border-radius:6px;background:#e4eaf4;display:grid;place-items:center;color:#8e9eb5;font-size:9px;flex:none}.direct-list small,.unread-badge{margin-left:auto;background:#3466f6;color:#fff;border-radius:7px;padding:1px 5px;font-size:9px}.direct-list>p{font-size:9px;color:#a1adbf;padding:0 10px}.roster{flex:initial;max-height:25dvh;flex-shrink:0}.account-area{margin-top:auto}@media(max-width:700px){.room-heading strong{font-size:12px}.room-heading small{font-size:9px}.member-stack{padding:4px 6px}.member-stack>span:nth-child(n+2){display:none}}.admin-invitations{padding:32px 40px;overflow:auto;max-width:1120px;width:100%;margin:0 auto}@media(max-width:700px){.admin-invitations{padding:24px 18px}}

/* Reference-aligned enterprise surfaces and readable type. */
@font-face{font-family:StarliInter;src:url('/assets/fonts/Inter-Variable.ttf') format('truetype');font-weight:100 900;font-display:swap}
.enterprise{font-family:StarliInter,Inter,sans-serif;--enterprise-primary:#2563eb;--enterprise-border:#e2e8f0;color:#17233b;background:#f8faff}
aside{width:224px;padding:20px 12px 14px;background:linear-gradient(180deg,#f4f7ff,#f8faff);border-color:#e2e8f0;overflow-y:auto}.workspace-brand{display:flex;align-items:center;gap:8px;padding:0 8px;text-decoration:none;font-size:16px;font-weight:700;letter-spacing:-.6px;color:#17233b}.workspace-brand span,.brand-star{color:#5372ff;font-size:28px}.company-pill{margin:20px 0 18px;font-size:12px;font-weight:550;width:100%;max-width:100%;background:#fff;padding:10px;border-color:#e2e8f0}nav button{font-size:13px;padding:9px 10px;min-height:38px}nav button.chosen,.channels>button.chosen,.roster>button.selected{color:#1d4ed8;background:#e1ebff;font-weight:600}.roster-title{font-size:10px;letter-spacing:.8px;margin:24px 8px 10px;color:#64748b}.roster strong{font-size:12px;font-weight:600}.roster small{font-size:10px;color:#64748b}.roster>button{min-height:48px}.channels>button{font-size:13px;min-height:34px}.direct-list>button{font-size:12px;color:#475569}.direct-list>p,.channels>p{font-size:11px;color:#64748b}.account strong{font-size:12px}.account small{font-size:10px;color:#64748b}.workspace{background:#fff}.workspace>header{height:64px;padding:0 28px;border-color:#e2e8f0;background:#ffffffed}.header-identity h1{font-size:15px;font-weight:650}.room-heading small{font-size:11px;color:#64748b}.chat-column{max-width:820px;padding-top:32px}article{font-size:14px;line-height:1.75}.speaker strong{font-size:12px}.human .message-text{font-size:14px;background:#edf3ff;color:#23395b;border-radius:12px 12px 3px 12px}.composer-column{max-width:100%;width:min(100%,768px)}.composer-area{padding:16px 28px 20px}.disclaimer{font-size:10px;color:#64748b}.primary{background:#2563eb;font-weight:600;font-size:13px;box-shadow:0 3px 8px #2563eb20}.primary:hover{background:#1d4ed8}.section-view{max-width:1100px;width:100%;margin:0 auto;padding:36px}.section-view h2{font-size:25px;font-weight:650}.company-welcome{padding:32px;min-height:230px;margin:24px 0;background:#eef3ff url('/starli-art/workspace-companion-v1.png') right center/cover;border:1px solid #e0e7ff;border-radius:16px}.company-welcome h3{font-size:26px;font-weight:650;letter-spacing:-1px;max-width:62%;margin:8px 0}.company-welcome p{max-width:53%;font-size:13px;color:#475569;margin:10px 0}.company-welcome .welcome-eyebrow{font-size:10px;letter-spacing:1px;font-weight:650;color:#2563eb}.company-shortcuts{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:24px 0}.company-shortcuts button{text-align:left;padding:20px;border:1px solid #e2e8f0;background:#fff;border-radius:12px;box-shadow:0 2px 5px #17233b04}.company-shortcuts button:hover{border-color:#a5bfff;background:#f8faff}.company-shortcuts span{display:block;font-size:23px;color:#2563eb;margin-bottom:12px}.company-shortcuts strong{display:block;font-size:13px}.company-shortcuts small{display:block;font-size:11px;color:#64748b;margin-top:5px}.signin{display:grid;grid-template-columns:1fr 1fr;gap:64px;padding:48px;background:#f4f7ff}.signin-story{height:min(680px,85dvh);border-radius:24px;padding:48px;background:#111b46 url('/starli-art/brand-cosmos-v1.png') center/cover;color:white;display:flex;flex-direction:column;justify-content:center}.story-brand{font-size:42px;font-weight:650;letter-spacing:-1.5px}.signin-story h2{font-size:32px;line-height:1.3;letter-spacing:-1px;font-weight:500;margin:24px 0 0}.signin-story p{color:#d7e1ff;font-size:15px;line-height:1.7;max-width:340px;margin-top:24px}.story-company{margin-top:auto;font-size:14px;color:#d7e1ff}.signin-card{width:min(400px,100%);padding:36px;border:1px solid #dfe6f2;border-radius:16px;box-shadow:0 12px 40px #1e3a8a08;justify-self:start}.signin-card .brand{font-size:25px;letter-spacing:-.7px;margin-bottom:28px}.signin h1{font-size:20px;font-weight:650}.signin p{font-size:13px;color:#64748b}.signin label{font-size:12px;color:#334155}.signin input{font-size:14px;min-height:42px;background:#fafdff}.signin .error{background:#fff0f2;border:1px solid #fecdd3;border-radius:8px;padding:12px;color:#be123c;font-size:12px}.signin form>.primary{min-height:42px}
@media(max-width:900px){.signin{gap:28px;padding:28px}.signin-story{padding:28px}.signin-story h2{font-size:26px}.story-brand{font-size:32px}.company-shortcuts{gap:10px}.company-shortcuts button{padding:14px}}
@media(max-width:700px){aside{width:224px}.signin{display:flex;padding:24px;justify-content:center}.signin-story{display:none}.signin-card{padding:28px}.section-view{padding:24px 18px}.company-welcome{padding:20px;background-position:60% center;min-height:210px}.company-welcome h3{font-size:22px;max-width:65%}.company-welcome p{max-width:60%}.company-shortcuts{grid-template-columns:1fr}.composer-area{padding:12px 16px max(16px,env(safe-area-inset-bottom))}.workspace>header{padding:0 16px}.chat-column{padding:24px 18px 12px}}

/* Company administration has its own bounded scrolling viewport. */
.company-providers-scroll{flex:1;min-height:0;min-width:0;width:100%;overflow-y:auto;overflow-x:hidden;padding:32px 40px 40px;box-sizing:border-box;scrollbar-gutter:stable;background:#f8faff}.company-admin{flex:1;min-height:0;min-width:0;box-sizing:border-box;overflow-y:auto;overflow-x:hidden}.workspace{min-height:0}
@media(max-width:700px){.company-providers-scroll{padding:24px 16px 32px;scrollbar-gutter:auto}}
.bot-unread{margin-left:auto;flex:none;min-width:20px;height:20px;display:grid;place-items:center;padding:0 5px;border-radius:7px;background:#2563eb;color:#fff;font-size:10px;font-weight:650}.roster>button>span{min-width:0}
.wave1-workspace-strip{padding:8px 16px 12px;border-bottom:1px solid #edf0f6;background:#f8faff;overflow-x:hidden;max-width:100%;box-sizing:border-box}
</style>





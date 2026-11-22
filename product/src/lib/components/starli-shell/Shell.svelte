<script lang="ts">
 import {onMount,onDestroy,setContext,tick} from 'svelte';
 import {writable} from 'svelte/store';
 import {page} from '$app/stores';
 import {goto,afterNavigate} from '$app/navigation';
 import {user,chats,banners,chatId,showControls,showArtifacts,showOverview,showSettings} from '$lib/stores';
 import {activeProject,openProjectPanel,projectPanel,dismissPreview} from '$lib/stores/starli-project';
 import {starliAgents} from '$lib/stores/starli-activity';
 import {chatIdFromPath,botChatPath} from '$lib/utils/starli-chat-url';
 import {navItems,extraItems,nativePath,registryReady,jsonApi,type WindowItem} from './identity';
 import Icon from './Icon.svelte';
 import Portrait from './Portrait.svelte';
 import Dock from './Dock.svelte';
 import GroupCreator from './GroupCreator.svelte';
 import CompanyWorkspace from './CompanyWorkspace.svelte';
 import HomeDashboard from './HomeDashboard.svelte';
 import CompanyMessenger from '$lib/components/company/CompanyMessenger.svelte';
 import {listNativeCompanies,switchNativeCompany} from '$lib/utils/company-bootstrap';
 import StarliProjectPanel from '$lib/components/starli-preview/StarliProjectPanel.svelte';
 import UserMenu from '$lib/components/layout/Sidebar/UserMenu.svelte';
 export let guest=false;
 let dock:Dock,modal:HTMLDialogElement,dialog='',query='',railQuery='',filter='All',railSearch=false,sheet='',tab='agents',more=false;
 let ctx=new AbortController(),searchCtrl=new AbortController(),searchTimer:any,results:any[]=[],lookupError='';
 let workspace:any=null,companyList:any[]=[],companiesReady=false,companyMode=false,channel='';
 let companyError='',switchingCompany='',channelWorkspace:CompanyWorkspace;
 let landingBoss='';
 let switchController=new AbortController(),switchEpoch=0;
 let data=writable<any>({});setContext('starli-shell-data',data);
 let favorites:string[]=[],owner='',mounted=false,lastFocus:HTMLElement|null=null;
 $: people=Object.values($starliAgents) as any[];
 $: visible=people.filter(a=>(filter!=='Active'||a.status==='ACTIVE')&&(filter!=='Favorites'||favorites.includes(a.id))&&(filter!=='Custom'||a.kind==='persistent')&&(a.name+' '+a.role).toLowerCase().includes(railQuery.toLowerCase()));
 $: route=$page.url.pathname;
 $: dashboard=route==='/home'&&!companyMode;
 const shellNav=navItems.map(x=>x[0]==='home'?[x[0],x[1],'/home']:x[0]==='chat'?[x[0],x[1],'/']:x);
 $: onChat=route==='/'||!!chatIdFromPath(route);
 $: nativeChat=chatIdFromPath(route)||($chatId&&$chatId!=='local'?$chatId:null);
 $: if(mounted&&owner!==($user?.id||'guest')){owner=$user?.id||'guest';void reset();}
 $: if($projectPanel&&onChat&&!companyMode){tab='project';if(typeof window!=='undefined'&&window.innerWidth<1150)sheet='rail';}
 $: if(!$projectPanel&&tab==='project')tab='agents';
 function stored(key:string){try{return JSON.parse(localStorage.getItem('sd.'+owner+'.'+key)||'null');}catch{return null;}}
 function store(key:string,value:any){try{localStorage.setItem('sd.'+owner+'.'+key,JSON.stringify(value));}catch{}}
 async function reset(){
  ctx.abort();switchController.abort();switchEpoch++;ctx=new AbortController();const sig=ctx.signal;
  data.set({});workspace=null;companyList=[];companiesReady=false;companyMode=false;channel='';favorites=stored('favorites')||[];tab='agents';
  landingBoss='';if(guest)return;
  const requests=[['overview','/api/v1/starli/overview'],['projects','/api/v1/starli/resources/projects?limit=4&offset=0']];
  await Promise.allSettled([...requests.map(async([k,path])=>{const v=await jsonApi(path,sig);if(!sig.aborted)data.update(old=>({...old,[k]:v}));}),loadCompanies()]);
 }
 async function loadCompanies(){const sig=ctx.signal,epoch=switchEpoch;companyError='';try{const items=await listNativeCompanies(jsonApi,sig);if(sig.aborted)return;companyList=items;companiesReady=true;const wanted=stored('company');if(wanted&&!workspace&&epoch===switchEpoch&&$page.url.pathname==='/home'){const item=companyList.find(x=>x.id===wanted);if(item)void selectCompany(item);else store('company',null);}}catch{if(!sig.aborted){companiesReady=false;companyError='Company workspaces are unavailable. Try refreshing the list.';}}}
 async function selectCompany(item:any){companyError='';switchingCompany=item?.id||'';switchController.abort();switchController=new AbortController();const signal=switchController.signal,epoch=++switchEpoch,actor=owner;if(item){try{item=await switchNativeCompany(jsonApi,actor,item,signal);if(epoch!==switchEpoch||owner!==actor||signal.aborted)return;}catch{if(epoch===switchEpoch&&!signal.aborted){switchingCompany='';companyError='Company access could not be confirmed. Refresh your workspaces.';}return;}}if(epoch!==switchEpoch||owner!==actor)return;switchingCompany='';close();workspace=item;companyMode=!!item;channel='';sheet='';tab='agents';if(item&&$page.url.pathname!=='/home')void goto('/home');dismissPreview();showControls.set(false);store('company',item?.id||null);}
 async function show(name:string){sheet='';dialog=name;query='';results=[];lookupError='';lastFocus=document.activeElement as HTMLElement;await tick();if(!modal.open)modal.showModal();modal.querySelector<HTMLElement>('input:not([type=checkbox]),button')?.focus();}
 function close(){if(modal?.open)modal.close();dialog='';searchCtrl.abort();clearTimeout(searchTimer);}
 function ended(){dialog='';lastFocus?.focus();}
 function search(text:string){query=text;results=[];lookupError='';searchCtrl.abort();clearTimeout(searchTimer);if(!text.trim()||guest||companyMode)return;
  searchCtrl=new AbortController();const s=searchCtrl.signal;
  searchTimer=setTimeout(async()=>{try{const r=await jsonApi('/api/v1/chats/search?text='+encodeURIComponent(text)+'&page=1',s);if(!s.aborted)results=Array.isArray(r)?r:[];}catch{if(!s.aborted)lookupError='Chat history search unavailable.';}},200);
 }
 function navigate(path:string){sheet='';close();
  if(['agents','chats','automations','integrations'].includes(path)){act(path);return;}
  if(path==='/'){openAccountChat();return;}
  if(guest&&!['/','/home','/auth'].includes(path)){void goto('/auth');return;}
  if(companyMode)selectCompany(null);void goto(path);
 }
 async function openMain(path:string){
  await selectCompany(null);sheet='';close();await goto(path);
 }
 function openAccountChat(){
  const boss=people.find(agent=>agent.kind==='boss');
  void openMain(!guest&&boss?nativePath(boss):'/');
 }
 $: isPersonalLanding=!guest&&!companyMode&&route==='/'&&!$page.url.searchParams.get('starli');
 $: if(!isPersonalLanding)landingBoss='';
 $: if(mounted&&isPersonalLanding&&owner===$user?.id&&$registryReady==='ready'&&people.length){
  const boss=people.find(agent=>agent.kind==='boss');
  if(boss&&landingBoss!==owner){landingBoss=owner;void goto(nativePath(boss),{replaceState:true});}
 }
 function openAgent(agent:any){close();sheet='';dock.open({key:'bot:'+agent.id,name:agent.name,path:nativePath(agent),agentId:agent.id,min:false,full:false});}
 function openChat(chat:any){const a=people.find(x=>x.chatId===chat.id);if(a){openAgent(a);return;}close();sheet='';dock.open({key:'chat:'+chat.id,name:chat.title,path:botChatPath(chat.title,chat.id),min:false,full:false});}
 function openGroup(g:any){close();dock.open({key:'group:'+g.groupId,path:'/starli/groups?group='+encodeURIComponent(g.groupId),groupId:g.groupId,name:g.name,min:false,full:false});}
 function edit(agent:any=null){if(guest){void goto('/auth');return;}close();sheet='';window.dispatchEvent(new CustomEvent('starli-edit-agent',{detail:agent}));}
 function panel(value:string){
  if(guest){if(value==='preview'){window.dispatchEvent(new Event('starli-guest-preview'));return;}void show('signin');return;}
  if(value==='tasks'){void show('tasks');return;}
  if(!onChat||companyMode){void show('context');return;}
  if((value==='preview'||value==='files')&&!$activeProject){void show('project-needed');return;}
  if(value==='computer'&&!nativeChat){void show('computer-needed');return;}
  if(openProjectPanel(value)){tab='project';showArtifacts.set(false);showOverview.set(false);showControls.set(true);if(innerWidth<1150)sheet='rail';}
 }
 function act(action:string){
  if(action==='agents'){if(guest){void goto('/auth');return;}dismissPreview();showControls.set(false);tab='agents';if(innerWidth<1150||dashboard)sheet='rail';return;}
  if(action==='chats'||action==='search'){void show('search');return;}
  if(['preview','computer','files','tasks'].includes(action)){panel(action);return;}
  if(action==='automations'||action==='integrations'){void show(action);return;}
 }
 function favorite(id:string){favorites=favorites.includes(id)?favorites.filter(x=>x!==id):[...favorites,id];store('favorites',favorites);}
 function keys(e:KeyboardEvent){if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();void show('search');}if(e.key==='Escape')sheet='';}
 const actionEvent=(e:Event)=>act((e as CustomEvent).detail);
 function companyAccessLost(e:Event){const id=(e as CustomEvent).detail?.companyId;if(id!==workspace?.id)return;companyList=companyList.filter(c=>c.id!==id);void selectCompany(null);void loadCompanies();}
 onMount(()=>{mounted=true;window.addEventListener('starli-shell-action',actionEvent);window.addEventListener('starli-company-access-lost',companyAccessLost);window.addEventListener('keydown',keys);return()=>{window.removeEventListener('starli-shell-action',actionEvent);window.removeEventListener('starli-company-access-lost',companyAccessLost);window.removeEventListener('keydown',keys);};});
 onDestroy(()=>{ctx.abort();switchController.abort();switchEpoch++;searchCtrl.abort();clearTimeout(searchTimer);});
 afterNavigate(()=>{sheet='';});
</script>
<div class="sd-shell" class:company={companyMode} class:dashboard>
 <header class="sd-top">
 <button class="sd-icon mobile-nav" aria-label="Open navigation" on:click={()=>sheet=sheet==='nav'?'':'nav'}><Icon name="menu"/></button>
 <a class="sd-brand" aria-label="StarliDigital home" href="/" on:click={()=>{if(companyMode)selectCompany(null)}}><i>✦</i><span>StarliDigital</span></a>
 <button class="sd-company sd-button" aria-haspopup="dialog" aria-label={workspace?'Switch workspace, current company '+workspace.name:guest?'Guest workspace sign in':'Switch workspace, current personal workspace'} on:click={()=>show(guest?'signin':'workspace')}><Icon name="layers"/><span>{workspace?.name||($user?.name?'Personal workspace':'Guest workspace')}</span><Icon name="down" size={14}/></button>
 <div class="sd-top-fill"></div>
 {#if $data.overview?.credits?.available&&$data.overview.credits.balance!=null&&!companyMode}<a class="sd-button balance" href="/starli/billing"><Icon name="billing" size={16}/>{$data.overview.credits.balance.toLocaleString()} credits</a>{/if}
 <button class="sd-find" aria-label="Search workspace" aria-haspopup="dialog" on:click={()=>show('search')}><Icon name="search" size={18}/><span>Search workspace</span><kbd>Ctrl K</kbd></button>
 {#if companyMode}<button class="sd-button" on:click={()=>show('invite')}><Icon name="groups" size={17}/>Invite people</button>{/if}
 <button class="sd-icon sd-bell" aria-label="Workspace announcements" on:click={()=>show('notices')}><Icon name="bell"/>{#if $banners?.length}<i></i>{/if}</button>
 {#if guest}<a class="sd-primary" href="/auth">Sign in</a>{:else}<UserMenu role={$user?.role}><span class="sd-profile" title="Account menu">{#if $user?.profile_image_url}<img alt="" src={$user.profile_image_url}/>{:else}{($user?.name||'A').slice(0,1)}{/if}<span class="sr-only">Account menu</span><Icon name="down" size={14}/></span></UserMenu>{/if}
 <button class="sd-icon mobile-agents" aria-label="Open agents and workspace" on:click={()=>sheet=sheet==='rail'?'':'rail'}><Icon name="groups"/></button>
 </header>
 {#if sheet}<button class="sd-scrim" aria-label="Close workspace panel" on:click={()=>sheet=''}></button>{/if}
 <aside class="sd-nav" class:opened={sheet==='nav'} aria-label="Workspace navigation">
 <button class="sd-button mobile-company" aria-label={workspace?'Switch workspace, current company '+workspace.name:guest?'Guest workspace sign in':'Switch workspace, current personal workspace'} aria-haspopup="dialog" on:click={()=>show(guest?'signin':'workspace')}><Icon name="layers" size={16}/><span>{workspace?.name||'Personal workspace'}</span><Icon name="down" size={14}/></button>
 <nav>{#each shellNav.filter(x=>!['automations','integrations'].includes(x[2])) as [icon,label,path]}<button class:current={route===path&&!companyMode} aria-current={route===path&&!companyMode?'page':undefined} on:click={()=>navigate(path)}><Icon name={icon}/>{companyMode?(path==='agents'?'Company directory':['/home','/','/starli/projects','/starli/billing'].includes(path)?'Personal '+label:label):label}</button>{/each}
 <button class="more" aria-expanded={more} on:click={()=>more=!more}><Icon name="more"/>More <Icon name="down" size={13}/></button>
 {#if more}{#each extraItems as [icon,label,path]}<button on:click={()=>navigate(path)}><Icon name={icon} size={17}/>{label}</button>{/each}{#if $user?.role==='admin'}<a href="/starli/admin">Admin</a>{/if}{/if}</nav>
 {#if companyMode}<section><h3>{workspace.name}</h3><p class="sd-empty">Company workspace</p><button class="sd-list-link" on:click={()=>{sheet='';channelWorkspace?.openChannels();}}>Channels <Icon name="chat" size={16}/></button></section>{/if}
 {#if !guest&&!companyMode&&$chats?.length}<section class="sd-recent"><h3>Recent chats</h3>{#each $chats.slice(0,4) as chat}<button on:click={()=>openChat(chat)}><Icon name="chat" size={16}/><span>{chat.title}</span></button>{/each}</section>{/if}
</aside>
 <main class="sd-main" class:home={onChat&&route==='/'&&!companyMode}>
 {#if companyMode}{#key workspace.id}<CompanyWorkspace bind:this={channelWorkspace} company={workspace} bind:channel/>{/key}{:else if dashboard}<HomeDashboard {guest} overview={$data.overview} projects={$data.projects} agents={people} registryState={$registryReady}/>{:else if isPersonalLanding}<div class="boss-loading" role="status">{#if $registryReady==='error'||$registryReady==='ready'&&!people.some(a=>a.kind==='boss')}<p>Your personal STARLI BOSS is unavailable.</p><button class="sd-button" on:click={()=>location.reload()}>Retry</button>{:else}Opening STARLI BOSS...{/if}</div>{:else}<slot/>{/if}
 </main>
 <aside class="sd-rail" class:opened={sheet==='rail'} aria-label="Agents and workspace">
 {#if !companyMode&&(nativeChat||$activeProject)}<div class="sd-worktabs">{#each [['globe','Preview','preview'],['computer','Computer','computer'],['projects','Files','files']].filter(x=>x[2]==='computer'?!!nativeChat:!!$activeProject) as [icon,label,value]}<button on:click={()=>companyMode?window.dispatchEvent(new CustomEvent('company-panel',{detail:value})):panel(value)}><Icon name={icon} size={16}/><span>{label}</span></button>{/each}</div>{/if}
 {#if tab==='project'&&onChat&&!companyMode}<div class="rail-card sd-project"><button class="sd-list-link" on:click={()=>act('agents')}>← Back to agents</button><StarliProjectPanel chatId={nativeChat}/></div>
 {:else if companyMode}<div class="rail-card"><h2>Company directory</h2><p class="sd-empty">People and shared company bots</p>{#key workspace.id}<CompanyWorkspace company={workspace} mode="roster" {channel}/>{/key}</div>
 {:else}<div class="rail-card sd-directory"><div class="rail-heading"><div><h2>Personal agents</h2><p>{guest?'Personal workspace':$registryReady==='ready'?people.length+' personal '+(people.length===1?'bot':'bots'):'Agent directory'}</p></div>
 {#if !guest}<button class="sd-icon" aria-label="Find an agent" on:click={()=>railSearch=!railSearch}><Icon name="search"/></button><button class="sd-icon" aria-label="Create agent or group" on:click={()=>show('create')}><Icon name="plus"/></button>{/if}</div>
 {#if railSearch}<input class="sd-input" placeholder="Find an agent…" aria-label="Find an agent by name" bind:value={railQuery}/>{/if}
 {#if !guest}<div class="sd-filters">{#each ['All','Active','Favorites','Custom'] as value}<button class:selected={filter===value} aria-pressed={filter===value} on:click={()=>filter=value}>{value}</button>{/each}</div>{/if}
 {#if guest}<div class="sd-rail-empty"><div class="preview-portraits" aria-hidden="true">{#each [0,1,7] as n}<Portrait agent={{avatarShape:'p'+n}} size={42}/>{/each}</div><h3>Your AI agent bots</h3><p>Sign in to see your agents, recent conversations and groups.</p><a class="sd-button" href="/auth">Sign in <Icon name="arrow" size={14}/></a></div>
 {:else}{#each visible as agent(agent.id)}<div class="agent-row"><button class="agent-open" on:click={()=>openAgent(agent)}><Portrait {agent} size={50}/><span><strong>{agent.name}</strong><small>{agent.lastActivity||agent.role}</small></span></button><div class="agent-side">{#if agent.lastMessageAt}<time>{new Date(agent.lastMessageAt*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time>{/if}<button class="sd-row-action" aria-label={'Edit '+agent.name} on:click={()=>edit(agent)}><Icon name="edit" size={14}/></button><button class="sd-row-action" class:faved={favorites.includes(agent.id)} aria-label={'Favorite '+agent.name} aria-pressed={favorites.includes(agent.id)} on:click={()=>favorite(agent.id)}><Icon name="star" size={14}/></button></div></div>{:else}<p class="sd-empty">{$registryReady==='error'?'Agent directory unavailable.':$registryReady==='loading'?'Loading your agents…':'No matching agents.'}</p>{/each}
 <button class="sd-group-link" on:click={()=>show('groups')}><Icon name="groups" size={17}/>Group conversations <Icon name="arrow" size={15}/></button>{/if}</div>{/if}</aside>
 {#if !guest&&!companyMode}{#key owner}<Dock {owner} bind:this={dock} on:main={e=>openMain(e.detail)}/>{/key}{/if}
 {#if !guest&&companyMode}{#key owner+'|'+workspace.id}<CompanyMessenger directory={workspace.directory||[]} companyId={workspace.id} {owner}/>{/key}{/if}
 <dialog bind:this={modal} class="sd-dialog" on:close={ended}><div class="dialog-head"><button class="sd-icon" aria-label="Close dialog" on:click={close}><Icon name="close" size={17}/></button></div>
 {#if dialog==='search'}<h2>Search workspace</h2><input class="sd-input" placeholder="Search chats, agents and pages…" aria-label="Search workspace" value={query} on:input={e=>search(e.currentTarget.value)}/>
 {#each [...shellNav,...extraItems].filter(x=>!['automations','integrations'].includes(x[2])).filter(x=>x[1].toLowerCase().includes(query.toLowerCase())).slice(0,query?12:5) as x}<button class="sd-list-link" on:click={()=>navigate(x[2])}><Icon name={x[0]} size={16}/>{x[1]}</button>{/each}
 {#if !companyMode&&!guest}{#each people.filter(x=>x.name.toLowerCase().includes(query.toLowerCase())).slice(0,5) as a}<button class="sd-list-link" on:click={()=>openAgent(a)}><Portrait agent={a} size={24}/>{a.name}</button>{/each}
 {#each (query?results:$chats||[]).slice(0,10) as c}<button class="sd-list-link" on:click={()=>openChat(c)}><Icon name="chat" size={16}/>{c.title}</button>{/each}{/if}{#if lookupError}<p>{lookupError}</p>{/if}
 {:else if dialog==='groups'}<GroupCreator on:open={e=>openGroup(e.detail)}/>
 {:else if dialog==='create'}<h2>Create</h2><button class="sd-list-link" on:click={()=>edit()}><Icon name="agents"/>New agent</button><button class="sd-list-link" on:click={()=>show('groups')}><Icon name="groups"/>Group conversation</button>
 {:else if dialog==='workspace'}<h2>Switch workspace</h2><button class="sd-list-link" on:click={()=>selectCompany(null)}>Personal workspace</button>{#each companyList as c}<button class="sd-list-link" aria-pressed={workspace?.id===c.id} aria-busy={switchingCompany===c.id} on:click={()=>selectCompany(c)}>{c.name}{#if switchingCompany===c.id}<small>Opening...</small>{:else if workspace?.id===c.id}<Icon name="check" size={14}/>{/if}</button>{:else}{#if companiesReady}<p>No company workspaces yet. Create your first company below.</p>{/if}{/each}<button class="sd-list-link" on:click={loadCompanies}>Refresh companies</button><CompanyWorkspace mode="create" on:created={async(e)=>{await loadCompanies();void selectCompany(companyList.find(c=>c.id===e.detail.id)||e.detail)}}/><details><summary>Join with an invitation</summary><CompanyWorkspace mode="accept" on:accepted={async(e)=>{await loadCompanies();const c=companyList.find(c=>c.id===e.detail.id);if(c)void selectCompany(c);}}/></details><details><summary>Your account ID</summary><input class="sd-input" aria-label="Your account ID" readonly value={$user?.id||''}/></details>{#if companyError}<p role="alert">{companyError}</p>{/if}
 {:else if dialog==='invite'}<CompanyWorkspace company={workspace} mode="invite"/>
 {:else if dialog==='notices'}<h2>Announcements</h2>{#each ($banners||[]) as b}<p>{b.content}</p>{:else}<p>No workspace announcements.</p>{/each}
 {:else if dialog==='signin'}<h2>Sign in to your workspace</h2><p>Agents, conversations and company workspaces belong to your account.</p><a href="/auth" class="sd-primary">Sign in</a>
 {:else if dialog==='project-needed'}<h2>Select a project</h2><p>Choose a customer project in the chat toolbar to open its preview or files.</p><a class="sd-button" href="/starli/projects">View projects</a>
 {:else if dialog==='computer-needed'}<h2>Open an agent conversation</h2><p>Computer Use needs a saved conversation. Select an agent to open its chat.</p><button class="sd-button" on:click={()=>{close();act('agents')}}>View agents</button>
 {:else if dialog==='tasks'}<h2>Task queue</h2><p>The persisted task queue is unavailable in this workspace.</p>
 {:else if dialog==='automations'||dialog==='integrations'}<h2>{dialog==='automations'?'Automations':'Integrations'}</h2><p>{dialog==='automations'?'The workflow manager is unavailable in this workspace.':'Connected integrations are unavailable in this workspace.'}</p><a class="sd-button" href={guest?'/auth':'/starli/tools'}>Browse available tools</a>
 {:else if dialog==='context'}<h2>Open a chat workspace</h2><p>Preview, files and Computer Use use the active conversation.</p>{/if}
 </dialog>
</div>

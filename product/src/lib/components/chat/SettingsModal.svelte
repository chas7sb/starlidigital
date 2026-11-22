<script lang="ts">
 import { getContext,onDestroy } from 'svelte';
 import { toast } from 'svelte-sonner';
 import { settings, user, models } from '$lib/stores';
 import { updateUserSettings } from '$lib/apis/users';
 import { getModels } from '$lib/apis';
 import Modal from '../common/Modal.svelte';
 import StarliBrand from '../starli-preview/StarliBrand.svelte';
 import XMark from '../icons/XMark.svelte';
 import Account from './Settings/Account.svelte';
 import Chats from './Settings/Chats.svelte';
 import Personalization from './Settings/Personalization.svelte';
 import General from './Settings/General.svelte';
 import Interface from './Settings/Interface.svelte';
 import Audio from './Settings/Audio.svelte';
 import StarliPreferences from './Settings/StarliPreferences.svelte';
 import Providers from './Settings/Providers.svelte';
 import CustomMCP from './Settings/CustomMCP.svelte';
 import APIAccess from './Settings/APIAccess.svelte';
 import {ApiAccessClient} from './Settings/api-access';
 import {createMcpRegistryClient,type McpRegistryPort} from '$lib/utils/starli-account-mcp';
 import StarliMailSettings from '$lib/components/starli-preview/StarliMailSettings.svelte';
 const i18n = getContext('i18n');
 export let show = false;
 let selectedTab = 'account';
 let search = '';
 let saving = false;
 let pendingSave = Promise.resolve();
 let saveStatus = '';
 let mcpOwner='',mcpApi:McpRegistryPort|null=null;
 let apiBots=[],apiSessionOwner='',apiEpoch=0,apiAvailable=false,apiAbort=new AbortController(),apiProbe:ApiAccessClient|null=null;
 $: if(show&&$user?.id&&apiSessionOwner!==$user.id){apiSessionOwner=$user.id;void probeApi();}
 async function probeApi(){const owner=apiSessionOwner,epoch=++apiEpoch,token=localStorage.token;apiAbort.abort();apiAbort=new AbortController();apiProbe?.clear();const port=new ApiAccessClient();apiProbe=port;port.setSession(owner,token);apiAvailable=false;apiBots=[];
  try{const [response]=await Promise.all([fetch('/api/v1/starli/api-tokens/bots',{signal:apiAbort.signal,credentials:'same-origin',headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store'}),port.list()]);if(!response.ok||!response.headers.get('Content-Type')?.includes('application/json'))throw Error();const data=await response.json();if(!Array.isArray(data.items)||data.items.some((b:any)=>typeof b.id!=='string'||typeof b.name!=='string'))throw Error();if($user?.id===owner&&epoch===apiEpoch&&localStorage.token===token){apiBots=data.items;apiAvailable=true;}}catch{}finally{port.clear();}
 }
 $: if(!$user?.id){apiSessionOwner='';apiEpoch++;apiAbort.abort();apiProbe?.clear();apiAvailable=false;apiBots=[];}
 onDestroy(()=>{apiEpoch++;apiAbort.abort();apiProbe?.clear();});
 $: if(($user?.id??'')!==mcpOwner){mcpOwner=$user?.id??'';const owner=mcpOwner;mcpApi=owner?createMcpRegistryClient(()=>typeof localStorage!=='undefined'&&$user?.id===owner?localStorage.token??'':''):null;}
 const tabs = [
  {id:'account',title:'Account',description:'Profile and password'},
  {id:'providers',title:'Providers and models',description:'API keys and subscription sign-in'},
  {id:'api-access',title:'API Access',description:'Tokens for existing personal and shared bot conversations'},
  {id:'custom-mcp',title:'Custom MCP',description:'Account connections for all your bots'},
  {id:'mail',title:'Email account',description:'Connect your mailbox securely'},
  {id:'appearance',title:'Appearance',description:'Theme and language'},
  {id:'chat',title:'Chat',description:'Messages and responses'},
  {id:'voice',title:'Voice',description:'Speech and playback'},
  {id:'memory',title:'Personalization',description:'Memory and preferences'},
  {id:'data',title:'Data and privacy',description:'Export, archive and delete chats'}
 ];
 $: visibleTabs = tabs.filter(t => (t.id!=='api-access'||apiAvailable)).filter(t => (t.title+' '+t.description).toLowerCase().includes(search.toLowerCase()));
 $: if ($user?.role !== 'admin' && ['advanced','interface','audio'].includes(selectedTab)) selectedTab='account';
 const saveSettings = (updated) => {
  const owner = $user?.id;
  const token = localStorage.token;
  const task = async () => {
   if (!owner || $user?.id !== owner) return false;
   const previous = $settings;
   const next = {...previous,...updated};
   saving=true;saveStatus='';
   try {
    const response = await updateUserSettings(token,{ui:next});
    if (!response) throw new Error('Preferences not saved');
    if ($user?.id !== owner) return false;
    settings.set(next);
    localStorage.setItem('settings',JSON.stringify(next));
    saveStatus='Saved';
    return true;
   } catch(error) {
    toast.error($i18n.t('Unable to save your preferences. Please try again.'));
    saveStatus='Not saved';
    return false;
   } finally {saving=false;}
  };
  const result=pendingSave.then(task,task);
  pendingSave=result.then(()=>undefined,()=>undefined);
  return result;
 };
 const saved = () => {toast.success($i18n.t('Settings saved successfully!'));};
 const refreshModels = async () => {const result=await getModels(localStorage.token);models.set(result);return result;};
</script>

<Modal size="xl" bind:show>
 <section aria-label="STARLIDIGITAL settings" class="text-gray-800 dark:text-gray-100">
  <header class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-850">
   <div><StarliBrand compact /><h1 class="text-lg font-medium mt-2">{$i18n.t('Settings')}</h1></div>
   <button type="button" aria-label="Close settings" class="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-850" on:click={()=>show=false}><XMark /></button>
  </header>
  <div class="flex flex-col md:flex-row gap-4 p-4">
   <nav aria-label="Settings categories" class="md:w-48 shrink-0">
    <input aria-label="Search settings" placeholder={$i18n.t('Search settings')} bind:value={search} class="w-full mb-3 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-850 text-sm outline-hidden" />
    <div class="flex md:flex-col gap-1 overflow-x-auto">
     {#each visibleTabs as tab}
      <button type="button" aria-current={selectedTab===tab.id?'page':undefined} on:click={()=>selectedTab=tab.id}
       class="text-left shrink-0 px-3 py-2 rounded-xl text-sm transition {selectedTab===tab.id?'bg-gray-100 dark:bg-gray-850 font-medium':'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-850'}">
       {$i18n.t(tab.title)}<span class="hidden md:block text-xs font-normal text-gray-500 mt-0.5">{$i18n.t(tab.description)}</span>
      </button>
     {/each}
    </div>
    {#if visibleTabs.length===0}<p class="text-xs text-gray-500 p-3">{$i18n.t('No results found')}</p>{/if}
    {#if $user?.role==='admin'}
     <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-850 space-y-1">
      <a href="/starli/admin" on:click={()=>show=false} class="block text-sm px-3 py-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-850">STARLIDIGITAL Admin ↗</a>
      <button type="button" on:click={()=>selectedTab='advanced'} class="text-sm text-gray-500 px-3 py-2">{$i18n.t('Advanced preferences')}</button>
     </div>
    {/if}
   </nav>
   <div class="flex-1 min-w-0 md:min-h-[32rem] max-h-[65vh] md:max-h-[36rem] overflow-y-auto pr-1">
    {#if !$user?.id}
     <p class="p-5 text-sm text-gray-500">{$i18n.t('Sign in to manage your account and preferences.')}</p>
    {:else}
     <div class="flex items-center justify-between mb-4">
      <h2 class="font-medium">{$i18n.t(tabs.find(t=>t.id===selectedTab)?.title ?? 'Advanced preferences')}</h2>
      <span role="status" class="text-xs text-gray-500">{saving?$i18n.t('Saving…'):$i18n.t(saveStatus)}</span>
     </div>
     {#key selectedTab}
      {#if selectedTab==='account'}
       <Account {saveSettings} saveHandler={saved} />
      {:else if selectedTab==='mail'}
 <StarliMailSettings/>
 {:else if selectedTab==='providers'}
       <Providers/>
 {:else if selectedTab==='api-access'}
       <APIAccess accountKey={$user?.id??''} nativeBearer={typeof localStorage!=='undefined'?localStorage.token??'':''} bots={apiBots}/>
 {:else if selectedTab==='custom-mcp'}
       <CustomMCP ownerId={$user?.id??''} api={mcpApi}/>
      {:else if ['appearance','chat','voice'].includes(selectedTab)}
       <StarliPreferences section={selectedTab} {saveSettings} />
      {:else if selectedTab==='memory'}
       <Personalization {saveSettings} on:save={saved} />
      {:else if selectedTab==='data'}
       <Chats {saveSettings} />
      {:else if $user?.role==='admin' && ['advanced','interface','audio'].includes(selectedTab)}
       <div class="flex flex-wrap gap-2 mb-4 text-xs">
        {#each [{id:'advanced',title:'Generation'},{id:'interface',title:'Interface'},{id:'audio',title:'Voice engines'}] as tab}
         <button type="button" class="px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-850" on:click={()=>selectedTab=tab.id}>{$i18n.t(tab.title)}</button>
        {/each}
       </div>
       {#if selectedTab==='advanced'}<General {saveSettings} getModels={refreshModels} on:save={saved} />
       {:else if selectedTab==='interface'}<Interface {saveSettings} on:save={saved} />
       {:else}<Audio {saveSettings} on:save={saved} />{/if}
      {/if}
     {/key}
    {/if}
   </div>
  </div>
 </section>
</Modal>

<script lang="ts">
 import {getContext,onMount} from 'svelte';
 import {settings,theme,config} from '$lib/stores';
 import {getLanguages,changeLanguage} from '$lib/i18n';
 import {getVoices} from '$lib/apis/audio';
 export let section='appearance';
 export let saveSettings: (updated:any)=>Promise<boolean>;
 const i18n=getContext('i18n');
 let selectedTheme='system';
 let language=$i18n.language;
 let languages=[];
 let voices=[];
 let rate=$settings?.audio?.tts?.playbackRate??1;
 let voice=$settings?.audio?.tts?.voice??'';
 let voiceError=false;
 const appearanceToggles=[
  {key:'widescreenMode',label:'Wide chat layout',detail:'Give conversations more room.',value:false},
  {key:'chatBubble',label:'Chat bubbles',detail:'Separate your messages visually.',value:true},
  {key:'showUsername',label:'Show your name',detail:'Display your name beside messages.',value:false}
 ];
 const chatToggles=[
  {key:'richTextInput',label:'Rich text composer',detail:'Format your prompts as you write.',value:true},
  {key:'ctrlEnterToSend',label:'Ctrl + Enter to send',detail:'Use Enter for a new line.',value:false},
  {key:'detectArtifacts',label:'Interactive previews',detail:'Display generated pages and artifacts in isolated previews.',value:true},
  {key:'collapseCodeBlocks',label:'Collapse code blocks',detail:'Keep long responses compact.',value:false},
  {key:'expandDetails',label:'Expand response details',detail:'Show reasoning and tool details when available.',value:false},
  {key:'scrollOnBranchChange',label:'Scroll when changing branches',detail:'Follow the selected conversation branch.',value:true},
  {key:'copyFormatted',label:'Copy formatted responses',detail:'Keep formatting when copying text.',value:false},
  {key:'autoTags',label:'Automatic chat tags',detail:'Organize new conversations with tags.',value:true}
 ];
 const voiceToggles=[
  {key:'speechAutoSend',label:'Send after transcription',detail:'Automatically send your voice message after transcription.',value:false},
  {key:'responseAutoPlayback',label:'Read responses aloud',detail:'Automatically play new spoken responses.',value:false},
  {key:'voiceInterruption',label:'Voice interruption',detail:'Allow a conversation to respond when you interrupt.',value:false},
  {key:'showEmojiInCall',label:'Call reactions',detail:'Show visual reactions during voice calls.',value:false}
 ];
 $: toggles=section==='appearance'?appearanceToggles:section==='chat'?chatToggles:voiceToggles;
 const changeTheme=async()=>{
  localStorage.setItem('theme',selectedTheme);theme.set(selectedTheme);
  const dark=selectedTheme==='system'?matchMedia('(prefers-color-scheme: dark)').matches:selectedTheme!=='light';
  document.documentElement.classList.remove('light','dark','oled-dark','her');
  document.documentElement.classList.add(dark?'dark':'light');
  if(selectedTheme==='oled-dark')document.documentElement.classList.add('oled-dark');
  for(const name of ['800','850','900','950'])document.documentElement.style.removeProperty('--color-gray-'+name);
  if(selectedTheme==='oled-dark')for(const [name,color] of [['800','#101010'],['850','#050505'],['900','#000000'],['950','#000000']])document.documentElement.style.setProperty('--color-gray-'+name,color);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#171717':'#ffffff');
  (window as any).applyTheme?.();
  await saveSettings({theme:selectedTheme});
 };
 const saveVoice=()=>saveSettings({audio:{...$settings.audio,tts:{...$settings.audio?.tts,playbackRate:rate,voice:voice||undefined,defaultVoice:$config?.audio?.tts?.voice??''}}});
 onMount(async()=>{
  selectedTheme=localStorage.theme??'system';
  languages=await getLanguages();
  if(section==='voice'){
   try{
    voices=$config?.audio?.tts?.engine?((await getVoices(localStorage.token))?.voices??[]):speechSynthesis.getVoices().map(v=>({id:v.voiceURI,name:v.name}));
   }catch{voiceError=true;}
  }
 });
</script>
<div class="space-y-5 text-sm">
 <p class="text-xs text-gray-500">{section==='appearance'?'Make STARLIDIGITAL feel right for you.':section==='chat'?'Choose how you write and read conversations with Starli AI.':'Personalize speech and playback. Available voices are managed by STARLIDIGITAL.'}</p>
 {#if section==='appearance'}
  <label class="flex justify-between items-center gap-4"><span>Theme</span><select aria-label="Theme" bind:value={selectedTheme} on:change={changeTheme} class="rounded-lg p-2 bg-gray-50 dark:bg-gray-850"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="oled-dark">OLED dark</option></select></label>
  <label class="flex justify-between items-center gap-4"><span>Language</span><select aria-label="Language" bind:value={language} on:change={async()=>{await changeLanguage(language);await saveSettings({language});}} class="rounded-lg p-2 max-w-[65%] bg-gray-50 dark:bg-gray-850">{#each languages as item}<option value={item.code}>{item.title}</option>{/each}</select></label>
 {/if}
 <div class="divide-y divide-gray-100 dark:divide-gray-850">
  {#each toggles as item}
   <div class="flex justify-between items-center gap-4 py-3">
    <div><div class="font-medium text-sm">{$i18n.t(item.label)}</div><p class="text-xs text-gray-500 mt-1">{$i18n.t(item.detail)}</p></div>
    <button type="button" role="switch" aria-label={item.label} aria-checked={$settings[item.key]??item.value} class="shrink-0 w-9 h-5 rounded-full transition {($settings[item.key]??item.value)?'bg-black dark:bg-white':'bg-gray-200 dark:bg-gray-700'}" on:click={()=>saveSettings({[item.key]:!($settings[item.key]??item.value)})}>
     <span class="block w-4 h-4 rounded-full transition-transform {($settings[item.key]??item.value)?'translate-x-[18px] bg-white dark:bg-black':'translate-x-0.5 bg-white'}"></span>
    </button>
   </div>
  {/each}
 </div>
 {#if section==='chat'}
  <label class="flex items-center justify-between gap-4"><span>Conversation direction</span><select aria-label="Conversation direction" value={$settings.chatDirection??'auto'} on:change={e=>saveSettings({chatDirection:e.currentTarget.value})} class="p-2 rounded-lg bg-gray-50 dark:bg-gray-850"><option value="auto">Automatic</option><option value="LTR">Left to right</option><option value="RTL">Right to left</option></select></label>
 {:else if section==='voice'}
  <label class="flex items-center justify-between gap-4"><span>Playback speed</span><select aria-label="Playback speed" bind:value={rate} on:change={saveVoice} class="p-2 rounded-lg bg-gray-50 dark:bg-gray-850">{#each [0.5,0.75,1,1.25,1.5,1.75,2] as speed}<option value={speed}>{speed}×</option>{/each}</select></label>
  <label class="flex items-center justify-between gap-4"><span>Voice</span><select aria-label="Voice" bind:value={voice} on:change={saveVoice} class="p-2 max-w-[65%] rounded-lg bg-gray-50 dark:bg-gray-850"><option value="">Platform default</option>{#each voices as item}<option value={item.id??item.voiceURI}>{item.name??item.id}</option>{/each}</select></label>
  {#if voiceError}<p role="status" class="text-xs text-gray-500">Available voices could not be loaded. You can continue using the platform default.</p>{/if}
 {/if}
</div>

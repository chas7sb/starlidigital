<script lang="ts">
 import {encodeAvatar,getAvatar,normalizeAvatar,avatarHash,type AvatarConfig} from './avatar-model';
 export let size=48;
 export let name='';
 export let index=0;
 export let avatarKey='';
 export let config:AvatarConfig|null=null;
 $: value=config?normalizeAvatar(config):getAvatar(avatarKey,name,index);
 $: id='avatar-'+avatarHash(encodeAvatar(value));
 $: gradientFill='url(#'+id+')';
</script>
<span class="avatar-svg" style:width={size+'px'} style:height={size+'px'} aria-hidden="true">
 <svg viewBox="0 0 64 64" fill="none" focusable="false">
  <defs>
   {#if value.gradient==='radial'}
    <radialGradient id={id} cx="29%" cy="17%" r="90%"><stop offset="0" stop-color={value.colorB}/><stop offset=".92" stop-color={value.colorA}/></radialGradient>
   {:else}
    <linearGradient id={id} x1={value.gradient==='horizontal'?'0%':'10%'} y1={value.gradient==='vertical'?'0%':'15%'} x2={value.gradient==='horizontal'?'100%':value.gradient==='vertical'?'0%':'88%'} y2={value.gradient==='vertical'?'100%':value.gradient==='horizontal'?'15%':'92%'}>
      <stop offset="0%" stop-color={value.colorB}/><stop offset="100%" stop-color={value.colorA}/>
    </linearGradient>
   {/if}
  </defs>
  {#if value.background==='soft'}<circle cx="32" cy="32" r="31" fill={value.colorA} opacity=".115"/>
  {:else if value.background==='ring'}<circle cx="32" cy="32" r="29" stroke={value.colorB} stroke-width="4" opacity=".4"/><circle cx="32" cy="32" r="24" fill={value.colorA} opacity=".09"/>{/if}
  <g fill={gradientFill} stroke-linejoin="round">
    {#if value.shell==='round'}<rect x="12" y="15" width="40" height="37" rx="13"/>
    {:else if value.shell==='soft-square'}<path d="M18 13h28a9 9 0 0 1 9 9v24a9 9 0 0 1-9 9H18a9 9 0 0 1-9-9V22a9 9 0 0 1 9-9Z"/>
    {:else if value.shell==='hex'}<path d="M20 11h24l11 12v22L43 56H21L9 45V23Z"/>
    {:else if value.shell==='helmet'}<path d="M12 43V29C12 16 20 10 32 10s20 6 20 19v14c0 10-7 13-20 13S12 53 12 43Z"/>
    {:else if value.shell==='capsule'}<path d="M32 6C22 17 12 28 12 39c0 13 9 19 20 19s20-6 20-19C52 28 42 17 32 6Z"/>
    {:else}<path d="M16 11h32v8h8v31h-8v7H16v-7H8V19h8Z"/>{/if}
  </g>
  <path d="M18 23q10-14 27-5" stroke="#fff" opacity=".24" stroke-width="3" stroke-linecap="round"/>
  {#if value.face==='visor'}
    <rect x="16" y="26" width="32" height="18" rx="9" fill="#20324e"/>
    <path d="M19 30h26" stroke="#fff" opacity=".16" stroke-width="1.5"/>
  {:else if value.face==='focused'}
    <rect x="19" y="25" width="26" height="17" rx="5" fill="#fff" opacity=".95"/>
  {:else if value.face==='cute'}
    <rect x="18" y="23" width="28" height="22" rx="11" fill="#fff" opacity=".96"/>
    <circle cx="20" cy="38" r="2.6" fill={value.colorB} opacity=".65"/><circle cx="44" cy="38" r="2.6" fill={value.colorB} opacity=".65"/>
  {:else if value.face==='minimal'}
    <rect x="20" y="26" width="24" height="16" rx="6" fill="#f5f8ff"/>
  {:else if value.face==='pilot'}
    <path d="M16 32Q32 16 48 32v9a16 16 0 0 1-32 0Z" fill="#e6f6ff"/>
  {:else if value.face==='screen'}
    <rect x="18" y="24" width="28" height="22" rx={value.shell==='pixel'?3:7} fill="#fff" opacity=".97"/>
  {:else if value.face==='open'}
    <rect x="17" y="22" width="30" height="24" rx="10" fill="#fff" opacity=".97"/>
  {:else}
    <rect x="19" y="24" width="26" height="20" rx="8" fill="#fff" opacity=".96"/>
  {/if}
  <g stroke={value.face==='visor'?'#b7e9ff':'#24324d'} stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
   {#if value.eyes==='dots'}<path d="M25.5 31v3m13-3v3"/>
   {:else if value.eyes==='round'}<circle cx="25.5" cy="33" r="2.2" fill={value.face==='visor'?'#b7e9ff':'#24324d'} stroke="none"/><circle cx="38.5" cy="33" r="2.2" fill={value.face==='visor'?'#b7e9ff':'#24324d'} stroke="none"/>
   {:else if value.eyes==='pixel'}<path d="M23.5 31h4v4h-4zm13 0h4v4h-4z" fill={value.face==='visor'?'#b7e9ff':'#24324d'} stroke="none"/>
   {:else if value.eyes==='sleepy'}<path d="M22 34q4 3 7 0m6 0q4 3 7 0"/>
   {:else if value.eyes==='visor'}<path d="M23 34h18" stroke-width="3.6"/>
   {:else}<path d="m26 29 1.2 3.5 3.5 1.1-3.5 1.2-1.2 3.6-1.2-3.6-3.5-1.2 3.5-1.1Zm12 0 1.1 3.5 3.5 1.1-3.5 1.2-1.1 3.6-1.3-3.6-3.5-1.2 3.5-1.1Z" fill={value.face==='visor'?'#b7e9ff':'#24324d'} stroke="none"/>{/if}
  </g>
  <g stroke={value.face==='visor'?'#b7e9ff':'#445c75'} stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">
   {#if value.mouth==='smile'}<path d="M28 39q4 4 8 0"/>
   {:else if value.mouth==='tiny'}<path d="M30 40q2 1.7 4 0"/>
   {:else if value.mouth==='flat'}<path d="M29 40h6"/>
   {:else if value.mouth==='open'}<ellipse cx="32" cy="40" rx="3" ry="2.8" fill={value.face==='visor'?'#b7e9ff':'#445c75'} stroke="none"/>{/if}
  </g>
  {#if value.accessory==='antenna'}
    <path d="M32 15V8m-5 0h10" stroke={value.colorA} stroke-width="3" stroke-linecap="round"/><circle cx="32" cy="6" r="2.5" fill={value.colorA}/>
  {:else if value.accessory==='ears'}
    <path d="M15 22 10 11l12 6m27 5 5-11-12 6" fill={gradientFill} stroke={value.colorA} stroke-width="1.5" stroke-linejoin="round"/>
  {:else if value.accessory==='headphones'}
    <path d="M13 31v-4c0-14 38-14 38 0v4" stroke={value.colorA} stroke-width="3.3" stroke-linecap="round"/><rect x="7" y="29" width="9" height="16" rx="5" fill={gradientFill}/><rect x="48" y="29" width="9" height="16" rx="5" fill={gradientFill}/>
  {:else if value.accessory==='crown'}
    <path d="m19 15-3-11 10 5 6-8 7 8 10-5-3 11Z" fill={gradientFill} stroke={value.colorA} stroke-width="1"/><circle cx="32" cy="8" r="2" fill="white"/>
  {:else if value.accessory==='bolts'}
    <path d="M13 32H7m50 0h-6" stroke={value.colorA} stroke-width="3" stroke-linecap="round"/><circle cx="9" cy="32" r="3" fill={value.colorB}/><circle cx="55" cy="32" r="3" fill={value.colorB}/>
  {:else if value.accessory==='halo'}
    <ellipse cx="32" cy="9" rx="17" ry="5" fill="none" stroke={value.colorB} stroke-width="3"/>
  {/if}
  <path d="M26 49q6 4 12 0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".62"/>
 </svg>
</span>
<style>
 .avatar-svg{display:inline-flex;flex:none;vertical-align:middle;align-items:center;justify-content:center;line-height:0}
 .avatar-svg svg{width:100%;height:100%;display:block;overflow:visible}
</style>

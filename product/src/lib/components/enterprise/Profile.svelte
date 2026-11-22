<script lang="ts">
 import {onMount,onDestroy,createEventDispatcher} from 'svelte';
 export let actor:{name:string;email:string};export let companyName:string;export let accessSignal:AbortSignal;
 const dispatch=createEventDispatcher(),controller=new AbortController();const token=localStorage.token||'';
 let currentPassword='',newPassword='',confirmation='',busy=false,error='',notice='';
 function clear(){currentPassword='';newPassword='';confirmation='';}
 function lost(){controller.abort();clear();dispatch('close');}
 async function save(){
  if(busy)return;error='';notice='';
  if(!currentPassword||!newPassword){error='Enter your current and new passwords.';return;}
  if(newPassword!==confirmation){error='The new passwords do not match.';return;}
  if(newPassword===currentPassword){error='Choose a different new password.';return;}
  busy=true;
  try{
   const response=await fetch('/api/v1/auths/update/password',{method:'POST',signal:controller.signal,credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({password:currentPassword,new_password:newPassword})});
   if(controller.signal.aborted||accessSignal.aborted||localStorage.token!==token)return;
   clear();
   if(!response.ok){if(response.status===401){dispatch('denied',{status:401});throw Error('Your session expired. Sign in again.');}throw Error(response.status===400?'Your current password was not accepted, or password changes are disabled for this account.':response.status===429?'Please wait before trying again.':'Your password could not be changed.');}
   const result=await response.json();if(result!==true)throw Error('The password change could not be confirmed.');
   notice='Your password has been changed.';
  }catch(cause){clear();if(!controller.signal.aborted)error=(cause as Error).message||'The request was interrupted. Sign in with your new password to check the outcome before retrying.';}
  finally{busy=false;}
 }
 function session(event:StorageEvent){if(event.key==='token'||event.key===null)lost();}
 onMount(()=>{accessSignal.addEventListener('abort',lost,{once:true});window.addEventListener('storage',session);if(accessSignal.aborted)lost();});
 onDestroy(()=>{controller.abort();clear();accessSignal.removeEventListener('abort',lost);window.removeEventListener('storage',session);});
</script>
<section class="profile" aria-label="Your profile"><button class="back" on:click={()=>dispatch('close')}>← Back to workspace</button><header><div class="avatar">{actor.name?.slice(0,1)||'A'}</div><div><h1>Your profile</h1><p>{companyName}</p></div></header><div class="identity"><div><small>Name</small><strong>{actor.name}</strong></div><div><small>Email</small><strong>{actor.email}</strong></div></div><form on:submit|preventDefault={save}><h2>Change password</h2><p>Use your current password to choose a new one.</p><label for="profile-current-password">Current password</label><input id="profile-current-password" type="password" autocomplete="current-password" bind:value={currentPassword} required disabled={busy}/><label for="profile-new-password">New password</label><input id="profile-new-password" type="password" autocomplete="new-password" bind:value={newPassword} required disabled={busy}/><label for="profile-confirm-password">Confirm new password</label><input id="profile-confirm-password" type="password" autocomplete="new-password" bind:value={confirmation} required disabled={busy}/>{#if error}<p role="alert" class="error">{error}</p>{/if}{#if notice}<p role="status" class="success">{notice}</p>{/if}<footer><button class="primary" disabled={busy||!currentPassword||!newPassword||!confirmation}>{busy?'Updating…':'Update password'}</button></footer></form></section>
<style>.profile{width:100%;max-width:760px;padding:36px 44px 60px;margin:0 auto;overflow:auto;color:#17243f}.back{border:0;background:none;color:#71809a;font:inherit;font-size:12px;padding:0;cursor:pointer}header{display:flex;align-items:center;gap:15px;margin:32px 0}.avatar{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:#eaf0ff;color:#3466f6;font-size:20px}h1{font-size:25px;font-weight:500;letter-spacing:-.6px;margin:0}p{font-size:12px;line-height:1.7;color:#71809a;margin:6px 0}.identity{display:grid;grid-template-columns:1fr 1fr;gap:20px;border:1px solid #e6ebf4;border-radius:12px;padding:20px;margin-bottom:32px}.identity small{display:block;font-size:10px;color:#71809a;margin-bottom:5px}.identity strong{display:block;font-size:12px;font-weight:500;overflow-wrap:anywhere}h2{font-size:16px;font-weight:500;margin:0}form{max-width:440px}label{display:block;font-size:12px;margin:20px 0 8px}input{width:100%;background:white;border:1px solid #e6ebf4;border-radius:8px;padding:11px 12px;font:inherit;color:inherit;font-size:13px}input:focus-visible,button:focus-visible{outline:2px solid #9ab5ff;outline-offset:2px}.error{color:#a53f4a;margin-top:16px}.success{color:#17846c;margin-top:16px}footer{margin-top:24px}.primary{border:0;border-radius:8px;padding:10px 16px;font:inherit;font-size:12px;background:#3466f6;color:white;cursor:pointer}button:disabled{opacity:.45;cursor:default}@media(max-width:700px){.profile{padding:26px 22px}.identity{grid-template-columns:1fr}h1{font-size:22px}}</style>

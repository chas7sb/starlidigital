<script lang="ts">
 import {onMount,createEventDispatcher} from 'svelte';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import ConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
 const dispatch=createEventDispatcher();
 let showDisconnect=false;
 let account:any=null,email='',displayName='',imapHost='',smtpHost='',smtpPort=465,username='',password='',smtpUsername='',smtpPassword='',advanced=false,loading=true,busy=false,error='',notice='';
 const headers=()=>({Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'});
 async function api(path='',options:any={}){const r=await fetch('/api/v1/starli/mail'+path,{...options,headers:headers()});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Mailbox request failed ('+r.status+')');return d;}
 async function load(){loading=true;error='';try{account=await api();if(account.connected){email=account.email;displayName=account.displayName;imapHost=account.imapHost;smtpHost=account.smtpHost;smtpPort=account.smtpPort;username=account.username;smtpUsername=account.smtpUsername??'';advanced=!!smtpUsername&&smtpUsername!==username;}}catch(e){error=(e as Error).message;}finally{loading=false;}}
 async function save(){busy=true;error='';notice='';try{account=await api('',{method:'PUT',body:JSON.stringify({email,displayName,imapHost,smtpHost,smtpPort:Number(smtpPort),username:username||email,password,...(advanced?{smtpUsername:smtpUsername||username||email,...(smtpPassword?{smtpPassword}:{})}:{}),...(account?.version?{expectedVersion:account.version}:{})})});password='';smtpPassword='';notice='Mailbox connection saved securely. Test it before syncing.';dispatch('change',account);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function test(){busy=true;error='';notice='';try{const result=await api('/test',{method:'POST'});account=result.account;notice='IMAP and SMTP authenticated over TLS. No email was sent.';dispatch('change',account);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function disconnect(){busy=true;error='';try{account=await api('',{method:'DELETE'});password='';smtpPassword='';notice='Mailbox disconnected.';dispatch('change',account);}catch(e){error=(e as Error).message;}finally{busy=false;}}
 function toggleAdvanced(e:Event){advanced=(e.currentTarget as HTMLDetailsElement).open;}
 onMount(()=>{void load();});
</script>
<ConfirmDialog bind:show={showDisconnect} title="Disconnect mailbox" message="Pending send reviews will be cancelled. Saved messages and drafts remain in your workspace." confirmLabel="Disconnect" onConfirm={disconnect}/>
<section class="mx-auto max-w-3xl p-1" aria-label="Mailbox connection settings">
 <header class="mb-5"><h2 class="text-lg font-semibold">Mailbox connection</h2><p class="mt-2 text-sm text-gray-500">Connect your own email account. Starli can synchronize messages, draft replies, and prepare reviewed sends through chat.</p></header>
 {#if loading}<Spinner/>{/if}
 {#if error}<p role="alert" class="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>{/if}
 {#if notice}<p role="status" class="mb-4 text-sm text-gray-500">{notice}</p>{/if}
 {#if account?.connected}<p class="mb-4 text-xs text-gray-500">{account.email} · {account.status==='VERIFIED'?'Connection verified':'Saved; connection test needed'}</p>{/if}
 <form class="space-y-4" on:submit|preventDefault={save}>
  <div class="grid gap-4 sm:grid-cols-2">
   <label class="block text-xs font-medium">Email address<input required type="email" bind:value={email} autocomplete="email" placeholder="you@yourbusiness.com" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label>
   <label class="block text-xs font-medium">Sender name<input bind:value={displayName} maxlength="100" autocomplete="name" placeholder="Your business" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label>
  </div>
  <div class="grid gap-4 sm:grid-cols-2">
   <label class="block text-xs font-medium">IMAP server<input required bind:value={imapHost} autocomplete="off" placeholder="imap.yourprovider.com" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/><span class="mt-1 block text-xs font-normal text-gray-500">Secure IMAP · port 993</span></label>
   <label class="block text-xs font-medium">SMTP server<input required bind:value={smtpHost} autocomplete="off" placeholder="smtp.yourprovider.com" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label>
  </div>
  <div class="grid gap-4 sm:grid-cols-2">
   <label class="block text-xs font-medium">Username<input bind:value={username} autocomplete="username" placeholder={email||'Usually your email address'} class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label>
   <label class="block text-xs font-medium">Password or app password<input type="password" bind:value={password} autocomplete="new-password" placeholder={account?.connected?'Leave blank to keep saved password':'Enter password securely'} class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/><span class="mt-1 block text-xs font-normal text-gray-500">Use an app password when your provider requires one. Credentials are encrypted and never shown in chat.</span></label>
  </div>
  <label class="block max-w-sm text-xs font-medium">SMTP security<select bind:value={smtpPort} class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"><option value={465}>TLS · port 465</option><option value={587}>STARTTLS · port 587</option></select></label>
  <details open={advanced} on:toggle={toggleAdvanced}><summary class="cursor-pointer text-xs text-gray-500">Different SMTP credentials</summary><div class="mt-3 grid gap-4 sm:grid-cols-2"><label class="block text-xs font-medium">SMTP username<input bind:value={smtpUsername} autocomplete="off" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label><label class="block text-xs font-medium">SMTP password<input type="password" bind:value={smtpPassword} autocomplete="new-password" placeholder="Leave blank to keep saved credentials" class="mt-1.5 w-full rounded-lg bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-850"/></label></div></details>
  <div class="flex flex-wrap gap-2"><button disabled={busy} class="rounded-lg bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900">{busy?'Working…':'Save connection'}</button><button type="button" disabled={busy||!account?.connected} class="rounded-lg bg-gray-100 px-4 py-2 text-sm disabled:opacity-40 dark:bg-gray-800" on:click={test}>Test connection</button>{#if account?.connected}<button type="button" disabled={busy} class="rounded-lg px-4 py-2 text-sm text-gray-500 disabled:opacity-40" on:click={()=>showDisconnect=true}>Disconnect</button>{/if}</div>
 </form>
 <p class="mt-5 text-xs text-gray-500">Use the server names supplied by your email provider. Public TLS mail servers are supported; local and private network hosts are blocked. Sending requires review of the exact message.</p>
</section>

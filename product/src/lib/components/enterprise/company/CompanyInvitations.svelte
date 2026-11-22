<script lang="ts">
 import {onDestroy,createEventDispatcher} from 'svelte';
 import {InvitationsClient,invitationAction,type Invitation} from './invitations-client';
 export let companyId='';
 export let token='';
 export let canManage=false;
 export let roles:{id:string;name:string}[]=[];
 export let joinToken='';
 export let accessSignal:AbortSignal;
 export let actorId='';
 const dispatch=createEventDispatcher();
 let client:InvitationsClient|null=null,clientSignal:AbortSignal|undefined,scope='',rows:Invitation[]=[],email='',role='member',busy=false,error='',notice='';
 let invitation:any=null,name='',password='';let signalCleanup=()=>{};
 $: key=companyId+'|'+token+'|'+canManage+'|'+actorId;
 $: if(key!==scope||clientSignal!==accessSignal){scope=key;clientSignal=accessSignal;signalCleanup();client?.close();client=companyId&&token?new InvitationsClient(companyId,()=>token):null;rows=[];error='';if(client){const scoped=client;const boundSignal=accessSignal;const abort=()=>scoped.close();accessSignal.addEventListener('abort',abort,{once:true});signalCleanup=()=>boundSignal.removeEventListener('abort',abort);if(accessSignal.aborted)client.close();else if(canManage)load();}}
 $: if(joinToken) inspect(joinToken);
 onDestroy(()=>{signalCleanup();client?.close();password='';});
 async function load(){const current=client;try{const data=await current?.list();if(current===client)rows=data??[];}catch(e){if(current===client)error=(e as Error).message;}}
 async function inspect(value:string){try{invitation=await invitationAction('inspect',value,'',{},accessSignal);}catch(e){error=(e as Error).message;}}
 async function invite(previous?:Invitation){if(!client)return;busy=true;error='';notice='';const current=client;try{await current.create(previous?.email??email,previous?.role??role,previous?.id);if(current!==client)return;email='';notice='Invitation accepted by the mail server. Delivery is not confirmed.';await load();dispatch('changed');}catch(e){if(current===client)error=(e as Error).message;}finally{busy=false;}}
 async function revoke(item:Invitation){if(!client)return;busy=true;error='';try{await client.revoke(item.id);await load();dispatch('changed');}catch(e){error=(e as Error).message;}finally{busy=false;}}
 async function join(){const started=scope;busy=true;error='';try{const data=await invitationAction(token?'accept':'register',joinToken,token,token?{}:{name,password},accessSignal);password='';if(started!==scope)return;notice=token?'You joined the company.':'Account created and company joined. Sign in to continue.';invitation=null;dispatch('joined',{companyId:data.companyId,signInRequired:!token});}catch(e){password='';error=(e as Error).message;}finally{busy=false;}}
</script>
<section class="invitations" aria-label={joinToken?'Accept company invitation':'Company invitations'}>
 <header><div><p class="eyebrow">COMPANY ACCESS</p><h2>{joinToken?'Join your team':'Invite your team'}</h2><p>{joinToken?'Your invitation is tied to your email address.':'Send a secure invitation with the right company role.'}</p></div>{#if !joinToken&&canManage}<button class="secondary" on:click={load} disabled={busy}>Refresh</button>{/if}</header>
 {#if error}<p class="error" role="alert">{error}</p>{/if}
 {#if notice}<p class="notice" role="status">{notice}</p>{/if}
 {#if joinToken}
  {#if invitation}<div class="join"><h3>{invitation.companyName}</h3><p>Invited as <strong>{invitation.email}</strong> · {invitation.role}</p><p>Expires {new Date(invitation.expires*1000).toLocaleString()}</p>
   <form on:submit|preventDefault={join}>{#if !token}<label>Your name<input required maxlength="100" bind:value={name} autocomplete="name" /></label><label>Create password<input required type="password" minlength="12" maxlength="72" bind:value={password} autocomplete="new-password" /></label><p class="hint">Already have an account? <a href="/auth">Sign in with {invitation.email}</a>, then return to this invitation.</p>{/if}<button disabled={busy}>{busy?'Joining…':token?'Accept invitation':'Create account and join'}</button></form></div>{/if}
 {:else if canManage}
  <form class="invite-form" on:submit|preventDefault={()=>invite()}><label>Email address<input required type="email" placeholder="colleague@company.com" bind:value={email} autocomplete="email" disabled={busy}/></label><label>Assigned role<select bind:value={role} disabled={busy}><option value="member">Member</option>{#each roles as item}<option value={item.id}>{item.name}</option>{/each}</select></label><button disabled={busy}>{busy?'Sending…':'Send invitation'}</button></form>
  <p class="hint">Links expire after 24 hours and can be used once. Resending replaces the previous link.</p>
  <div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Role</th><th>Status</th><th>Expires</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>{#each rows as item}<tr><td>{item.email}</td><td>{roles.find(r=>r.id===item.role)?.name??item.role}</td><td><span class:pending={item.state==='pending'} class="status">{item.state}</span></td><td>{new Date(item.expires*1000).toLocaleDateString()}</td><td class="actions">{#if ['pending','failed','expired'].includes(item.state)}<button class="text" on:click={()=>invite(item)} disabled={busy}>Resend</button><button class="text danger" on:click={()=>revoke(item)} disabled={busy}>Revoke</button>{/if}</td></tr>{:else}<tr><td colspan="5" class="empty">No invitations yet. Invite a teammate to get started.</td></tr>{/each}</tbody></table></div>
 {:else}<p class="empty">A company administrator can manage invitations.</p>{/if}
</section>
<style>
 .invitations{font-family:inherit;color:#17243f;background:#fff;border:1px solid #e6ebf4;border-radius:18px;padding:28px}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:26px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;color:#71809a;margin:0 0 8px}h2{font-size:23px;letter-spacing:-.04em;margin:0 0 8px}header p:not(.eyebrow),.hint{font-size:13px;color:#71809a;margin:0;line-height:1.6}form{display:flex;gap:14px;align-items:end}label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:600;flex:1}input,select{height:43px;border:1px solid #e6ebf4;border-radius:9px;padding:0 12px;font:inherit;font-weight:400;background:#fff;color:#17243f;min-width:0}input:focus,select:focus{outline:2px solid #3466f6;outline-offset:2px}button{border:0;border-radius:9px;background:#3466f6;color:#fff;padding:12px 17px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}button:disabled{opacity:.5;cursor:wait}.secondary{background:#f6f8fc;color:#17243f;border:1px solid #e6ebf4}.hint{margin:12px 0 22px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;text-align:left}th{font-weight:500;color:#71809a;background:#f6f8fc}td,th{padding:15px 12px;border-bottom:1px solid #e6ebf4}td:first-child{font-weight:600}.status{padding:5px 9px;border-radius:6px;color:#71809a;background:#f6f8fc;text-transform:capitalize}.pending{color:#3466f6;background:#eef3ff}.actions{text-align:right}.text{background:none;color:#3466f6;padding:5px 7px}.danger{color:#b74747}.empty{text-align:center;color:#71809a;padding:34px!important}.error,.notice{border-radius:9px;padding:12px;font-size:13px;background:#fff1f1;color:#a43131}.notice{background:#eef3ff;color:#3466f6}.join{max-width:520px}.join form{display:flex;flex-direction:column;align-items:stretch}.join p{font-size:13px;color:#71809a}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:650px){.invitations{padding:18px}.invite-form{flex-direction:column;align-items:stretch}header{align-items:start}h2{font-size:21px}}
</style>

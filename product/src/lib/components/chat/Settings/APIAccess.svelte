<script lang="ts">
 import {onMount,onDestroy} from 'svelte';
 import {API_BASE,SCOPES,ApiAccessClient,AccessError,creationInput,example,type Scope,type TokenMetadata,type OwnedBot} from './api-access';
 export let accountKey='';
 export let nativeBearer='';
 export let bots:OwnedBot[]=[];
 const client=new ApiAccessClient();
 let mounted=false,epoch=0,busy=false,available=false,error='',notice='';
 let rows:TokenMetadata[]=[],name='',mode:'all_owned'|'selected'='all_owned',selectedBots:string[]=[],scopes:Scope[]=[...SCOPES];
 const initialExpiration=new Date(Date.now()+30*86400000);
 let expiration=new Date(initialExpiration.getTime()-initialExpiration.getTimezoneOffset()*60000).toISOString().slice(0,16);
 let revealedToken='',exampleBot='',language:'curl'|'javascript'|'python'='curl';
 $: snippet=example(exampleBot,language);
 $: if(mounted&&client.setSession(accountKey,nativeBearer)){
  epoch++;rows=[];revealedToken='';name='';selectedBots=[];error='';notice='';available=false;busy=false;
  void refresh();
 }
 $: if(!bots.some(bot=>bot.id===exampleBot))exampleBot=bots[0]?.id??'';
 onMount(()=>{mounted=true;});
 onDestroy(()=>{mounted=false;epoch++;revealedToken='';client.clear();});
 const date=(value:number|null)=>value===null?'Never':new Date(value*1000).toLocaleString();
 async function refresh(){
  const captured=epoch;busy=true;error='';
  try{const value=await client.list();if(captured===epoch&&mounted){rows=value;available=true;}}
  catch(e){if(captured===epoch&&mounted){available=false;error=e instanceof AccessError?e.message:'Unable to load API Access.';}}
  finally{if(captured===epoch&&mounted)busy=false;}
 }
 async function create(){
  if(busy||!available||revealedToken)return;
  const captured=epoch;busy=true;error='';notice='';
  try{
   const expiresAt=Math.floor(new Date(expiration).getTime()/1000);
   const input=creationInput(name,expiresAt,scopes,mode==='all_owned'?{mode}:{mode,botIds:selectedBots},bots);
   const value=await client.create(input);
   if(captured===epoch&&mounted){revealedToken=value.token;rows=[...rows,value.metadata];name='';notice='Token created. Save it now; it cannot be retrieved again.';}
  }catch(e){if(captured===epoch&&mounted)error=e instanceof AccessError?e.message:'Creation outcome could not be confirmed. Refresh the list before retrying.';}
  finally{if(captured===epoch&&mounted)busy=false;}
 }
 async function revoke(id:string){
  if(busy)return;const captured=epoch;busy=true;error='';notice='';
  try{await client.revoke(id);if(captured===epoch&&mounted){revealedToken='';notice='Token revoked.';await refresh();}}
  catch(e){if(captured===epoch&&mounted)error=e instanceof AccessError?e.message:'Revocation could not be confirmed. Refresh the list.';}
  finally{if(captured===epoch&&mounted)busy=false;}
 }
 async function copy(value:string){
  const captured=epoch;
  try{await navigator.clipboard.writeText(value);if(captured===epoch&&mounted)notice='Copied.';}
  catch{if(captured===epoch&&mounted)error='Copy failed. Select and copy the text manually.';}
 }
</script>

<section class="api-access" aria-label="API Access">
 <h2>API Access</h2>
 <p>API messages continue the same visible Starli chat and use the selected bot’s configured provider. Initialize the bot’s conversation in Starli first.</p>
 <div class="base"><code>{API_BASE}</code><button type="button" on:click={()=>copy(API_BASE)}>Copy base URL</button></div>
 <p class="limitations">Uses the configured native hosted or account provider for personal bots, and the configured shared runtime for company bots. Unsupported providers fail explicitly. Shared bots need one existing visible room; ambiguous rooms are rejected. Background delegation, restart recovery and multi-hour execution are not advertised.</p>
 {#if error}<p role="alert" class="error">{error}</p>{/if}
 {#if notice}<p role="status">{notice}</p>{/if}
 <button type="button" disabled={busy} on:click={refresh}>{busy?'Loading…':'Refresh API Access'}</button>
 {#if available}
  {#if revealedToken}
   <div class="one-time">
    <h3>Save your token now</h3>
    <p>This token is shown once. Keep it in a server-side secret manager.</p>
    <label for="starli-api-new-token">New API token</label>
    <input id="starli-api-new-token" readonly value={revealedToken} autocomplete="off" spellcheck="false" />
    <button type="button" on:click={()=>copy(revealedToken)}>Copy token</button>
    <button type="button" on:click={()=>{revealedToken='';notice='One-time token dismissed.';}}>I saved it — dismiss</button>
   </div>
  {/if}
  <form on:submit|preventDefault={create}>
   <fieldset disabled={busy||Boolean(revealedToken)}>
    <legend>Create a customer API token</legend>
    <label for="starli-api-name">Token name</label>
    <input id="starli-api-name" bind:value={name} maxlength="100" required autocomplete="off" />
    <label for="starli-api-expires">Expiration (local time)</label>
    <input id="starli-api-expires" type="datetime-local" bind:value={expiration} required />
    <fieldset><legend>Bot access</legend>
     <label><input type="radio" bind:group={mode} value="all_owned" /> All owned personal bots, including future owned bots</label>
     <label><input type="radio" bind:group={mode} value="selected" /> Selected personal or shared bots</label>
     {#if mode==='selected'}
      {#if !bots.length}<p>No owned bots are available. Initialize a bot in Starli first.</p>{/if}
      {#each bots as bot (bot.id)}<label><input type="checkbox" bind:group={selectedBots} value={bot.id} /> {bot.name}</label>{/each}
     {/if}
    </fieldset>
    <fieldset><legend>Scopes</legend>
     {#each SCOPES as scope}<label><input type="checkbox" bind:group={scopes} value={scope} /> {scope}</label>{/each}
    </fieldset>
    <button type="submit">Create token</button>
   </fieldset>
  </form>
  <h3>Your API tokens</h3>
  {#if !rows.length}<p>No API tokens.</p>{/if}
  {#each rows as row (row.id)}
   <article>
    <h4>{row.name}</h4>
    <p>{row.botAccess.mode==='all_owned'?'All owned personal bots':`${row.botAccess.botIds.length} selected bots`} · {row.scopes.join(', ')}</p>
    <dl><dt>Created</dt><dd>{date(row.createdAt)}</dd><dt>Expires</dt><dd>{date(row.expiresAt)}</dd><dt>Last used</dt><dd>{date(row.lastUsedAt)}</dd></dl>
    {#if row.revokedAt!==null}<p>Revoked {date(row.revokedAt)}</p>{:else if row.expiresAt*1000<=Date.now()}<p>Expired</p>{:else}<button type="button" disabled={busy} on:click={()=>revoke(row.id)}>Revoke {row.name}</button>{/if}
   </article>
  {/each}
 {/if}
 <h3>Examples</h3>
 <label for="starli-api-example-bot">Owned bot (including BOSS when listed)</label>
 <select id="starli-api-example-bot" bind:value={exampleBot}>{#each bots as bot (bot.id)}<option value={bot.id}>{bot.name} — starli/{bot.id}</option>{/each}</select>
 <label for="starli-api-example-language">Example language</label>
 <select id="starli-api-example-language" bind:value={language}><option value="curl">curl</option><option value="javascript">JavaScript</option><option value="python">Python</option></select>
 <pre><code>{snippet}</code></pre><button type="button" disabled={!exampleBot} on:click={()=>copy(snippet)}>Copy example</button>
 <p>Send exactly one new user text up to 32 KiB. Do not resend history, system instructions, assistant messages or tool results. Unlisted OpenAI fields are rejected. Keep and reuse the same Idempotency-Key for a retry.</p>
 <p>For work that outlasts the HTTP response, submit to <code>/bots/&#123;botId&#125;/messages</code>, then read <code>/runs/&#123;runId&#125;</code> or <code>/runs/&#123;runId&#125;/result</code>. Reconnect to <code>/runs/&#123;runId&#125;/events?after=&#123;cursor&#125;</code>. Disconnecting an observer does not cancel the current native work.</p>
</section>

<style>
 .api-access{display:grid;gap:.85rem;max-width:56rem}.api-access h2,.api-access h3,.api-access h4,.api-access p{margin:0}fieldset{display:grid;gap:.65rem;border:1px solid #8885;padding:1rem;border-radius:.65rem}label{display:flex;gap:.5rem;align-items:center}input:not([type=checkbox]):not([type=radio]),select{width:100%;padding:.55rem;border:1px solid #8888;border-radius:.4rem;background:transparent}button{border:1px solid #8888;border-radius:.4rem;padding:.45rem .7rem;width:fit-content}button:disabled{opacity:.5}.base{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}.limitations,.one-time{padding:1rem;border:1px solid #b48639;border-radius:.65rem}.one-time{display:grid;gap:.65rem}.error{color:#ba3232}article{padding:.85rem;border:1px solid #8885;border-radius:.65rem}dl{display:grid;grid-template-columns:auto 1fr;gap:.15rem .7rem}dd{margin:0}pre{overflow:auto;max-width:100%;padding:.8rem;border:1px solid #8885;border-radius:.5rem;white-space:pre;font-size:.8rem}code{overflow-wrap:anywhere}legend{padding:0 .25rem}
</style>

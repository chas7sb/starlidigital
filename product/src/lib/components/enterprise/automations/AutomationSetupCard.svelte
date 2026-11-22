<script lang="ts">
 import {createEventDispatcher} from 'svelte';
 import AutomationConnectionCard from './AutomationConnectionCard.svelte';
 import {setupFields,authorizationUrl,type Draft,type Configuration,type Requirement,type Authorization,type Connector,type ProviderSetup,type ConnectionOptions} from './automations-client';
 import './automations.css';
 export let setupProviders:ProviderSetup[]=[];export let people:{id:string;name:string}[]=[];export let draft:Draft;export let connectors:Connector[]=[];export let busy=false;export let authorization:Authorization|null=null;
 const dispatch=createEventDispatcher<{answer:Configuration;connect:({providerId:string}&ConnectionOptions);refresh:void}>();
 let answer='',seen='';
 $: requirement=draft.missing[0] as Requirement|undefined;
 $: key=draft.id+':'+draft.revision+':'+(requirement?.id||'');
 $: if(key!==seen){seen=key;answer='';}
 $: options=requirement?.options?.length?requirement.options:requirement?.id==='approverId'?people.map(p=>({value:p.id,label:p.name})):[];
 $: provider=connectors.find(c=>c.id===requirement?.providerId);
 function submit(){if(!requirement||requirement.kind!=='question'||!setupFields.includes(requirement.id as any)||!answer.trim())return;dispatch('answer',{[requirement.id]:requirement.id==='notifySlack'?answer==='true':answer.trim()} as Configuration);}
</script>
<section class="starli-automations setup-card" aria-label="Automation setup">
 <div class="sa-heading"><div><span class="sa-eyebrow">STARLI AUTOMATIONS</span><h3>{draft.name}</h3></div><span class="sa-badge">{draft.status.replaceAll('_',' ').toLowerCase()}</span></div>
 <p class="sa-muted">Saved in this conversation · revision {draft.revision}</p>
 {#if requirement?.kind==='question'}<form on:submit|preventDefault={submit}><h4>{requirement.question}</h4>{#if options.length}<div class="sa-options">{#each options as option}<label class="sa-choice"><input type="radio" bind:group={answer} value={option.value} disabled={busy||!draft.actions.canManage}/><span>{option.label}</span></label>{/each}</div>{:else}<label class="sa-label">{requirement.id==='approverId'?'Starli member ID':requirement.id==='slackChannelId'?'Slack channel ID':'Your answer'}<input class="sa-input" bind:value={answer} autocomplete="off" maxlength="300" disabled={busy||!draft.actions.canManage} required/></label>{/if}<button class="sa-primary" disabled={busy||!draft.actions.canManage||!answer.trim()}>{busy?'Saving…':'Continue'}</button></form>
 {:else if requirement?.kind==='connection'}{#if ['slack','shopify'].includes(requirement.providerId||'')}<AutomationConnectionCard providerId={requirement.providerId||''} providerName={provider?.displayName||requirement.providerId||'Integration'} requestedScopes={requirement.requestedScopes||[]} setup={setupProviders.find(s=>s.providerId===requirement?.providerId)||null} canManage={draft.actions.canManage} {busy} {authorization} on:connect={e=>dispatch('connect',e.detail)} on:refresh={()=>dispatch('refresh')}/>{:else}<div class="sa-connect"><div class="sa-service-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none"><path d="m9 15 6-6m-9 4-2 2a4.24 4.24 0 0 0 6 6l3-3m-2-12 2-2a4.24 4.24 0 0 1 6 6l-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div><div><h4>Connect {provider?.displayName||requirement.providerId}</h4><p class="sa-muted">Authorize the account for this company. Your saved setup will resume in this conversation.</p></div></div>{#if requirement.requestedScopes?.length}<div class="sa-permissions"><strong>Requested permissions</strong>{#each requirement.requestedScopes as scope}<span>{scope}</span>{/each}</div>{/if}
 {#if authorization?.status==='AUTHORIZATION_REQUIRED'&&authorizationUrl(authorization.authorizationUrl)}<a class="sa-primary sa-link" href={authorizationUrl(authorization.authorizationUrl)||undefined} target="_blank" rel="noopener noreferrer">Continue secure sign-in ↗</a><button on:click={()=>dispatch('refresh')} disabled={busy}>I’ve finished connecting</button><p class="sa-muted">Sign in with the provider. Return here when authorization is complete.</p>{:else}<button class="sa-primary" disabled={busy||!draft.actions.canManage} on:click={()=>requirement?.providerId&&dispatch('connect',{providerId:requirement.providerId})}>{busy?'Checking…':'Connect '+(provider?.displayName||requirement.providerId)}</button>{/if}
 {#if authorization?.status==='SETUP_UNAVAILABLE'}<p role="status" class="sa-warning">Secure connection setup is not available for this integration yet. Your draft is saved.</p>{/if}
 {/if}{:else}<div class="sa-ready"><strong>Setup complete</strong><p class="sa-muted">Review the workflow and run its non-destructive test before activation.</p></div>{/if}
</section>

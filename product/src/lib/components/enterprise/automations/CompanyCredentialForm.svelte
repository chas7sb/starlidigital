<script lang="ts">
 import {createEventDispatcher,onDestroy} from 'svelte';import type {CredentialSchema} from './company-connections-client';
 export let schema:CredentialSchema;export let busy=false;export let resetKey='';
 const dispatch=createEventDispatcher<{submit:{displayName:string;data:Record<string,unknown>}}>();let values:Record<string,unknown>={},displayName='',error='',bound='';
 $: if(bound!==schema.schemaHash+'\0'+resetKey){values={};displayName='';error='';bound=schema.schemaHash+'\0'+resetKey;for(const field of schema.fields)if(!field.secret&&field.default!==undefined)values[field.name]=field.default;}
 $: supported=schema.status==='FORM_AVAILABLE'&&schema.unsupported.length===0&&schema.fields.every(f=>['string','number','integer','boolean','select'].includes(f.kind)&&(!f.secret||f.kind==='string'));
 function visible(field:CredentialSchema['fields'][number]){return Object.entries(field.displayOptions?.show||{}).every(([name,options])=>options.some(value=>value===values[name]));}
 function submit(){if(busy||!supported)return;error='';if(!displayName.trim()){error='Enter a name for this company connection.';return;}const data:Record<string,unknown>={};for(const f of schema.fields){if(!visible(f))continue;let value=values[f.name];if(value===undefined||value===''){if(f.required){error='Complete '+f.label+'.';return;}continue;}if(f.kind==='number'||f.kind==='integer'){value=Number(value);if(!Number.isFinite(value)||f.kind==='integer'&&!Number.isInteger(value)){error='Check '+f.label+'.';return;}}if(f.kind==='select'&&!f.options?.some(o=>o.value===value)){error='Choose '+f.label+'.';return;}data[f.name]=value;}dispatch('submit',{displayName:displayName.trim(),data});values={};}
 onDestroy(()=>{values={};displayName='';});
</script>
{#if schema.status==='NEEDS_PLATFORM_APP'}<p class="sa-muted">This connection uses OAuth. Starli’s platform app must be configured before secure account consent is available. Do not paste a password or token into chat.</p>
{:else if !supported}<p class="sa-muted">The installed credential schema needs a supported setup flow before this connection can be saved.</p>
{:else}<form on:submit|preventDefault={submit} autocomplete="off"><label>Company connection name<input bind:value={displayName} maxlength="160" disabled={busy} required autocomplete="off"/></label>
{#each schema.fields as field}{#if visible(field)}<label>{field.label}{field.required?' *':''}
{#if field.kind==='boolean'}<input type="checkbox" checked={values[field.name]===true} on:change={e=>values[field.name]=e.currentTarget.checked} disabled={busy}/>
{:else if field.kind==='select'}<select aria-label={field.label} value={String(field.options?.findIndex(o=>o.value===values[field.name])??-1)} on:change={e=>values[field.name]=field.options?.[Number(e.currentTarget.value)]?.value} required={field.required} disabled={busy}><option value="-1">Choose…</option>{#each field.options||[] as option,index}<option value={String(index)}>{option.label}</option>{/each}</select>
{:else if field.kind==='number'||field.kind==='integer'}<input type="number" value={String(values[field.name]??'')} on:input={e=>values[field.name]=e.currentTarget.value} step={field.kind==='integer'?'1':'any'} required={field.required} disabled={busy} autocomplete="off"/>
{:else}<input type={field.secret?'password':'text'} value={String(values[field.name]??'')} on:input={e=>values[field.name]=e.currentTarget.value} required={field.required} disabled={busy} autocomplete={field.secret?'new-password':'off'} spellcheck="false"/>{/if}
{#if field.secret}<small>Sent directly to the protected company credential service. Never added to chat.</small>{/if}</label>{/if}{/each}
{#if error}<p class="sa-error" role="alert">{error}</p>{/if}<p class="sa-muted">Saving stores this connection for the company. It does not verify the account or enable connector execution.</p><button class="sa-primary" type="submit" disabled={busy}>Save company connection</button></form>{/if}
<style>form{display:grid;gap:14px;margin-top:16px}label{display:grid;gap:6px;font-size:14px}input:not([type=checkbox]),select{width:100%;min-width:0;border:1px solid #e6ebf4;border-radius:8px;background:white;padding:10px;color:#17243f}input[type=checkbox]{width:18px;height:18px}small{color:#71809a;font-size:12px}button{justify-self:start}</style>



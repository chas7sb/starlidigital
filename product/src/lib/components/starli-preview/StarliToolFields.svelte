<script lang="ts">
 import Switch from '$lib/components/common/Switch.svelte';
 import {fieldSchema,fieldLabel} from '$lib/utils/starli-tool-form';
 export let schema:any={};
 export let values:Record<string,any>={};
 export let prefix='tool';
 export let disabled=false;
 $: if(!values||typeof values!=='object'||Array.isArray(values))values={};
 function set(name:string,value:any){values={...values,[name]:value};}
 function complex(event:Event,name:string,required:boolean){
  const input=event.currentTarget as HTMLTextAreaElement;
  if(!input.value.trim()&&!required){const next={...values};delete next[name];values=next;input.setCustomValidity('');return;}
  try{set(name,JSON.parse(input.value));input.setCustomValidity('');}catch{input.setCustomValidity('Enter valid JSON for this structured field.');}
 }
 function lines(event:Event,name:string,type:string){
  const input=event.currentTarget as HTMLTextAreaElement;
  const list=input.value.split(/\n/).map(s=>s.trim()).filter(Boolean);
  set(name,type==='string'?list:list.map(Number));
 }
</script>
<div class="space-y-4">
 {#each Object.entries(schema.properties??{}) as [name,raw] (name)}
  {@const field=fieldSchema(raw)}
  {@const required=(schema.required??[]).includes(name)}
  {@const id=prefix+'-'+name}
  <div class="space-y-1.5">
   {#if field.type==='boolean'}
    <div class="flex items-center justify-between gap-3"><label class="text-sm font-medium" for={id}>{field.title??fieldLabel(name)}{#if required}<span class="ml-1 text-gray-400">*</span>{/if}</label><div class={disabled?'pointer-events-none opacity-50':''}><Switch label={field.title??fieldLabel(name)} state={values[name]??false} on:change={(e)=>set(name,e.detail)}/></div></div>
   {:else}
    <label class="block text-sm font-medium" for={id}>{field.title??fieldLabel(name)}{#if required}<span class="ml-1 text-gray-400">*</span>{/if}</label>
    {#if field.enum}
     <select {id} {disabled} {required} bind:value={values[name]} class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850"><option value={undefined}>Choose {fieldLabel(name).toLowerCase()}</option>{#each field.enum as option}<option value={option}>{typeof option==='string'?fieldLabel(option):String(option)}</option>{/each}</select>
    {:else if ['number','integer'].includes(field.type)}
     <input {id} {disabled} {required} type="number" min={field.minimum} max={field.maximum} step={field.type==='integer'?1:'any'} bind:value={values[name]} placeholder={field.default!==undefined?String(field.default):''} class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850"/>
    {:else if field.type==='object'&&field.properties}
     <details open={required||Object.keys(values[name]??{}).length>0} class="rounded-lg border border-gray-100 p-3 dark:border-gray-800"><summary class="cursor-pointer text-xs text-gray-500">Configure {fieldLabel(name).toLowerCase()}</summary><div class="pt-3"><svelte:self schema={field} bind:values={values[name]} prefix={id} {disabled}/></div></details>
    {:else if field.type==='array'&&['string','number','integer'].includes(field.items?.type)}
     <textarea {id} {disabled} {required} rows="3" placeholder="One item per line" class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850" on:input={(e)=>lines(e,name,field.items.type)}>{(values[name]??[]).join('\n')}</textarea>
    {:else if field.type==='object'||field.type==='array'||field.anyOf||field.oneOf}
     <details open={required} class="rounded-lg border border-gray-100 p-3 dark:border-gray-800"><summary class="cursor-pointer text-xs text-gray-500">Structured data</summary><p class="my-2 text-xs text-gray-500">This field has a nested format. Use its parameter schema below as a reference.</p><textarea {id} {disabled} {required} rows="6" spellcheck="false" class="w-full rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs outline-hidden dark:bg-gray-850" on:input={(e)=>complex(e,name,required)}>{values[name]!==undefined?JSON.stringify(values[name],null,2):''}</textarea></details>
    {:else if /content|body|brief|prompt|instructions|description|message|summary|purpose|knowledge/i.test(name)||Number(field.maxLength)>500}
     <textarea {id} {disabled} {required} rows="3" minlength={field.minLength} maxlength={field.maxLength} bind:value={values[name]} placeholder={field.examples?.[0]??''} class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850"/>
    {:else}
     <input {id} {disabled} {required} type={field.format==='email'?'email':field.format==='uri'?'url':'text'} minlength={field.minLength} maxlength={field.maxLength} value={values[name]??''} on:input={(e)=>set(name,e.currentTarget.value)} placeholder={field.examples?.[0]??''} class="w-full rounded-lg bg-gray-50 px-3 py-2 text-sm outline-hidden dark:bg-gray-850"/>
    {/if}
   {/if}
   {#if field.description}<p class="text-xs leading-relaxed text-gray-500">{field.description}</p>{/if}
  </div>
 {/each}
</div>

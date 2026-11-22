<script lang="ts">
 import {marked} from 'marked';import {createEventDispatcher} from 'svelte';import ChatArtifact from './ChatArtifact.svelte';
 export let content='';export let allowOpen=false;export let hiddenImageUrls:string[]=[];const dispatch=createEventDispatcher();
 function hiddenImage(raw:string){return hiddenImageUrls.some(url=>raw.trim()==='![Generated image]('+url+')');}
 $: tokens=marked.lexer(content||'',{gfm:true});
</script>
<div class="message-content">{#each tokens as token,i}{#if token.type==='code'}<ChatArtifact code={token.text} language={token.lang||''} index={i+1} {allowOpen} on:open={event=>dispatch('artifact',{...event.detail,blockIndex:i})}/>{:else if !hiddenImage(token.raw)}<span class="prose">{token.raw}</span>{/if}{/each}</div>
<style>.message-content{min-width:0;max-width:100%}.prose{white-space:pre-wrap;overflow-wrap:anywhere}</style>

<script lang="ts">
 import {onMount,createEventDispatcher} from 'svelte';
 import AvatarBuilder from './AvatarBuilder.svelte';
 import {presets,type AvatarConfig} from './avatar-model';
 const dispatch=createEventDispatcher<{close:void}>();
 let dialog:HTMLDialogElement;
 let custom:AvatarConfig={...presets.pixel};
 onMount(()=>{dialog?.showModal();return()=>{if(dialog?.open)dialog.close();};});
 function close(){dialog?.close();}
</script>
<dialog bind:this={dialog} on:close={()=>dispatch('close')} on:cancel={()=>dispatch('close')} aria-labelledby="public-avatar-title" class="avatar-dialog">
 <header><div><p class="eyebrow">MAKE IT YOURS</p><h2 id="public-avatar-title">Create your custom bot</h2><p>Mix SVG faces, colors and gradient styles to design a unique AI teammate.</p></div><button type="button" class="close" aria-label="Close avatar builder" on:click={close}>✕</button></header>
 <div class="content"><AvatarBuilder compact={true} config={custom} on:change={(event)=>custom=event.detail.config} on:preset={(event)=>custom={...event.detail.config}}/></div>
 <footer><p>Preview only. Open your company workspace to save the look to an existing bot or create a new teammate.</p><a href="/app">Open workspace <span aria-hidden="true">↗</span></a></footer>
</dialog>
<style>
 .avatar-dialog{width:min(760px,calc(100vw - 24px));max-height:min(90dvh,960px);min-height:0;border:1px solid #dce6f4;box-shadow:0 20px 100px #1728524d;border-radius:18px;background:#fff;color:#17243f;padding:0;overflow:auto;margin:auto;font-family:Inter,Arial,sans-serif}
 .avatar-dialog::backdrop{background:#14264c85;backdrop-filter:blur(5px)}
 header{position:sticky;top:0;z-index:1;background:#fff;display:flex;align-items:flex-start;gap:12px;justify-content:space-between;padding:22px 26px 19px;border-bottom:1px solid #e8eef8}
 header h2{font-size:24px;line-height:1.25;letter-spacing:-.04em;margin:4px 0 7px;font-weight:720}
 header p{font-size:12px;color:#7586a2;margin:0;line-height:1.6}.eyebrow{color:#446dff;font-size:10px;letter-spacing:.1em;font-weight:800}
 .close{height:34px;width:34px;display:grid;place-items:center;border:1px solid #e2e9f5;border-radius:9px;background:#f7f9ff;color:#41516a;cursor:pointer}
 .content{padding:24px 26px}
 footer{display:flex;align-items:center;justify-content:space-between;gap:18px;border-top:1px solid #e8eef8;padding:19px 26px}
 footer p{font-size:11px;line-height:1.6;color:#7485a1;margin:0}
 footer a{display:inline-flex;gap:10px;white-space:nowrap;align-items:center;background:#3967ff;color:#fff;text-decoration:none;font-size:12px;font-weight:740;border-radius:8px;padding:12px 15px}
 button:focus-visible,a:focus-visible{outline:2px solid #3967ff;outline-offset:2px}
 @media(max-width:600px){header,.content,footer{padding:18px}.avatar-dialog{max-height:95dvh}footer{display:block}footer a{margin-top:12px}}
</style>

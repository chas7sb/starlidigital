<script lang="ts">
 import {createEventDispatcher} from 'svelte';
 import AvatarRenderer from './AvatarRenderer.svelte';
 import {shells,faces,eyes,mouths,accessories,gradients,backgrounds,palettes,presets,presetNames,normalizeAvatar,randomAvatar,encodeAvatar,type AvatarConfig} from './avatar-model';
 export let config:AvatarConfig=presets.atlas;
 export let disabled=false;
 export let compact=false;
 export let showPresets=true;
 const dispatch=createEventDispatcher<{change:{config:AvatarConfig};preset:{key:string;config:AvatarConfig};save:{config:AvatarConfig}}>();
 $: current=normalizeAvatar(config);
 function update(field:keyof AvatarConfig,value:string){if(disabled)return;dispatch('change',{config:normalizeAvatar({...current,[field]:value})});}
 function choose(value:AvatarConfig){if(disabled)return;dispatch('change',{config:normalizeAvatar(value)});}
 function choosePreset(key:string){if(disabled)return;dispatch('preset',{key,config:presets[key as keyof typeof presets]});}
 function randomize(){if(disabled)return;choose(randomAvatar());}
 function start(i:number):AvatarConfig{
  const palette=palettes[i%palettes.length];
  return normalizeAvatar({shell:shells[i%shells.length],face:faces[(i*3)%faces.length],eyes:eyes[(i*5+1)%eyes.length],mouth:mouths[(i*7+2)%mouths.length],accessory:accessories[(i*5+2)%accessories.length],gradient:gradients[i%gradients.length],background:backgrounds[i%backgrounds.length],colorA:palette.a,colorB:palette.b});
 }
 const starterVariants=Array.from({length:24},(_,i)=>start(i));
</script>
<section class:compact class="avatar-builder" aria-label="Modular bot avatar builder">
 <div class="preview">
  <div class="preview-main">
   <AvatarRenderer size={compact?102:128} config={current}/>
   <div class="preview-copy">
    <strong>Your custom bot</strong><small>Live SVG preview · {current.gradient} gradient</small>
    <div class="preview-actions"><button type="button" disabled={disabled} on:click={randomize}>✧ Randomize</button><button type="button" disabled={disabled} on:click={()=>choose(presets.atlas)}>Reset</button></div>
   </div>
  </div>
  <div class="preview-card"><AvatarRenderer size={42} config={current}/><span><strong>In your team</strong><small>Avatar preview</small></span></div>
 </div>
 {#if showPresets}
  <div class="group">
   <p class="group-title">Classic bot presets</p>
   <div class="preset-grid">
    {#each presetNames as key}
      <button type="button" class:chosen={encodeAvatar(current)===encodeAvatar(presets[key])} disabled={disabled} aria-label={'Choose '+key+' preset'} on:click={()=>choosePreset(key)}><AvatarRenderer size={38} config={presets[key]}/><span>{key}</span></button>
    {/each}
   </div>
  </div>
 {/if}
 <div class="group">
  <p class="group-title">Choose your face and shape</p>
  <div class="options">
   <label>Head shape<select disabled={disabled} value={current.shell} on:change={(event)=>update('shell',event.currentTarget.value)}>{#each shells as option}<option value={option}>{option.replaceAll('-',' ')}</option>{/each}</select></label>
   <label>Face<select disabled={disabled} value={current.face} on:change={(event)=>update('face',event.currentTarget.value)}>{#each faces as option}<option value={option}>{option}</option>{/each}</select></label>
   <label>Eyes<select disabled={disabled} value={current.eyes} on:change={(event)=>update('eyes',event.currentTarget.value)}>{#each eyes as option}<option value={option}>{option}</option>{/each}</select></label>
   <label>Mouth<select disabled={disabled} value={current.mouth} on:change={(event)=>update('mouth',event.currentTarget.value)}>{#each mouths as option}<option value={option}>{option}</option>{/each}</select></label>
   <label>Accessory<select disabled={disabled} value={current.accessory} on:change={(event)=>update('accessory',event.currentTarget.value)}>{#each accessories as option}<option value={option}>{option}</option>{/each}</select></label>
   <label>Gradient<select disabled={disabled} value={current.gradient} on:change={(event)=>update('gradient',event.currentTarget.value)}>{#each gradients as option}<option value={option}>{option}</option>{/each}</select></label>
   <label>Background<select disabled={disabled} value={current.background} on:change={(event)=>update('background',event.currentTarget.value)}>{#each backgrounds as option}<option value={option}>{option}</option>{/each}</select></label>
  </div>
 </div>
 <div class="group">
  <p class="group-title">Pick a color or create a gradient</p>
  <div class="palette-grid">
   {#each palettes as palette}
    <button type="button" class:chosen={current.colorA===palette.a&&current.colorB===palette.b} aria-label={'Choose '+palette.name+' gradient'} title={palette.name} style={'--color-a:'+palette.a+';--color-b:'+palette.b} disabled={disabled} on:click={()=>choose({...current,colorA:palette.a,colorB:palette.b})}></button>
   {/each}
  </div>
  <div class="color-inputs">
   <label>Color 1 <input aria-label="Primary avatar color" type="color" value={current.colorA} disabled={disabled} on:input={(event)=>update('colorA',event.currentTarget.value)}/><code>{current.colorA}</code></label>
   <label>Color 2 <input aria-label="Secondary avatar color" type="color" value={current.colorB} disabled={disabled} on:input={(event)=>update('colorB',event.currentTarget.value)}/><code>{current.colorB}</code></label>
  </div>
 </div>
 <div class="group">
  <p class="group-title">Explore 24 original combinations</p>
  <div class="starter-grid">
   {#each starterVariants as starter,i}
    <button type="button" aria-label={'Use starter avatar '+(i+1)} aria-pressed={encodeAvatar(current)===encodeAvatar(starter)} class:chosen={encodeAvatar(current)===encodeAvatar(starter)} disabled={disabled} on:click={()=>choose(starter)}><AvatarRenderer size={39} config={starter}/></button>
   {/each}
  </div>
 </div>
</section>
<style>
 .avatar-builder{--line:#e2e9f5;display:flex;flex-direction:column;gap:19px;color:#17243f;font-family:inherit}
 .preview{display:flex;align-items:center;gap:14px;padding:20px;border:1px solid var(--line);background:linear-gradient(135deg,#f5f8ff,#f0eaff);border-radius:15px}
 .preview-main{display:flex;align-items:center;gap:15px;min-width:0;flex:1}.preview-copy{min-width:0;display:flex;flex-direction:column;gap:6px}.preview-copy strong{font-size:16px;line-height:1.3}.preview-copy small{font-size:11px;color:#71809a}
 .preview-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px}.preview-actions button{padding:8px 10px;border:1px solid #d8e2f3;background:#fff;border-radius:7px;color:#385ec9;font-size:11px;cursor:pointer}
 .preview-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:7px;min-width:135px}.preview-card span{display:grid;gap:4px}.preview-card strong{font-size:10px}.preview-card small{font-size:9px;color:#71809a}
 .group-title{font-size:12px;font-weight:700;color:#2b3852;margin:0 0 11px}
 .preset-grid{display:flex;flex-wrap:wrap;gap:7px}.preset-grid button{display:flex;flex-direction:column;align-items:center;min-width:59px;padding:8px 7px;gap:5px;border:1px solid var(--line);border-radius:10px;background:#fff;color:#52647e;font-size:10px;text-transform:capitalize;cursor:pointer}
 .options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
 .options label{font-size:11px;color:#50617e;display:grid;gap:5px;margin:0}.options select{min-width:0;width:100%;height:38px;border:1px solid #dfe7f2;border-radius:9px;padding:0 10px;color:#192740;text-transform:capitalize;background:#fff;font:inherit;font-size:12px}
 .palette-grid{display:flex;flex-wrap:wrap;gap:8px}.palette-grid button{height:30px;width:39px;border:2px solid #fff;border-radius:10px;background:linear-gradient(135deg,var(--color-a),var(--color-b));box-shadow:0 0 0 1px #dbe4f2;cursor:pointer}
 .color-inputs{display:flex;flex-wrap:wrap;gap:15px;margin-top:12px}.color-inputs label{display:flex;align-items:center;gap:7px;font-size:11px;color:#607089;margin:0}.color-inputs input{width:35px;height:29px;padding:2px;border:1px solid #dae3f0;border-radius:7px;cursor:pointer}.color-inputs code{font-size:11px;color:#465777}
 .starter-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:6px}.starter-grid button{border:1px solid var(--line);background:#fff;min-width:0;border-radius:9px;padding:5px 0;display:flex;align-items:center;justify-content:center;cursor:pointer}
 .avatar-builder button.chosen{border-color:#3d6fff!important;box-shadow:0 0 0 1px #3d6fff,0 2px 7px #3d6fff1a}.avatar-builder button:hover:not(:disabled){border-color:#9fbaff}.avatar-builder button:focus-visible,.avatar-builder select:focus-visible,.avatar-builder input:focus-visible{outline:2px solid #3d6fff;outline-offset:2px}.avatar-builder button:disabled{opacity:.58;cursor:default}
 .compact .preview{padding:13px}.compact .preview-card{display:none}.compact .starter-grid{grid-template-columns:repeat(8,minmax(0,1fr))}.compact .options{grid-template-columns:repeat(2,minmax(0,1fr))}
 @media(max-width:650px){.preview{padding:13px}.preview-card{display:none}.options{grid-template-columns:repeat(2,minmax(0,1fr))}.starter-grid{grid-template-columns:repeat(6,minmax(0,1fr))}}
</style>

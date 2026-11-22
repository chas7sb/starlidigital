<script lang="ts">
 import Icon from './Icon.svelte';
 import Portrait from './Portrait.svelte';
 import {nativePath} from './identity';
 export let guest=false;
 export let overview:any=null;
 export let projects:any=null;
 export let agents:any[]=[];
 export let registryState='loading';
 const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value.toLocaleString():null;
 $: projectCount=count(projects?.total);
 $: agentCount=registryState==='ready'?count(agents.length):null;
 $: creditBalance=overview?.credits?.available?count(overview.credits.balance):null;
</script>
<div class="sd-dashboard">
 <header class="home-heading"><h1>Home</h1><span>{guest?'Guest workspace':'Personal workspace'}</span></header>
 <section class="home-editorial" aria-label="Welcome to Starli">
  <div><p class="home-eyebrow">STARLI AI</p><h2>Work with your Starli agents</h2><p>Open a conversation or return to a project in your workspace.</p><a class="home-cta" href="/">Open chat <Icon name="arrow" size={15}/></a></div>
 </section>
 {#if !guest&&(projectCount!==null||agentCount!==null||creditBalance!==null)}
 <section class="home-stats" aria-label="Your workspace overview">
  {#if projectCount!==null}<a href="/starli/projects"><span>Projects <Icon name="arrow" size={13}/></span><strong>{projectCount}</strong><small>{projects.total===0?'No saved projects yet.':'Saved projects in your workspace'}</small></a>{/if}
  {#if agentCount!==null}<button on:click={()=>window.dispatchEvent(new CustomEvent('starli-shell-action',{detail:'agents'}))}><span>AI agents <Icon name="arrow" size={13}/></span><strong>{agentCount}</strong><small>{agents.length===0?'No agents to show yet.':'Your personal agent directory'}</small></button>{/if}
  {#if creditBalance!==null}<a href="/starli/billing"><span>Credit balance <Icon name="arrow" size={13}/></span><strong>{creditBalance}</strong><small>{overview?.credits?.unit||'credits'}</small></a>{/if}
 </section>
 {/if}
 <div class="home-columns">
  <section class="home-section"><div class="home-section-heading"><h2>{guest?'Start with a conversation':'Your agents'}</h2>{#if !guest&&agents.length}<button on:click={()=>window.dispatchEvent(new CustomEvent('starli-shell-action',{detail:'agents'}))}>View all <Icon name="arrow" size={14}/></button>{/if}</div>
   {#if guest}<div class="home-empty"><p>Ask a question or describe what you want to do. Sign in to access your own agents and workspaces.</p><a href="/auth" class="home-cta">Sign in <Icon name="arrow" size={14}/></a></div>
   {:else if registryState==='ready'&&agents.length}<div class="home-agent-grid">{#each agents.slice(0,4) as agent(agent.id)}<a href={nativePath(agent)}><Portrait {agent} size={36}/><span><strong>{agent.name}</strong><small>{agent.role||'Open conversation'}</small></span><Icon name="arrow" size={14}/></a>{/each}</div>
   {:else}<p class="home-empty">{registryState==='loading'?'Loading your agents…':registryState==='error'?'Your agent directory could not be loaded.':'No agents to show yet.'}</p>{/if}
  </section>
  <section class="home-section"><div class="home-section-heading"><h2>{guest?'Explore Starli':'Recent projects'}</h2>{#if !guest&&projects?.items?.length}<a href="/starli/projects">View projects <Icon name="arrow" size={14}/></a>{/if}</div>
   {#if !guest&&projects?.items?.length}<ul class="home-project-list">{#each projects.items.slice(0,4) as project}<li><Icon name="projects" size={17}/><span>{project.name}</span>{#if project.status}<small>{project.status}</small>{/if}</li>{/each}</ul>
   {:else if !guest}<p class="home-empty">{projects?'No projects to show yet.':'Project activity is unavailable.'}</p>{/if}
   <a class="home-doc-link" href="/docs"><Icon name="book" size={17}/><span><strong>Starli documentation</strong><small>Find help and learn how the workspace works.</small></span><Icon name="arrow" size={14}/></a>
  </section>
 </div>
</div>
<style>
 .sd-dashboard{width:100%;max-width:1700px;margin:auto;padding:40px 48px 64px;color:var(--sd-text)}
 .home-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:32px}.home-heading h1{font-size:34px;font-weight:600;line-height:1.2;letter-spacing:-.035em}.home-heading>span{font-size:12px;color:var(--sd-muted)}
 .home-editorial{min-height:210px;display:flex;align-items:center;border:1px solid #303030;border-radius:12px;background-color:#050709;background-image:linear-gradient(90deg,#050709 28%,#050709f2 43%,#05070922 76%,transparent),url('/starli-art/earth-blue-marble-nasa.jpg');background-size:100% 100%,auto 245%;background-position:center,right -28px center;background-repeat:no-repeat;overflow:hidden;margin-bottom:32px}.home-editorial>div{max-width:580px;padding:28px 32px}.home-eyebrow{font-size:10px;font-weight:600;letter-spacing:.14em;color:#aeb7c1;margin-bottom:8px}.home-editorial h2{font-size:26px;line-height:1.2;letter-spacing:-.025em;font-weight:600;color:#f9fafb}.home-editorial h2+p{font-size:13px;line-height:1.6;color:#c1c5cc;margin-top:10px;max-width:390px}.home-cta{display:inline-flex;align-items:center;gap:9px;border:1px solid #d1d5db;border-radius:7px;background:#f3f4f6;color:#111827;padding:7px 12px;font-size:12px;font-weight:500;margin-top:16px}.home-cta:hover{background:#fff}
 .home-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--sd-line);border-radius:12px;overflow:hidden;margin-bottom:36px}.home-stats>a,.home-stats>button{min-width:0;padding:20px 18px;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left}.home-stats>:not(:last-child){border-right:1px solid var(--sd-line)}.home-stats>:hover{background:#ffffff04}.home-stats span{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--sd-muted)}.home-stats strong{font-size:20px;font-weight:600;letter-spacing:-.02em}.home-stats small{font-size:11px;line-height:1.5;color:var(--sd-muted)}
 .home-columns{display:grid;grid-template-columns:1.5fr 1fr;gap:32px}.home-section{min-width:0}.home-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.home-section h2{font-size:16px;font-weight:600;letter-spacing:-.015em}.home-section-heading a,.home-section-heading button{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--sd-muted)}.home-agent-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.home-agent-grid>a,.home-doc-link{display:flex;align-items:center;gap:12px;border:1px solid var(--sd-line);border-radius:10px;padding:16px;min-width:0}.home-agent-grid>a:hover,.home-doc-link:hover{background:#ffffff06}.home-agent-grid span,.home-doc-link span{display:flex;flex-direction:column;min-width:0;gap:3px;flex:1}.home-agent-grid strong,.home-doc-link strong{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-agent-grid small,.home-doc-link small{font-size:11px;line-height:1.5;color:var(--sd-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-agent-grid>a>:global(svg),.home-doc-link>:global(svg){flex:none;color:var(--sd-muted)}.home-project-list{margin-bottom:16px}.home-project-list li{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid var(--sd-line);font-size:13px}.home-project-list span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-project-list small{font-size:11px;color:var(--sd-muted)}.home-empty{font-size:13px;line-height:1.7;color:var(--sd-muted);padding:16px 0}.home-empty p{max-width:420px}
 @media(max-width:1100px){.sd-dashboard{padding:32px 28px}.home-columns{grid-template-columns:1fr;gap:28px}.home-heading h1{font-size:30px}}
 @media(max-width:600px){.sd-dashboard{padding:24px 16px 40px}.home-heading{margin-bottom:22px}.home-heading h1{font-size:28px}.home-heading>span{font-size:11px}.home-editorial{min-height:225px;margin-bottom:22px;background-image:linear-gradient(90deg,#050709 24%,#050709ed 48%,#05070955 78%,#05070911),url('/starli-art/earth-blue-marble-nasa.jpg');background-size:100% 100%,auto 115%;background-position:center,right -105px center}.home-editorial>div{padding:24px 20px}.home-editorial h2{font-size:23px}.home-editorial h2+p{max-width:245px}.home-stats{grid-template-columns:1fr;margin-bottom:28px}.home-stats>:not(:last-child){border-right:0;border-bottom:1px solid var(--sd-line)}.home-stats>a,.home-stats>button{padding:16px}.home-agent-grid{grid-template-columns:1fr}.home-columns{gap:28px}}
</style>

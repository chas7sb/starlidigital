<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
 import {createProjectViewStore} from '$lib/stores/starli-project';
 import Spinner from '$lib/components/common/Spinner.svelte';
 import XMark from '$lib/components/icons/XMark.svelte';
 import {PaneGroup,Pane,PaneResizer} from 'paneforge';
 import {mobile} from '$lib/stores';
 import Drawer from '$lib/components/common/Drawer.svelte';
	import Navbar from '$lib/components/chat/Navbar.svelte';
	import Placeholder from '$lib/components/chat/Placeholder.svelte';
	import MessageInput from '$lib/components/chat/MessageInput.svelte';
	import StarliBrand from '$lib/components/starli-preview/StarliBrand.svelte';

	type Role = 'user' | 'assistant';
	type Msg = { role: Role; content: string };

	const MAX_MSGS = 20;
	const MAX_CHARS = 4000;
	let messages: Msg[] = [];
 let guestProject:any=null,previewHtml='';
 const guestView=createProjectViewStore({namespace:'starli-guest-preview.v2'});
 const {projectPanel:guestPreviewOpen}=guestView;
 let guestChatPane:any;
 function activateGuestPreview(id?:string,startClosed=false,inheritCurrent=false){guestView.activateConversation(id?'project:'+id:null,'guest',{startClosed,inheritCurrent});if(id)guestView.selectProject(id);}
 async function resizeGuestPane(open:boolean){await tick();try{guestChatPane?.resize(open?50:100);}catch{}}
 $: if(guestChatPane&&!$mobile)void resizeGuestPane($guestPreviewOpen);
 let buildRetry:{requestId:string,prompt:string,projectId?:string}|null=null;
	let draft = '';
	let busy = false;
	let error = '';
	let modelName = 'STARLI BOSS';
	let guestLimit: number | null = null;
	let ac: AbortController | null = null;
	let requestEpoch = 0;
	let failed: { requestId: string; messages: Msg[] } | null = null;
	let retryAsNew = false;
	let initialSession: Promise<void> | null = null;
	let scroller: HTMLElement;

	onMount(() => {
 try{const saved=JSON.parse(localStorage.getItem('starli-guest-draft')??'null');if(saved){messages=Array.isArray(saved.messages)?saved.messages.slice(-20):[];guestProject=saved.project??null;}}catch{}
 activateGuestPreview(guestProject?.id,true);

		initialSession = fetch('/api/v1/starli/public/session', { credentials: 'same-origin', signal: AbortSignal.timeout(8000) })
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => {
				void restoreProject();
				if (d?.model?.name === 'STARLI BOSS') modelName = d.model.name;
				if (Number.isInteger(d?.allowance?.limit) && d.allowance.limit > 0) guestLimit = d.allowance.limit;
			})
			.catch(() => {});
	});

	$: if (scroller) scroller.scrollTop = scroller.scrollHeight;

	// Invalidate before aborting: stale fetch/JSON completions cannot mutate a new chat.
	function stop() {
		requestEpoch += 1;
		ac?.abort();
		ac = null;
		busy = false;
        if(!previewHtml)guestPreviewOpen.set(false);
	}

	onDestroy(stop);
 onMount(()=>{const preview=()=>{if(guestProject||previewHtml)guestView.openProjectPanel();else {error='Build a guest project to open its preview.';}};window.addEventListener('starli-guest-preview',preview);return()=>window.removeEventListener('starli-guest-preview',preview);});

	function newChat() {
 guestView.dismissPreview();activateGuestPreview(undefined,true);
 guestProject=null;previewHtml='';buildRetry=null;localStorage.removeItem('starli-guest-draft');
		stop();
		messages = [];
		failed = null;
		retryAsNew = false;
		error = '';
		draft = '';
		busy = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send(false);
		}
	}

	async function send(retry: boolean) {
		if (busy) return;
		const text = draft.trim();
		if (!retry && !text) return;
		if (!retry && (text.length > MAX_CHARS || messages.length >= MAX_MSGS)) {
			error = text.length > MAX_CHARS ? `Max ${MAX_CHARS} characters.` : `Max ${MAX_MSGS} messages. Start a new chat.`;
			return;
		}
		if (retry && !failed) return;
		error = '';
		const requestId = retry && failed && !retryAsNew ? failed.requestId : crypto.randomUUID();
		const payload = retry && failed ? failed.messages : [...messages, { role: 'user' as Role, content: text }];
		if (!retry) {
			messages = payload;
			draft = '';
			failed = null;
		}
		busy = true;
		const controller = new AbortController();
		const epoch = ++requestEpoch;
		ac = controller;
		const isCurrent = () => requestEpoch === epoch && ac === controller && !controller.signal.aborted;
		try {
			if (initialSession) await initialSession;
			if (!isCurrent()) return;
			// Confirm the signed guest cookie before every generation, including retries.
			const session = await fetch('/api/v1/starli/public/session', { credentials: 'same-origin', signal: controller.signal });
			if (!isCurrent()) return;
			if (!session.ok) throw new Error('Guest session unavailable');
			const res = await fetch('/api/v1/starli/public/chat', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				signal: controller.signal,
				body: JSON.stringify({ requestId, messages: payload })
			});
			if (!isCurrent()) return;
			if (!res.ok) {
				failed = { requestId, messages: payload };
				const state = res.headers.get('X-Starli-Request-State');
				retryAsNew = res.status === 503 || (res.status === 409 && state === 'UNCERTAIN');
				error = res.status === 429
					? 'STARLI BOSS is busy or your guest allowance is temporarily used up. Try again in a few minutes.'
					: retryAsNew ? 'STARLI BOSS could not finish this reply. You can send the message again.'
					: res.status === 409 ? 'Your reply is still being processed. Retry shortly to check for it.'
					: res.status === 403 ? 'Your guest session expired. Retry to reconnect.'
					: 'The connection was interrupted. Retry to recover your reply.';
				return;
			}
			const data = await res.json();
			if (!isCurrent()) return;
			const reply = typeof data?.reply === 'string' ? data.reply : '';
			if (!reply) {
				failed = { requestId, messages: payload };
				error = 'Empty reply. Retry this message.';
				return;
			}
			messages = [...payload, { role: 'assistant', content: reply }];
			failed = null;
			retryAsNew = false;
		} catch (e) {
			if (!isCurrent()) return;
			if ((e as Error).name === 'AbortError') return;
			failed = { requestId, messages: payload };
			retryAsNew = false;
			error = 'The connection was interrupted. Retry to reconnect and recover your reply.';
		} finally {
			if (requestEpoch === epoch && ac === controller) {
				busy = false;
				ac = null;
			}
		}
	}
 async function restoreProject(){
  try{
   const response=await fetch('/api/v1/starli/public/projects',{credentials:'same-origin'});
   if(!response.ok)return;const data=await response.json();
   if(!guestProject&&data.items?.length){guestProject=data.items[0];activateGuestPreview(guestProject.id,true);}
   if(guestProject){const r=await fetch('/api/v1/starli/public/projects/'+encodeURIComponent(guestProject.id)+'/preview',{credentials:'same-origin'});if(r.ok){const p=await r.json();previewHtml=p.available?p.html:'';}}
  }catch{}
 }
 function persist(){localStorage.setItem('starli-guest-draft',JSON.stringify({messages,project:guestProject}));}
 async function buildProject(retry=false){
  const text=retry?buildRetry?.prompt:draft.trim();if(!text||busy)return;
  if(text.length>4000){error='Please keep the request under 4,000 characters.';return;}
  const payload=retry&&buildRetry?buildRetry:{requestId:crypto.randomUUID(),prompt:text,...(guestProject?{projectId:guestProject.id}:{})};
  if(!retry){messages=[...messages,{role:'user',content:text}];draft='';persist();}
  buildRetry=payload;busy=true;error='';const controller=new AbortController();ac=controller;const epoch=++requestEpoch;
  try{
   if(initialSession)await initialSession;
   const session=await fetch('/api/v1/starli/public/session',{credentials:'same-origin',signal:controller.signal});if(!session.ok)throw Error('Guest session unavailable');
   guestView.requestProjectPreview({chatId:guestView.currentConversation(),projectId:guestProject?.id??'pending',phase:'building',buildKey:payload.requestId,showPreview:true});
   const response=await fetch('/api/v1/starli/public/projects/build',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
   const data=await response.json();if(epoch!==requestEpoch)return;
   if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Project build failed ('+response.status+')');
   guestProject=data.project;activateGuestPreview(guestProject.id,false,true);
   guestView.requestProjectPreview({chatId:guestView.currentConversation(),projectId:guestProject.id,phase:'ready',buildKey:payload.requestId,showPreview:true});
   messages=[...messages,{role:'assistant',content:data.reply}];buildRetry=null;persist();await restoreProject();
  }catch(e){if(epoch===requestEpoch&&(e as Error).name!=='AbortError'){error=(e as Error).message;if(!previewHtml)guestPreviewOpen.set(false);}}
  finally{if(epoch===requestEpoch){busy=false;ac=null;}}
 }
</script>


<PaneGroup direction="horizontal" class="h-screen w-full">
<Pane bind:pane={guestChatPane} defaultSize={$mobile||!$guestPreviewOpen?100:50} class="min-w-0">
<section id="chat-container" class="h-screen max-h-[100dvh] w-full flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-primary" aria-label="STARLI BOSS guest chat">
	<div class="sr-only focus-within:not-sr-only"><Navbar guestMode  selectedModels={['starli-ai']} history={{currentId:null,messages:{}}} />
	</div><div class="guest-header flex items-center gap-2 px-4 py-2 text-xs text-gray-500"><strong>STARLI BOSS</strong>
 {#if guestProject||previewHtml}<button class="ml-auto rounded-lg px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>guestView.openProjectPanel()}>Preview</button>{/if}
</div>
{#if messages.length === 0}
		<div class="flex-1 min-h-0 overflow-auto flex flex-col @container">
			<Placeholder guestMode history={{currentId:null,messages:{}}} selectedModels={['starli-ai']} bind:prompt={draft} stopResponse={stop} createMessagePair={() => {}} on:submit={(e) => { draft = e.detail; send(false); }} />
		</div>
	{:else}
		<div id="messages-container" class="flex-1 min-h-0 overflow-auto scrollbar-hidden" bind:this={scroller} role="log" aria-live="polite">
			<div class="max-w-3xl mx-auto px-4 pt-8 pb-6 space-y-6">
				{#each messages as m, i (i)}
					<article class={m.role === 'user' ? 'flex justify-end' : 'flex gap-3'}>
						{#if m.role === 'assistant'}<div class="mt-1 shrink-0"><StarliBrand compact iconOnly /></div>{/if}
						<div class={m.role === 'user' ? 'max-w-[85%] rounded-3xl bg-gray-100 dark:bg-gray-850 px-5 py-3 whitespace-pre-wrap break-words' : 'min-w-0 whitespace-pre-wrap break-words py-1'}>{m.content}</div>
					</article>
				{/each}
				{#if busy}<p class="text-sm text-gray-500 animate-pulse">STARLI BOSS is thinking…</p>{/if}
			</div>
		</div>
		<div class="pb-3 w-full max-w-3xl mx-auto">
			<MessageInput guestMode guestBusy={busy} history={{currentId:null,messages:{}}} selectedModels={['starli-ai']} bind:prompt={draft} stopResponse={stop} createMessagePair={() => {}} on:submit={(e) => { draft = e.detail; send(false); }} />
		</div>
	{/if}
	{#if error}<div class="px-4 py-2 text-center text-sm text-red-600 dark:text-red-400" role="alert">{error} {#if buildRetry}<button class="underline ml-2" on:click={()=>buildProject(true)}>Check build</button>{/if} {#if failed}<button class="underline ml-2" on:click={() => send(true)}>{retryAsNew ? 'Send again' : 'Retry'}</button>{/if}</div>{/if}
	<p class="px-4 pb-3 text-center text-xs text-gray-500">{#if guestLimit}Free guest chat · {guestLimit} messages every 5 minutes. {/if}<a class="underline" href="/auth?mode=signup">Create account</a> or <a class="underline" href="/auth">sign in</a> to keep your projects and chats.</p>
</section>
</Pane>
{#if !$mobile&&$guestPreviewOpen}
<PaneResizer class="relative flex w-2 items-center justify-center bg-background group"><div class="h-8 w-1 rounded-full bg-gray-200 dark:bg-gray-700"/></PaneResizer>
<Pane defaultSize={50} class="min-w-0 bg-white dark:bg-gray-900">
 <div class="flex h-full flex-col">
  <header class="flex items-center justify-between gap-3 border-b border-gray-100 p-3 text-sm dark:border-gray-800"><span class="truncate">{guestProject?.name??'Project preview'}</span><button class="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close preview" on:click={()=>guestView.dismissPreview()}><XMark className="size-4"/></button></header>
  {#if previewHtml}<iframe title="Guest project live preview" srcdoc={previewHtml} sandbox="allow-scripts" referrerpolicy="no-referrer" class="w-full flex-1 border-0 bg-white"/>
  {:else if busy}<div class="m-auto flex items-center gap-3 p-6 text-sm text-gray-500"><Spinner/><span>Building your project preview…</span></div>
  {:else}<p class="m-auto p-6 text-sm text-gray-500">The project preview is not ready yet.</p>{/if}
 </div>
</Pane>
{/if}
</PaneGroup>
{#if $mobile&&$guestPreviewOpen}<Drawer show={$guestPreviewOpen} on:close={()=>guestView.dismissPreview()}><div class="flex h-screen flex-col bg-white dark:bg-gray-900"><header class="flex items-center justify-between gap-3 border-b border-gray-100 p-3 text-sm dark:border-gray-800"><span>{guestProject?.name??'Project preview'}</span><button class="rounded-lg px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>guestView.dismissPreview()}>Back to chat</button></header>{#if previewHtml}<iframe title="Guest project preview" srcdoc={previewHtml} sandbox="allow-scripts" referrerpolicy="no-referrer" class="w-full flex-1 border-0 bg-white"/>{:else if busy}<div class="m-auto flex items-center gap-3 p-5 text-sm text-gray-500"><Spinner/><span>Building your project preview…</span></div>{:else}<p class="p-5 text-gray-500">The project preview is not ready yet.</p>{/if}</div></Drawer>{/if}

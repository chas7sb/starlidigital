<script lang="ts">
 import {avatarVersions,registryReady} from '$lib/components/starli-shell/identity';
 import AvatarEditor from '$lib/components/starli-shell/AvatarEditor.svelte';
 let avatarEditor:AvatarEditor,portraitShape='',avatarsAvailable=false,savingAgent=false,editorAccount='',editorToken='';
 const shellEdit=(e:Event)=>editStarli((e as CustomEvent).detail||null);
 async function avatarIndex(){
   const owner=$user?.id,token=localStorage.token;
   try{const r=await fetch('/api/v1/starli/avatars/',{headers:{Authorization:'Bearer '+token},cache:'no-store'});if(!r.ok)throw Error();const d=await r.json();if(owner!==$user?.id||token!==localStorage.token)return;avatarsAvailable=d.version==='starli.avatar.v1';if(avatarsAvailable)avatarVersions.set(d.revisions);}catch{if(owner===$user?.id&&token===localStorage.token){avatarsAvailable=false;avatarVersions.set({});}}
 }
 onMount(()=>{window.addEventListener('starli-edit-agent',shellEdit);void avatarIndex();return()=>window.removeEventListener('starli-edit-agent',shellEdit);});

 import {botChatPath} from '$lib/utils/starli-chat-url';
 import StarliAvatar from '$lib/components/starli-preview/StarliAvatar.svelte';
 import StarliWhisper from '$lib/components/starli-preview/StarliWhisper.svelte';
 import Modal from '$lib/components/common/Modal.svelte';
 import Switch from '$lib/components/common/Switch.svelte';
 import {registerStarlis,receiveStarliActivity,resetStarliActivity} from '$lib/stores/starli-activity';

	import StarliBrand from '$lib/components/starli-preview/StarliBrand.svelte';
	import StarliDrawerLinks from '$lib/components/starli-preview/StarliDrawerLinks.svelte';
	import { toast } from 'svelte-sonner';
	import { v4 as uuidv4 } from 'uuid';

	import { goto } from '$app/navigation';
	import {
		user,
		chats,
		settings,
		showSettings,
		chatId,
		tags,
		showSidebar,
		mobile,
		showArchivedChats,
		pinnedChats,
		scrollPaginationEnabled,
		currentChatPage,
		temporaryChatEnabled,
		channels,
		socket,
		config,
		isApp
	} from '$lib/stores';
	import { onMount, getContext, tick, onDestroy } from 'svelte';

	const i18n = getContext('i18n');

	import {
		deleteChatById,
		getChatList,
		getAllTags,
		getChatListBySearchText,
		createNewChat,
		getPinnedChatList,
		toggleChatPinnedStatusById,
		getChatPinnedStatusById,
		getChatById,
		updateChatFolderIdById,
		importChat
	} from '$lib/apis/chats';
	import { createNewFolder, getFolders, updateFolderParentIdById } from '$lib/apis/folders';
	import { WEBUI_BASE_URL } from '$lib/constants';

	import ArchivedChatsModal from './Sidebar/ArchivedChatsModal.svelte';
	import UserMenu from './Sidebar/UserMenu.svelte';
	import ChatItem from './Sidebar/ChatItem.svelte';
	import Spinner from '../common/Spinner.svelte';
	import Loader from '../common/Loader.svelte';
	import AddFilesPlaceholder from '../AddFilesPlaceholder.svelte';
	import SearchInput from './Sidebar/SearchInput.svelte';
	import Folder from '../common/Folder.svelte';
	import Plus from '../icons/Plus.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import Folders from './Sidebar/Folders.svelte';
	import { getChannels, createNewChannel } from '$lib/apis/channels';
	import ChannelModal from './Sidebar/ChannelModal.svelte';
	import ChannelItem from './Sidebar/ChannelItem.svelte';
	import Home from '../icons/Home.svelte';

	const BREAKPOINT = 768;

	let navElement;
	let search = '';

	let shiftKey = false;

	let selectedChatId = null;
	let showDropdown = false;
	let showPinnedChat = true;
	let showConversations = false;
	let starlis: any[] = [];
	let starlisAvailable = false;
 let activitySocket:any=null;
 let activityAccount:string|null=null;
 let agentPoll:ReturnType<typeof setInterval>|null=null;
 let activityEvent=(event:any)=>receiveStarliActivity(event);
 $: if($user?.id!==activityAccount){
   activityAccount=$user?.id??null;starlis=[];starlisAvailable=false;resetStarliActivity();
 }
 $: if($socket!==activitySocket){
   activitySocket?.off('starli-execution',activityEvent);
   activitySocket=$socket;
   const boundSocket=activitySocket,boundAccount=$user?.id;
   activityEvent=(event:any)=>{if(boundAccount&&$user?.id===boundAccount&&$socket===boundSocket)receiveStarliActivity(event);};
   activitySocket?.on('starli-execution',activityEvent);
 }

 let starliMenu: string | null = null;
 let starliEditor = false;
 let starliEditing: any = null;
 let starliName = '';
 let starliRole = 'Specialist';
 let starliInstructions = '';
 let providerCatalog:any[]=[];
 let catalogEpoch=0;
 $: selectableProviderModels=providerCatalog.find(item=>item.id===starliProvider)?.models??[];
 const providerDefault=()=>starliProvider==='account'?'account-default':providerCatalog.find(item=>item.id===starliProvider)?.defaultModel??'';
 let starliProvider = 'account';
 let starliModel = 'account-default';
 let starliColor = '#f52991';
 let starliPlatform=false;
 let starliShape = 0;
 const starliColors = ['#f52991','#ff3453','#ff8515','#15c3aa','#168cff','#9c62fa','#ffffff','#777777'];
 const starliShapes = ['✦','◆','◈','✿','⬡','✧','◉','✣','✤','❖'];
 const starliRequest = async (path: string, method = 'GET', body?: any) => {
   const res = await fetch('/api/v1/starli/v3-native'+path,{method,headers:{Authorization:`Bearer ${localStorage.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.detail||`HTTP ${res.status}`);return data;
 };
 const editStarli = async (agent:any=null)=>{
  const epoch=++catalogEpoch,account=$user?.id,token=localStorage.token;
  editorAccount=account;editorToken=token;portraitShape=agent?.avatarShape||'p0';
  starliMenu=null;starliEditing=agent;starliPlatform=agent?.platformAccess===true;starliName=agent?.name||'';starliColor=agent?.avatarColor||'#2563eb';starliShape=Math.max(0,starliShapes.indexOf(agent?.avatarShape||'✦'));starliRole=agent?.role||'Specialist';starliInstructions=agent?.instructions||'';starliProvider=agent?.provider||'account';starliModel=agent?.model||(starliProvider==='account'?'account-default':'');starliEditor=true;providerCatalog=[];
  try{
   const response=await starliRequest('/providers');
   if(epoch!==catalogEpoch||account!==$user?.id||token!==localStorage.token||!starliEditor)return;
   providerCatalog=(Array.isArray(response.items)?response.items:[]).filter((item:any)=>['hosted','openrouter'].includes(item?.id)).map((item:any)=>({...item,defaultModel:typeof item.defaultModel==='string'?item.defaultModel:'',models:(Array.isArray(item.models)?item.models:[]).filter((m:any)=>typeof m?.id==='string'&&m.id.length<=160&&typeof m?.name==='string')}));
   if(!starliModel)starliModel=providerDefault();
  }catch{/* Preserve explicit model input when the server catalog is unavailable. */}
 };

 const saveStarli = async () => {
   if(savingAgent||editorAccount!==$user?.id||editorToken!==localStorage.token)return; savingAgent=true;
   try {
     const agent=starliEditing;
     const values={name:starliName,role:starliRole,instructions:starliInstructions,avatarColor:starliColor,avatarShape:portraitShape||starliShapes[starliShape],provider:starliProvider,model:starliModel};
     const saved=agent
       ? await starliRequest('/agents/'+encodeURIComponent(agent.id),'PATCH',{...values,expectedVersion:agent.version})
       : await starliRequest('/agents','POST',values);
     if(editorAccount!==$user?.id||editorToken!==localStorage.token)return;
     starliEditing=saved;
     await avatarEditor?.save(saved.id,editorToken,editorAccount);
     if($user?.role==='admin'&&starliPlatform!==(saved.platformAccess===true))
       await starliRequest('/agents/'+encodeURIComponent(saved.id)+'/platform-access','PATCH',{enabled:starliPlatform});
     starliEditor=false;await loadStarlis();
   } catch(e) {toast.error(String(e));} finally {savingAgent=false;}
 };
 const togglePlatform = async(agent:any)=>{
   starliMenu=null;
   try {await starliRequest('/agents/'+encodeURIComponent(agent.id)+'/platform-access','PATCH',{enabled:!agent.platformAccess});await loadStarlis();}
   catch(e){toast.error(String(e));}
 };
 const toggleAutonomous = async (agent: any) => {
   starliMenu=null;
   try {
     const objective=!agent.autonomousEnabled ? window.prompt('Continue this Starli conversation in the background. Optional objective:', 'Continue the unfinished work from this conversation, following the latest user request.') : '';
     if(!agent.autonomousEnabled && !objective?.trim())return;
     const result=await starliRequest('/agents/'+encodeURIComponent(agent.id)+'/autonomous-mode','POST',{enabled:!agent.autonomousEnabled,objective:objective||''});
     await loadStarlis();
     toast.success(result.enabled ? 'Autonomous session started.' : 'Background task cancellation requested.');
   } catch(e) {toast.error(String(e));}
 };
  const deleteStarli = async (agent: any) => {starliMenu=null;if(agent.kind==='boss'||!confirm(`Archive ${agent.name}?`))return;try{await starliRequest('/agents/'+encodeURIComponent(agent.id)+'?expectedVersion='+agent.version,'DELETE');await loadStarlis();}catch(e){toast.error(String(e));}};
	const loadStarlis = async () => {
		try {
            const account=$user?.id, token=localStorage.token;if(!account)return;
			const response = await fetch('/api/v1/starli/v3-native/agents', { headers: { Authorization: `Bearer ${localStorage.token}` } });
			if (!response.ok) {registryReady.set('error');return;}
			const data = await response.json();
			if($user?.id!==account||token!==localStorage.token)return;
            starlis = data.items ?? [];
            registerStarlis(starlis);
			starlisAvailable = true;registryReady.set('ready');
		} catch { starlisAvailable = false;registryReady.set('error'); }
	};

	let showCreateChannel = false;

	// Pagination variables
	let chatListLoading = false;
	let allChatsLoaded = false;

	let folders = {};
	let newFolderId = null;

	const initFolders = async () => {
		const folderList = await getFolders(localStorage.token).catch((error) => {
			toast.error(`${error}`);
			return [];
		});

		folders = {};

		// First pass: Initialize all folder entries
		for (const folder of folderList) {
			// Ensure folder is added to folders with its data
			folders[folder.id] = { ...(folders[folder.id] || {}), ...folder };

			if (newFolderId && folder.id === newFolderId) {
				folders[folder.id].new = true;
				newFolderId = null;
			}
		}

		// Second pass: Tie child folders to their parents
		for (const folder of folderList) {
			if (folder.parent_id) {
				// Ensure the parent folder is initialized if it doesn't exist
				if (!folders[folder.parent_id]) {
					folders[folder.parent_id] = {}; // Create a placeholder if not already present
				}

				// Initialize childrenIds array if it doesn't exist and add the current folder id
				folders[folder.parent_id].childrenIds = folders[folder.parent_id].childrenIds
					? [...folders[folder.parent_id].childrenIds, folder.id]
					: [folder.id];

				// Sort the children by updated_at field
				folders[folder.parent_id].childrenIds.sort((a, b) => {
					return folders[b].updated_at - folders[a].updated_at;
				});
			}
		}
	};

	const createFolder = async (name = 'Untitled') => {
		if (name === '') {
			toast.error($i18n.t('Folder name cannot be empty.'));
			return;
		}

		const rootFolders = Object.values(folders).filter((folder) => folder.parent_id === null);
		if (rootFolders.find((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
			// If a folder with the same name already exists, append a number to the name
			let i = 1;
			while (
				rootFolders.find((folder) => folder.name.toLowerCase() === `${name} ${i}`.toLowerCase())
			) {
				i++;
			}

			name = `${name} ${i}`;
		}

		// Add a dummy folder to the list to show the user that the folder is being created
		const tempId = uuidv4();
		folders = {
			...folders,
			tempId: {
				id: tempId,
				name: name,
				created_at: Date.now(),
				updated_at: Date.now()
			}
		};

		const res = await createNewFolder(localStorage.token, name).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			newFolderId = res.id;
			await initFolders();
		}
	};

	const initChannels = async () => {
		await channels.set(await getChannels(localStorage.token));
	};

	const initChatList = async () => {
		// Reset pagination variables
		tags.set(await getAllTags(localStorage.token));
		pinnedChats.set(await getPinnedChatList(localStorage.token));
		initFolders();

		currentChatPage.set(1);
		allChatsLoaded = false;

		if (search) {
			await chats.set(await getChatListBySearchText(localStorage.token, search, $currentChatPage));
		} else {
			await chats.set(await getChatList(localStorage.token, $currentChatPage));
		}

		// Enable pagination
		scrollPaginationEnabled.set(true);
	};

	const loadMoreChats = async () => {
		chatListLoading = true;

		currentChatPage.set($currentChatPage + 1);

		let newChatList = [];

		if (search) {
			newChatList = await getChatListBySearchText(localStorage.token, search, $currentChatPage);
		} else {
			newChatList = await getChatList(localStorage.token, $currentChatPage);
		}

		// once the bottom of the list has been reached (no results) there is no need to continue querying
		allChatsLoaded = newChatList.length === 0;
		await chats.set([...($chats ? $chats : []), ...newChatList]);

		chatListLoading = false;
	};

	let searchDebounceTimeout;

	const searchDebounceHandler = async () => {
		console.log('search', search);
		chats.set(null);

		if (searchDebounceTimeout) {
			clearTimeout(searchDebounceTimeout);
		}

		if (search === '') {
			await initChatList();
			return;
		} else {
			searchDebounceTimeout = setTimeout(async () => {
				allChatsLoaded = false;
				currentChatPage.set(1);
				await chats.set(await getChatListBySearchText(localStorage.token, search));

				if ($chats.length === 0) {
					tags.set(await getAllTags(localStorage.token));
				}
			}, 1000);
		}
	};

	const importChatHandler = async (items, pinned = false, folderId = null) => {
		console.log('importChatHandler', items, pinned, folderId);
		for (const item of items) {
			console.log(item);
			if (item.chat) {
				await importChat(localStorage.token, item.chat, item?.meta ?? {}, pinned, folderId);
			}
		}

		initChatList();
	};

	const inputFilesHandler = async (files) => {
		console.log(files);

		for (const file of files) {
			const reader = new FileReader();
			reader.onload = async (e) => {
				const content = e.target.result;

				try {
					const chatItems = JSON.parse(content);
					importChatHandler(chatItems);
				} catch {
					toast.error($i18n.t(`Invalid file format.`));
				}
			};

			reader.readAsText(file);
		}
	};

	const tagEventHandler = async (type, tagName, chatId) => {
		console.log(type, tagName, chatId);
		if (type === 'delete') {
			initChatList();
		} else if (type === 'add') {
			initChatList();
		}
	};

	let draggedOver = false;

	const onDragOver = (e) => {
		e.preventDefault();

		// Check if a file is being draggedOver.
		if (e.dataTransfer?.types?.includes('Files')) {
			draggedOver = true;
		} else {
			draggedOver = false;
		}
	};

	const onDragLeave = () => {
		draggedOver = false;
	};

	const onDrop = async (e) => {
		e.preventDefault();
		console.log(e); // Log the drop event

		// Perform file drop check and handle it accordingly
		if (e.dataTransfer?.files) {
			const inputFiles = Array.from(e.dataTransfer?.files);

			if (inputFiles && inputFiles.length > 0) {
				console.log(inputFiles); // Log the dropped files
				inputFilesHandler(inputFiles); // Handle the dropped files
			}
		}

		draggedOver = false; // Reset draggedOver status after drop
	};

	let touchstart;
	let touchend;

	function checkDirection() {
		const screenWidth = window.innerWidth;
		const swipeDistance = Math.abs(touchend.screenX - touchstart.screenX);
		if (touchstart.clientX < 40 && swipeDistance >= screenWidth / 8) {
			if (touchend.screenX < touchstart.screenX) {
				showSidebar.set(false);
			}
			if (touchend.screenX > touchstart.screenX) {
				showSidebar.set(true);
			}
		}
	}

	const onTouchStart = (e) => {
		touchstart = e.changedTouches[0];
		console.log(touchstart.clientX);
	};

	const onTouchEnd = (e) => {
		touchend = e.changedTouches[0];
		checkDirection();
	};

	const onKeyDown = (e) => {
		if (e.key === 'Shift') {
			shiftKey = true;
		}
	};

	const onKeyUp = (e) => {
		if (e.key === 'Shift') {
			shiftKey = false;
		}
	};

	const onFocus = () => {};

	const onBlur = () => {
		shiftKey = false;
		selectedChatId = null;
	};

	onMount(async () => {
		void loadStarlis();
        agentPoll=setInterval(()=>{if(!document.hidden)void loadStarlis();},15000);
		window.addEventListener('starli-conversation-bound', loadStarlis);
		showPinnedChat = localStorage?.showPinnedChat ? localStorage.showPinnedChat === 'true' : true;

		mobile.subscribe((value) => {
			if ($showSidebar && value) {
				showSidebar.set(false);
			}

			if ($showSidebar && !value) {
				const navElement = document.getElementsByTagName('nav')[0];
				if (navElement) {
					navElement.style['-webkit-app-region'] = 'drag';
				}
			}

			if (!$showSidebar && !value) {
				showSidebar.set(true);
			}
		});

		showSidebar.set(!$mobile ? localStorage.sidebar === 'true' : false);
		showSidebar.subscribe((value) => {
			localStorage.sidebar = value;

			// nav element is not available on the first render
			const navElement = document.getElementsByTagName('nav')[0];

			if (navElement) {
				if ($mobile) {
					if (!value) {
						navElement.style['-webkit-app-region'] = 'drag';
					} else {
						navElement.style['-webkit-app-region'] = 'no-drag';
					}
				} else {
					navElement.style['-webkit-app-region'] = 'drag';
				}
			}
		});

		await initChannels();
		await initChatList();

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);

		window.addEventListener('touchstart', onTouchStart);
		window.addEventListener('touchend', onTouchEnd);

		window.addEventListener('focus', onFocus);
		window.addEventListener('blur-sm', onBlur);

		const dropZone = document.getElementById('sidebar');

		dropZone?.addEventListener('dragover', onDragOver);
		dropZone?.addEventListener('drop', onDrop);
		dropZone?.addEventListener('dragleave', onDragLeave);
	});

	onDestroy(() => {
        activitySocket?.off('starli-execution',activityEvent);
        window.removeEventListener('starli-conversation-bound',loadStarlis);
        if(agentPoll)clearInterval(agentPoll);

		window.removeEventListener('keydown', onKeyDown);
		window.removeEventListener('keyup', onKeyUp);

		window.removeEventListener('touchstart', onTouchStart);
		window.removeEventListener('touchend', onTouchEnd);

		window.removeEventListener('focus', onFocus);
		window.removeEventListener('blur-sm', onBlur);

		const dropZone = document.getElementById('sidebar');

		dropZone?.removeEventListener('dragover', onDragOver);
		dropZone?.removeEventListener('drop', onDrop);
		dropZone?.removeEventListener('dragleave', onDragLeave);
	});
</script>

<ArchivedChatsModal
	bind:show={$showArchivedChats}
	on:change={async () => {
		await initChatList();
	}}
/>

<ChannelModal
	bind:show={showCreateChannel}
	onSubmit={async ({ name, access_control }) => {
		const res = await createNewChannel(localStorage.token, {
			name: name,
			access_control: access_control
		}).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			$socket.emit('join-channels', { auth: { token: $user?.token } });
			await initChannels();
			showCreateChannel = false;
		}
	}}
/>

<!-- svelte-ignore a11y-no-static-element-interactions -->

<style>
	.scrollbar-hidden:active::-webkit-scrollbar-thumb,
	.scrollbar-hidden:focus::-webkit-scrollbar-thumb,
	.scrollbar-hidden:hover::-webkit-scrollbar-thumb {
		visibility: visible;
	}
	.scrollbar-hidden::-webkit-scrollbar-thumb {
		visibility: hidden;
	}
</style>

<Modal bind:show={starliEditor} size="sm">
 <form on:submit|preventDefault={saveStarli} class="text-gray-900 dark:text-gray-100">
  <header class="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
   <h2 class="text-lg font-medium">{starliEditing?'Edit Starli':'Create Starli'}</h2>
   <button type="button" class="rounded-lg p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="Close agent editor" on:click={()=>starliEditor=false}>✕</button>
  </header>
  <div class="max-h-[65vh] space-y-4 overflow-y-auto p-5">
   {#if starliEditor}<AvatarEditor bind:this={avatarEditor} agent={starliEditing} bind:shape={portraitShape} available={avatarsAvailable}/>{/if}
   <label class="block text-sm font-medium">Name<input bind:value={starliName} required minlength="2" maxlength="80" class="mt-1 w-full rounded-xl bg-gray-50 px-3 py-2 font-normal dark:bg-gray-850" placeholder="Name your Starli"/></label>
   <label class="block text-sm font-medium">Role<input bind:value={starliRole} required minlength="2" maxlength="120" class="mt-1 w-full rounded-xl bg-gray-50 px-3 py-2 font-normal dark:bg-gray-850" placeholder="Project engineer"/></label>
   <div class="grid grid-cols-2 gap-3">
    <label class="text-sm font-medium">Provider<select bind:value={starliProvider} on:change={()=>starliModel=providerDefault()} class="mt-1 w-full rounded-xl bg-gray-50 px-3 py-2 font-normal dark:bg-gray-850"><option value="account">Account provider and model</option><option value="hosted">Hosted Starli</option><option value="openrouter">OpenRouter</option></select></label>
    <label class="text-sm font-medium">Model<input list="starli-provider-models" placeholder={starliProvider==='account'?'Account default':'Exact model ID'} disabled={starliProvider==='account'} bind:value={starliModel} required maxlength="160" class="mt-1 w-full rounded-xl bg-gray-50 px-3 py-2 font-normal dark:bg-gray-850"/></label>
   </div>
   {#if $user?.role==='admin'}
    <div class="flex items-center justify-between gap-4 rounded-xl border border-gray-100 p-3 dark:border-gray-800">
     <span><span class="block text-sm font-medium">STARLI PLATFORM</span><span class="mt-1 block text-xs text-gray-500">Give this agent access to platform projects and engineering tools. Off keeps it in your customer workspace.</span></span>
     <Switch bind:state={starliPlatform} label="STARLI PLATFORM"/>
    </div>
   {/if}
   <label class="block text-sm font-medium">Instructions<textarea bind:value={starliInstructions} maxlength="5000" rows="4" class="mt-1 w-full rounded-xl bg-gray-50 px-3 py-2 font-normal dark:bg-gray-850" placeholder="Describe how this agent should help with customer projects."/></label>
  </div>
  <footer class="flex justify-end gap-2 border-t border-gray-100 px-5 py-4 dark:border-gray-800">
   <button type="button" on:click={()=>starliEditor=false} class="rounded-full px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
   <button type="submit" disabled={savingAgent} class="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900">{starliEditing?'Save':'Create'}</button>
  </footer>
 </form>
</Modal>

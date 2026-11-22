<script lang="ts">
 import Modal from '$lib/components/common/Modal.svelte';
 import StarliBrand from '$lib/components/starli-preview/StarliBrand.svelte';
 import XMark from '$lib/components/icons/XMark.svelte';
 export let show=false;
 const topics=[
  {title:'Start with Starli AI',text:'Write your request in the chat composer. Press Enter to send and Shift + Enter for a new line. Use New chat to start a fresh conversation.'},
  {title:'Keep your conversations',text:'Sign in to save your chats in your account. Guest conversations are temporary and do not appear in your saved history.'},
  {title:'Make it yours',text:'Open your profile menu, then My profile & preferences to manage your account, appearance, chat, voice and data preferences.'},
  {title:'Manage your data',text:'Use Data and privacy in Settings to export, archive or delete your saved conversations. A shared chat link can be viewed by anyone who has that link.'}
 ];
</script>
<Modal bind:show size="md">
 <div class="p-5 text-gray-900 dark:text-gray-100">
  <div class="flex items-center justify-between gap-4"><StarliBrand compact/><button type="button" aria-label="Close help" class="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800" on:click={()=>show=false}><XMark/></button></div>
  <h1 class="text-xl font-semibold mt-5 mb-1">Welcome to your workspace</h1>
  <p class="text-sm text-gray-500">A quick guide to STARLIDIGITAL.</p>
  <div class="mt-5 space-y-5">{#each topics as topic}<section><h2 class="text-sm font-medium">{topic.title}</h2><p class="text-sm text-gray-500 mt-1 leading-relaxed">{topic.text}</p></section>{/each}</div>
  <div class="flex justify-end mt-6"><button type="button" class="px-4 py-2 rounded-full bg-black text-white dark:bg-white dark:text-black text-sm font-medium" on:click={()=>show=false}>Got it</button></div>
 </div>
</Modal>

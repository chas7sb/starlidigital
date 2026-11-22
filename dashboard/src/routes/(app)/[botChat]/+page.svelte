<script lang="ts">
 import {page} from '$app/stores';
 import {chatIdFromPath} from '$lib/utils/starli-chat-url';
 import Chat from '$lib/components/chat/Chat.svelte';
 import Help from '$lib/components/layout/Help.svelte';
 $: id=chatIdFromPath($page.params.botChat);
</script>
{#if id}<Help/><Chat chatIdProp={id}/>{:else}<div class="m-auto p-8 text-sm text-gray-500">Conversation not found. <a class="underline" href="/">Open chat</a></div>{/if}

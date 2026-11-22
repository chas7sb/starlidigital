<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';
	import { showSettings, mobile, showSidebar, user, socket, config } from '$lib/stores';
	import { userSignOut } from '$lib/apis/auths';
	export let show = false;
	export let role = '';
	export let className = 'max-w-[280px]';
	const dispatch = createEventDispatcher();
	function close() { show = false; if ($mobile) showSidebar.set(false); }
	function preferences() { showSettings.set(true); close(); }
</script>

<DropdownMenu.Root bind:open={show} onOpenChange={(state) => dispatch('change', state)}>
	<DropdownMenu.Trigger><slot /></DropdownMenu.Trigger>
	<slot name="content">
		<DropdownMenu.Content class="w-72 {className} text-sm rounded-2xl p-2 z-50 bg-white dark:bg-gray-850 text-gray-900 dark:text-white shadow-lg border border-gray-100 dark:border-gray-800 font-primary" sideOffset={8} side="bottom" align="end" transition={(e) => fade(e, { duration: 100 })}>
			{#if $user?.id}
				<div class="flex items-center gap-3 px-3 py-3">
					<div class="size-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-semibold" aria-hidden="true">{($user.name || 'S').slice(0, 1).toUpperCase()}</div>
					<div class="min-w-0"><div class="font-semibold truncate">{$user.name}</div><div class="text-xs text-gray-500 truncate">{$user.email}</div></div>
				</div>
				<hr class="border-gray-100 dark:border-gray-800 my-1" />
				<button class="flex rounded-xl py-2.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800" on:click={preferences}>My profile &amp; preferences</button>
				<button class="flex rounded-xl py-2.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800" on:click={() => { dispatch('show', 'archived-chat'); close(); }}>Archived chats</button>
				{#if $user.role === 'admin'}
					<a class="flex rounded-xl py-2.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800" href="/starli/admin" on:click={close}>Platform administration</a>
				{/if}
				<hr class="border-gray-100 dark:border-gray-800 my-1" />
				<button class="flex rounded-xl py-2.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800" on:click={async () => {
					await userSignOut(); $socket?.disconnect(); user.set(null); localStorage.removeItem('token'); location.href = '/';
				}}>Sign out</button>
			{:else}
				<div class="px-3 py-3"><div class="font-semibold">Welcome to STARLIDIGITAL</div><p class="mt-1 text-xs text-gray-500">Sign in to save your chats and access your workspace.</p></div>
				<a class="flex rounded-xl py-2.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800" href="/auth" on:click={close}>Sign in</a>
				{#if $config?.features?.enable_signup}
					<a class="flex rounded-xl py-2.5 px-3 w-full bg-black text-white dark:bg-white dark:text-black" href="/auth?mode=signup" on:click={close}>Create account</a>
				{/if}
			{/if}
		</DropdownMenu.Content>
	</slot>
</DropdownMenu.Root>

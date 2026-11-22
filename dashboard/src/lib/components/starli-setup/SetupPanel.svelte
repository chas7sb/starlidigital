<script lang="ts">
 import { config, user } from '$lib/stores';
 import Providers from '$lib/components/chat/Settings/Providers.svelte';
 import StarliBrand from '$lib/components/starli-preview/StarliBrand.svelte';
 import LocalComputer from './LocalComputer.svelte';

 type ProviderState = { loaded: boolean; available: boolean; connected: number; selected: boolean; provider?: string; model?: string };
 let providerState: ProviderState = { loaded: false, available: false, connected: 0, selected: false };
 let accountId: string | undefined;
 $: if (accountId !== $user?.id) {
  accountId = $user?.id;
  providerState = { loaded: false, available: false, connected: 0, selected: false };
 }
 $: activeAccount = ['admin', 'user'].includes($user?.role);
</script>

<svelte:head><title>Local setup · StarliDigital</title></svelte:head>

<main class="min-h-screen overflow-y-auto bg-white px-4 py-8 text-gray-900 dark:bg-gray-900 dark:text-gray-100 sm:px-8">
 <div class="mx-auto max-w-4xl space-y-6">
  <header class="flex flex-wrap items-center justify-between gap-4">
   <StarliBrand />
   <a href="/" class="rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-850">Open dashboard</a>
  </header>
  <div>
   <h1 class="text-2xl font-semibold">Set up your local workspace</h1>
   <p class="mt-2 text-sm text-gray-500">Sign in, connect a model provider, then choose the model your agents will use. You can return to this page at any time.</p>
  </div>

  <section aria-labelledby="setup-account" class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800">
   <h2 id="setup-account" class="font-medium">1. Your account</h2>
   {#if activeAccount}
    <p class="mt-2 text-sm">Signed in as <span class="font-medium">{$user.name || $user.email}</span>.</p>
    <p class="mt-1 text-xs text-gray-500">Provider connections below belong to this account.</p>
   {:else if $user}
    <p class="mt-2 text-sm">This account is awaiting access. Ask the installation administrator to activate it, then sign in again.</p>
    <a href="/auth?redirect=%2Fsetup" class="mt-3 inline-block text-sm underline">Return to sign-in</a>
   {:else}
    <p class="mt-2 text-sm">Sign in to this installation before connecting a provider.</p>
    {#if $config?.onboarding && $config?.features?.enable_signup}
     <p class="mt-1 text-xs text-gray-500">This is a new installation. Create its first account to become the administrator.</p>
     <a href="/auth?mode=signup&redirect=%2Fsetup" class="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">Create administrator account</a>
    {:else}
     <a href="/auth?redirect=%2Fsetup" class="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">Sign in</a>
     <p class="mt-3 text-xs text-gray-500">If no account exists and signup is disabled, follow the local account-provisioning instructions in the installation guide.</p>
    {/if}
   {/if}
  </section>

  <section aria-labelledby="setup-provider" class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800">
   <h2 id="setup-provider" class="font-medium">2. Connect a provider and choose a model</h2>
   <p class="mb-5 mt-2 text-sm text-gray-500">Choose a provider, complete an available sign-in or API-key flow, then select a chat model. Authentication options come from the installed runtime.</p>
   {#if activeAccount}
    {#key $user.id}
     <Providers on:state={(event) => providerState = event.detail} />
    {/key}
   {:else}
    <p class="text-sm text-gray-500">Provider connections are available after your account is active.</p>
   {/if}
  </section>

  <LocalComputer />

  <section aria-labelledby="setup-next" class="rounded-2xl border border-gray-100 p-5 dark:border-gray-800">
   <h2 id="setup-next" class="font-medium">3. Try your workspace</h2>
   {#if activeAccount && providerState.loaded && providerState.available && providerState.selected}
    <p role="status" class="mt-2 text-sm">Saved default: <span class="font-medium">{providerState.provider} / {providerState.model}</span>.</p>
    <p class="mt-2 text-xs text-gray-500">Credentials are saved and a model is selected. Send a message in chat to check that the provider can respond; setup does not run an inference request.</p>
   {:else if activeAccount && providerState.loaded && !providerState.available}
    <p role="status" class="mt-2 text-sm">Provider status is unavailable. Check the error above and use Refresh before continuing.</p>
   {:else if activeAccount && providerState.loaded}
    <p role="status" class="mt-2 text-sm">{providerState.connected ? 'Credentials are saved. Select a chat model above to set your default.' : 'No provider credentials are saved for this account yet.'}</p>
   {:else}
    <p class="mt-2 text-sm text-gray-500">Your selected account model will appear here after connecting.</p>
   {/if}
   <a href="/" class="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-gray-900">{activeAccount && providerState.selected ? 'Open chat' : 'Explore dashboard'}</a>
   <p class="mt-3 text-xs text-gray-500">Email, social accounts, publishing and computer-use services have their own connection requirements. This page does not mark those services as configured.</p>
  </section>
 </div>
</main>

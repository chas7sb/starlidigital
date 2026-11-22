<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchStarliOverview } from '$lib/apis/starli';

  export let section: string;

  type StarliOverview = {
    company: { id: string; name: string } | null;
    agents: Array<{ id: string; name: string; status: string }>;
    tools: Array<{ id: string; name: string; description?: string }>;
    browser: { available: boolean; reason?: string };
    credits: { available: boolean; balance: number | null; unit: string };
    readOnly: boolean;
  };

  let overview: StarliOverview | null = null;
  let loading = true;
  let error = '';
  let requestController: AbortController | null = null;

  async function loadOverview() {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    loading = true;
    error = '';

    try {
      const token = localStorage.token;
      if (!token) throw new Error('Your session token is not available. Sign in and try again.');
      overview = await fetchStarliOverview(token, controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted) {
        error = cause instanceof Error ? cause.message : 'Unable to load Starli resources.';
      }
    } finally {
      if (!controller.signal.aborted) loading = false;
    }
  }

  onMount(() => {
    void loadOverview();
    return () => requestController?.abort();
  });

  $: title = section === 'company' ? 'Company'
    : section === 'agents' ? 'Agents'
    : section === 'tools' ? 'Tools'
    : section === 'browser' ? 'Browser'
    : section === 'billing' ? 'Billing'
    : 'Starli resources';
</script>

<section class="p-4 space-y-4" aria-labelledby="starli-resource-heading">
  <header class="flex items-center justify-between gap-3">
    <h1 id="starli-resource-heading" class="text-xl font-semibold">{title}</h1>
    {#if overview?.readOnly}
      <p class="text-sm text-gray-500" role="status">Read-only</p>
    {/if}
  </header>

  {#if loading}
    <p class="text-sm text-gray-500" role="status" aria-live="polite">Loading {title.toLowerCase()}…</p>
  {:else if error}
    <div class="space-y-3" role="alert">
      <p>{error}</p>
      <button class="btn" type="button" on:click={loadOverview}>Retry</button>
    </div>
  {:else if overview}
    {#if overview.readOnly}
      <p class="text-sm text-gray-500">This information is read-only.</p>
    {/if}

    {#if section === 'company'}
      {#if overview.company}
        <ul class="list-disc pl-5">
          <li><span class="font-medium">{overview.company.name}</span> <span class="text-sm text-gray-500">({overview.company.id})</span></li>
        </ul>
      {:else}
        <p class="text-sm text-gray-500">No company information is available.</p>
      {/if}
    {:else if section === 'agents'}
      {#if overview.agents.length}
        <ul class="divide-y divide-gray-200">
          {#each overview.agents as agent (agent.id)}
            <li class="py-3">
              <h2 class="font-medium">{agent.name}</h2>
              <p class="text-sm text-gray-500">Status: {agent.status}</p>
              <p class="text-xs text-gray-500">ID: {agent.id}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-gray-500">No agents are available.</p>
      {/if}
    {:else if section === 'tools'}
      {#if overview.tools.length}
        <ul class="divide-y divide-gray-200">
          {#each overview.tools as tool (tool.id)}
            <li class="py-3">
              <h2 class="font-medium">{tool.name}</h2>
              {#if tool.description}<p class="text-sm text-gray-500">{tool.description}</p>{/if}
              <p class="text-xs text-gray-500">ID: {tool.id}</p>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-gray-500">No tools are available. Open the native Tools workspace to configure tools.</p>
      {/if}
    {:else if section === 'browser'}
      <h2 class="font-medium">Browser availability</h2>
      {#if overview.browser.available}
        <p>Available</p>
      {:else}
        <p class="text-sm text-gray-500">Unavailable{#if overview.browser.reason}: {overview.browser.reason}{/if}</p>
      {/if}
    {:else if section === 'billing'}
      <h2 class="font-medium">Credits</h2>
      {#if !overview.credits.available}
        <p class="text-sm text-gray-500">Credit information is unavailable.</p>
      {:else if overview.credits.balance === null}
        <p class="text-sm text-gray-500">A credit balance is not available.</p>
      {:else}
        <p>{overview.credits.balance} {overview.credits.unit}</p>
      {/if}
    {:else}
      <p class="text-sm text-gray-500">Choose a company, agents, tools, browser, or billing section.</p>
    {/if}
  {/if}
</section>

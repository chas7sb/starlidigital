<script>
  import { mobile, showSidebar, user } from '$lib/stores';
  import { page } from '$app/stores';

  export let compact = false;

  const primary = [
    { label: 'Chat', href: '/' },
    { label: 'Company', href: '/starli/company' },
    { label: 'Projects', href: '/starli/projects' },
    { label: 'CRM', href: '/starli/crm' },
    { label: 'Social media', href: '/starli/social' },
    { label: 'Browser', href: '/starli/browser' }
  ];
  const business = [
    { label: 'Proposals', href: '/starli/proposals' },
    { label: 'Mailbox', href: '/starli/mailbox' },
    { label: 'Hosted agents', href: '/starli/hosted-agents' },
    { label: 'Video studio', href: '/starli/videos' },
    { label: 'Activity', href: '/starli/activity' }
  ];
  const platform = [
    { label: 'Tools', href: '/starli/tools' },
    { label: 'Action reviews', href: '/starli/approvals' },
    { label: 'Billing', href: '/starli/billing' },
    { label: 'Admin', href: '/starli/admin', adminOnly: true }
  ];

  $: path = $page.url.pathname;
  $: plat = platform.filter((l) => !l.adminOnly || $user?.role === 'admin');

  function isActive(href, pathname) {
    return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  }
  function close() {
    if ($mobile) showSidebar.set(false);
  }
  function cls(active) {
    return `flex items-center rounded-md font-medium transition-colors hover:bg-gray-100 hover:text-gray-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 dark:hover:bg-gray-800 dark:hover:text-white ${compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'} ${active ? 'bg-gray-100 text-gray-950 dark:bg-gray-800 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`;
  }
</script>

{#if ['admin','user'].includes($user?.role)}
<nav aria-label="Starli" class="max-h-40 w-full overflow-y-auto">
  <ul class="m-0 flex list-none flex-col gap-1 p-0">
    {#each primary as link (link.href)}
      {@const active = isActive(link.href, path)}
      <li>
        <a href={link.href} on:click={close} aria-current={active ? 'page' : undefined} class={cls(active)}>{link.label}</a>
      </li>
    {/each}
    <li>
      <details open={business.some((l) => isActive(l.href, path))}>
        <summary class={`cursor-pointer rounded-md font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 dark:text-gray-300 dark:hover:bg-gray-800 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}>Business</summary>
        <ul class="m-0 list-none p-0">
          {#each business as link (link.href)}
            {@const active = isActive(link.href, path)}
            <li><a href={link.href} on:click={close} aria-current={active ? 'page' : undefined} class={cls(active)}>{link.label}</a></li>
          {/each}
        </ul>
      </details>
    </li>
    <li>
      <details open={plat.some((l) => isActive(l.href, path))}>
        <summary class={`cursor-pointer rounded-md font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 dark:text-gray-300 dark:hover:bg-gray-800 ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}`}>Platform</summary>
        <ul class="m-0 list-none p-0">
          {#each plat as link (link.href)}
            {@const active = isActive(link.href, path)}
            <li><a href={link.href} on:click={close} aria-current={active ? 'page' : undefined} class={cls(active)}>{link.label}</a></li>
          {/each}
        </ul>
      </details>
    </li>
  </ul>
</nav>
{/if}

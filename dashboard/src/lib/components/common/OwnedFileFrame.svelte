<script lang="ts">
 import { WEBUI_BASE_URL } from '$lib/constants';
 import { safeOwnedFileUrl } from '$lib/utils/safe-render';
 export let src: string | null = null;
 export let title = 'File preview';
 $: safeSrc = safeOwnedFileUrl(src, WEBUI_BASE_URL);
</script>

{#if safeSrc}
 <div class="my-2 h-96 min-h-48 w-full resize-y overflow-hidden rounded-lg border border-gray-100 dark:border-gray-800">
  <iframe src={safeSrc} {title} class="h-full w-full border-0" sandbox="allow-scripts allow-downloads" referrerpolicy="no-referrer" loading="lazy"></iframe>
 </div>
{/if}

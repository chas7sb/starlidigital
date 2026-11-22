<script lang="ts">
 export let compact = false;
 export let iconOnly = false;
</script>

<span class="inline-flex shrink-0 items-center gap-2.5 text-gray-900 dark:text-gray-100" aria-label="STARLIDIGITAL">
 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" class={compact ? 'size-6' : 'size-8'} aria-hidden="true">
  <rect x="1" y="1" width="62" height="62" rx="17" class="fill-gray-900 dark:fill-gray-100" />
  <path d="M32 11C34.1 24.2 39.8 29.9 53 32C39.8 34.1 34.1 39.8 32 53C29.9 39.8 24.2 34.1 11 32C24.2 29.9 29.9 24.2 32 11Z" class="fill-white dark:fill-gray-900" />
  <path d="M44 10h7v7h-7z" class="fill-white dark:fill-gray-900" />
 </svg>
 {#if !iconOnly}<span class={compact ? 'text-[10px] font-semibold tracking-[0.14em]' : 'text-sm font-semibold tracking-[0.14em]'}>STARLIDIGITAL</span>{/if}
</span>

<script lang="ts">
 export let name: string;
 export let size = 20;
 const paths: Record<string,string> = {
 home:'M3 10 12 3l9 7v10H6V10m4 10v-7h5v7',
 chat:'M21 11a8 8 0 0 1-8 8H8l-5 3 1.4-6A8 8 0 0 1 3 11a9 8 0 0 1 18 0Z',
 agents:'m12 2 2.4 7.5L22 12l-7.6 2.5L12 22l-2.4-7.5L2 12l7.6-2.5Z',
 projects:'M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11H3Z',
 automations:'m13 2-9 12h7l-1 8L21 9h-8Z',
 integrations:'m10 7 2-2a4 4 0 0 1 6 6l-4 4m0 2-2 2a4 4 0 0 1-6-6l4-4m-1 6 6-6',
 billing:'M3 5h18v14H3Zm0 5h18m-6 5h3',
 search:'M16 16l5 5m-3-11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
 bell:'M5 16c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7l1 1H4Zm5 4a2 2 0 0 0 4 0',
 account:'M4 21V4h11v17m0-12h5v12M2 21h20M8 8h2m-2 4h2m-2 4h2',
 down:'m6 9 6 6 6-6',arrow:'M4 12h15m-6-6 6 6-6 6',plus:'M12 5v14M5 12h14',
 close:'m6 6 12 12M18 6 6 18',menu:'M3 6h18M3 12h18M3 18h18',
 globe:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20m-10-10c6 6 6 14 0 20-6-6-6-14 0-20Z',
 computer:'M2 4h20v13H2Zm10 13v4m-5 0h10',tasks:'m3 6 1 1 3-3m2 3h12M3 13l1 1 3-3m2 3h12M3 20l1 1 3-3m2 3h12',
 files:'M6 2h8l5 5v15H6Zm7 0v6h6',groups:'M15 21v-2a5 5 0 0 0-10 0v2m8-14a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm4-3a3 3 0 0 1 0 6m0 4c3 0 5 2 5 5v2',
 expand:'M14 3h7v7m0-7-8 8M3 14v7h7m-7 0 8-8',minus:'M5 12h14',edit:'m4 16 12-12 4 4L8 20l-5 1Zm10-10 4 4',
 more:'M4 12h.1m7.9 0h.1m7.9 0h.1',layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 book:'M3 4c4-1 6-1 9 1 3-2 5-2 9-1v15c-4-1-6-1-9 1-3-2-5-2-9-1Zm9 1v15',star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',spark:'m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',check:'m4 12 5 5L20 6',settings:'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-8 0v6'
 };
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={name==='more'?3.5:1.7} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>

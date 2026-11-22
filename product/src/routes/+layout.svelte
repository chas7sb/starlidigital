<script lang="ts">
 import {onMount} from 'svelte';
 import {page} from '$app/stores';
 import {browser} from '$app/environment';
 import '../tailwind.css';
 import '../app.css';

 $: enterprise=$page.url.pathname==='/' || $page.url.pathname==='/guest' || $page.url.pathname.startsWith('/register') || $page.url.pathname.startsWith('/join') || $page.url.pathname.startsWith('/app') || $page.url.pathname.startsWith('/enterprise');
 $: if(browser) document.documentElement.classList.toggle('marketing-home', $page.url.pathname==='/');
 onMount(()=>{
  if(enterprise){
   document.documentElement.classList.remove('dark');
   document.documentElement.style.colorScheme='light';
   document.getElementById('splash-screen')?.remove();
  }
 });
</script>
<slot />

<style>
 :global(html.marketing-home){overflow-y:auto!important;overflow-x:hidden; height:auto;min-height:100%}
 :global(html.marketing-home body){overflow:visible;height:auto;min-height:100vh}
</style>

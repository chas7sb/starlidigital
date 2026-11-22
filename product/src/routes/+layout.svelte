<script lang="ts">
 import {onMount} from 'svelte';
 import SelfHostGate from '$lib/components/enterprise/SelfHostGate.svelte';
 import '../tailwind.css';
 import '../app.css';
 onMount(()=>{document.documentElement.classList.remove('dark','marketing-home');document.documentElement.style.colorScheme='light';document.getElementById('splash-screen')?.remove();});
</script>
<SelfHostGate><slot /></SelfHostGate>

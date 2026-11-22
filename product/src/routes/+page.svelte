<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores';
  import Homepage from '$lib/components/marketing/Homepage.svelte';
  import type { HomepageLoadData } from './+page';

  export let data: HomepageLoadData = { bossIntakeEnabled: false, grokbot1WireEnabled: false };

  async function hydrateSession() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      user.set(undefined);
      return;
    }
    try {
      const r = await fetch('/api/v1/auths/', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (r.ok) {
        const me = await r.json();
        if (me && typeof me.id === 'string') user.set(me);
      } else if (r.status === 401) {
        user.set(undefined);
      }
    } catch {
      // Non-fatal: unauthenticated guest mode continues
    }
  }

  onMount(() => {
    void hydrateSession();
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === 'token') void hydrateSession();
    };
    const onSessionUpdated = () => {
      void hydrateSession();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('starli-session-updated', onSessionUpdated);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('starli-session-updated', onSessionUpdated);
    };
  });

</script>
<Homepage
  bossIntakeEnabled={data.bossIntakeEnabled}
/>

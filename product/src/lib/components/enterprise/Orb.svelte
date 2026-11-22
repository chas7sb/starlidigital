<script lang="ts">
 import AvatarRenderer from './avatar-studio/AvatarRenderer.svelte';
 export let size=32;
 export let index=0;
 export let name='';
 export let avatarKey='';
</script>
<AvatarRenderer {size} {index} {name} {avatarKey}/>

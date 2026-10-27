<script lang="ts">
 import {onMount} from 'svelte';
 import {page} from '$app/stores';
 import {goto} from '$app/navigation';
 onMount(()=>{void goto(`/n/${$page.params.novelId}/plots${$page.url.search}`,{replaceState:true});});
</script>
<p>Opening Grand plot &amp; subplots…</p>

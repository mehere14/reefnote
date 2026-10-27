<script lang="ts">
 import {renderMarkdown} from '$lib/markdown';
 export let text='';
 export let interactive=true;
 $: html=renderMarkdown(text,interactive);
</script>
<div class="markdown">{@html html}</div>

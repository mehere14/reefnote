<script lang="ts">
 import Markdown from './Markdown.svelte';
 export let request:any;
 $: sent=JSON.parse(request.prompt);
 $: context=sent.context||{};
 const labels:Record<string,string>={subplot:'Plot premise and turning points',current_turning_point:'Current turning point and sibling summaries',element:'Scene plan',plot_scenes:'All plot scenes · full prose in story order',continuity_instruction:'Continuity instructions',previous:'Previous scene',next:'Next scene plan',cards:'Linked reference cards',linked_elements:'Linked scene summaries',style:'Writing style'};
 function readable(value:any):string{if(typeof value==='string'){try{return JSON.stringify(JSON.parse(value),null,2);}catch{return value;}}return JSON.stringify(value,null,2);}
</script>
<div class="request-context">
 <p><b>{context.element?.title||'Scene conversation'}</b> · {request.model}{#if context.element?.target_length} · Target: {context.element.target_length.toLocaleString()} words{/if}</p>
 <p class="note">Sent the scene plan, plot and turning-point context, all plot scenes with full saved prose, linked cards, writing style, and {sent.conversation?.length||0} recent conversation messages.</p>
 {#each Object.entries(labels) as [key,label]}{#if context[key]}<details><summary>{label}</summary><pre>{readable(context[key])}</pre></details>{/if}{/each}
 {#if sent.target_prose}<details><summary>Current scene prose</summary><Markdown text={sent.target_prose}/></details>{/if}
 {#if sent.conversation?.length}<details><summary>Conversation sent</summary>{#each sent.conversation as message}<p><b>{message.role}</b></p><Markdown text={message.text}/>{/each}</details>{/if}
 <details><summary>Exact request and instructions</summary><pre>{JSON.stringify(sent,null,2)}</pre><pre>{request.system}</pre></details>
</div>
<style>
 .request-context{font-size:13px;overflow-wrap:anywhere}.request-context p{line-height:1.5}.note{color:var(--dim)}details{margin:8px 0}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 var(--mono,monospace);max-height:320px;overflow:auto}
</style>

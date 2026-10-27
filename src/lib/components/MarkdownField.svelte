<script lang="ts">
 import { tick } from 'svelte';
 import Markdown from './Markdown.svelte';
 export let value='';
 export let id: string | undefined=undefined;
 export let label='Text';
 export let onInput:(text:string)=>void=()=>{};
 export let onBlur:(text:string)=>void=()=>{};
 let className='';
 export {className as class};
 let editing=false, input:HTMLTextAreaElement;
 async function edit(){editing=true;await tick();input?.focus();}
 // Clicking rendered text opens the editor, except when the click is on a link inside it.
 function previewClick(e:MouseEvent){if(!(e.target as HTMLElement).closest('a'))void edit();}
</script>
<div class="markdown-field">
 <div class="markdown-field-toolbar">
  <button type="button" class="chip" aria-pressed={!editing} on:click={()=>editing=false}>Preview</button>
  <button type="button" class="chip" aria-pressed={editing} on:click={edit}>Edit</button>
 </div>
 {#if editing}
  <textarea {...$$restProps} {id} class={'ta '+className} aria-label={label} bind:this={input} bind:value on:input={(e)=>onInput(e.currentTarget.value)} on:blur={(e)=>onBlur(e.currentTarget.value)}></textarea>
 {:else}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (the Edit button is the keyboard path; click-to-edit is a pointer shortcut) -->
  <div {id} class="markdown-field-preview" class:filled={!!value} role="region" aria-label={label} title={value?'Click to edit':undefined} on:click={previewClick}>
   {#if value}<Markdown text={value}/>{:else}<button type="button" class="plain add-text" on:click|stopPropagation={edit}>Add text…</button>{/if}
  </div>
 {/if}
</div>

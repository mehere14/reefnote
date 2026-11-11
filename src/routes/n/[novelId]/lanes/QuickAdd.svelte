<script lang="ts">
 // Inline add on the lane grid: place something that already exists (a whole plot, a turning point,
 // an unplaced event or beat), or type a title to create a new one.
 import {createEventDispatcher,onMount} from 'svelte';
 export let placeholder='What changes?';
 export let groups:Array<{label:string;items:Array<{value:string;title:string}>}>=[];
 export let existingLabel='Or place an existing one';
 const dispatch=createEventDispatcher<{create:string;pick:string;cancel:void}>();
 let title='',form:HTMLFormElement,input:HTMLInputElement,done=false;
 $: shown=groups.filter(g=>g.items.length);
 function finish(kind:'create'|'pick'|'cancel',value=''){if(done)return;done=true;if(kind==='create')dispatch('create',value);else if(kind==='pick')dispatch('pick',value);else dispatch('cancel');}
 function submit(){title.trim()?finish('create',title.trim()):finish('cancel');}
 // Close only when focus leaves the whole form, so the picker stays usable.
 function focusout(e:FocusEvent){if(form.contains(e.relatedTarget as Node))return;submit();}
 const escape=(e:KeyboardEvent)=>e.key==='Escape'&&finish('cancel');
 onMount(()=>input?.focus());
</script>

<form class="quick" bind:this={form} on:submit|preventDefault={submit} on:focusout={focusout}>
 <input bind:this={input} on:keydown={escape} aria-label="New title" {placeholder} bind:value={title}/>
 {#if shown.length}
  <select on:keydown={escape} aria-label={existingLabel} on:change={e=>e.currentTarget.value&&finish('pick',e.currentTarget.value)}>
   <option value="">{existingLabel}…</option>
   {#each shown as g}<optgroup label={g.label}>{#each g.items as o}<option value={o.value}>{o.title}</option>{/each}</optgroup>{/each}
  </select>
 {/if}
</form>

<style>
 .quick{display:flex;flex-direction:column;gap:6px;width:100%}
 input,select{width:100%;padding:6px 8px;border:1px solid var(--accent);border-radius:var(--radius-s);background:var(--paper);color:var(--ink);font:inherit;font-size:13px}
 select{border-color:var(--line);font-size:12.5px}
</style>

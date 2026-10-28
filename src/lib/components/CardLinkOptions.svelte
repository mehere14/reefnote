<script lang="ts">
 export let cards:{id:string;title:string;type:string}[]=[];
 const names:Record<string,string>={character:'Characters',group:'Groups',relationship:'Relationships',arc:'Character arcs',premise:'Premise',outline:'Outlines',setting:'Settings',rule:'Rules',object:'Objects',event:'Timeline events',style:'Voice & Style',plot:'Plots',secret:'Secrets',theme:'Themes',question:'Open questions',chapter:'Chapters',scene:'Scenes',beat:'Beats'};
 const order=Object.keys(names);
 $: types=[...order,...new Set(cards.map(c=>c.type).filter(type=>!order.includes(type)))];
 $: groups=types.map(type=>({type,label:names[type]||type,cards:cards.filter(c=>c.type===type).sort((a,b)=>a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'}))})).filter(group=>group.cards.length);
</script>

{#each groups as group,i}
 {#if i>0}<hr />{/if}
 <optgroup label={group.label}>
  {#each group.cards as card}<option value={card.id}>{card.title}</option>{/each}
 </optgroup>
{/each}

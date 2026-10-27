<script lang="ts">
 import {api} from '$lib/api';
 export let card:any;
 let rows:any[]=[],loaded='',error='';
 $: if(card&&loaded!==card.id+':'+card.rev){loaded=card.id+':'+card.rev;void api(`/cards/${card.id}/impact`).then(value=>rows=value).catch(e=>error=e.message);}
</script>
<section class="appearances"><h3>Appears in · {rows.length}</h3>{#if error}<p role="alert">{error}</p>{/if}{#each [...new Set<string>(rows.map(r=>r.subplot_title))] as group}<h4>{group}</h4>{#each rows.filter(r=>r.subplot_title===group) as row}<a href={`/n/${card.novel_id}/${row.subplot_id?'plots?subplot='+row.subplot_id+'&element='+row.element_id:'chapters/'+row.element_id}`}>{row.title} · {row.role.replaceAll('_',' ')} · {row.mentions.length} mentions</a>{/each}{:else}<p>No indexed appearances yet.</p>{/each}<a href={`/n/${card.novel_id}/plots?impact=${card.id}`}>Review impact / propose rewrites</a></section>
<style>.appearances{padding:16px 0;border-bottom:1px solid var(--line)}h3{font:500 22px var(--serif)}h4{margin-bottom:8px}a{display:block;font:12px/1.7 var(--ui);margin:5px 0}</style>

<script lang="ts">
 export let versions:any[]=[];
 export let onRestore:(version:any)=>void;
</script>
<p class="note">Every change has a past. Restore a version to bring it back.</p>
{#each versions as v}
 <div class="version"><div>{v.note}<span>{new Date(v.created_at).toLocaleString()} · {v.source}</span></div><button class="btn sm ghost" on:click={()=>onRestore(v)}>Restore</button></div>
{:else}<p class="note">No saved versions yet.</p>{/each}
<style>
 .version{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--line)}
 span{display:block;font-size:12px;color:var(--dim)}
</style>

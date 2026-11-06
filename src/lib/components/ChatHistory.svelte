<script lang="ts">
 import {api} from '$lib/api';
 export let novelId:string;
 export let scope:string;
 export let disabled=false;
 export let onResume:()=>Promise<void>;
 let open=false, loading=false, switching=false, error='', chats:any[]=[];
 let trigger:HTMLButtonElement;
 async function toggle(){
  open=!open;if(!open)return;
  loading=true;error='';
  try{chats=await api(`/novels/${novelId}/chats?scope=${encodeURIComponent(scope)}`);}catch(e){error=(e as Error).message;}finally{loading=false;}
 }
 async function resume(id:string){
  switching=true;error='';
  try{await api(`/novels/${novelId}/chats/${id}/resume`,'POST',{});await onResume();open=false;trigger?.focus();}catch(e){error=(e as Error).message;}finally{switching=false;}
 }
</script>
<svelte:window on:keydown={(e)=>{if(open&&e.key==='Escape'){open=false;trigger?.focus();}}}/>
<div class="chat-history">
 <button bind:this={trigger} class="history-trigger" aria-label="Chat history" title="Chat history" aria-expanded={open} disabled={disabled||switching} on:click={toggle}>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7M12 7v5l3 2"/></svg>
 </button>
 {#if open}
 <section class="history-panel" aria-label="Previous chats">
  <header><strong>Chat history</strong><button aria-label="Close chat history" on:click={()=>{open=false;trigger?.focus();}}>×</button></header>
  <p>Reopen a conversation to continue it. Your current chat will be saved here.</p>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if loading}<p role="status">Loading chats…</p>{:else if !chats.length}<p>No previous chats for this card yet.</p>{:else}
   <div class="history-list">{#each chats as chat}<button class="history-chat" disabled={disabled||switching} on:click={()=>resume(chat.id)}><time datetime={new Date(chat.created_at).toISOString()}>{new Date(chat.created_at).toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</time><span>{chat.preview||'Empty conversation'}</span><small>{chat.message_count} messages · Reopen chat</small></button>{/each}</div>
  {/if}
 </section>
 {/if}
</div>
<style>
 .chat-history{position:relative;display:inline-flex;font-weight:400}
 button{font:inherit;color:var(--ink);cursor:pointer}button:disabled{opacity:.5;cursor:default}
 .history-trigger{display:grid;place-items:center;min-width:34px;min-height:34px;border:1px solid var(--line);border-radius:8px;background:var(--paper)}
 .history-panel{position:absolute;right:0;top:calc(100% + 8px);z-index:30;width:min(330px,calc(100vw - 40px));padding:16px;border:1px solid var(--line);border-radius:12px;background:var(--paper);box-shadow:0 12px 36px #0002;text-align:left;white-space:normal}
 header{display:flex;align-items:center;justify-content:space-between;gap:12px}header button{background:none;border:0;font-size:22px;min-width:32px;min-height:32px}
 p{font-size:12px;line-height:1.5;color:var(--dim);margin:8px 0 12px}.history-list{max-height:45dvh;overflow:auto;display:grid;gap:8px}
 .history-chat{display:flex;flex-direction:column;gap:7px;text-align:left;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--soft);overflow-wrap:anywhere}.history-chat:hover{border-color:var(--accent)}time,small{font-size:11px;color:var(--dim)}.history-chat span{font-size:13px;line-height:1.5}
</style>

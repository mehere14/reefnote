<script lang="ts">
 import {onMount} from 'svelte';
 import {page} from '$app/stores';
 import {api} from '$lib/api';
 import Markdown from '$lib/components/Markdown.svelte';
 let mounted=false, chats:any[]=[], novel:any=null, selected:any=null, messages:any[]=[], loading=true, error='', filter='';
 let loaded='', requestVersion=0;
 $: novelId=$page.params.novelId;
 $: chatId=$page.url.searchParams.get('chat')||'';
 $: routeKey=novelId+'/'+chatId;
 $: if(mounted&&novelId&&loaded!==routeKey){loaded=routeKey;void load(novelId,chatId);}
 $: filtered=chats.filter(c=>`${c.card_name} ${c.card_type} ${c.scope} ${c.id} ${date(c.created_at)}`.toLowerCase().includes(filter.toLowerCase()));
 function date(value:number){return new Date(value).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});}
 async function load(id:string,chat:string){
  const version=++requestVersion;loading=true;error='';selected=null;messages=[];
  try{
   const [novels,all,detail]=await Promise.all([api('/novels'),api(`/novels/${id}/chats`),chat?api(`/novels/${id}/chats/${encodeURIComponent(chat)}`):Promise.resolve(null)]);
   if(version!==requestVersion)return;
   novel=novels.find((n:any)=>n.id===id);chats=all.filter((c:any)=>c.archived_at!=null);selected=detail?.chat;messages=detail?.messages||[];
  }catch(e:any){if(version===requestVersion)error=e.message;}finally{if(version===requestVersion)loading=false;}
 }
 onMount(()=>{mounted=true;const theme=localStorage.getItem('novel-theme');if(theme)document.documentElement.dataset.theme=theme;});
</script>

<svelte:head><title>Chat archive · {novel?.title||'Reefnote'}</title></svelte:head>
<div class="archive-page">
 <header class="archive-header"><a href={`/n/${novelId}/chapters`}>← Back to story</a><p>{novel?.title||'Reefnote'}</p><h1>Chat archive</h1><p>Previous conversations, including chats from deleted cards.</p></header>
 <main class:has-chat={!!chatId}>
  <aside aria-label="Archived chats"><label for="archive-search">Find a chat</label><input id="archive-search" type="search" placeholder="Search name, type, date or ID…" bind:value={filter}/><p class="count-label">{filtered.length} archived {filtered.length===1?'chat':'chats'}</p>
   <nav aria-label="Archive conversations">{#each filtered as chat}<a class="archive-item" class:active={chat.id===chatId} aria-current={chat.id===chatId?'page':undefined} href={`/n/${novelId}/archive?chat=${encodeURIComponent(chat.id)}`}><time datetime={new Date(chat.created_at).toISOString()}>{date(chat.created_at)}</time><strong>{chat.card_name}</strong><span class="card-type">{chat.card_type}</span><small>Card ID: {chat.scope}</small><small>Chat ID: {chat.id}</small></a>{/each}</nav>
   {#if !loading&&!filtered.length}<p class="empty">{filter?'No chats match your search.':'No archived chats yet. Start a new chat under a card to archive its previous conversation.'}</p>{/if}
  </aside>
  <section class="conversation" aria-label="Archived conversation" aria-busy={loading}>
   {#if error}<p role="alert">{error}</p>{:else if loading}<p class="empty" role="status">Loading archive…</p>{:else if selected}<a class="back-list" href={`/n/${novelId}/archive`}>← All archived chats</a><header class="conversation-header"><p>{selected.card_type} · Started {date(selected.created_at)}</p><h2>{selected.card_name}</h2><small>Card ID: {selected.scope}</small><small>Chat ID: {selected.id}</small></header>
    {#each messages as message}<article class="archive-message" class:writer={message.role==='user'}><h3>{message.role==='user'?'You':'Co-writer'}</h3><Markdown text={message.text}/></article>{/each}
    {#if !messages.length}<p class="empty">This chat had no messages.</p>{/if}
   {:else}<div class="empty"><h2>Your past conversations</h2><p>Select a chat to read its full history.</p></div>{/if}
  </section>
 </main>
</div>

<style>
 .archive-page{height:100dvh;display:flex;flex-direction:column;background:var(--paper)}
 .archive-header{padding:24px 32px;border-bottom:1px solid var(--line);flex-shrink:0}
 a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
 h1{font:500 36px var(--serif);margin:8px 0}p{margin:6px 0;color:var(--dim)}
 main{display:grid;grid-template-columns:340px minmax(0,1fr);min-height:0;flex:1}
 aside{padding:24px;overflow:auto;border-right:1px solid var(--line);background:var(--soft)}
 label{display:block;font-weight:600;margin-bottom:8px}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font:inherit}
 .count-label{font-size:12px;margin:12px 0}.archive-item{display:flex;flex-direction:column;gap:6px;padding:16px;margin-bottom:10px;border:1px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);overflow-wrap:anywhere}
 .archive-item:hover,.archive-item.active{border-color:var(--accent);text-decoration:none}.archive-item.active{box-shadow:inset 3px 0 var(--accent)}
 time,.card-type,small{font-size:12px;color:var(--dim)}strong{font-size:16px}small{display:block;overflow-wrap:anywhere}
 .conversation{overflow:auto;padding:32px max(24px,calc((100% - 820px)/2));min-width:0}.conversation-header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:24px}h2{font:500 30px var(--serif);margin:8px 0 12px}
 .archive-message{padding:20px 0;overflow-wrap:anywhere}.archive-message.writer{background:var(--soft);padding:20px;border-radius:12px;margin:12px 0}.archive-message h3{font-size:12px;color:var(--dim);margin:0 0 12px}.empty{padding:24px 0;line-height:1.7}.back-list{display:inline-block;margin-bottom:20px}
 @media(max-width:700px){.archive-header{padding:20px}main{grid-template-columns:minmax(0,1fr)}aside{border-right:0}.conversation{display:none;padding:20px}main.has-chat aside{display:none}main.has-chat .conversation{display:block}h1{font-size:30px}}
</style>

<script lang="ts">
 import { onMount } from 'svelte';
 import { EditorState, Compartment } from '@codemirror/state';
 import { EditorView, keymap } from '@codemirror/view';
 import { api } from '$lib/api';
 import { beforeNavigate, goto } from '$app/navigation';
 export let sceneId:string;
 export let onSaved: () => void = () => {};
 let host: HTMLDivElement; let view:EditorView; let rev=1; let saved=''; let state='Loading prose…'; let timer:ReturnType<typeof setTimeout>; let busy=false; let hint=true; let alive=true;let pending:Promise<void>|null=null;let navigating=false;const editable=new Compartment();
 async function persist(snapshot=false){
  if(!view)return; const text=view.state.doc.toString(); if(text===saved&&!snapshot)return; busy=true;state='Saving…';
  try{let result;
   if(saved.length>200000){let from=0;while(from<saved.length&&from<text.length&&saved[from]===text[from])from++;let end=saved.length, next=text.length;while(end>from&&next>from&&saved[end-1]===text[next-1]){end--;next--;}result=await api(`/cards/${sceneId}/prose`,'PATCH',{ops:[{from,to:end,insert:text.slice(from,next)}],baseRev:rev,snapshot});}
   else result=await api(`/cards/${sceneId}/prose`,'PUT',{text,baseRev:rev,snapshot});
   saved=text;rev=result.rev??result.prose?.rev??rev+1;state='Saved';onSaved();
  }catch(e:any){state=e.status===409?'This scene changed in another tab. Copy your edits and reload before saving.':e.message;}finally{busy=false;}
 }
 async function save(snapshot=false){if(pending)await pending;if(!view)return;pending=persist(snapshot);await pending;pending=null;if(alive&&view.state.doc.toString()!==saved&&state==='Saved')timer=setTimeout(()=>save(false),600);}
 beforeNavigate(n=>{if(navigating||!view||view.state.doc.toString()===saved&&!pending)return;n.cancel();clearTimeout(timer);save(true).then(()=>{if(view.state.doc.toString()===saved&&n.to){navigating=true;goto(n.to.url).finally(()=>navigating=false);}});});
 export async function flush(){clearTimeout(timer);await save(true);if(!view || view.state.doc.toString()!==saved)throw new Error(state);}
 async function split(){
  if(!view)return;const cursor=view.state.selection.main.head;
  if(!cursor||cursor===view.state.doc.length){state='Place the cursor where the next scene should begin.';return;}
  view.dispatch({effects:editable.reconfigure(EditorView.editable.of(false))});
  try{clearTimeout(timer);await save(true);if(view.state.doc.toString()!==saved)return;
   const result=await api(`/cards/${sceneId}/split`,'POST',{cursor,baseRev:rev});
   const prose=result.prose;
   saved=prose.text;rev=prose.rev;
   view.dispatch({changes:{from:0,to:view.state.doc.length,insert:saved}});
   clearTimeout(timer);state='Split into a new scene';onSaved();
  }catch(e:any){state=e.message;}finally{view.dispatch({effects:editable.reconfigure(EditorView.editable.of(true))});}
 }

 onMount(()=>{(async()=>{try{let data=await api(`/cards/${sceneId}/prose?offset=0&limit=200000`);let text=data.text||'';rev=data.rev;while(data.next!=null){data=await api(`/cards/${sceneId}/prose?offset=${data.next}&limit=200000`);text+=data.text||'';}if(!alive)return;saved=text;view=new EditorView({parent:host,state:EditorState.create({doc:text,extensions:[editable.of(EditorView.editable.of(true)),EditorView.lineWrapping,keymap.of([{key:'Mod-s',run:()=>{save(true);return true;}}]),EditorView.updateListener.of(u=>{if(u.docChanged){state='Unsaved';clearTimeout(timer);timer=setTimeout(()=>save(false),600);}}),EditorView.domEventHandlers({blur:()=>{clearTimeout(timer);save(true);}}),EditorView.contentAttributes.of({'aria-label':'Scene prose'})]})});state='Saved';}catch(e:any){state=e.message;}})();return()=>{alive=false;clearTimeout(timer);save(true);view?.destroy();};});
</script>
<div class="prose-editor" bind:this={host}></div>
<div class="saving" aria-live="polite">{state}</div>
{#if hint && view && view.state.doc.length > 180000}<p class="help">This scene is very long. Splitting it makes drafting and checks sharper. <button class="chip" on:click={split}>Split at cursor</button> <button class="plain" on:click={()=>hint=false}>Dismiss</button></p>{/if}

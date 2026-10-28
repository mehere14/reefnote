<script lang="ts">
 import HelpTip from './HelpTip.svelte';
 import {onMount} from 'svelte';
 import {api} from '$lib/api';
 import Markdown from './Markdown.svelte';
 import MarkdownField from './MarkdownField.svelte';
 import {bookTemplate,voiceTemplate,characterVoice,hasStyleText} from '$lib/style';
 export let manager=false;
 export let card:any=null;
 export let saveSource=false;
 export let onApplied:()=>Promise<void>=async()=>{};
 export let onMerge:(text:string)=>Promise<void>=async()=>{};
 let entries:any[]=[],category=manager?'book-voice':card?.type==='character'?'character-voices':card?.type==='style'&&card.subtype==='book'?'book-voice':'scene-presets',search='',selected:any=null,error='',notice='',busy=false,mode='replace',choices:Record<string,string>={},editing=false,slug='',title='',summary='',tags='',body='',traits:any[]=[],proposal:any=null,overwrite=false;
 const labels:Record<string,string>={'book-voice':'Book voice','style-traits':'Style traits','scene-presets':'Scene presets','character-voices':'Character voices'};
 $: allowed=manager?Object.keys(labels):card?.type==='character'?['character-voices']:card?.type==='style'?[(card.subtype==='book'?'book-voice':'scene-presets'),'style-traits']:['scene-presets'];
 $: filtered=entries.filter(e=>e.category===category&&(e.title+' '+e.summary+' '+e.tags.join(' ')).toLowerCase().includes(search.toLowerCase()));
 $: preview=selected?.category==='style-traits'?(selected.traits||[]).flatMap((g:any)=>g.options.filter((o:any)=>choices[g.group]===o.id).map((o:any)=>'### '+g.group+'\n'+o.text)).join('\n\n'):selected?.body||'';
 $: populated=card?.type==='character'?hasStyleText(Object.values(characterVoice(card.body)).join('\n')):hasStyleText(card?.body||'');
 async function safely(fn:()=>Promise<void>){busy=true;error='';notice='';try{await fn();}catch(e:any){error=e.message;}finally{busy=false;}}
 async function load(){entries=await api('/style-library'+(manager?'?all=1':''));}
 onMount(()=>{void safely(async()=>{await load();if(saveSource)newEntry(true);});});
 function select(entry:any){selected=entry;choices={};editing=false;proposal=null;}
 function edit(entry:any,duplicate=false){selected=entry;editing=true;slug=entry.slug+(duplicate?'-copy':'');title=entry.title+(duplicate?' copy':'');summary=entry.summary;tags=entry.tags.join(', ');body=entry.body;traits=structuredClone(entry.traits||[]);proposal=null;}
 function newEntry(fromCard=false){selected=null;editing=true;slug='';title=fromCard?card.title:'';summary='';tags='';body=fromCard?(card?.type==='character'?'### Dialogue\n'+characterVoice(card.body).dialogue+'\n\n### Interior\n'+characterVoice(card.body).interior:card.body):category==='character-voices'?voiceTemplate:category==='style-traits'?'':bookTemplate;traits=category==='style-traits'?[{group:'New group',options:[{id:'new-option',title:'New option',text:''}]}]:[];}
 async function save(){await safely(async()=>{const result=await api(`/style-library/${category}/${slug}`,'PUT',{title,summary,tags:tags.split(',').map(s=>s.trim()).filter(Boolean),body,...(category==='style-traits'?{traits}:{})});await load();selected=result;editing=false;notice='Library entry saved';});}
 async function action(name:string){await safely(async()=>{await api(`/style-library/${selected.category}/${selected.slug}`+(name==='delete'?'':'/'+name),name==='delete'?'DELETE':'POST');selected=null;await load();notice='Library updated';});}
 async function apply(){if(!card)return;const target=card;await safely(async()=>{if(mode==='merge'&&populated){await onMerge(preview);return;}await api(`/cards/${target.id}/apply-style`,'POST',{category:selected.category,slug:selected.slug,mode:populated?mode:'replace',baseRev:target.rev,asPreset:['chapter','scene'].includes(target.type),traits:choices});await onApplied();});}
 async function assist(action:string){await safely(async()=>{proposal=await api(`/style-library/${category}/${selected.slug}/assist`,'POST',{action,body});});}
 async function importFile(event:Event){const input=event.currentTarget as HTMLInputElement,file=input.files?.[0];if(!file)return;await safely(async()=>{const response=await fetch(`/api/style-library/import?name=${encodeURIComponent(file.name)}&category=${category}&overwrite=${overwrite?'1':'0'}`,{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error||'Import failed');await load();notice=`Imported ${result.imported} entries`;});input.value='';}
</script>
<div class="style-library">
 <h2>{manager?'Style library':saveSource?'Save as library entry':'Choose from library'}</h2>
 <p class="note">Library choices are editable copies. Existing cards keep their text when the library changes.</p>
 {#if error}<p role="alert" class="danger">{error}</p>{/if}{#if notice}<p role="status">{notice}</p>{/if}
 <div class="actions">{#each allowed as key}<button class="chip" class:on={category===key} on:click={()=>{category=key;selected=null;editing=false;}}>{labels[key]}</button>{/each}</div>
 {#if !saveSource}<label>Search<input aria-label="Search style library" bind:value={search}/></label>{/if}
 {#if manager}<div class="actions"><button class="chip" on:click={()=>newEntry()}>+ New</button><a class="chip" href="/api/style-library/export">Export user library (.zip)</a><label class="chip">Import .md or .zip<input aria-label="Import style library" type="file" accept=".md,.zip" on:change={importFile}/></label><label><input type="checkbox" bind:checked={overwrite}/> Overwrite matching entries on import</label></div>{/if}
 <div class="library-grid">
 {#if !saveSource}<div class="library-list">{#each filtered as entry}<button class="library-entry" class:on={selected?.slug===entry.slug} on:click={()=>select(entry)}><strong>{entry.title}</strong>{#if manager}<small>{entry.status}{entry.hidden?' · Hidden':''}</small>{/if}<span>{entry.summary}</span><small>{entry.body.replace(/#{1,6}\s/g,'').slice(-160)}</small></button>{:else}<p class="note">No matching entries.</p>{/each}</div>{/if}
 <div class="library-preview">
 {#if editing}<label>Slug <HelpTip term="Slug" text="A stable short identifier for this style preset, used to reference it. Choose a descriptive name without spaces."/><input aria-label="Library entry slug" bind:value={slug} pattern="[a-z0-9]+(-[a-z0-9]+)*"/></label><label>Title<input aria-label="Library entry title" bind:value={title}/></label><label>Summary<textarea aria-label="Library entry summary" bind:value={summary}></textarea></label><label>Tags<input aria-label="Library entry tags" bind:value={tags}/></label>
 {#if category==='style-traits'}{#each traits as group,g}<div class="trait-group"><label>Group name<input bind:value={group.group}/></label>{#each group.options as option,i}<div class="trait-option"><label>Option ID <HelpTip term="Option ID" text="A stable identifier for this style option. Used to distinguish it from other options in the preset."/><input bind:value={option.id}/></label><label>Label<input bind:value={option.title}/></label><label>Inserted text <HelpTip term="Inserted text" text="The writing instructions contributed by this option when selected. Write guidance you want the AI to follow."/><textarea bind:value={option.text}></textarea></label><button class="chip" on:click={()=>{traits[g].options.splice(i,1);traits=[...traits];}}>Remove option</button></div>{/each}<button class="chip" on:click={()=>{group.options=[...group.options,{id:'option-'+(group.options.length+1),title:'New option',text:''}];traits=[...traits];}}>+ Option</button><button class="chip" on:click={()=>traits=traits.filter((_,i)=>i!==g)}>Remove group</button></div>{/each}<button class="chip" on:click={()=>traits=[...traits,{group:'New group',options:[{id:'new-option',title:'New option',text:''}]}]}>+ Group</button>
 {:else}<MarkdownField label="Library entry body" bind:value={body}/><details><summary>Live preview</summary><Markdown text={body}/></details>{/if}
 <div class="actions"><button class="btn" disabled={busy||!slug||!title} on:click={save}>Save entry</button>{#if selected&&category!=='style-traits'}<button class="chip" disabled={busy} on:click={()=>assist('improve')}>Improve this entry</button><button class="chip" disabled={busy} on:click={()=>assist('sample')}>Write a sample passage</button>{/if}</div>
 {#if proposal}<section><h3>Suggested revision</h3><p>{proposal.why}</p><Markdown text={proposal.body}/><div class="actions"><button class="btn" on:click={()=>{body=proposal.body;proposal=null;}}>Accept into editor</button><button class="chip" on:click={()=>proposal=null}>Reject</button></div><p class="note">Save the entry to publish an accepted revision to your library.</p></section>{/if}
 {:else if selected}<h3>{selected.title}</h3><p>{selected.summary}</p>
 {#if selected.category==='style-traits'}{#each selected.traits as group}<fieldset><legend>{group.group}</legend>{#each group.options as option}<button class="chip" aria-pressed={choices[group.group]===option.id} on:click={()=>choices={...choices,[group.group]:option.id}}>{option.title}</button>{/each}</fieldset>{/each}{/if}
 <Markdown text={preview}/>
 {#if manager}<div class="actions"><button class="chip" on:click={()=>edit(selected)}>Edit</button><button class="chip" on:click={()=>edit(selected,true)}>Duplicate</button>{#if selected.status==='Custom'}<button class="chip danger" on:click={()=>action('delete')}>Delete</button>{:else}<button class="chip" on:click={()=>action(selected.hidden?'show':'hide')}>{selected.hidden?'Show':'Hide'}</button>{#if selected.status==='Edited'}<button class="chip" on:click={()=>action('reset')}>Reset to default</button>{/if}{/if}</div>
 {:else}{#if populated&&!['chapter','scene'].includes(card?.type)}<label>Apply to existing text<select aria-label="Apply library mode" bind:value={mode}><option value="replace">Replace</option><option value="append">Append</option><option value="merge">Merge with AI · review a suggestion</option></select></label>{/if}<button class="btn" disabled={busy||!preview.trim()} on:click={apply}>{mode==='merge'&&populated?'Propose merged style':['chapter','scene'].includes(card?.type)?'Create preset and use it':'Apply style'}</button>{/if}
 {:else}<p class="note">Choose an entry to preview it.</p>{/if}
 </div></div>
 {#if busy}<p role="status">Working…</p>{/if}
</div>
<style>
 .style-library{max-width:1100px}.library-grid{display:grid;grid-template-columns:minmax(180px,1fr) minmax(0,2fr);gap:20px;margin-top:16px}.library-list{max-height:520px;overflow:auto}.library-entry{display:flex;flex-direction:column;gap:7px;width:100%;text-align:left;padding:14px;border:1px solid var(--line);border-radius:6px;background:var(--paper);margin-bottom:8px;color:var(--ink)}.library-entry.on{border-color:var(--accent);background:var(--soft)}.library-entry small,.note{color:var(--dim)}.library-preview{min-width:0}.trait-group{padding:12px;border:1px solid var(--line);margin:12px 0}.trait-option{padding:10px;background:var(--soft);margin:8px 0}fieldset{border:1px solid var(--line);margin:10px 0;padding:10px}label{display:block;margin:10px 0}input:not([type=checkbox]),textarea,select{width:100%}.actions{flex-wrap:wrap}.library-preview:only-child{grid-column:1/-1}@media(max-width:650px){.library-grid{grid-template-columns:1fr}.library-list{max-height:240px}}
</style>

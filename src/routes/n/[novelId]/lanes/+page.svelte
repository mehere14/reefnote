<script lang="ts">
 import {onMount,tick} from 'svelte';
 import {page} from '$app/stores';
 import {goto} from '$app/navigation';
 import {api} from '$lib/api';
 import {BECAUSE_OF,TOUCHES,COLD_AFTER,PILEUP_OVER} from '$lib/lanes';
 import QuickAdd from './QuickAdd.svelte';

 type Col={kind:'gap'|'col'|'backstub'|'divider';slot?:number;region?:'backstory'|'present';between?:[number|null,number|null];label?:string};
 let mounted=false,novel:any=null,g:any=null,error='',loading=true,busy=false;
 let selected='';            // beat id or turning point id
 let showBackstory=false,coldAfter=COLD_AFTER,phone=false,phoneLane='';
 let dragging:{kind:'beat'|'tp'|'scene';id:string}|null=null,dropKey='';
 let draggedLane='',laneDrop='';
 let hoverBeat='',lines:Array<{x1:number;y1:number;x2:number;y2:number}>=[];
 let gridEl:HTMLDivElement,addDialog:HTMLDialogElement;
 let laneChoice='',newLaneType='character',newLaneTitle='',newLaneBody='',addMode:'existing'|'new'='existing';
 let quick:{lane:string;slot?:number;between?:[number|null,number|null];region?:'backstory'|'present';scene?:string}|null=null;
 let draftTitle='',draftBody='',draftLabel='',draftFor='';
 const NEW_TYPES=['plot','character','group','setting','object','question','secret','theme','event','rule','arc','relationship'];
 const TYPE_NAMES:Record<string,string>={plot:'Plots',character:'Characters',group:'Groups',relationship:'Relationships',arc:'Arcs',setting:'Settings',rule:'Rules',object:'Objects',event:'Events',secret:'Secrets',theme:'Themes',question:'Questions',premise:'Premise',outline:'Outline'};

 $: novelId=$page.params.novelId as string;
 $: if(mounted&&novelId)void load();

 // ---------- Derived read model ----------
 $: lanes=(g?.lanes||[]) as any[];
 $: placements=new Map<string,any>((g?.placements||[]).map((p:any)=>[p.beat_id,p]));
 $: beatsById=new Map<string,any>((g?.beats||[]).map((b:any)=>[b.id,b]));
 $: scenesById=new Map<string,any>((g?.scenes||[]).map((s:any)=>[s.id,s]));
 $: laneById=new Map<string,any>(lanes.map(l=>[l.id,l]));
 $: laneByCard=new Map<string,any>(lanes.map(l=>[l.card_id,l]));
 $: slots=[...new Set((g?.placements||[]).filter((p:any)=>p.slot!==null).map((p:any)=>p.slot as number))].sort((a:any,b:any)=>a-b) as number[];
 $: backSlots=slots.filter(s=>s<0);
 $: presentSlots=slots.filter(s=>s>=0);
 $: placedAt=(()=>{const m=new Map<string,any[]>();for(const p of g?.placements||[]){if(p.slot===null)continue;const k=`${p.lane_id}|${p.slot}`;const b=beatsById.get(p.beat_id);if(b)(m.get(k)||m.set(k,[]).get(k)!).push(b);}return m;})();
 $: columnLabel=(slot:number,index:number)=>{const label=(g?.placements||[]).find((p:any)=>p.slot===slot&&p.time_label)?.time_label;return label||(slot<0?`Before ${backSlots.length-index}`:`${index+1}`);};
 $: cols=buildCols(showBackstory,backSlots,presentSlots);
 function buildCols(open:boolean,back:number[],present:number[]):Col[]{
  const out:Col[]=[];
  if(open){back.forEach((slot,i)=>{out.push({kind:'gap',region:'backstory',between:[back[i-1]??null,slot]});out.push({kind:'col',slot,region:'backstory'});});out.push({kind:'gap',region:'backstory',between:[back.at(-1)??null,null]});}
  else out.push({kind:'backstub',region:'backstory',between:[back.at(-1)??null,null]});
  out.push({kind:'divider'});
  present.forEach((slot,i)=>{out.push({kind:'gap',region:'present',between:[present[i-1]??null,slot]});out.push({kind:'col',slot,region:'present'});});
  out.push({kind:'gap',region:'present',between:[present.at(-1)??null,null]});
  return out;
 }
 $: template=['minmax(170px,210px)',...cols.map(c=>c.kind==='gap'?'16px':c.kind==='divider'?'30px':c.kind==='backstub'?'132px':'minmax(168px,196px)'),'minmax(140px,1fr)'].join(' ');
 const colIndex=(i:number)=>i+2;
 $: rowOf=new Map<string,number>(lanes.map((l,i)=>[l.id,i+2]));

 /** Scene brackets: a scene whose placed beats share a column, joining its lanes (a collision when 2+). */
 $: brackets=(()=>{const out:any[]=[];for(const s of g?.scenes||[]){const beats=(g.beats as any[]).filter(b=>b.parent_id===s.id&&placements.get(b.id)?.slot!=null);if(!beats.length)continue;const slot=placements.get(beats[0].id).slot;const ci=cols.findIndex(c=>c.kind==='col'&&c.slot===slot);if(ci<0)continue;const rows=beats.map(b=>rowOf.get(placements.get(b.id).lane_id)!).filter(Boolean);const laneCount=new Set(beats.map(b=>placements.get(b.id).lane_id)).size;out.push({scene:s,col:colIndex(ci),from:Math.min(...rows),to:Math.max(...rows)+1,collision:laneCount>1,beats:beats.length});}return out;})();
 /** `touches` ghosts: a beat on one lane that also touches another lane's card. */
 $: ghosts=(()=>{const m=new Map<string,any[]>();for(const l of g?.links||[]){if(l.label!==TOUCHES)continue;const p=placements.get(l.from_id),lane=laneByCard.get(l.to_id),b=beatsById.get(l.from_id);if(!p||p.slot===null||!lane||lane.id===p.lane_id||!b)continue;const k=`${lane.id}|${p.slot}`;(m.get(k)||m.set(k,[]).get(k)!).push(b);}return m;})();
 /** Signals (computed only): quiet stretches per lane and pileups per column. */
 $: quiet=(()=>{const cells=new Set<string>(),trailing=new Map<string,number>();for(const lane of lanes){let run:number[]=[];const flush=(end:boolean)=>{if(run.length>coldAfter){for(const s of run)cells.add(`${lane.id}|${s}`);if(end)trailing.set(lane.id,run.length);}run=[];};const seen=presentSlots.map(s=>(placedAt.get(`${lane.id}|${s}`)?.length||0)+(ghosts.get(`${lane.id}|${s}`)?.length||0)>0);const first=seen.indexOf(true);if(first<0)continue;presentSlots.forEach((s,i)=>{if(i<first)return;if(seen[i])flush(false);else run.push(s);});flush(true);}return {cells,trailing};})();
 $: pileups=new Set(presentSlots.filter(s=>lanes.reduce((n,l)=>n+(placedAt.get(`${l.id}|${s}`)?.length||0),0)>PILEUP_OVER));
 $: backCount=(laneId:string)=>backSlots.reduce((n,s)=>n+(placedAt.get(`${laneId}|${s}`)?.length||0),0);

 // Tray: per-lane parked beats and unplaced turning points; plus beats and events with no lane.
 $: trayFor=(laneId:string)=>(g?.placements||[]).filter((p:any)=>p.lane_id===laneId&&p.slot===null).map((p:any)=>beatsById.get(p.beat_id)).filter(Boolean);
 $: tpsFor=(laneId:string)=>(g?.turningPoints||[]).filter((t:any)=>t.lane_id===laneId);
 $: loose=(g?.beats||[]).filter((b:any)=>!b.placed);
 $: candidatesByType=(()=>{const m=new Map<string,any[]>();for(const c of g?.candidates||[]){if(laneByCard.has(c.id))continue;(m.get(c.type)||m.set(c.type,[]).get(c.type)!).push(c);}return [...m.entries()];})();

 $: sel=selected?beatsById.get(selected)||null:null;
 $: selTP=selected&&!sel?(g?.turningPoints||[]).find((t:any)=>t.id===selected)||null:null;
 $: selPlacement=sel?placements.get(sel.id)||null:null;
 $: selScene=sel?.parent_id?scenesById.get(sel.parent_id)||null:null;
 $: selSceneCard=selected&&!sel&&!selTP?scenesById.get(selected)||null:null;
 $: linkSource=sel||selSceneCard;
 $: selLinks=linkSource?(g?.links||[]).filter((l:any)=>l.from_id===linkSource.id):[];
 /** The column a scene sits in (its beats share one), or null when none of its beats is placed. */
 const sceneColumn=(sceneId:string)=>{const b=(g?.beats||[]).find((b:any)=>b.parent_id===sceneId&&placements.get(b.id)?.slot!=null);return b?placements.get(b.id).slot:null;};
 $: sceneBeats=selSceneCard?(g.beats as any[]).filter(b=>b.parent_id===selSceneCard.id):[];
 /** Any card the grid knows, for naming link targets. */
 $: cardsById=new Map<string,any>([...(g?.candidates||[]).map((c:any)=>[c.id,c]),...lanes.map(l=>[l.card_id,l.card]),...(g?.scenes||[]).map((s:any)=>[s.id,{...s,type:'scene'}]),...(g?.beats||[]).map((b:any)=>[b.id,b])]);
 /**
  * Backstory causes for a beat or scene, grouped. A backstory plot is linked whole (its lane card);
  * its placed turning points and backstory scenes can be linked one by one.
  */
 $: becauseGroups=(()=>{if(!linkSource)return [];
  const taken=new Set(selLinks.filter((l:any)=>l.label===BECAUSE_OF).map((l:any)=>l.to_id));taken.add(linkSource.id);
  const backLane=new Set((g.placements as any[]).filter(p=>p.slot!==null&&p.slot<0).map(p=>p.lane_id));
  const plots=[...new Map([...lanes.map(l=>l.card),...(g.candidates as any[])].filter(c=>c.type==='plot').map(c=>[c.id,c])).values()]
   .sort((a,b)=>Number(backLane.has(laneByCard.get(b.id)?.id))-Number(backLane.has(laneByCard.get(a.id)?.id))||a.title.localeCompare(b.title));
  const backBeats=(g.beats as any[]).filter(b=>b.type==='beat'&&(placements.get(b.id)?.slot??0)<0).sort((a,b)=>placements.get(a.id).slot-placements.get(b.id).slot);
  const backScenes=(g.scenes as any[]).filter(s=>(sceneColumn(s.id)??0)<0);
  const events=(g.beats as any[]).filter(b=>b.type==='event');
  const laneName=(b:any)=>laneById.get(placements.get(b.id)?.lane_id)?.card.title;
  return [
   {label:'Whole plot',items:plots.map(c=>({id:c.id,title:c.title+(backLane.has(laneByCard.get(c.id)?.id)?' (backstory)':'')}))},
   {label:'Backstory scenes',items:backScenes.map(s=>({id:s.id,title:s.title}))},
   {label:'Backstory beats and turning points',items:backBeats.map(b=>({id:b.id,title:`${b.title}${laneName(b)?` · ${laneName(b)}`:''}`}))},
   {label:'Events',items:events.map(b=>({id:b.id,title:b.title+(b.subtype?` (${b.subtype})`:'')}))}
  ].map(gr=>({...gr,items:gr.items.filter(i=>!taken.has(i.id))})).filter(gr=>gr.items.length);})();
 const linkName=(id:string)=>{const c=cardsById.get(id);return c?`${c.title}${c.type==='plot'?' · whole plot':c.type==='scene'?' · scene':''}`:'A card';};
 $: if(sel&&draftFor!==sel.id+':'+sel.rev){draftFor=sel.id+':'+sel.rev;draftTitle=sel.title;draftBody=sel.body;draftLabel=selPlacement?.time_label||'';}
 $: phoneLaneObj=laneById.get(phoneLane)||lanes[0]||null;

 // ---------- Data ----------
 async function load(){try{error='';const [novels,grid]=await Promise.all([api('/novels'),api(`/novels/${novelId}/grid`)]);novel=novels.find((n:any)=>n.id===novelId);g=grid;}catch(e:any){error=e.message;}finally{loading=false;}}
 /** Every direct action applies immediately and is versioned server-side; a 409 reloads the grid. */
 async function act(fn:()=>Promise<any>,keepSelection=true){if(busy)return;busy=true;error='';try{const result=await fn();if(result?.lanes)g=result;else if(result?.grid)g=result.grid;else await load();if(!keepSelection)selected='';return result;}catch(e:any){error=e.status===409?'That changed elsewhere. The grid has been reloaded.':e.message;await load();}finally{busy=false;dragging=null;dropKey='';}}
 const place=(id:string,body:any)=>act(()=>api(`/beats/${id}/placement`,'PUT',{...body,...(beatsById.get(id)?{baseRev:beatsById.get(id).rev}:{})}));
 const unplace=(id:string)=>act(()=>api(`/beats/${id}/placement`,'DELETE',{baseRev:beatsById.get(id)?.rev}));
 const group=(ids:string[])=>act(()=>api('/scenes/group','POST',{beat_ids:ids}));
 const moveScene=(id:string,body:any)=>act(()=>api(`/scenes/${id}/move`,'POST',body));
 const openCard=(c:any)=>goto(`/n/${novelId}/${c.type==='beat'||c.type==='scene'?'chapters':TYPE_SECTION[c.type]||'chapters'}/${c.id}`);
 const TYPE_SECTION:Record<string,string>={character:'characters',group:'characters',relationship:'characters',arc:'arcs',setting:'world',rule:'world',object:'world',event:'world',plot:'plots',secret:'plots',theme:'plots',question:'plots',premise:'premise',outline:'outline'};

 // ---------- Lanes ----------
 function openAddLane(){laneChoice='';newLaneTitle='';newLaneBody='';addMode=candidatesByType.length?'existing':'new';addDialog.showModal();}
 async function addLane(){const body=addMode==='existing'?{card_id:laneChoice}:{new_card:{type:newLaneType,title:newLaneTitle.trim(),body:newLaneBody}};await act(()=>api(`/novels/${novelId}/lanes`,'POST',body));addDialog.close();}
 const laneAction=(lane:any,body:any)=>act(()=>api(`/lanes/${lane.id}`,'PATCH',body));
 function startLaneDrag(event:DragEvent,id:string){
  if(busy){event.preventDefault();return;}
  draggedLane=id;
  event.dataTransfer?.setData('text/plain',id);
  if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
 }
 function overLane(event:DragEvent,id:string){
  if(!draggedLane||draggedLane===id||busy)return;
  event.preventDefault();
  laneDrop=id;
 }
 function endLaneDrag(){draggedLane='';laneDrop='';}
 function dropLane(event:DragEvent,lane:any){
  if(!draggedLane)return;
  event.preventDefault();
  const id=draggedLane;
  endLaneDrag();
  if(id!==lane.id)void laneAction({id},{move_to:lane.id});
 }
 function removeLane(lane:any){const n=(g.placements as any[]).filter(p=>p.lane_id===lane.id).length;if(!confirm(`Stop following “${lane.card.title}” as a lane?${n?` Its ${n} ${n===1?'beat returns':'beats return'} to the tray.`:''} The card itself is kept.`))return;void act(()=>api(`/lanes/${lane.id}`,'DELETE'));}

 // ---------- Beats ----------
 function startQuick(q:NonNullable<typeof quick>){quick=q;}
 const quickTarget=(q:NonNullable<typeof quick>)=>({lane_id:q.lane,...(q.slot!==undefined?{slot:q.slot}:{}),...(q.between?{between:q.between,region:q.region}:{})});
 /** Quick-add: a typed title creates a beat (an event in the backstory region). */
 async function createQuick(title:string){if(!quick)return;const q=quick;quick=null;const type=q.region==='backstory'?'event':'beat';const r=await act(()=>api(`/novels/${novelId}/beats`,'POST',{title,type,...(type==='event'?{subtype:'backstory'}:{}),...quickTarget(q)}));if(r?.card)selected=r.card.id;}
 /** Short label for a turning point: its first sentence, cut at a word near 90 characters. */
 const tpTitle=(text:string)=>{const line=(text.split('\n').map(l=>l.replace(/^#+\s*/,'').trim()).find(Boolean)||'Turning point').split(/(?<=[.!?])\s+/)[0];if(line.length<=90)return line;const cut=line.slice(0,90),sp=cut.lastIndexOf(' ');return (sp>40?cut.slice(0,sp):cut)+'…';};
 /**
  * What quick-add can place. Appending spots (backstory, end of lane) also offer a whole plot: every
  * unplaced turning point, each in its own column, in story order. Turning points become beats when placed.
  */
 $: quickGroups=(append:boolean,backstory:boolean)=>{
  const tps=(g?.turningPoints||[]) as any[],byPlot=new Map<string,any[]>();
  for(const t of tps){const k=t.plot_card_id||t.subplot_id;(byPlot.get(k)||byPlot.set(k,[]).get(k)!).push(t);}
  const plots=[...byPlot.values()].filter(list=>list[0].plot_card_id);
  const events=loose.filter((b:any)=>b.type==='event'),beats=loose.filter((b:any)=>b.type!=='event');
  const whole=append?[{label:'Whole plot, every turning point in order',items:plots.map(list=>({value:'plot:'+list[0].plot_card_id,title:`${list[0].plot_title} · ${list.length} turning ${list.length===1?'point':'points'}`}))}]:[];
  const points=[...byPlot.values()].map(list=>({label:`Turning points · ${list[0].plot_title}`,items:list.map(t=>({value:t.id,title:tpTitle(t.text)}))}));
  const ev={label:'Events',items:events.map((b:any)=>({value:b.id,title:b.title+(b.subtype?` (${b.subtype})`:'')}))};
  const bt={label:'Beats',items:beats.map((b:any)=>({value:b.id,title:b.title}))};
  // Backstory: plots first, then events. Present: loose beats first.
  return backstory?[...whole,...points,ev,bt]:[bt,...whole,...points,ev];
 };
 /** Quick-add: choosing a whole plot lays it out; a turning point, event or beat is placed in this cell. */
 async function pickQuick(value:string){if(!quick)return;const q=quick;quick=null;
  if(value.startsWith('plot:')){await act(()=>api(`/lanes/${q.lane}/layout`,'POST',{region:q.region||'present',plot_card_id:value.slice(5)}));return;}
  const r=await place(value,quickTarget(q));selected=(r?.beats||[]).find((b:any)=>b.turning_point_id===value)?.id||value;}
 async function saveDraft(){if(!sel)return;const changes:any={};if(draftTitle.trim()&&draftTitle!==sel.title)changes.title=draftTitle.trim();if(draftBody!==sel.body)changes.body=draftBody;if(Object.keys(changes).length)await act(()=>api(`/cards/${sel.id}`,'PATCH',{...changes,baseRev:sel.rev}));}
 async function saveLabel(){if(!sel||!selPlacement||draftLabel===selPlacement.time_label)return;await place(sel.id,{lane_id:selPlacement.lane_id,slot:selPlacement.slot,time_label:draftLabel});}
 function moveTo(value:string){if(!sel&&!selTP)return;const id=sel?.id||selTP.id,lane=selPlacement?.lane_id||selTP?.lane_id||lanes[0]?.id;if(!lane)return;
  if(value==='tray')return place(id,{lane_id:lane,slot:null});
  if(value==='end')return place(id,{lane_id:lane,between:[presentSlots.at(-1)??null,null],region:'present'});
  if(value==='back')return place(id,{lane_id:lane,between:[backSlots.at(-1)??null,null],region:'backstory'});
  return place(id,{lane_id:lane,slot:Number(value)});}
 const changeLane=(laneId:string)=>sel&&place(sel.id,{lane_id:laneId,slot:selPlacement?.slot??null});
 const addLink=(label:string,toId:string)=>toId&&linkSource&&act(()=>api('/links','POST',{fromId:linkSource.id,toId,label}));
 /** Place a lane's whole tray (turning points in story order) in new columns, in the backstory or at the end. */
 const layoutLane=(lane:any,region:'backstory'|'present')=>act(()=>api(`/lanes/${lane.id}/layout`,'POST',{region}));
 const removeLink=(id:string)=>act(()=>api(`/links/${id}`,'DELETE'));

 // ---------- Drag and drop (desktop) ----------
 function dragStart(e:DragEvent,kind:'beat'|'tp'|'scene',id:string){dragging={kind,id};e.dataTransfer?.setData('text/plain',id);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';}
 function over(e:DragEvent,key:string){if(!dragging)return;e.preventDefault();dropKey=key;}
 function dropCell(e:DragEvent,lane:any,c:Col){e.preventDefault();const d=dragging;if(!d)return;
  const target=c.kind==='col'?{slot:c.slot}:{between:c.between,region:c.region};
  if(d.kind==='scene')return moveScene(d.id,target);
  return place(d.id,{lane_id:lane.id,...target});}
 async function dropOnBeat(e:DragEvent,target:any){e.preventDefault();e.stopPropagation();const d=dragging;if(!d||d.id===target.id||d.kind==='scene')return;
  if(target.type!=='beat'){const p=placements.get(target.id);if(p)return place(d.id,{lane_id:p.lane_id,slot:p.slot});return;}
  if(d.kind==='tp'){const p=placements.get(target.id);const tp=(g.turningPoints as any[]).find(t=>t.id===d.id);const r=await place(d.id,{lane_id:tp?.lane_id||p.lane_id,slot:p?.slot??null});const bridged=(r?.beats||[]).find((b:any)=>b.turning_point_id===d.id);if(bridged)await group([target.id,bridged.id]);return;}
  const dragged=beatsById.get(d.id);if(dragged?.type!=='beat'){error='Events stay loose; link them with “because of” instead.';dragging=null;return;}
  return group([target.id,d.id]);}
 function dropTray(e:DragEvent,lane:any|null){e.preventDefault();const d=dragging;if(!d||d.kind==='scene')return;if(lane)return place(d.id,{lane_id:lane.id,slot:null});if(d.kind==='beat'&&placements.has(d.id))return unplace(d.id);dragging=null;}

 // ---------- Keyboard: arrows move the selection, Enter opens ----------
 function key(e:KeyboardEvent){if(!sel||!selPlacement||selPlacement.slot===null||(e.target as HTMLElement)?.closest?.('input,textarea,select'))return;
  const order=[...backSlots,...presentSlots],li=lanes.findIndex(l=>l.id===selPlacement.lane_id),si=order.indexOf(selPlacement.slot);
  const at=(l:number,s:number)=>lanes[l]&&order[s]!==undefined?placedAt.get(`${lanes[l].id}|${order[s]}`)?.[0]:null;
  let next:any=null;
  if(e.key==='Enter'&&!(e.target as HTMLElement)?.closest?.('button:not([data-beat])')){e.preventDefault();return openCard(sel);}
  if(e.key==='ArrowRight')for(let s=si+1;s<order.length&&!next;s++)next=at(li,s);
  if(e.key==='ArrowLeft')for(let s=si-1;s>=0&&!next;s--)next=at(li,s);
  if(e.key==='ArrowDown')for(let l=li+1;l<lanes.length&&!next;l++)next=at(l,si);
  if(e.key==='ArrowUp')for(let l=li-1;l>=0&&!next;l--)next=at(l,si);
  if(next){e.preventDefault();selected=next.id;void tick().then(()=>document.querySelector<HTMLElement>(`[data-beat="${next.id}"]`)?.focus());}}

 // ---------- `because of` lines on hover ----------
 /** Where a `because of` line ends: the beat or scene itself, else its lane's backstory stub, else a whole plot's lane head. */
 function causeTarget(id:string):Element|null{
  const direct=gridEl.querySelector(`[data-beat="${id}"]`)||gridEl.querySelector(`[data-scene="${id}"]`);if(direct)return direct;
  const sceneBeat=(g.beats as any[]).find(b=>b.parent_id===id&&placements.has(b.id));
  const lane=placements.get(id)?.lane_id||(sceneBeat&&placements.get(sceneBeat.id)?.lane_id)||laneByCard.get(id)?.id;
  return (lane&&(gridEl.querySelector(`[data-backstub-lane="${lane}"]`)||gridEl.querySelector(`[data-lane-head="${lane}"]`)))||null;
 }
 async function hover(b:any|null){hoverBeat=b?.id||'';lines=[];if(!b||!gridEl)return;await tick();const box=gridEl.getBoundingClientRect(),from=(gridEl.querySelector(`[data-beat="${b.id}"]`)||gridEl.querySelector(`[data-scene="${b.id}"]`))?.getBoundingClientRect();if(!from)return;
  for(const l of g.links as any[]){if(l.label!==BECAUSE_OF||l.from_id!==b.id)continue;const to=causeTarget(l.to_id)?.getBoundingClientRect();if(to)lines=[...lines,{x1:from.left-box.left+gridEl.scrollLeft,y1:from.top+from.height/2-box.top+gridEl.scrollTop,x2:to.right-box.left+gridEl.scrollLeft,y2:to.top+to.height/2-box.top+gridEl.scrollTop}];}}

 onMount(()=>{mounted=true;const theme=localStorage.getItem('novel-theme');if(theme)document.documentElement.dataset.theme=theme;try{coldAfter=Number(localStorage.getItem('reef-lane-cold'))||COLD_AFTER;showBackstory=localStorage.getItem('reef-lane-backstory')==='1';}catch{}const mq=matchMedia('(max-width: 960px)');phone=mq.matches;const on=()=>phone=mq.matches;mq.addEventListener('change',on);return()=>mq.removeEventListener('change',on);});
 function savePrefs(){try{localStorage.setItem('reef-lane-cold',String(coldAfter));localStorage.setItem('reef-lane-backstory',showBackstory?'1':'0');}catch{}}
 const beatTitle=(b:any)=>b.title||'Untitled beat';
 /** Body lines after the first (the first usually repeats the title). */
 const bodyRest=(b:any)=>String(b.body||'').split('\n').slice(1).join(' ').trim();
 const laneColor=(lane:any)=>`var(--${lane?.color||'lane-1'})`;
</script>

<svelte:head><title>Lane grid · {novel?.title||'Reefnote'}</title></svelte:head>
<svelte:window on:keydown={key}/>
<div class="lanes-page">
 <header class="lanes-header">
  <a href={`/n/${novelId}/chapters`}>← Back to story</a>
  <p>{novel?.title||'Reefnote'}</p>
  <h1>Lane grid</h1>
  <p class="intro">Follow each thread across story time. Drag beats between columns and lanes, drop one beat on another to make them one scene.</p>
  <div class="toolbar">
   <button class="btn" on:click={openAddLane}>+ Add lane</button>
   <button class="chip" aria-pressed={showBackstory} on:click={()=>{showBackstory=!showBackstory;savePrefs();}}>{showBackstory?'Compress backstory':'Expand backstory'}</button>
   <label class="cold">Quiet after <input type="number" min="1" max="50" bind:value={coldAfter} on:change={savePrefs}/> columns</label>
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
 </header>

 {#if loading}<p class="empty" role="status">Loading lanes…</p>
 {:else if !lanes.length}
  <section class="empty-state"><h2>No lanes yet</h2><p>A lane follows one thread: a plot, a character, a group, a question, a secret. Plot lanes bring their turning points into the tray, ready to place.</p><button class="btn" on:click={openAddLane}>+ Add your first lane</button>{#if loose.length}<p>{loose.length} {loose.length===1?'beat is':'beats are'} waiting in the tray.</p>{/if}</section>
 {:else if phone}
  <!-- Phone: one lane at a time, in story-time order. Moves happen in the beat panel. -->
  <section class="phone">
   <label for="lane-switch">Lane</label>
   <select id="lane-switch" bind:value={phoneLane}>{#each lanes as lane}<option value={lane.id}>{lane.card.title} · {lane.card.type}</option>{/each}</select>
   {#if phoneLaneObj}
    <div class="lane-tools">
     <button class="chip" disabled={busy||phoneLaneObj.id===lanes[0]?.id} on:click={()=>{phoneLane=phoneLaneObj.id;laneAction(phoneLaneObj,{direction:-1});}}>Move lane up</button>
     <button class="chip" disabled={busy||phoneLaneObj.id===lanes.at(-1)?.id} on:click={()=>{phoneLane=phoneLaneObj.id;laneAction(phoneLaneObj,{direction:1});}}>Move lane down</button>
    </div>
    <ol class="phone-cols" style={`--lane:${laneColor(phoneLaneObj)}`}>
     {#each [...backSlots,...presentSlots] as slot,i}{@const items=placedAt.get(`${phoneLaneObj.id}|${slot}`)||[]}
      {#if slot>=0&&(i===0||[...backSlots,...presentSlots][i-1]<0)}<li class="phone-divider">Chapter 1 starts</li>{/if}
      {#if items.length||ghosts.get(`${phoneLaneObj.id}|${slot}`)?.length}<li><span class="col-label">{columnLabel(slot,slot<0?backSlots.indexOf(slot):presentSlots.indexOf(slot))}</span>
       {#each items as b}<button class="beat" class:selected={selected===b.id} class:event={b.type==='event'} on:click={()=>selected=b.id}><b>{beatTitle(b)}</b>{#if b.parent_id&&scenesById.get(b.parent_id)}<small>Scene: {scenesById.get(b.parent_id).title}</small>{/if}</button>{/each}
       {#each ghosts.get(`${phoneLaneObj.id}|${slot}`)||[] as b}<button class="ghost" on:click={()=>selected=b.id}>Touches: {beatTitle(b)}</button>{/each}</li>{/if}
     {/each}
    </ol>
    <button class="chip" on:click={()=>startQuick({lane:phoneLaneObj.id,between:[presentSlots.at(-1)??null,null],region:'present'})}>+ Beat at the end</button>
    {#if quick}<QuickAdd placeholder="What changes?" existingLabel="Or place an existing one" groups={quickGroups(true,false)} on:create={e=>createQuick(e.detail)} on:pick={e=>pickQuick(e.detail)} on:cancel={()=>quick=null}/>{/if}
    <h3>Tray</h3>
    {#if tpsFor(phoneLaneObj.id).length+trayFor(phoneLaneObj.id).length>1}<div class="layout"><button class="chip" disabled={busy} on:click={()=>layoutLane(phoneLaneObj,'backstory')}>All into backstory</button><button class="chip" disabled={busy} on:click={()=>layoutLane(phoneLaneObj,'present')}>All at the end</button></div>{/if}
    <div class="tray-items" style={`--lane:${laneColor(phoneLaneObj)}`}>{#if !tpsFor(phoneLaneObj.id).length&&!trayFor(phoneLaneObj.id).length&&!loose.length}<p class="none">Nothing in the tray.</p>{/if}{#each tpsFor(phoneLaneObj.id) as tp}<button class="beat tp" class:selected={selected===tp.id} on:click={()=>selected=tp.id}><small>Turning point</small><b>{tp.text.split('\n')[0]}</b></button>{/each}{#each trayFor(phoneLaneObj.id) as b}<button class="beat" class:selected={selected===b.id} on:click={()=>selected=b.id}><b>{beatTitle(b)}</b></button>{/each}{#each loose as b}<button class="beat" class:event={b.type==='event'} class:selected={selected===b.id} on:click={()=>selected=b.id}><small>No lane</small><b>{beatTitle(b)}</b></button>{/each}</div>
   {/if}
  </section>
 {:else}
  <div class="board">
   <!-- svelte-ignore a11y-no-static-element-interactions -->
   <div class="grid" bind:this={gridEl} style={`grid-template-columns:${template};grid-template-rows:auto repeat(${lanes.length},auto)`} role="region" aria-label="Lanes across story time" on:dragend={()=>{dragging=null;dropKey='';}}>
    <div class="corner" style="grid-row:1;grid-column:1">Lanes</div>
    {#each cols as c,i}
     {#if c.kind==='col'}{@const index=c.region==='backstory'?backSlots.indexOf(c.slot??0):presentSlots.indexOf(c.slot??0)}
      <div class="colhead" class:back={c.region==='backstory'} style={`grid-row:1;grid-column:${colIndex(i)}`}>{columnLabel(c.slot??0,index)}{#if pileups.has(c.slot??0)}<span class="pileup" title="More than {PILEUP_OVER} beats in this column">Crowded</span>{/if}</div>
     {:else if c.kind==='backstub'}<button class="colhead backstub-head" data-backstub style={`grid-row:1;grid-column:${colIndex(i)}`} on:click={()=>{showBackstory=true;savePrefs();}}>Backstory{backSlots.length?` · ${backSlots.length}`:''}</button>
     {:else if c.kind==='divider'}<div class="divider" style={`grid-row:1 / span ${lanes.length+1};grid-column:${colIndex(i)}`}><span>Chapter 1 starts</span></div>{/if}
    {/each}
    <div class="colhead endhead" style={`grid-row:1;grid-column:${cols.length+2}`}></div>

    {#each lanes as lane,li}{@const row=li+2}
     <div class="lanehead" role="group" on:dragover={e=>overLane(e,lane.id)} on:drop={e=>dropLane(e,lane)} class:lane-drop={laneDrop===lane.id} data-lane-head={lane.id} class:collapsed={lane.collapsed} style={`grid-row:${row};grid-column:1;--lane:${laneColor(lane)}`}>
      <button class="lane-title" on:click={()=>openCard(lane.card)}><span class="dot"></span><span><b>{lane.card.title}</b><small>{lane.card.type}{lane.card.subtype?` · ${lane.card.subtype}`:''}</small></span></button>
      {#if quiet.trailing.has(lane.id)}<small class="quiet-note">Quiet for {quiet.trailing.get(lane.id)} columns</small>{/if}
      <div class="lane-tools"><span class="lane-grip" draggable="true" title="Drag to reorder lanes" on:dragstart={e=>startLaneDrag(e,lane.id)} on:dragend={endLaneDrag} aria-hidden="true">⠿</span><button class="plain" aria-label={`Move ${lane.card.title} up`} title="Move lane up" disabled={busy||li===0} on:click={()=>laneAction(lane,{direction:-1})}>↑</button><button class="plain" aria-label={`Move ${lane.card.title} down`} title="Move lane down" disabled={busy||li===lanes.length-1} on:click={()=>laneAction(lane,{direction:1})}>↓</button><button class="plain" on:click={()=>laneAction(lane,{collapsed:!lane.collapsed})}>{lane.collapsed?'Show':'Fold'}</button><button class="plain danger" on:click={()=>removeLane(lane)}>Remove</button></div>
     </div>
     {#each cols as c,i}{@const k=`${lane.id}|${c.kind}|${i}`}
      {#if c.kind==='col'}{@const items=placedAt.get(`${lane.id}|${c.slot}`)||[]}{@const ghostItems=ghosts.get(`${lane.id}|${c.slot}`)||[]}
       <!-- svelte-ignore a11y-no-static-element-interactions -->
       <div class="cell" class:back={c.region==='backstory'} class:quiet={quiet.cells.has(`${lane.id}|${c.slot}`)} class:drop={dropKey===k} style={`grid-row:${row};grid-column:${colIndex(i)};--lane:${laneColor(lane)}`} on:dragover={e=>over(e,k)} on:dragleave={()=>dropKey===k&&(dropKey='')} on:drop={e=>dropCell(e,lane,c)}>
        {#if lane.collapsed}{#if items.length}<span class="folded">{items.length}</span>{/if}
        {:else}
         {#each items as b (b.id)}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <button class="beat" data-beat={b.id} class:event={b.type==='event'} class:selected={selected===b.id} class:linked={hoverBeat&&g.links.some((l:any)=>l.label===BECAUSE_OF&&l.from_id===hoverBeat&&l.to_id===b.id)} draggable="true" on:dragstart={e=>dragStart(e,'beat',b.id)} on:dragover={e=>over(e,'b:'+b.id)} on:drop={e=>dropOnBeat(e,b)} on:click={()=>selected=b.id} on:dblclick={()=>openCard(b)} on:mouseenter={()=>hover(b)} on:mouseleave={()=>hover(null)} on:focus={()=>hover(b)} on:blur={()=>hover(null)}>
           {#if b.turning_point_id}<small>Turning point</small>{:else if b.type==='event'}<small>Event{b.subtype?` · ${b.subtype}`:''}</small>{/if}
           <b>{beatTitle(b)}</b>
           {#if bodyRest(b)}<span class="excerpt">{bodyRest(b).slice(0,90)}</span>{/if}
          </button>
         {/each}
         {#each ghostItems as b}<button class="ghost" on:click={()=>selected=b.id} title="This beat touches this lane">Touches: {beatTitle(b)}</button>{/each}
         {#if !items.length&&!ghostItems.length}<button class="add" aria-label={`Add a beat to ${lane.card.title} here`} on:click={()=>startQuick({lane:lane.id,slot:c.slot})}>+</button>{/if}
         {#if quick&&quick.lane===lane.id&&quick.slot===c.slot}<QuickAdd placeholder="What changes?" existingLabel="Or place an existing one" groups={quickGroups(false,c.region==='backstory')} on:create={e=>createQuick(e.detail)} on:pick={e=>pickQuick(e.detail)} on:cancel={()=>quick=null}/>{/if}
        {/if}
       </div>
      {:else if c.kind==='gap'}
       <!-- svelte-ignore a11y-no-static-element-interactions -->
       <div class="gap" class:drop={dropKey===k} style={`grid-row:${row};grid-column:${colIndex(i)}`} title="Drop here for a new column" on:dragover={e=>over(e,k)} on:dragleave={()=>dropKey===k&&(dropKey='')} on:drop={e=>dropCell(e,lane,c)}></div>
      {:else if c.kind==='backstub'}
       <!-- svelte-ignore a11y-no-static-element-interactions -->
       <div class="cell backstub" data-backstub-lane={lane.id} class:drop={dropKey===k} style={`grid-row:${row};grid-column:${colIndex(i)}`} on:dragover={e=>over(e,k)} on:dragleave={()=>dropKey===k&&(dropKey='')} on:drop={e=>dropCell(e,lane,c)}>
        {#if backCount(lane.id)}<button class="plain" on:click={()=>{showBackstory=true;savePrefs();}}>{backCount(lane.id)} backstory</button>{/if}
        {#if !lane.collapsed}<button class="add" aria-label={`Add backstory to ${lane.card.title}`} on:click={()=>startQuick({lane:lane.id,between:c.between,region:'backstory'})}>+</button>{/if}
        {#if quick&&quick.lane===lane.id&&quick.region==='backstory'&&!quick.slot}<QuickAdd placeholder="What happened before?" existingLabel="Or choose existing backstory" groups={quickGroups(true,true)} on:create={e=>createQuick(e.detail)} on:pick={e=>pickQuick(e.detail)} on:cancel={()=>quick=null}/>{/if}
       </div>
      {/if}
     {/each}
     <!-- svelte-ignore a11y-no-static-element-interactions -->
     <div class="cell endcell" class:drop={dropKey===`${lane.id}|end`} style={`grid-row:${row};grid-column:${cols.length+2}`} on:dragover={e=>over(e,`${lane.id}|end`)} on:drop={e=>dropCell(e,lane,cols[cols.length-1])}>
      {#if !lane.collapsed}<button class="chip" on:click={()=>startQuick({lane:lane.id,between:[presentSlots.at(-1)??null,null],region:'present'})}>+ Beat</button>
      {#if quick&&quick.lane===lane.id&&quick.region==='present'&&quick.between}<QuickAdd placeholder="What changes?" existingLabel="Or place an existing one" groups={quickGroups(true,false)} on:create={e=>createQuick(e.detail)} on:pick={e=>pickQuick(e.detail)} on:cancel={()=>quick=null}/>{/if}{/if}
     </div>
    {/each}

    {#each brackets as br}
     <div class="bracket" class:collision={br.collision} style={`grid-column:${br.col};grid-row:${br.from} / ${br.to}`}>
      <button class="bracket-label" data-scene={br.scene.id} class:selected={selected===br.scene.id} draggable="true" title="Drag to move the whole scene. Click for its backstory links." on:dragstart={e=>dragStart(e,'scene',br.scene.id)} on:click={()=>selected=br.scene.id} on:dblclick={()=>openCard({...br.scene,type:'scene'})} on:mouseenter={()=>hover(br.scene)} on:mouseleave={()=>hover(null)} on:focus={()=>hover(br.scene)} on:blur={()=>hover(null)}>{br.collision?'Collision':'Scene'}: {br.scene.title}{#if br.scene.chapter} · read in Ch {br.scene.chapter}{/if}</button>
     </div>
    {/each}
    {#if lines.length}<svg class="lines" aria-hidden="true">{#each lines as l}<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}/>{/each}</svg>{/if}
   </div>

   <section class="tray" aria-label="Tray">
    <h2>Tray</h2><p class="hint">Unplaced beats. Drag onto a column, or into a lane’s tray to park them there.</p>
    <div class="tray-groups">
     {#each lanes as lane}{@const items=trayFor(lane.id)}{@const tps=tpsFor(lane.id)}
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="tray-group" class:drop={dropKey===`tray|${lane.id}`} style={`--lane:${laneColor(lane)}`} on:dragover={e=>over(e,`tray|${lane.id}`)} on:drop={e=>dropTray(e,lane)}>
       <h3><span class="dot"></span>{lane.card.title}</h3>
       {#if tps.length+items.length>1}<div class="layout"><button class="chip" disabled={busy} title="Each one gets its own column before Chapter 1, in story order" on:click={()=>layoutLane(lane,'backstory')}>All into backstory</button><button class="chip" disabled={busy} title="Each one gets its own column at the end, in story order" on:click={()=>layoutLane(lane,'present')}>All at the end</button></div>{/if}
       {#each tps as tp}<button class="beat tp" class:selected={selected===tp.id} draggable="true" on:dragstart={e=>dragStart(e,'tp',tp.id)} on:click={()=>selected=tp.id}><small>Turning point{tp.status==='approved'?'':` · ${tp.status.replace('_',' ')}`}</small><b>{tp.text.split('\n')[0]}</b></button>{/each}
       {#each items as b}<button class="beat" data-beat={b.id} class:selected={selected===b.id} draggable="true" on:dragstart={e=>dragStart(e,'beat',b.id)} on:click={()=>selected=b.id}><b>{beatTitle(b)}</b></button>{/each}
       {#if !tps.length&&!items.length}<p class="none">Nothing parked.</p>{/if}
      </div>
     {/each}
     <!-- svelte-ignore a11y-no-static-element-interactions -->
     <div class="tray-group nolane" class:drop={dropKey==='tray|none'} on:dragover={e=>over(e,'tray|none')} on:drop={e=>dropTray(e,null)}>
      <h3>No lane</h3>
      {#each loose as b}<button class="beat" class:event={b.type==='event'} data-beat={b.id} class:selected={selected===b.id} draggable="true" on:dragstart={e=>dragStart(e,'beat',b.id)} on:click={()=>selected=b.id}>{#if b.type==='event'}<small>Event{b.subtype?` · ${b.subtype}`:''}</small>{/if}<b>{beatTitle(b)}</b>{#if b.parent_id&&scenesById.get(b.parent_id)}<small>Scene: {scenesById.get(b.parent_id).title}</small>{/if}</button>{/each}
      {#if !loose.length}<p class="none">Every beat has a lane.</p>{/if}
     </div>
    </div>
   </section>
  </div>
 {/if}

 {#if sel||selTP||selSceneCard}
  <aside class="inspector" aria-label="Selected beat">
   <button class="plain close" on:click={()=>selected=''}>Close</button>
   {#if selTP}
    <p class="kicker">Turning point · {laneById.get(selTP.lane_id)?.card.title||selTP.plot_title}</p>
    <p class="tp-text">{selTP.text}</p>
    <p class="hint">Placing it creates a beat card linked to this turning point. Editing either one updates the other.</p>
    <label for="tp-col">Place in column</label>
    <select id="tp-col" on:change={e=>moveTo(e.currentTarget.value)}><option value="">Choose…</option>{#each presentSlots as s,i}<option value={s}>{columnLabel(s,i)}</option>{/each}<option value="end">New column at the end</option><option value="back">New backstory column</option></select>
   {:else if selSceneCard}
    <p class="kicker">{(sceneColumn(selSceneCard.id)??0)<0?'Backstory scene':'Scene'}{selSceneCard.chapter?` · read in Ch ${selSceneCard.chapter}`:''}</p>
    <h2 class="scene-title">{selSceneCard.title}</h2>
    <h3>Beats</h3>
    <ul class="scene-beats">{#each sceneBeats as b}<li><button class="plain" on:click={()=>selected=b.id}>{beatTitle(b)}</button>{#if placements.get(b.id)}<small> · {laneById.get(placements.get(b.id).lane_id)?.card.title}</small>{/if}</li>{/each}</ul>
    <h3>Because of</h3>
    <p class="hint">What in the backstory drives this scene. Link a whole backstory plot, or one of its scenes or turning points.</p>
    {#each selLinks.filter((l:any)=>l.label===BECAUSE_OF) as l}<p class="link-row">{linkName(l.to_id)} <button class="plain danger" on:click={()=>removeLink(l.id)}>Remove</button></p>{/each}
    <select aria-label="Add a because of link" on:change={e=>{addLink(BECAUSE_OF,e.currentTarget.value);e.currentTarget.value='';}}><option value="">Add backstory cause…</option>{#each becauseGroups as gr}<optgroup label={gr.label}>{#each gr.items as o}<option value={o.id}>{o.title}</option>{/each}</optgroup>{/each}</select>
    <div class="foot"><button class="btn ghost" on:click={()=>openCard({...selSceneCard,type:'scene'})}>Open scene</button></div>
   {:else if sel}
    <p class="kicker">{sel.type==='event'?'Event':'Beat'}{sel.turning_point_id?' · linked to a turning point':''}</p>
    <label for="beat-title">Title</label><input id="beat-title" bind:value={draftTitle} on:blur={saveDraft}/>
    <label for="beat-body">What happens</label><textarea id="beat-body" rows="4" bind:value={draftBody} on:blur={saveDraft}></textarea>
    {#if sel.turning_point_id}<p class="hint">Edits here also update the turning point, which goes back to draft for approval.</p>{/if}
    <div class="row2">
     <div><label for="beat-lane">Lane</label><select id="beat-lane" value={selPlacement?.lane_id||''} on:change={e=>e.currentTarget.value?changeLane(e.currentTarget.value):unplace(sel.id)}><option value="">No lane</option>{#each lanes as lane}<option value={lane.id}>{lane.card.title}</option>{/each}</select></div>
     <div><label for="beat-col">Column</label><select id="beat-col" value={selPlacement?.slot==null?'tray':String(selPlacement.slot)} disabled={!selPlacement} on:change={e=>moveTo(e.currentTarget.value)}><option value="tray">Lane tray</option>{#each backSlots as s,i}<option value={String(s)}>Backstory: {columnLabel(s,i)}</option>{/each}{#each presentSlots as s,i}<option value={String(s)}>{columnLabel(s,i)}</option>{/each}<option value="end">New column at the end</option><option value="back">New backstory column</option></select></div>
    </div>
    {#if selPlacement}<label for="beat-time">Time label <small>(optional, free text)</small></label><input id="beat-time" placeholder="e.g. Spring 2187" bind:value={draftLabel} on:blur={saveLabel}/>{/if}
    <h3>Scene</h3>
    {#if selScene}<p>In <button class="plain" title="Show this scene and its backstory links" on:click={()=>selected=selScene.id}>{selScene.title}</button>{#if selScene.chapter} · read in Ch {selScene.chapter}{/if}</p><button class="chip" on:click={()=>act(()=>api(`/scenes/${selScene.id}/ungroup`,'POST',{beat_id:sel.id}))}>Take out of scene</button>
    {:else if sel.type==='beat'}<label for="group-with">Make a scene with</label><select id="group-with" on:change={e=>e.currentTarget.value&&group([e.currentTarget.value,sel.id])}><option value="">Choose a beat…</option>{#each (g.beats as any[]).filter(b=>b.type==='beat'&&b.id!==sel.id&&placements.get(b.id)?.slot!=null) as b}<option value={b.id}>{b.title}</option>{/each}</select>
    {:else}<p class="hint">Events stay loose. Link present beats to them with “because of”.</p>{/if}
    <h3>Because of</h3>
    {#each selLinks.filter((l:any)=>l.label===BECAUSE_OF) as l}<p class="link-row">{linkName(l.to_id)} <button class="plain danger" on:click={()=>removeLink(l.id)}>Remove</button></p>{/each}
    <select aria-label="Add a because of link" on:change={e=>{addLink(BECAUSE_OF,e.currentTarget.value);e.currentTarget.value='';}}><option value="">Add backstory cause…</option>{#each becauseGroups as gr}<optgroup label={gr.label}>{#each gr.items as o}<option value={o.id}>{o.title}</option>{/each}</optgroup>{/each}</select>
    <h3>Touches</h3>
    {#each selLinks.filter((l:any)=>l.label===TOUCHES) as l}<p class="link-row">{laneByCard.get(l.to_id)?.card.title||'A card'} <button class="plain danger" on:click={()=>removeLink(l.id)}>Remove</button></p>{/each}
    <select aria-label="Add a touches link" on:change={e=>{addLink(TOUCHES,e.currentTarget.value);e.currentTarget.value='';}}><option value="">Also touches lane…</option>{#each lanes.filter(l=>l.id!==selPlacement?.lane_id&&!selLinks.some((x:any)=>x.label===TOUCHES&&x.to_id===l.card_id)) as lane}<option value={lane.card_id}>{lane.card.title}</option>{/each}</select>
    <div class="foot"><button class="btn ghost" on:click={()=>openCard(sel)}>Open card</button>{#if selPlacement}<button class="chip" on:click={()=>unplace(sel.id)}>Remove from lane</button>{/if}</div>
   {/if}
  </aside>
 {/if}

 <dialog bind:this={addDialog} aria-labelledby="add-lane-title">
  <form class="dialog-body" on:submit|preventDefault={addLane}>
   <h2 id="add-lane-title">Add a lane</h2>
   <div class="segmented" role="tablist"><button type="button" role="tab" aria-selected={addMode==='existing'} on:click={()=>addMode='existing'}>Existing card</button><button type="button" role="tab" aria-selected={addMode==='new'} on:click={()=>addMode='new'}>New card</button></div>
   {#if addMode==='existing'}
    <label for="lane-card">Follow this card</label>
    <select id="lane-card" bind:value={laneChoice} required><option value="">Choose a card…</option>{#each candidatesByType as [type,list]}<optgroup label={TYPE_NAMES[type]||type}>{#each list as c}<option value={c.id}>{c.title}</option>{/each}</optgroup>{/each}</select>
   {:else}
    <label for="lane-type">Type</label><select id="lane-type" bind:value={newLaneType}>{#each NEW_TYPES as t}<option value={t}>{t}</option>{/each}</select>
    <label for="lane-title">Title</label><input id="lane-title" bind:value={newLaneTitle} required/>
    <label for="lane-body">{newLaneType==='plot'?'Premise':'Notes'} <small>(optional)</small></label><textarea id="lane-body" rows="3" bind:value={newLaneBody}></textarea>
   {/if}
   <div class="foot"><button type="button" class="btn ghost" on:click={()=>addDialog.close()}>Cancel</button><button class="btn" disabled={busy||(addMode==='existing'?!laneChoice:!newLaneTitle.trim())}>Add lane</button></div>
  </form>
 </dialog>
</div>

<style>
 .lanes-page{min-height:100dvh;background:var(--page);color:var(--ink);display:flex;flex-direction:column}
 .lanes-header{padding:22px 32px 16px;border-bottom:1px solid var(--line);background:var(--paper)}
 a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
 h1{font:500 34px var(--serif);margin:6px 0}
 .lanes-header>p{margin:4px 0;color:var(--dim)}.intro{max-width:70ch}
 .toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
 .cold{font-size:12.5px;color:var(--dim);display:flex;align-items:center;gap:6px}.cold input{width:56px;padding:4px 6px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--paper);color:var(--ink)}
 .error{color:var(--danger);margin-top:10px}
 .empty{padding:32px}.empty-state{margin:48px auto;max-width:560px;text-align:center;padding:0 16px}.empty-state h2{font:500 28px var(--serif)}.empty-state p{color:var(--dim);line-height:1.6}

 .board{flex:1;min-height:0;display:flex;flex-direction:column}
 .grid{position:relative;display:grid;overflow:auto;padding:0 24px 18px;align-items:stretch;max-height:68vh}
 .corner,.colhead{position:sticky;top:0;z-index:3;background:var(--page);font:600 12px var(--ui);color:var(--dim);padding:12px 8px 8px;border-bottom:1px solid var(--line)}
 .corner{left:0;z-index:5}
 .colhead{text-align:center;font:500 13px var(--serif);color:var(--ink)}.colhead.back{color:var(--dim);font-style:italic}
 .backstub-head{border:0;border-bottom:1px solid var(--line);cursor:pointer;font:italic 500 13px var(--serif);color:var(--dim)}
 .pileup{display:block;font:600 11px var(--ui);color:var(--pending-ink)}
 .divider{position:relative;display:flex;justify-content:center;z-index:1}
 .divider::before{content:'';position:absolute;top:0;bottom:0;left:50%;border-left:1.5px dashed var(--rule)}
 .divider span{position:sticky;top:8px;writing-mode:vertical-rl;transform:rotate(180deg);font:600 11px var(--ui);color:var(--dim);background:var(--page);padding:6px 0;height:max-content}
 .lanehead{position:sticky;left:0;z-index:2;background:var(--paper);border-bottom:1px solid var(--line);border-right:1px solid var(--line);padding:10px 10px 8px;display:flex;flex-direction:column;gap:4px}
 .lane-title{display:flex;gap:8px;align-items:flex-start;border:0;background:none;text-align:left;padding:0;color:var(--ink)}
 .lane-title b{display:block;font:500 15px/1.25 var(--serif)}.lane-title small{display:block;color:var(--dim);font-size:11.5px}
 .lane-title:hover b{color:var(--accent)}
 .dot{flex:0 0 10px;width:10px;height:10px;border-radius:50%;background:var(--lane);margin-top:4px}
 .lane-tools{display:flex;gap:8px;font-size:12px}.lane-tools .plain{font-size:12px}.lane-tools .plain:disabled{color:var(--line)}
 .quiet-note{color:var(--dim);font-size:11.5px;font-style:italic}
 .lane-grip{cursor:grab;font-size:16px;color:var(--dim);line-height:1}
 .lanehead.lane-drop{background:var(--accent-soft);outline:1px dashed var(--accent);outline-offset:-2px}
 .lanehead.collapsed{padding-top:6px;padding-bottom:6px}
 .cell{border-bottom:1px solid var(--line);padding:8px 4px;display:flex;flex-direction:column;gap:6px;min-height:72px;position:relative}
 .cell.back{background:color-mix(in srgb,var(--soft) 70%,transparent)}
 .cell.quiet{background-image:repeating-linear-gradient(135deg,transparent 0 7px,color-mix(in srgb,var(--line) 55%,transparent) 7px 8px)}
 .cell.backstub{background:var(--soft);align-items:center;justify-content:center}
 .endcell{align-items:flex-start;justify-content:center;padding-left:12px}
 .gap{border-bottom:1px solid var(--line)}
 .gap.drop,.cell.drop,.tray-group.drop{background:var(--accent-soft);outline:1.5px dashed var(--accent);outline-offset:-3px}
 .folded{font:600 12px var(--ui);color:var(--dim)}
 .beat{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;background:var(--paper);border:1px solid var(--line);border-radius:var(--radius-s);padding:7px 9px 8px;box-shadow:var(--shadow);color:var(--ink);cursor:grab;position:relative;z-index:1}
 .beat::before{content:'';position:absolute;left:9px;right:9px;top:0;height:2px;border-radius:0 0 2px 2px;background:var(--lane,var(--line))}
 .beat b{font:500 13.5px/1.3 var(--serif)}.beat small{font:600 10.5px var(--ui);color:var(--dim)}
 .beat .excerpt{font-size:12px;color:var(--dim);line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical}
 .beat:hover{border-color:var(--accent)}.beat.selected{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft),var(--shadow)}
 .beat.event{background:var(--soft)}.beat.event b{font-style:italic}
 .beat.linked{border-color:var(--accent);background:var(--accent-soft)}
 .beat.tp{border-style:dashed}
 .beat.tp b{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;line-clamp:3;-webkit-box-orient:vertical}
 .ghost{border:1px dashed var(--line);background:transparent;color:var(--dim);border-radius:var(--radius-s);padding:5px 8px;font:italic 12px var(--serif);text-align:left}
 .add{align-self:center;margin:auto;border:1px dashed transparent;background:none;color:var(--dim);width:30px;height:30px;border-radius:50%;font-size:18px;opacity:0}
 .cell:hover .add,.add:focus-visible{opacity:1;border-color:var(--line)}
 .bracket{pointer-events:none;position:relative;z-index:2;margin:4px 0 4px -2px;border-left:2px solid var(--dim);border-radius:6px 0 0 6px}
 .bracket.collision{border-left-color:var(--accent)}
 .bracket-label{pointer-events:auto;position:absolute;top:-2px;left:-2px;transform:translateY(-100%);max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:0;background:var(--page);color:var(--dim);font:600 10.5px var(--ui);padding:0 4px;cursor:grab}
 .bracket.collision .bracket-label{color:var(--accent)}
 .bracket-label.selected{color:var(--ink);text-decoration:underline}
 .layout{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 6px}
 .layout .chip{font-size:11.5px;padding:2px 8px}
 .scene-title{font:500 20px var(--serif);margin:2px 0 4px}
 .scene-beats{margin:0;padding-left:18px;font-size:13.5px}
 .lines{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;overflow:visible}.lines line{stroke:var(--accent);stroke-width:1.5;stroke-dasharray:4 3}

 .tray{border-top:1px solid var(--line);background:var(--paper);padding:14px 32px 28px}
 .tray h2{font:500 20px var(--serif);margin:0}.hint{color:var(--dim);font-size:12.5px;margin:4px 0 10px}
 .tray-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
 .tray-group{border:1px solid var(--line);border-radius:var(--radius);padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--soft);min-height:70px}
 .tray-group h3{display:flex;gap:6px;align-items:center;font:italic 500 14px var(--serif);margin:0 0 2px}.tray-group h3 .dot{margin-top:0}
 .none{color:var(--dim);font-size:12px;margin:0}

 .inspector{position:fixed;right:16px;top:16px;bottom:16px;width:min(360px,calc(100vw - 32px));overflow:auto;z-index:20;background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:16px 18px;display:flex;flex-direction:column;gap:6px}
 .inspector .close{align-self:flex-end}.kicker{font:600 12px var(--ui);color:var(--dim);margin:0}
 .inspector h3{font:italic 500 15px var(--serif);margin:12px 0 2px;padding-bottom:4px;border-bottom:1.5px solid var(--rule)}
 .inspector label,.dialog-body label{font-size:12.5px;font-weight:600;margin-top:6px}
 .inspector input,.inspector textarea,.inspector select,.dialog-body input,.dialog-body select,.dialog-body textarea{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--paper);color:var(--ink);font:inherit}
 .inspector textarea{font-family:var(--serif);font-size:14px;line-height:1.5}
 .tp-text{font:15px/1.5 var(--serif);white-space:pre-wrap;margin:4px 0}
 .row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.row2>div{display:flex;flex-direction:column}
 .link-row{display:flex;justify-content:space-between;gap:8px;margin:2px 0;font-size:13.5px}
 .foot{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;justify-content:flex-end}
 .dialog-body{padding:20px 22px;display:flex;flex-direction:column;gap:4px}.dialog-body h2{font:500 22px var(--serif);margin:0 0 8px}
 .segmented{display:flex;gap:4px;margin-bottom:6px}.segmented button{flex:1;border:1px solid var(--line);background:var(--paper);padding:7px;border-radius:var(--radius-s);font-weight:600;color:var(--ink)}.segmented button[aria-selected="true"]{background:var(--accent-soft);border-color:transparent;color:var(--accent)}

 .phone{padding:16px;display:flex;flex-direction:column;gap:8px}.phone select{padding:10px;border:1px solid var(--line);border-radius:var(--radius-s);background:var(--paper);color:var(--ink);font:inherit}
 .phone-cols{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:10px}.phone-cols li{display:flex;flex-direction:column;gap:6px}
 .col-label{font:600 12px var(--ui);color:var(--dim)}.phone-divider{font:600 12px var(--ui);color:var(--dim);border-top:1.5px dashed var(--rule);padding-top:6px}
 .phone h3{font:italic 500 16px var(--serif);margin:12px 0 0}.tray-items{display:flex;flex-direction:column;gap:6px}
 @media(max-width:960px){.lanes-header{padding:16px}h1{font-size:28px}.inspector{top:auto;max-height:70dvh;left:8px;right:8px;width:auto;bottom:8px}}
</style>

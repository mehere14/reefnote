import db from '../db';
import {ulid} from 'ulid';
import {z} from 'zod';
import {CoreError,getCard,getNovel,createCard,moveCard,snapshotCard,touchCard} from '../core';
import {createSubplot} from '../subplots/service';
import {ensureBridgeBeat} from './bridge';
import {placementOf,sceneSlot} from './sync';
import {LANE_COLORS,LANE_LINK_LABELS,NON_LANE_TYPES,PLACEABLE_TYPES} from '../../lanes';
const fail=(status:number,message:string,details:any={}):never=>{throw new CoreError(status,message,details);};

// ---------- Lanes ----------

export function getLane(id:string):any{return db.prepare('SELECT * FROM lanes WHERE id=?').get(id)||fail(404,'Lane not found');}

/** The subplot behind a plot card, so a plot lane can list its turning points. */
function subplotOfCard(cardId:string):string|null{
 return (db.prepare('SELECT coalesce(a.plot_id,s.plot_id) id FROM plot_sources s LEFT JOIN plot_aliases a ON a.alias_id=s.plot_id WHERE s.card_id=?').get(cardId) as any)?.id||null;
}

const newCardSchema=z.object({type:z.string(),title:z.string().min(1),body:z.string().default(''),subtype:z.string().default('')});
export function createLane(novelId:string,input:any){return db.transaction(()=>{
 getNovel(novelId);
 const d=z.object({card_id:z.string().optional(),new_card:newCardSchema.optional()}).parse(input);
 let cardId=d.card_id;
 if(!cardId){
  if(!d.new_card)fail(400,'Choose a card or describe a new one');
  const n=d.new_card!;
  if(NON_LANE_TYPES.includes(n.type))fail(400,'Chapters, scenes, beats and styles cannot be lanes');
  // A new plot gets a real subplot so its turning points appear on the lane.
  if(n.type==='plot'){const plot=createSubplot(novelId,{title:n.title,premise:n.body});cardId=(db.prepare('SELECT card_id FROM plot_sources WHERE plot_id=?').get(plot.id) as any).card_id;}
  else cardId=createCard(novelId,{type:n.type,title:n.title,body:n.body,subtype:n.subtype}).id;
 }
 const card=getCard(cardId!);
 if(card.novel_id!==novelId)fail(400,'Choose a card in this novel');
 if(NON_LANE_TYPES.includes(card.type))fail(400,'Chapters, scenes, beats and styles cannot be lanes');
 const existing=db.prepare('SELECT * FROM lanes WHERE novel_id=? AND card_id=?').get(novelId,card.id);
 if(existing)fail(409,'This card is already a lane',{lane:existing});
 const count=(db.prepare('SELECT count(*) n,coalesce(max(position),-1)+1 next FROM lanes WHERE novel_id=?').get(novelId) as any);
 const lane={id:ulid(),novel_id:novelId,card_id:card.id,position:count.next,color:LANE_COLORS[count.n%LANE_COLORS.length],collapsed:0,created_at:Date.now()};
 db.prepare('INSERT INTO lanes(id,novel_id,card_id,position,color,collapsed,created_at) VALUES(@id,@novel_id,@card_id,@position,@color,@collapsed,@created_at)').run(lane);
 return lane;
})();}

export function updateLane(id:string,input:any){return db.transaction(()=>{
 const lane=getLane(id);
 const d=z.object({position:z.number().optional(),move_to:z.string().optional(),direction:z.union([z.literal(-1),z.literal(1)]).optional(),color:z.string().refine(c=>!c||LANE_COLORS.includes(c),'Unknown lane colour').optional(),collapsed:z.boolean().optional()}).parse(input);
 if(d.direction||d.move_to){
  const lanes=db.prepare('SELECT id FROM lanes WHERE novel_id=? ORDER BY position,id').all(lane.novel_id) as {id:string}[];
  const from=lanes.findIndex(l=>l.id===id);
  const to=d.move_to?lanes.findIndex(l=>l.id===d.move_to):from+d.direction!;
  if(to>=0&&to<lanes.length&&to!==from){
   const [moved]=lanes.splice(from,1);
   lanes.splice(to,0,moved);
   const update=db.prepare('UPDATE lanes SET position=? WHERE id=?');
   lanes.forEach((entry,position)=>update.run(position,entry.id));
  }
 }
 if(d.position!==undefined)db.prepare('UPDATE lanes SET position=? WHERE id=?').run(d.position,id);
 if(d.color!==undefined)db.prepare('UPDATE lanes SET color=? WHERE id=?').run(d.color,id);
 if(d.collapsed!==undefined)db.prepare('UPDATE lanes SET collapsed=? WHERE id=?').run(d.collapsed?1:0,id);
 return getLane(id);
})();}

/** Placements cascade; the beats themselves stay and return to the global tray. */
export function deleteLane(id:string){return db.transaction(()=>{
 getLane(id);
 for(const row of db.prepare('SELECT beat_id FROM beat_placements WHERE lane_id=?').all(id) as any[]){snapshotCard(row.beat_id,'Lane removed');touchCard(row.beat_id);}
 db.prepare('DELETE FROM lanes WHERE id=?').run(id);
 return {deleted:true};
})();}

// ---------- Slots (story time) ----------

/**
 * Story time is an ordinal x-axis shared by every lane. Slots > 0 are the story's present,
 * slots < 0 are backstory (left of "Chapter 1 starts"). Inserting between two columns takes the
 * midpoint; when a gap falls below 1e-9 every distinct slot in the region is renumbered
 * (1…N, or −N…−1) in one go, keeping equal slots equal.
 */
function distinctSlots(novelId:string):number[]{
 return (db.prepare('SELECT DISTINCT p.slot FROM beat_placements p JOIN lanes l ON l.id=p.lane_id WHERE l.novel_id=? AND p.slot IS NOT NULL ORDER BY p.slot').all(novelId) as any[]).map(r=>r.slot);
}
export function renumberSlots(novelId:string){
 const slots=distinctSlots(novelId),back=slots.filter(s=>s<0),present=slots.filter(s=>s>=0),map=new Map<number,number>();
 back.forEach((s,i)=>map.set(s,i-back.length));present.forEach((s,i)=>map.set(s,i+1));
 const update=db.prepare('UPDATE beat_placements SET slot=? WHERE beat_id=?');
 for(const row of db.prepare('SELECT p.beat_id,p.slot FROM beat_placements p JOIN lanes l ON l.id=p.lane_id WHERE l.novel_id=? AND p.slot IS NOT NULL').all(novelId) as any[])update.run(map.get(row.slot),row.beat_id);
 return map;
}
const slotInput=z.object({slot:z.number().nullable().optional(),between:z.tuple([z.number().nullable(),z.number().nullable()]).optional(),region:z.enum(['backstory','present']).default('present')});
/** Resolve {slot} or {between:[left,right], region} into a concrete slot (null = tray). */
export function resolveSlot(novelId:string,input:any):number|null{
 const d=slotInput.parse(input);
 if(!d.between)return d.slot??null;
 let [a,b]=d.between;
 const mid=(lo:number,hi:number)=>(lo+hi)/2;
 const compute=()=>{
  if(d.region==='backstory'){const hi=b??0;return a===null?hi-1:mid(a,hi);}
  const lo=a??0;return b===null?(a===null?Math.max(0,...distinctSlots(novelId).filter(s=>s>0))+1:a+1):mid(lo,b);
 };
 let slot=compute();
 const lo=d.region==='backstory'?a:(a??0),hi=d.region==='backstory'?(b??0):b;
 if(lo!==null&&hi!==null&&Math.min(slot-lo,hi-slot)<1e-9){
  const map=renumberSlots(novelId);
  a=a===null?null:map.get(a)??a;b=b===null?null:map.get(b)??b;slot=compute();
 }
 return slot;
}

// ---------- Placement ----------

function placeableCard(id:string,novelId:string){
 const card=getCard(id);
 if(card.novel_id!==novelId)fail(400,'Card belongs to another novel');
 if(!PLACEABLE_TYPES.includes(card.type))fail(400,'Only beats and events can be placed on a lane');
 return card;
}
function checkBase(card:any,baseRev:any){if(baseRev!==undefined&&baseRev!==card.rev)fail(409,'This beat changed in another tab',{card,reason:'changed'});}
/** Write a placement row; shared by every direct grid action. */
function writePlacement(beatId:string,laneId:string,slot:number|null,timeLabel:string){
 db.prepare('INSERT INTO beat_placements(beat_id,lane_id,slot,time_label) VALUES(?,?,?,?) ON CONFLICT(beat_id) DO UPDATE SET lane_id=excluded.lane_id,slot=excluded.slot,time_label=excluded.time_label').run(beatId,laneId,slot,timeLabel);
}

const placeSchema=z.object({lane_id:z.string(),time_label:z.string().optional(),baseRev:z.number().int().optional()}).passthrough();
/**
 * PUT /beats/:id/placement. `id` may be a turning point id: its bridge beat is created first.
 * A beat inside a scene that moves to a different column than its scene's other beats is pulled
 * out of the scene (the writer's choice); moving the whole scene is moveScene.
 */
export function placeBeat(id:string,input:any){return db.transaction(()=>{
 const d=placeSchema.parse(input),lane=getLane(d.lane_id);
 const isTP=!!db.prepare('SELECT id FROM turning_points WHERE id=?').get(id);
 const beatId=isTP?ensureBridgeBeat(id):id;
 const card=placeableCard(beatId,lane.novel_id);
 if(!isTP)checkBase(card,d.baseRev);
 const before=placementOf(beatId);
 let slot=resolveSlot(lane.novel_id,input);
 const parent=card.parent_id?getCard(card.parent_id):null;
 if(parent?.type==='scene'&&slot!==null){
  const shared=sceneSlot(parent.id,beatId);
  if(shared!==null&&shared!==slot){moveCard(beatId,{parentId:null});}
 }
 const timeLabel=d.time_label??before?.time_label??'';
 if(before&&before.lane_id===lane.id&&before.slot===slot&&before.time_label===timeLabel)return grid(lane.novel_id);
 snapshotCard(beatId,before?'Moved on lane grid':'Placed on lane');
 writePlacement(beatId,lane.id,slot,timeLabel);
 touchCard(beatId);
 return grid(lane.novel_id);
})();}

/**
 * Lay out a lane in one step: its unplaced turning points (story order), then beats parked in its
 * tray, each in a new column at the end of the backstory region or of the present.
 * Used for a backstory plot whose turning points all happened before Chapter 1. With `plot_card_id`,
 * another plot's unplaced turning points are laid out on this lane instead (its tray is left alone).
 */
export function layoutLane(id:string,input:any){return db.transaction(()=>{
 const lane=getLane(id),d=z.object({region:z.enum(['backstory','present']).default('present'),plot_card_id:z.string().optional()}).parse(input),region=d.region;
 if(d.plot_card_id&&getCard(d.plot_card_id).novel_id!==lane.novel_id)fail(400,'Choose a plot in this novel');
 const subplot=subplotOfCard(d.plot_card_id||lane.card_id);
 const ids=[
  ...(subplot?(db.prepare('SELECT t.id FROM turning_points t WHERE t.subplot_id=? AND NOT EXISTS(SELECT 1 FROM turning_point_beats b WHERE b.turning_point_id=t.id) ORDER BY t.position,t.id').all(subplot) as any[]).map(r=>r.id):[]),
  ...(d.plot_card_id?[]:(db.prepare('SELECT p.beat_id id FROM beat_placements p JOIN cards c ON c.id=p.beat_id WHERE p.lane_id=? AND p.slot IS NULL ORDER BY c.position,c.id').all(id) as any[]).map(r=>r.id))
 ];
 if(!ids.length)fail(400,d.plot_card_id?'Every turning point of that plot is already placed':'Nothing in this lane’s tray to lay out');
 for(const beat of ids){
  const slots=distinctSlots(lane.novel_id),last=(region==='backstory'?slots.filter(s=>s<0):slots.filter(s=>s>=0)).at(-1)??null;
  placeBeat(beat,{lane_id:id,between:[last,null],region});
 }
 return grid(lane.novel_id);
})();}

export function unplaceBeat(id:string,input:any={}){return db.transaction(()=>{
 const card=getCard(id);checkBase(card,input.baseRev);
 if(placementOf(id)){snapshotCard(id,'Removed from lane');db.prepare('DELETE FROM beat_placements WHERE beat_id=?').run(id);touchCard(id);}
 return grid(card.novel_id);
})();}

const beatSchema=z.object({type:z.enum(['beat','event']).default('beat'),title:z.string().min(1),body:z.string().default(''),subtype:z.string().default(''),lane_id:z.string().optional(),scene_id:z.string().optional(),time_label:z.string().default('')}).passthrough();
/** Quick-add a beat (or backstory event) on the grid, optionally straight onto a lane cell or into a scene. */
export function createBeat(novelId:string,input:any){return db.transaction(()=>{
 const d=beatSchema.parse(input);
 if(d.type==='event'&&d.scene_id)fail(400,'Events cannot join a scene');
 const card=createCard(novelId,{type:d.type,title:d.title,body:d.body,subtype:d.subtype,parentId:d.scene_id||null},{note:'Created on lane grid'});
 if(d.lane_id){
  const lane=getLane(d.lane_id);if(lane.novel_id!==novelId)fail(400,'Lane belongs to another novel');
  const shared=d.scene_id?sceneSlot(d.scene_id,card.id):null;
  writePlacement(card.id,lane.id,shared??resolveSlot(novelId,input),d.time_label);
 }
 return {card:getCard(card.id),grid:grid(novelId)};
})();}

// ---------- Scenes (collisions) ----------

/** Move every placed beat of a scene to one column. Lanes are unchanged. */
export function moveScene(sceneId:string,input:any){return db.transaction(()=>{
 const scene=getCard(sceneId);if(scene.type!=='scene')fail(400,'Only scenes can be moved on the grid');
 const slot=resolveSlot(scene.novel_id,input);if(slot===null)fail(400,'Choose a column');
 for(const row of db.prepare('SELECT b.id FROM cards b JOIN beat_placements p ON p.beat_id=b.id WHERE b.parent_id=? AND p.slot IS NOT NULL').all(sceneId) as any[]){
  snapshotCard(row.id,'Scene moved on lane grid');db.prepare('UPDATE beat_placements SET slot=? WHERE beat_id=?').run(slot,row.id);touchCard(row.id);
 }
 return grid(scene.novel_id);
})();}

/**
 * Group beats into one scene. If the first beat is already in a scene, the others join that scene;
 * otherwise a new chapterless scene is created. All placed beats share the first placed beat's slot.
 */
export function groupScene(input:any){return db.transaction(()=>{
 const d=z.object({beat_ids:z.array(z.string()).min(1),title:z.string().optional()}).parse(input);
 if(new Set(d.beat_ids).size!==d.beat_ids.length)fail(400,'Each beat can be grouped once');
 const beats=d.beat_ids.map(id=>getCard(id)),novelId=beats[0].novel_id;
 if(beats.some(b=>b.novel_id!==novelId))fail(400,'Beats must belong to one novel');
 if(beats.some(b=>b.type!=='beat'))fail(400,'Only beats can be grouped into a scene; events stay loose');
 const first=beats[0],existing=first.parent_id?getCard(first.parent_id):null;
 const scene=existing?.type==='scene'?existing:createCard(novelId,{type:'scene',title:d.title||beats.map(b=>b.title).join(' / ').slice(0,120)},{note:'Created by grouping beats on lane grid'});
 // Joining an existing scene keeps its column; a new scene takes the first placed beat's column.
 const target=(existing?.type==='scene'?sceneSlot(scene.id):null)??beats.map(b=>placementOf(b.id)?.slot).find(s=>s!==null&&s!==undefined)??null;
 for(const beat of beats){
  if(beat.parent_id!==scene.id)moveCard(beat.id,{parentId:scene.id});
  const p=placementOf(beat.id);
  if(p&&p.slot!==null&&target!==null&&p.slot!==target)db.prepare('UPDATE beat_placements SET slot=? WHERE beat_id=?').run(target,beat.id);
 }
 return {scene:getCard(scene.id),grid:grid(novelId)};
})();}

/** Take one beat out of its scene. It keeps its lane and slot. Empty scenes are kept (they may hold prose). */
export function ungroupBeat(sceneId:string,input:any){return db.transaction(()=>{
 const beatId=z.string().parse(input.beat_id),beat=getCard(beatId);
 if(beat.parent_id!==sceneId)fail(400,'This beat is not in that scene');
 moveCard(beatId,{parentId:null});
 return grid(beat.novel_id);
})();}

// ---------- Grid read model ----------

const cardFields=(c:any)=>({id:c.id,type:c.type,subtype:c.subtype,title:c.title,body:c.body,parent_id:c.parent_id,rev:c.rev});
export function grid(novelId:string){
 getNovel(novelId);
 const lanes=(db.prepare('SELECT l.*,c.type card_type,c.subtype card_subtype,c.title card_title FROM lanes l JOIN cards c ON c.id=l.card_id WHERE l.novel_id=? ORDER BY l.position,l.id').all(novelId) as any[])
  .map(l=>({id:l.id,card_id:l.card_id,position:l.position,color:l.color,collapsed:!!l.collapsed,card:{id:l.card_id,type:l.card_type,subtype:l.card_subtype,title:l.card_title},subplot_id:l.card_type==='plot'?subplotOfCard(l.card_id):null}));
 const placements=db.prepare('SELECT p.* FROM beat_placements p JOIN lanes l ON l.id=p.lane_id WHERE l.novel_id=?').all(novelId) as any[];
 const placed=new Set(placements.map(p=>p.beat_id));
 const bridges=new Map((db.prepare('SELECT b.beat_id,b.turning_point_id FROM turning_point_beats b JOIN cards c ON c.id=b.beat_id WHERE c.novel_id=?').all(novelId) as any[]).map(r=>[r.beat_id,r.turning_point_id]));
 // Every beat and every event (timeline, history, backstory) is on the grid or in a tray, ready to place.
 const beats=(db.prepare("SELECT * FROM cards WHERE novel_id=? AND type IN ('beat','event') ORDER BY position,id").all(novelId) as any[])
  .map(c=>({...cardFields(c),placed:placed.has(c.id),turning_point_id:bridges.get(c.id)||null}));
 const chapters=(db.prepare("SELECT id,title,position FROM cards WHERE novel_id=? AND type='chapter' AND parent_id IS NULL ORDER BY position,id").all(novelId) as any[]).map((c,i)=>({...c,number:i+1}));
 const chapterNumber=new Map(chapters.map(c=>[c.id,c.number]));
 const sceneIds=[...new Set(beats.map(b=>b.parent_id).filter(Boolean))];
 const scenes=sceneIds.map(id=>getCard(id)).filter(s=>s.type==='scene').map(s=>({id:s.id,title:s.title,parent_id:s.parent_id,position:s.position,rev:s.rev,chapter:s.parent_id?chapterNumber.get(s.parent_id)??null:null}));
 // Every plot's turning points without a bridge beat yet: virtual tray items on their plot's lane,
 // and placeable on any lane (e.g. a backstory plot's turning points into a faction's backstory).
 const laneOfSubplot=new Map(lanes.filter(l=>l.subplot_id).map(l=>[l.subplot_id,l.id]));
 const turningPoints=(db.prepare(`SELECT t.*,s.title plot_title,(SELECT card_id FROM plot_sources WHERE plot_id=s.id) plot_card_id FROM turning_points t JOIN subplots s ON s.id=t.subplot_id
  WHERE s.novel_id=? AND s.id NOT IN (SELECT alias_id FROM plot_aliases) AND NOT EXISTS(SELECT 1 FROM turning_point_beats b WHERE b.turning_point_id=t.id) ORDER BY s.title,t.position,t.id`).all(novelId) as any[])
  .map(tp=>({id:tp.id,subplot_id:tp.subplot_id,lane_id:laneOfSubplot.get(tp.subplot_id)||null,plot_title:tp.plot_title,plot_card_id:tp.plot_card_id,text:tp.text,status:tp.status,position:tp.position}));
 const links=db.prepare(`SELECT id,from_id,to_id,label FROM links WHERE novel_id=? AND label IN (${LANE_LINK_LABELS.map(()=>'?').join(',')})`).all(novelId,...LANE_LINK_LABELS);
 const candidates=db.prepare(`SELECT id,type,subtype,title FROM cards WHERE novel_id=? AND type NOT IN (${NON_LANE_TYPES.map(()=>'?').join(',')}) AND NOT (type='plot' AND id NOT IN (SELECT card_id FROM plot_sources)) ORDER BY type,title`).all(novelId,...NON_LANE_TYPES);
 return {novel_id:novelId,lanes,placements,beats,scenes,chapters,turningPoints,links,candidates};
}

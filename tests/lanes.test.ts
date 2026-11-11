import {beforeEach,describe,expect,it} from 'vitest';
process.env.NOVEL_STUDIO_DB=':memory:';
const db=(await import('../src/lib/server/db')).default;
const core=await import('../src/lib/server/core');
const sp=await import('../src/lib/server/subplots/service');
const lanes=await import('../src/lib/server/lanes/service');
const struct=await import('../src/lib/server/ai/structure');
const {handleLanes}=await import('../src/lib/server/lanes/api');
const {migrateLanes}=await import('../src/lib/server/db/lane-schema');

beforeEach(()=>{db.prepare('DELETE FROM novels').run();db.prepare('INSERT INTO novels(id,title,created_at,updated_at) VALUES(?,?,?,?)').run('n','Lanes',1,1);});

/** A plot with two approved turning points, a character and a question, each followed as a lane. */
function setup(){
 let plot=sp.createSubplot('n',{title:'The heist',premise:'They rob the vault.'});plot=sp.approve('subplot',plot.id,plot.rev);
 const tps=['Crew assembles\nThe old team returns.','Vault opens'].map(text=>{const tp=sp.addTP(plot.id,{text});return sp.approve('turning_point',tp.id,tp.rev);});
 const plotCard=(db.prepare('SELECT card_id FROM plot_sources WHERE plot_id=?').get(plot.id) as any).card_id;
 const kira=core.createCard('n',{type:'character',title:'Kira'});
 const question=core.createCard('n',{type:'question',title:'Who tipped off the guards?'});
 const plotLane=lanes.createLane('n',{card_id:plotCard}),kiraLane=lanes.createLane('n',{card_id:kira.id}),questionLane=lanes.createLane('n',{card_id:question.id});
 return {plot,tps,plotCard,kira,question,plotLane,kiraLane,questionLane};
}
const placement=(id:string)=>db.prepare('SELECT * FROM beat_placements WHERE beat_id=?').get(id) as any;
const beat=(title:string,lane?:string,slot?:number,extra:any={})=>lanes.createBeat('n',{title,lane_id:lane,slot,...extra}).card;

describe('migration and rules',()=>{
 it('runs idempotently on boot',()=>{expect(()=>{migrateLanes(db);migrateLanes(db);}).not.toThrow();expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('lanes','beat_placements','turning_point_beats')").all()).toHaveLength(3);});
 it('allows parentless beats in core and in structure validation, but still rejects non-scene parents',()=>{
  const loose=core.createCard('n',{type:'beat',title:'Floating'});expect(loose.parent_id).toBeNull();
  const chapter=core.createCard('n',{type:'chapter',title:'One'});
  expect(()=>core.createCard('n',{type:'beat',title:'Bad',parentId:chapter.id})).toThrow('Invalid parent');
  const out=struct.structSchema.parse({suggestions:[{action:'create_card',type:'beat',title:'Loose idea',text_ref:'S1',what:'Add a loose beat'},{action:'create_card',type:'beat',title:'Under chapter',parent_id:chapter.id,text_ref:'S1',what:'Bad parent'}]});
  const made=struct.materialize('n','chapters','capture','## Loose idea\nSomething changes.\n',out,null as any);
  expect(made.map((s:any)=>s.payload.title)).toEqual(['Loose idea']);
 });
 it('rejects scenes, chapters, beats and styles as lanes, and duplicate lanes',()=>{
  const {kira}=setup();
  expect(()=>lanes.createLane('n',{new_card:{type:'scene',title:'Nope'}})).toThrow('cannot be lanes');
  expect(()=>lanes.createLane('n',{card_id:kira.id})).toThrow('already a lane');
 });
 it('creates a new plot lane through a real subplot',()=>{
  const lane=lanes.createLane('n',{new_card:{type:'plot',title:'Romance',body:'They fall.'}});
  const g=lanes.grid('n');expect(g.lanes.find((l:any)=>l.id===lane.id)?.subplot_id).toBeTruthy();
 });
});

describe('slots',()=>{
 it('inserts between columns at the midpoint and renumbers tiny gaps, keeping shared columns shared',()=>{
  const {plotLane,kiraLane}=setup();
  const a=beat('A',plotLane.id,1),b=beat('B',plotLane.id,1+1e-10),c=beat('C',kiraLane.id,1);
  expect(lanes.resolveSlot('n',{between:[1,2]})).toBe(1.5);
  const slot=lanes.resolveSlot('n',{between:[1,1+1e-10]});
  expect(placement(a.id).slot).toBe(1);expect(placement(b.id).slot).toBe(2);expect(placement(c.id).slot).toBe(1);
  expect(slot).toBe(1.5);
 });
 it('keeps backstory left of zero and present right of it',()=>{
  const {plotLane}=setup();beat('Old war',plotLane.id,-1);beat('Now',plotLane.id,1);
  expect(lanes.resolveSlot('n',{between:[-1,null],region:'backstory'})).toBe(-.5);
  expect(lanes.resolveSlot('n',{between:[null,-1],region:'backstory'})).toBe(-2);
  expect(lanes.resolveSlot('n',{between:[null,1],region:'present'})).toBe(.5);
  expect(lanes.resolveSlot('n',{between:[1,null]})).toBe(2);
 });
});

describe('placement',()=>{
 it('shows unplaced turning points under their plot lane, and bridges on first placement',()=>{
  const {tps,plotLane,kiraLane}=setup();
  let g=lanes.grid('n');expect(g.turningPoints.map((t:any)=>[t.id,t.lane_id])).toEqual(tps.map(t=>[t.id,plotLane.id]));
  g=lanes.placeBeat(tps[0].id,{lane_id:plotLane.id,slot:1});
  const bridge=db.prepare('SELECT beat_id FROM turning_point_beats WHERE turning_point_id=?').get(tps[0].id) as any;
  const card=core.getCard(bridge.beat_id);
  expect(card).toMatchObject({type:'beat',title:'Crew assembles',body:'Crew assembles\nThe old team returns.',parent_id:null});
  expect(g.turningPoints.map((t:any)=>t.id)).toEqual([tps[1].id]);
  // Placing the same turning point again moves its existing bridge beat.
  lanes.placeBeat(tps[0].id,{lane_id:kiraLane.id,slot:2});
  expect(placement(card.id)).toMatchObject({lane_id:kiraLane.id,slot:2});
  expect(db.prepare('SELECT count(*) n FROM turning_point_beats').get()).toEqual({n:1});
 });
 it('syncs turning point text and beat body both ways, with review badges',()=>{
  const {plot,tps,plotLane}=setup();
  const scene=sp.addElement(plot.id,{title:'Scene',turning_point_id:tps[0].id});
  lanes.placeBeat(tps[0].id,{lane_id:plotLane.id,slot:1});
  const beatId=(db.prepare('SELECT beat_id FROM turning_point_beats').get() as any).beat_id;
  let tp=sp.getTP(tps[0].id);sp.editTP(tp.id,{text:'Crew splinters\nNobody trusts anyone.',baseRev:tp.rev});
  expect(core.getCard(beatId)).toMatchObject({title:'Crew splinters',body:'Crew splinters\nNobody trusts anyone.'});
  expect(sp.getElement(scene.scene_id).status).toBe('needs_review');
  tp=sp.approve('turning_point',tp.id,sp.getTP(tp.id).rev);
  const card=core.getCard(beatId);core.updateCard(beatId,{body:'Crew reunites anyway.',baseRev:card.rev});
  expect(sp.getTP(tp.id)).toMatchObject({text:'Crew reunites anyway.',status:'draft'});
  expect(sp.getTP(tp.id).rev).toBeGreaterThan(tp.rev);
 });
 it('versions placements and restores them from history',()=>{
  const {plotLane,kiraLane}=setup();const b=beat('Ambush',plotLane.id,1);
  lanes.placeBeat(b.id,{lane_id:kiraLane.id,slot:3});
  const versions=db.prepare("SELECT id,note FROM versions WHERE card_id=? ORDER BY created_at DESC,id DESC").all(b.id) as any[];
  expect(versions[0].note).toBe('Moved on lane grid');
  core.restoreVersion(versions[0].id);
  expect(placement(b.id)).toMatchObject({lane_id:plotLane.id,slot:1});
 });
 it('refuses a stale baseRev',()=>{const {plotLane}=setup();const b=beat('X',plotLane.id,1);expect(()=>lanes.placeBeat(b.id,{lane_id:plotLane.id,slot:2,baseRev:b.rev-1})).toThrow('changed');});
 it('deleting a lane returns its beats to the global tray; deleting its card removes the lane',()=>{
  const {plotLane,kiraLane,kira}=setup();const b=beat('Chase',plotLane.id,1),k=beat('Kira hides',kiraLane.id,1);
  lanes.deleteLane(plotLane.id);
  expect(placement(b.id)).toBeUndefined();expect(core.getCard(b.id).type).toBe('beat');
  expect(lanes.grid('n').beats.find((x:any)=>x.id===b.id)?.placed).toBe(false);
  core.deleteCard(kira.id);
  expect(db.prepare('SELECT * FROM lanes WHERE id=?').get(kiraLane.id)).toBeUndefined();
  expect(placement(k.id)).toBeUndefined();
 });
});

describe('scenes',()=>{
 it('groups two beats on different lanes into one collision scene at the target column',()=>{
  const {plotLane,kiraLane}=setup();const a=beat('Vault alarm',plotLane.id,2),b=beat('Kira freezes',kiraLane.id,5);
  const {scene}=lanes.groupScene({beat_ids:[a.id,b.id]});
  expect(scene).toMatchObject({type:'scene',parent_id:null});
  expect(core.getCard(a.id).parent_id).toBe(scene.id);expect(core.getCard(b.id).parent_id).toBe(scene.id);
  expect(placement(b.id)).toMatchObject({lane_id:kiraLane.id,slot:2});
  expect(lanes.grid('n').scenes.map((s:any)=>s.id)).toEqual([scene.id]);
 });
 it('joins an existing scene, adopts its slot, moves together, and pulls a beat out when dragged to another column',()=>{
  const {plotLane,kiraLane,questionLane}=setup();const a=beat('A',plotLane.id,2),b=beat('B',kiraLane.id,2);
  const {scene}=lanes.groupScene({beat_ids:[a.id,b.id]});
  const c=beat('C',questionLane.id,9,{scene_id:scene.id});expect(placement(c.id).slot).toBe(2);
  lanes.moveScene(scene.id,{slot:4});
  expect([a,b,c].map(x=>placement(x.id).slot)).toEqual([4,4,4]);
  lanes.placeBeat(c.id,{lane_id:questionLane.id,slot:7});
  expect(core.getCard(c.id).parent_id).toBeNull();expect(placement(c.id).slot).toBe(7);
  lanes.placeBeat(b.id,{lane_id:questionLane.id,slot:4});
  expect(core.getCard(b.id).parent_id).toBe(scene.id);expect(placement(b.id).lane_id).toBe(questionLane.id);
 });
 it('ungroups a beat and keeps its placement',()=>{
  const {plotLane,kiraLane}=setup();const a=beat('A',plotLane.id,1),b=beat('B',kiraLane.id,1);const {scene}=lanes.groupScene({beat_ids:[a.id,b.id]});
  lanes.ungroupBeat(scene.id,{beat_id:b.id});
  expect(core.getCard(b.id).parent_id).toBeNull();expect(placement(b.id).slot).toBe(1);expect(core.getCard(scene.id).type).toBe('scene');
 });
 it('deleting a scene releases lane beats and bridged beats but deletes other beats as before',()=>{
  const {tps,plotLane,kiraLane}=setup();
  lanes.placeBeat(tps[0].id,{lane_id:plotLane.id,slot:1});
  const bridged=(db.prepare('SELECT beat_id FROM turning_point_beats').get() as any).beat_id;
  const placed=beat('Placed',kiraLane.id,1);const {scene}=lanes.groupScene({beat_ids:[bridged,placed.id]});
  lanes.unplaceBeat(bridged);
  const plain=core.createCard('n',{type:'beat',title:'Plain',parentId:scene.id});
  core.deleteCard(scene.id);
  expect(core.getCard(bridged).parent_id).toBeNull();expect(core.getCard(placed.id).parent_id).toBeNull();
  expect(placement(placed.id).slot).toBe(1);
  expect(db.prepare('SELECT id FROM cards WHERE id=?').get(plain.id)).toBeUndefined();
 });
 it('refuses to put events in scenes',()=>{const {plotLane}=setup();const e=beat('Old war',plotLane.id,-1,{type:'event',subtype:'backstory'});const b=beat('Now',plotLane.id,1);expect(()=>lanes.groupScene({beat_ids:[b.id,e.id]})).toThrow('Only beats');});
});

describe('backstory plots',()=>{
 it('lays out a backstory plot: every turning point gets its own backstory column, in story order',()=>{
  const {tps,plotLane,kiraLane}=setup();
  const present=beat('Now',kiraLane.id,1),older=beat('Older memory',kiraLane.id,undefined,{between:[null,null],region:'backstory'});
  lanes.layoutLane(plotLane.id,{region:'backstory'});
  const placed=tps.map(t=>placement((db.prepare('SELECT beat_id FROM turning_point_beats WHERE turning_point_id=?').get(t.id) as any).beat_id));
  expect(placed.every(p=>p.lane_id===plotLane.id&&p.slot<0)).toBe(true);
  expect(placed[0].slot).toBeGreaterThan(placement(older.id).slot);
  expect(placed[1].slot).toBeGreaterThan(placed[0].slot);
  expect(placement(present.id).slot).toBe(1);
  expect(lanes.grid('n').turningPoints).toHaveLength(0);
  expect(()=>lanes.layoutLane(plotLane.id,{region:'backstory'})).toThrow('Nothing');
 });
 it('lists turning points of plots that are not lanes, and lays a whole plot into another lane’s backstory',()=>{
  const {kiraLane,questionLane}=setup();
  let back=sp.createSubplot('n',{title:'The old war',premise:'Before the story.'});back=sp.approve('subplot',back.id,back.rev);
  const tps=['Energy shock','Proxy wars','Exile'].map(text=>sp.addTP(back.id,{text}));
  const backCard=(db.prepare('SELECT card_id FROM plot_sources WHERE plot_id=?').get(back.id) as any).card_id;
  const listed=(lanes.grid('n').turningPoints as any[]).filter(t=>t.plot_card_id===backCard);
  expect(listed.map(t=>t.text)).toEqual(['Energy shock','Proxy wars','Exile']);
  expect(listed.every(t=>t.lane_id===null&&t.plot_title==='The old war')).toBe(true);
  // One turning point placed straight into a cell of a non-plot lane.
  lanes.placeBeat(tps[0].id,{lane_id:questionLane.id,between:[null,null],region:'backstory'});
  // The rest of the plot, in story order, into Kira's backstory.
  lanes.layoutLane(kiraLane.id,{region:'backstory',plot_card_id:backCard});
  const slotOf=(tp:any)=>placement((db.prepare('SELECT beat_id FROM turning_point_beats WHERE turning_point_id=?').get(tp.id) as any).beat_id);
  expect(slotOf(tps[0])).toMatchObject({lane_id:questionLane.id,slot:-1});
  expect(slotOf(tps[1]).lane_id).toBe(kiraLane.id);
  expect(slotOf(tps[1]).slot).toBeLessThan(0);expect(slotOf(tps[2]).slot).toBeGreaterThan(slotOf(tps[1]).slot);
  expect(()=>lanes.layoutLane(kiraLane.id,{region:'backstory',plot_card_id:backCard})).toThrow('already placed');
 });
 it('lays out at the end of the present too',()=>{
  const {plotLane,kiraLane}=setup();beat('Now',kiraLane.id,1);
  lanes.layoutLane(plotLane.id,{region:'present'});
  expect((lanes.grid('n').placements as any[]).filter(p=>p.lane_id===plotLane.id).map(p=>p.slot).sort()).toEqual([2,3]);
 });
 it('links a present scene to a whole backstory plot, a backstory scene, and a turning point, versioned on the scene',()=>{
  const {plotLane,plotCard,kiraLane}=setup();
  lanes.layoutLane(plotLane.id,{region:'backstory'});
  const [first,second]=(lanes.grid('n').beats as any[]).filter(b=>b.turning_point_id);
  const backScene=lanes.groupScene({beat_ids:[first.id,second.id],title:'The night of the vault'}).scene;
  const a=beat('Kira lies',kiraLane.id,1),b=beat('Kira runs',kiraLane.id,1);
  const scene=lanes.groupScene({beat_ids:[a.id,b.id]}).scene;
  for(const to of [plotCard,backScene.id,first.id])core.createLink({fromId:scene.id,toId:to,label:'because of'});
  const links=(lanes.grid('n').links as any[]).filter(l=>l.from_id===scene.id);
  expect(links.map(l=>l.to_id).sort()).toEqual([plotCard,backScene.id,first.id].sort());
  expect((db.prepare("SELECT count(*) n FROM versions WHERE card_id=? AND note='Added link'").get(scene.id) as any).n).toBe(3);
 });
});

describe('grid read model and API',()=>{
 it('lists every existing event, whatever its subtype, so it can be placed in the backstory',()=>{
  const {kiraLane}=setup();const old=core.createCard('n',{type:'event',subtype:'historical',title:'The Quietening'});
  expect(lanes.grid('n').beats.find((b:any)=>b.id===old.id)).toMatchObject({placed:false,type:'event'});
  lanes.placeBeat(old.id,{lane_id:kiraLane.id,between:[null,null],region:'backstory'});
  expect(placement(old.id)).toMatchObject({lane_id:kiraLane.id,slot:-1});
 });
 it('returns lanes, placements, backstory events and lane links',async()=>{
  const {plotLane,kiraLane,kira}=setup();
  const event=beat('The old war',plotLane.id,-1,{type:'event',subtype:'backstory'}),now=beat('Revenge',kiraLane.id,1);
  core.createLink({fromId:now.id,toId:event.id,label:'because of'});core.createLink({fromId:now.id,toId:kira.id,label:'touches'});core.createLink({fromId:now.id,toId:kira.id,label:'present'});
  const call=async(path:string,method='GET',body?:any)=>{const res=await handleLanes({params:{path},request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})}),url:new URL('http://localhost/api/'+path)});return {status:res!.status,data:await res!.json()};};
  const {status,data}=await call('novels/n/grid');
  expect(status).toBe(200);
  expect(data.lanes.map((l:any)=>l.card.title)).toEqual(['The heist','Kira','Who tipped off the guards?']);
  expect(data.lanes.map((l:any)=>l.color)).toEqual(['lane-1','lane-2','lane-3']);
  expect(data.beats.map((b:any)=>b.title).sort()).toEqual(['Revenge','The old war']);
  expect(data.links.map((l:any)=>l.label).sort()).toEqual(['because of','touches']);
  expect((await call(`lanes/${kiraLane.id}`,'PATCH',{direction:-1})).data.position).toBe(0);
  const lastLane=data.lanes.at(-1).id;
  await call(`lanes/${kiraLane.id}`,'PATCH',{move_to:lastLane});
  const reordered=(await call('novels/n/grid')).data;
  expect(reordered.lanes.map((l:any)=>l.id)).toEqual([plotLane.id,lastLane,kiraLane.id]);
  expect(reordered.placements.find((p:any)=>p.beat_id===now.id)).toMatchObject({lane_id:kiraLane.id,slot:1});
  expect((await call(`beats/${now.id}/placement`,'DELETE')).status).toBe(200);
  await expect(call('scenes/group','POST',{beat_ids:[]})).rejects.toThrow();
  expect(await handleLanes({params:{path:'novels/n/subplots'},request:new Request('http://localhost/api/x'),url:new URL('http://localhost/api/x')})).toBeNull();
 });
});

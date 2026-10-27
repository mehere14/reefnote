import {afterAll,beforeEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'reefnote-chapter-'));
process.env.DATA_DIR=directory;process.env.NOVEL_STUDIO_DB=':memory:';
const db=(await import('../src/lib/server/db')).default;
const core=await import('../src/lib/server/core');
const ai=await import('../src/lib/server/ai/api');
const {saveConfig}=await import('../src/lib/server/ai/settings');
const routes=await import('../src/routes/api/[...path]/+server');
async function call(method:string,path:string,data?:any){const url=new URL('http://localhost/api/'+path);return (routes as any)[method]({url,params:{path:url.pathname.slice(5)},request:new Request(url,{method,...(data!==undefined?{body:JSON.stringify(data),headers:{'content-type':'application/json'}}:{})})}) as Promise<Response>;}
async function begin(chapter:string,options:any={}){return call('POST','novels/n/turns',{scope:chapter,flow:'chapter_draft',text:'Let the storm build.',...options});}
function setup(){const chapter=core.createCard('n',{type:'chapter',title:'Storm',body:'CHAPTER NOTES',fields:{purpose:'Reveal the missing map',closes:'A ship appears'}}),first=core.createCard('n',{type:'scene',title:'Harbor',parentId:chapter.id,body:'HARBOR PLAN'}),second=core.createCard('n',{type:'scene',title:'Crossing',parentId:chapter.id,body:'CROSSING PLAN'});return {chapter,first,second};}
function mock(onStream:(args:any,index:number)=>string){let index=0;const calls:any[]=[];ai.setProviderFactory(()=>({async *stream(args:any){calls.push(args);yield onStream(args,index++);},async structured(){throw new Error('Chapter drafts must not be remapped by a model');},async test(){return {ok:true,msg:'OK'};},async listModels(){return [];}}));return calls;}
beforeEach(()=>{db.prepare('DELETE FROM novels').run();db.prepare('DELETE FROM settings').run();db.prepare('DELETE FROM fts').run();db.prepare("INSERT INTO novels(id,title,created_at,updated_at) VALUES('n','Novel',1,1)").run();saveConfig({provider:'openai',modelWrite:'mock',modelStruct:'mock',budget:20000});});
afterAll(()=>rmSync(directory,{recursive:true,force:true}));
it('drafts in scene order with optional beats, cast, style and new continuity, then populates scene prose on acceptance',async()=>{
 const {chapter,first,second}=setup();
 const beat=core.createCard('n',{type:'beat',title:'Find the compass',parentId:first.id,body:'COMPASS BEAT'});
 const cast=core.createCard('n',{type:'character',title:'Mara',body:'MARA BIOGRAPHY\n## Voice\n### Dialogue\nMARA DIALOGUE\n### Interior\nMARA INTERIOR'});
 core.createLink({fromId:first.id,toId:cast.id,label:'POV'});core.createLink({fromId:first.id,toId:cast.id,label:'present'});
 core.updateCard(chapter.id,{fields:{...chapter.fields,styleNotes:'CHAPTER STYLE'}});
 core.saveProse(first.id,{text:'Old harbor prose.',baseRev:1});
 const writing=['She found the compass.\n\nThunder rolled.','The crossing began. A ship appeared.'];
 const calls=mock((_,i)=>writing[i]);
 const {turnId}=await(await begin(chapter.id)).json();const events=await(await call('GET',`turns/${turnId}/stream`)).text();
 expect(events).toContain('event: done');expect(events).toContain('Drafting scene 2 of 2');expect(calls).toHaveLength(2);
 expect(calls[0].messages[0].content).toContain('HARBOR PLAN');expect(calls[0].messages[0].content).toContain('COMPASS BEAT');expect(calls[0].messages[0].content).toContain('MARA BIOGRAPHY');
 expect(calls[0].system).toContain('MARA DIALOGUE');expect(calls[0].system).toContain('MARA INTERIOR');expect(calls[0].system).toContain('CHAPTER STYLE');
 expect(calls[1].messages[0].content).toContain('CROSSING PLAN');expect(calls[1].messages[0].content).toContain(writing[0]);expect(calls[1].messages[0].content).not.toContain('Old harbor prose.');expect(calls[1].messages[0].content).toContain('Let the storm build.');
 const suggestions=await(await call('GET',`novels/n/suggestions?cardId=${chapter.id}`)).json();expect(suggestions).toHaveLength(2);
 expect((await(await call('GET',`cards/${first.id}/prose`)).json()).text).toBe('Old harbor prose.');
 for(const scene of [first,second]){const suggestion=suggestions.find((s:any)=>s.target_card_id===scene.id);expect(suggestion.payload.field).toBe('prose');expect(suggestion.scope).toBe(chapter.id);expect((await call('POST',`suggestions/${suggestion.id}/accept`,{})).status).toBe(200);}
 expect((await(await call('GET',`cards/${first.id}/prose`)).json()).text).toBe(writing[0]);expect((await(await call('GET',`cards/${second.id}/prose`)).json()).text).toBe(writing[1]);
 expect(core.getCard(first.id).body).toBe('HARBOR PLAN');expect(core.getCard(beat.id).body).toBe('COMPASS BEAT');expect(core.getCard(chapter.id).body).toBe('CHAPTER NOTES');
 const reader=await(await call('GET',`cards/${chapter.id}/read`)).json();expect(JSON.stringify(reader)).toContain(writing[1]);
 const turn=await(await call('GET',`turns/${turnId}`)).json();expect(turn.context_manifest.some((x:any)=>x.card_id===beat.id)).toBe(true);expect(turn.style_context.some((x:any)=>x.kind==='dialogue_voice')).toBe(true);
});
it('rejects missing scenes, non-chapter targets and restricted context',async()=>{const empty=core.createCard('n',{type:'chapter',title:'Empty'});expect((await begin(empty.id)).status).toBe(400);const {chapter,first}=setup();expect((await begin(first.id)).status).toBe(400);expect((await begin(chapter.id,{includeCardContext:false})).status).toBe(400);expect((await begin(chapter.id,{onlyCurrentCard:true})).status).toBe(400);});
it('protects edits made during generation and retains completed scenes after a later failure',async()=>{
 const {chapter,first}=setup();
 mock((_,i)=>{if(i===1)throw new Error('Provider unavailable');core.saveProse(first.id,{text:'My concurrent edit.',baseRev:1});return 'First complete draft.';});
 const {turnId}=await(await begin(chapter.id)).json();const events=await(await call('GET',`turns/${turnId}/stream`)).text();expect(events).toContain('event: error');
 const suggestions=await(await call('GET',`novels/n/suggestions?cardId=${chapter.id}`)).json();expect(suggestions).toHaveLength(1);
 expect((await call('POST',`suggestions/${suggestions[0].id}/accept`,{})).status).toBe(409);
 expect((await(await call('GET',`cards/${first.id}/prose`)).json()).text).toBe('My concurrent edit.');
 expect((db.prepare("SELECT text FROM messages WHERE turn_id=? AND role='assistant'").get(turnId) as any).text).toContain('First complete draft.');
});

it('passes chapter conversation and characters from other scenes to each scene draft',async()=>{
 const {chapter,first}=setup();const character=core.createCard('n',{type:'character',title:'Amissa',body:'RENAMED MACHINE BACKSTORY'});
 core.createLink({fromId:first.id,toId:character.id,label:''});
 db.prepare('INSERT INTO messages(id,novel_id,scope,role,text,created_at) VALUES(?,?,?,?,?,?)').run('rename','n',chapter.id,'user','Rename Nyx-7 to Amissa.',1);
 const calls=mock(()=> 'Revised prose.');const {turnId}=await(await begin(chapter.id)).json();await(await call('GET',`turns/${turnId}/stream`)).text();
 expect(calls).toHaveLength(2);
 for(const call of calls){expect(call.messages[0].content).toContain('Rename Nyx-7 to Amissa.');expect(call.messages[0].content).toContain('RENAMED MACHINE BACKSTORY');}
});

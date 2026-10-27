import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dataDir=mkdtempSync(join(tmpdir(),'novel-api-integration-'));
process.env.DATA_DIR=dataDir;
process.env.NOVEL_STUDIO_DB=':memory:';
const db=(await import('../src/lib/server/db')).default;
const routes=await import('../src/routes/api/[...path]/+server');
const ai=await import('../src/lib/server/ai/api');
const {createProvider}=await import('../src/lib/server/ai/providers');
const KEY='integration-secret-never-public';
const received:Array<{url:string,headers:any,body:any}>=[];
async function request(method:string,path:string,body?:any){const url=new URL('http://localhost/api/'+path),req=new Request(url,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'content-type':'application/json'}})});return (routes as any)[method]({request:req,url,params:{path:url.pathname.slice(5)}}) as Promise<Response>;}
async function json(method:string,path:string,body?:any){const response=await request(method,path,body);return{status:response.status,body:await response.json()};}
function providerStream(text:string){const chunks=[text.slice(0,Math.floor(text.length/2)),text.slice(Math.floor(text.length/2))];const frames=chunks.map(chunk=>'data: '+JSON.stringify({choices:[{delta:{content:chunk}}]})+'\n\n').join('')+'data: [DONE]\n\n';return new Response(new ReadableStream({start(controller){const bytes=new TextEncoder().encode(frames);for(let offset=0;offset<bytes.length;offset+=19)controller.enqueue(bytes.slice(offset,offset+19));controller.close();}}),{headers:{'content-type':'text/event-stream'}});}
function mockProvider(write:string,structure:any,invalidFirst=false){let structCalls=0;vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{const body=JSON.parse(init.body);received.push({url:String(url),headers:init.headers,body});const isStructure=body.messages[0].content.includes('Convert writing sections');if(isStructure){structCalls++;return providerStream(invalidFirst&&structCalls===1?'invalid JSON':JSON.stringify(structure));}return providerStream(write);}));}
async function configuredNovel(){expect((await json('PUT','settings',{provider:'openai',apiKey:KEY,modelWrite:'writer-model',modelStruct:'struct-model'})).status).toBe(200);return(await json('POST','novels',{title:'Test manuscript'})).body.novel;}
async function turn(novelId:string,text='Add a character'){const response=await json('POST',`novels/${novelId}/turns`,{scope:'characters',flow:'expand',text});expect(response.status).toBe(201);const stream=await request('GET',`turns/${response.body.turnId}/stream`);expect(stream.headers.get('content-type')).toBe('text/event-stream');const events=await stream.text();expect(events).toContain('event: done');return{events,id:response.body.turnId};}
beforeEach(()=>{db.prepare('DELETE FROM novels').run();db.prepare('DELETE FROM settings').run();db.prepare('DELETE FROM fts').run();received.length=0;ai.setProviderFactory(createProvider);});
afterEach(()=>vi.unstubAllGlobals());
afterAll(()=>rmSync(dataDir,{recursive:true,force:true}));
describe('real HTTP route and provider adapter lifecycle without live requests',()=>{
it('starts independent chats and preserves archived transcripts and card identity after deletion',async()=>{
 const n=await configuredNovel();
 const card=(await json('POST',`novels/${n.id}/cards`,{type:'character',title:'Mira'})).body.card;
 mockProvider('Remember the lighthouse.',{suggestions:[]});
 const first=await json('POST',`novels/${n.id}/turns`,{scope:card.id,flow:'card_chat',text:'My secret is the lighthouse.'});
 await(await request('GET',`turns/${first.body.turnId}/stream`)).text();
 const old=(await json('GET',`novels/${n.id}/chats`)).body[0];
 expect((await json('POST',`novels/${n.id}/chats`,{scope:card.id})).status).toBe(201);
 expect((await json('GET',`novels/${n.id}/messages?scope=${card.id}`)).body).toEqual([]);
 const second=await json('POST',`novels/${n.id}/turns`,{scope:card.id,flow:'card_chat',text:'Begin again with a forest.'});
 await(await request('GET',`turns/${second.body.turnId}/stream`)).text();
 expect(received.at(-1)!.body.messages[1].content).not.toContain('My secret is the lighthouse.');
 const archived=await json('GET',`novels/${n.id}/chats/${old.id}`);
 expect(archived.body.chat).toMatchObject({scope:card.id,card_type:'character',card_name:'Mira'});
 expect(archived.body.messages).toHaveLength(2);
 expect((await json('DELETE',`cards/${card.id}`)).status).toBe(200);
 const chats=(await json('GET',`novels/${n.id}/chats`)).body;
 expect(chats).toHaveLength(2);expect(chats.every((c:any)=>c.archived_at!==null)).toBe(true);
 expect((await json('GET',`novels/${n.id}/chats/${old.id}`)).body.messages).toHaveLength(2);
 const other=await configuredNovel();
 expect((await json('GET',`novels/${other.id}/chats/${old.id}`)).status).toBe(404);
});
it('streams two passes and accepts original prose verbatim with reversible history',async()=>{const novel=await configuredNovel();const body='A smuggler keeps a ledger of every debt.\n\nHer patience is dangerous.\n';mockProvider('## Oduya\n'+body,{suggestions:[{action:'create_card',type:'character',title:'Oduya',text_ref:'S1',what:'Add Oduya',why:'Requested'}]});const t=await turn(novel.id);expect(t.events).toContain('event: phase');expect(t.events).toContain('event: suggestions');const suggestions=(await json('GET',`novels/${novel.id}/suggestions?scope=characters`)).body;expect(suggestions).toHaveLength(1);expect(suggestions[0].payload.body).toBe(body);const accepted=await json('POST',`suggestions/${suggestions[0].id}/accept`,{});expect(accepted.status).toBe(200);expect(accepted.body.card.body).toBe(body);const versions=(await json('GET',`cards/${accepted.body.card.id}/versions`)).body;expect(versions[0].source).toBe('suggestion');expect(received).toHaveLength(2);expect(received.map(r=>r.body.model)).toEqual(['writer-model','struct-model']);expect(received.every(r=>r.url==='https://api.openai.com/v1/chat/completions')).toBe(true);expect(received.every(r=>r.headers.authorization===`Bearer ${KEY}`)).toBe(true);expect(t.events).not.toContain(KEY);});
it('stores rejection memory and filters the same proposal on a later turn',async()=>{const novel=await configuredNovel();mockProvider('## Captain\nA cautious navigator.\n',{suggestions:[{action:'create_card',type:'character',title:'Captain',text_ref:'S1',what:'Add Captain',why:'Requested'}]});await turn(novel.id);const [suggestion]=(await json('GET',`novels/${novel.id}/suggestions`)).body;expect((await json('POST',`suggestions/${suggestion.id}/reject`,{})).status).toBe(200);await turn(novel.id);expect((await json('GET',`novels/${novel.id}/suggestions`)).body).toHaveLength(0);expect(db.prepare('SELECT * FROM rejections WHERE novel_id=?').all(novel.id)).toHaveLength(1);expect(db.prepare("SELECT id FROM cards WHERE novel_id=? AND type!='style'").all(novel.id)).toHaveLength(0);});
it('encrypts secrets at rest and omits them from every settings response',async()=>{await configuredNovel();const saved=(db.prepare("SELECT value FROM settings WHERE key='ai'").get() as any).value;expect(saved).not.toContain(KEY);expect(JSON.parse(saved).encryptedKey).toBeTruthy();const publicSettings=await json('GET','settings');expect(publicSettings.body.hasKey).toBe(true);expect(JSON.stringify(publicSettings.body)).not.toContain(KEY);expect(publicSettings.body.apiKey).toBeUndefined();expect(publicSettings.body.encryptedKey).toBeUndefined();expect(readFileSync(join(dataDir,'secret.key'))).toHaveLength(32);expect(statSync(join(dataDir,'secret.key')).mode&0o777).toBe(0o600);expect(JSON.stringify((await json('PUT','settings',{provider:'openai',modelWrite:'updated-writer',modelStruct:'struct-model'})).body)).not.toContain(KEY);expect((await json('GET','settings')).body.hasKey).toBe(true);});
it('returns a plain missing-provider error without contacting a provider',async()=>{const n=(await json('POST','novels',{title:'No AI'})).body.novel;const spy=vi.fn();vi.stubGlobal('fetch',spy);const result=await json('POST',`novels/${n.id}/turns`,{scope:'characters',flow:'capture',text:'Add a pilot'});expect(result.status).toBe(400);expect(result.body.error).toBe('Add an AI provider in Settings to use the co-writer.');expect(spy).not.toHaveBeenCalled();});
it('retries only structuring after malformed provider JSON and keeps writing unchanged',async()=>{const n=await configuredNovel();const original='A truthful paragraph.\n';mockProvider('## Mira\n'+original,{suggestions:[{action:'create_card',type:'character',title:'Mira',text_ref:'S1',what:'Add Mira',why:'Requested'}]},true);await turn(n.id);expect(received.map(r=>r.body.model)).toEqual(['writer-model','struct-model','struct-model']);const [s]=(await json('GET',`novels/${n.id}/suggestions`)).body;expect(s.payload.body).toBe(original);expect(received[2].body.messages[1].content).toContain('validationError');expect((db.prepare("SELECT text FROM messages WHERE novel_id=? AND role='assistant'").get(n.id) as any).text).toBe('## Mira\n'+original);});
it.each(['concept','technology'])('repairs World & Rules %s and invalid fields when retrying saved writing',async(category)=>{
 const n=await configuredNovel();
 const card=(await json('POST',`novels/${n.id}/cards`,{type:'rule',title:'Existing world rule',body:'Original rule.'})).body.card;
 const writing='## Existing world rule\nNew rule detail.\n\n## Signal network\nThe network carries memories.\n';
 const invalid={suggestions:[{action:'update_card',card_id:card.id,field:'description',mode:'append',text_ref:'S1',what:'Extend rule'},{action:'create_card',type:category,title:'Signal network',text_ref:'S2',what:'Add network'}]};
 mockProvider(writing,invalid);
 const started=await json('POST',`novels/${n.id}/turns`,{scope:'world',flow:'expand',text:'Develop the network'});
 const events=await(await request('GET',`turns/${started.body.turnId}/stream`)).text();
 expect(events).toContain("Couldn't turn this into cards");
 const valid={suggestions:[{...invalid.suggestions[0],field:'body',why:'Add the requested network detail to the existing rule.'},{...invalid.suggestions[1],type:'rule',subtype:category,why:'Record the new network as a distinct world system.'}]};
 received.length=0;
 let calls=0;
 vi.stubGlobal('fetch',vi.fn(async(url:any,init:any)=>{const body=JSON.parse(init.body);received.push({url:String(url),headers:init.headers,body});return providerStream(JSON.stringify(++calls===1?invalid:valid));}));
 const retry=await json('POST',`turns/${started.body.turnId}/retry-structure`);
 expect(retry.status).toBe(200);
 expect(retry.body.suggestions).toHaveLength(2);
 expect(received.map(r=>r.body.model)).toEqual(['struct-model','struct-model']);
 const repair=JSON.parse(received[1].body.messages[1].content);
 expect(repair.validationError).toContain('invalid_string');
 expect(repair.validationError).toContain('invalid_enum_value');
 expect(received[0].body.messages[0].content).toContain('technology');
 expect(received[0].body.messages[0].content).toContain('fields.<key>');
 const added=retry.body.suggestions.find((s:any)=>s.action==='create_card');
 expect(added.payload).toMatchObject({type:'rule',subtype:category,body:'The network carries memories.\n'});
 const accepted=await json('POST',`suggestions/${added.id}/accept`,{});
 expect(accepted.body.card.body).toBe('The network carries memories.\n');
 const updated=retry.body.suggestions.find((s:any)=>s.action==='update_card');
 expect((await json('POST',`suggestions/${updated.id}/accept`,{})).body.card.body).toBe('Original rule.\n\nNew rule detail.\n\n');
 expect((await json('GET',`turns/${started.body.turnId}`)).body.error).toBeNull();
 expect((db.prepare("SELECT text FROM messages WHERE turn_id=? AND role='assistant'").get(started.body.turnId) as any).text).toBe(writing);
});
it('returns a readable retry failure and retains saved text after repeated invalid output',async()=>{
 const n=await configuredNovel();
 mockProvider('## Network\nSaved writing.\n',{suggestions:[{action:'create_card',type:'technology',title:'Network',text_ref:'S1',what:'Add network'}]});
 const t=await turn(n.id);
 received.length=0;
 const retry=await json('POST',`turns/${t.id}/retry-structure`);
 expect(retry.status).toBe(400);
 expect(retry.body.error).toBe("Couldn't turn this into cards. Your chat text is saved. Try again.");
 expect(received).toHaveLength(2);
 expect((db.prepare("SELECT text FROM messages WHERE turn_id=? AND role='assistant'").get(t.id) as any).text).toBe('## Network\nSaved writing.\n');
});
it('maps provider key rejection to plain error SSE without leaking credentials',async()=>{const n=await configuredNovel();vi.stubGlobal('fetch',vi.fn(async()=>new Response('unauthorized '+KEY,{status:401})));const started=await json('POST',`novels/${n.id}/turns`,{scope:'characters',flow:'capture',text:'Add pilot'});const response=await request('GET',`turns/${started.body.turnId}/stream`);const stream=await response.text();expect(stream).toContain('event: error');expect(stream).toContain('The provider rejected the API key. Check it in Settings.');expect(stream).not.toContain(KEY);expect((await json('GET',`turns/${started.body.turnId}`)).body.status).toBe('error');});
});

it('keeps chat suggestion-free and extracts from the full history only on request',async()=>{
 const n=await configuredNovel();
 mockProvider('## Mira\nMira is a navigator, not a pilot.\n',{suggestions:[{action:'create_card',type:'character',title:'Mira',text_ref:'S1',what:'Add Mira',why:'Latest character decision'}]});
 for(const text of ['Mira might be a pilot','Actually, make Mira a navigator']){
  const started=await json('POST',`novels/${n.id}/turns`,{scope:'characters',flow:'capture',text});
  await(await request('GET',`turns/${started.body.turnId}/stream`)).text();
 }
 expect(received).toHaveLength(2);
 expect((await json('GET',`novels/${n.id}/suggestions`)).body).toHaveLength(0);
 const generated=await json('POST',`novels/${n.id}/suggestions/generate`,{scope:'characters',instruction:'Extract only characters'});
 expect(generated.status).toBe(200);
 expect(generated.body.suggestions[0].payload.body).toContain('navigator, not a pilot');
 expect(received.slice(2).map(r=>r.body.model)).toEqual(['struct-model','struct-model']);
 const context=JSON.parse(received[2].body.messages[1].content);
 expect(context.instruction).toBe('Extract only characters');
 expect(context.conversation).toHaveLength(4);
 expect(context.conversation[0].text).toBe('Mira might be a pilot');
 expect(context.conversation[2].text).toBe('Actually, make Mira a navigator');
 expect(db.prepare('SELECT id FROM cards WHERE novel_id=? AND type=?').all(n.id,'character')).toHaveLength(0);
});

describe('chapter workspace conversations and references',()=>{
 it('keeps one chapter conversation while requests target different scenes',async()=>{
  const n=await configuredNovel();
  const chapter=(await json('POST',`novels/${n.id}/cards`,{type:'chapter',title:'Prologue'})).body.card;
  const scenes=[];for(const title of ['Arrival','Warning'])scenes.push((await json('POST',`novels/${n.id}/cards`,{type:'scene',title,parentId:chapter.id})).body.card);
  mockProvider('The lantern was still burning.',{suggestions:[]});
  for(const [i,scene] of scenes.entries()){
   const r=await json('POST',`novels/${n.id}/turns`,{scope:scene.id,conversationScope:chapter.id,flow:'card_chat',text:i?'Continue the lantern idea.':'Remember the lantern idea.'});
   expect(r.status).toBe(201);await(await request('GET',`turns/${r.body.turnId}/stream`)).text();
  }
  const history=(await json('GET',`novels/${n.id}/messages?scope=${chapter.id}`)).body;
  expect(history).toHaveLength(4);
  expect(history.map((m:any)=>m.scope)).toEqual([scenes[0].id,scenes[0].id,scenes[1].id,scenes[1].id]);
  expect(new Set(history.map((m:any)=>m.chat_id)).size).toBe(1);
  expect(received.at(-1)!.body.messages.at(-1).content).toContain('Remember the lantern idea.');
  await json('POST',`novels/${n.id}/chats`,{scope:chapter.id});
  expect((await json('GET',`novels/${n.id}/messages?scope=${chapter.id}`)).body).toEqual([]);
 });
 it('stores pins across archived conversations and prevents cross-novel pins',async()=>{
  const n=await configuredNovel();mockProvider('A useful scene reference.',{suggestions:[]});await turn(n.id);
  const m=(await json('GET',`novels/${n.id}/messages?scope=characters`)).body.find((m:any)=>m.role==='assistant');
  expect((await json('PUT',`novels/${n.id}/pins/${m.id}`)).status).toBe(200);
  await json('PUT',`novels/${n.id}/pins/${m.id}`);
  await json('POST',`novels/${n.id}/chats`,{scope:'characters'});
  expect((await json('GET',`novels/${n.id}/pins`)).body.map((p:any)=>p.id)).toEqual([m.id]);
  const other=(await json('POST','novels',{title:'Other'})).body.novel;
  expect((await json('PUT',`novels/${other.id}/pins/${m.id}`)).status).toBe(404);
  await json('DELETE',`novels/${n.id}/pins/${m.id}`);
  expect((await json('GET',`novels/${n.id}/pins`)).body).toEqual([]);
 });
 it('rejects unrelated conversation destinations',async()=>{
  const n=await configuredNovel();const a=(await json('POST',`novels/${n.id}/cards`,{type:'chapter',title:'A'})).body.card;const b=(await json('POST',`novels/${n.id}/cards`,{type:'chapter',title:'B'})).body.card;
  expect((await json('POST',`novels/${n.id}/turns`,{scope:a.id,conversationScope:b.id,flow:'card_chat',text:'Test'})).status).toBe(400);
 });
 it('applies an edited append preview once and rejects prose changed after review',async()=>{
  const n=await configuredNovel();const chapter=(await json('POST',`novels/${n.id}/cards`,{type:'chapter',title:'Chapter'})).body.card;const scene=(await json('POST',`novels/${n.id}/cards`,{type:'scene',title:'Scene',parentId:chapter.id})).body.card;
  await json('PUT',`cards/${scene.id}/prose`,{text:'Original.',baseRev:1});
  const id='workspace-prose-review';
  db.prepare('INSERT INTO suggestions(id,novel_id,origin,scope,target_card_id,action,payload,what,why,base_rev,created_at,fingerprint) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,n.id,'ai',scene.id,scene.id,'update_card',JSON.stringify({field:'prose',mode:'append',text:'More.'}),'Append','Test',scene.rev,Date.now(),'workspace-review');
  expect((await json('POST',`suggestions/${id}/accept`,{edits:'Original.\n\nEdited continuation.',replaceEdited:true,previewRev:1})).status).toBe(409);
  expect((await json('POST',`suggestions/${id}/accept`,{edits:'Original.\n\nEdited continuation.',replaceEdited:true,previewRev:2})).status).toBe(200);
  expect((await json('GET',`cards/${scene.id}/prose`)).body.text).toBe('Original.\n\nEdited continuation.');
 });
});

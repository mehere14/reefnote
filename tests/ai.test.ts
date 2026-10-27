import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'novel-ai-'));
process.env.NOVEL_STUDIO_DB=':memory:';
let db:any,api:any,structure:any,core:any,checks:any;
beforeAll(async()=>{db=(await import('../src/lib/server/db/index')).default;core=await import('../src/lib/server/core');api=await import('../src/lib/server/ai/api');structure=await import('../src/lib/server/ai/structure');checks=await import('../src/lib/server/checks/index');});
function novel(){const id='N'+Math.random();db.prepare('INSERT INTO novels(id,title,created_at,updated_at) VALUES(?,?,?,?)').run(id,'Test',Date.now(),Date.now());return id;}
test('sections and subanchors preserve exact pass-one text',()=>{const text='Intro\n## Escape\nType: trap-and-escape\n**The corner.** No doors.\n\n**Exits that fail.** Locked.\n';const parts=structure.sections(text);assert.equal(parts.S1.subtype,'trap-and-escape');assert.equal(parts.S1.text,'**The corner.** No doors.\n\n**Exits that fail.** Locked.\n');assert.equal(structure.resolveText('S1#corner',parts),'No doors.\n\n');});
test('verbatim proposal acceptance and rejection memory',()=>{const n=novel(),text='## Oduya\nAn exact smuggler biography.\n\n';const out={suggestions:[{action:'create_card',type:'character',title:'Oduya',text_ref:'S1',what:'Add Oduya',why:'Writer asked'}]};db.prepare('INSERT INTO turns(id,novel_id,scope,flow,status,created_at) VALUES(?,?,?,?,?,?)').run('T1',n,'characters','capture','done',Date.now());const [s]=structure.materialize(n,'characters','capture',text,out,'T1');assert.equal(s.payload.body,'An exact smuggler biography.\n\n');const accepted=api.acceptSuggestion(s.id);assert.equal(accepted.card.body,s.payload.body);const linkTarget=core.createCard(n,{type:'character',title:'Other'});const link=structure.storeSuggestion(n,'characters','add_link',{from_id:accepted.card.id,to_id:linkTarget.id,label:'knows'},'Connect');api.rejectSuggestion(link.id);assert.equal(structure.storeSuggestion(n,'characters','add_link',link.payload,'Connect'),null);});
test('replace becomes stale, force applies and appends remain safe',()=>{const n=novel(),card=core.createCard(n,{type:'character',title:'Ada',body:'old'});const s=structure.storeSuggestion(n,card.id,'update_card',{card_id:card.id,field:'body',mode:'replace',text:'new'},'Replace','',card.id);core.updateCard(card.id,{body:'user edit',baseRev:card.rev});assert.throws(()=>api.acceptSuggestion(s.id),(e:any)=>e.status===409&&e.reason==='changed');assert.equal(db.prepare('SELECT status FROM suggestions WHERE id=?').get(s.id).status,'stale');assert.equal(api.acceptSuggestion(s.id,{force:true}).card.body,'new');});
test('rules and rejection do not repeat dismissed flags',()=>{const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'One'}),scene=core.createCard(n,{type:'scene',title:'Scene',parentId:chapter.id}),beat=core.createCard(n,{type:'beat',subtype:'setup',title:'Gun',parentId:scene.id});const flags=checks.runChecks(n);assert(flags.some((f:any)=>f.what==='Setup has no payoff'));const flag=flags.find((f:any)=>f.target_card_id===beat.id);api.rejectSuggestion(flag.id);assert(!checks.runChecks(n).some((f:any)=>f.target_card_id===beat.id));});
test('settings encryption never exposes the key',async()=>{const settings=await import('../src/lib/server/ai/settings');settings.saveConfig({provider:'openai',apiKey:'private-test-key',modelWrite:'mock',modelStruct:'mock'});assert.equal(settings.publicConfig().hasKey,true);assert(!JSON.stringify(settings.publicConfig()).includes('private-test-key'));assert(!db.prepare("SELECT value FROM settings WHERE key='ai'").get().value.includes('private-test-key'));});
test('mock provider two passes SSE produce verbatim suggestions',async()=>{const n=novel();api.setProviderFactory(()=>({async *stream(){yield '## Mira\n';yield 'Exact streamed description.\n';},async structured(){return {suggestions:[{action:'create_card',type:'character',title:'Mira',text_ref:'S1',what:'Add Mira',why:'Requested'}]};},async test(){return {ok:true,msg:'Connected'};},async listModels(){return [{id:'mock'}];}}));const request=(path:string,method='GET',body?:any)=>api.handleAI({url:new URL('http://localhost/api/'+path),request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})})});const response=await request(`novels/${n}/turns`,'POST',{scope:'characters',flow:'expand',text:'Add Mira'});const {turnId}=await response.json();const stream=await request(`turns/${turnId}/stream`);const output=await stream.text();assert(output.includes('event: text'));assert(output.includes('event: done'));const row=db.prepare('SELECT payload FROM suggestions WHERE turn_id=?').get(turnId);assert.equal(JSON.parse(row.payload).body,'Exact streamed description.\n');});
test('long prose chunking bounded and overlapping',async()=>{const {chunkProse}=await import('../src/lib/server/ai/tokens');const text=('paragraph '.repeat(120)+'\n\n').repeat(500);const chunks=chunkProse(text);assert(chunks.length>20);assert(chunks.every(c=>c.text.length<=21600));assert.equal(chunks[0].offset,0);assert.equal(chunks.at(-1)!.offset+chunks.at(-1)!.text.length,text.length);assert(chunks[1].offset<chunks[0].text.length);});

test('switching providers clears saved credentials',async()=>{const settings=await import('../src/lib/server/ai/settings');settings.saveConfig({provider:'openai',apiKey:'openai-only',modelWrite:'mock',modelStruct:'mock'});settings.saveConfig({provider:'google',modelWrite:'gemini',modelStruct:'gemini'});assert.equal(settings.getConfig()?.apiKey,undefined);assert.equal(settings.publicConfig().hasKey,false);});

test('Ask retrieves a centered passage before unrelated context',async()=>{const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'Chapter'}),scene=core.createCard(n,{type:'scene',title:'Far passage',parentId:chapter.id});const text='Opening sentence. '.repeat(300)+'zirconium revelation happens here.'+' Tail.'.repeat(300);core.saveProse(scene.id,{text,baseRev:1});const {assemble}=await import('../src/lib/server/ai/context');const context=assemble(n,'flags','ask','Where is zirconium?',{provider:'openai',modelWrite:'mock',modelStruct:'mock',budget:3000});assert(context.text.includes('zirconium revelation happens here.'));assert(context.text.indexOf('Retrieved passage')<context.text.indexOf('=== CHAPTER:'));assert(context.manifest.some(x=>x.form==='retrieval'));});
test('draft includes earlier same-chapter digests and prior chapter fallback',async()=>{const n=novel(),first=core.createCard(n,{type:'chapter',title:'Earlier chapter'}),past=core.createCard(n,{type:'scene',title:'Past',body:'An earlier secret is exposed.',parentId:first.id}),chapter=core.createCard(n,{type:'chapter',title:'Current chapter'}),earlier=core.createCard(n,{type:'scene',title:'Earlier scene',body:'The relic has broken.',parentId:chapter.id}),current=core.createCard(n,{type:'scene',title:'Current scene',parentId:chapter.id});core.saveProse(earlier.id,{text:'The prior ending.',baseRev:1});const {assemble}=await import('../src/lib/server/ai/context');const context=assemble(n,current.id,'draft','',{provider:'openai',modelWrite:'mock',modelStruct:'mock'});assert(context.text.includes('The relic has broken.'));assert(context.text.includes('An earlier secret is exposed.'));assert(context.text.includes('The prior ending.'));assert(context.manifest.some(x=>x.card_id===past.id)===false);});
test('who candidates find aliases in prose and omit rejected pair',async()=>{const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'Chapter'}),scene=core.createCard(n,{type:'scene',title:'Scene',parentId:chapter.id}),character=core.createCard(n,{type:'character',title:'Admiral Haas',aliases:['the Admiral']});core.saveProse(scene.id,{text:'Opening. '.repeat(1200)+'The Admiral entered quietly.',baseRev:1});const {assemble}=await import('../src/lib/server/ai/context');const config={provider:'openai',modelWrite:'mock',modelStruct:'mock'};let context=assemble(n,scene.id,'who','',config);assert(context.text.includes('mention: The Admiral entered quietly.'));const suggestion=structure.storeSuggestion(n,scene.id,'add_link',{from_id:scene.id,to_id:character.id,label:'present'},'Admiral present','',scene.id);api.rejectSuggestion(suggestion.id);context=assemble(n,scene.id,'who','',config);assert(!context.text.includes(`Candidate ${character.id}`));});

test('chapter checks map scene-specific cast and preserve separate issue headings',async()=>{const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'Chapter'}),first=core.createCard(n,{type:'scene',title:'First',parentId:chapter.id}),second=core.createCard(n,{type:'scene',title:'Second',parentId:chapter.id}),alice=core.createCard(n,{type:'character',title:'Alice',body:'Alice fact.'}),bob=core.createCard(n,{type:'character',title:'Bob',body:'Bob fact.'});core.createLink({fromId:first.id,toId:alice.id,label:'POV'});core.createLink({fromId:second.id,toId:bob.id,label:'POV'});core.saveProse(first.id,{text:'First passage.',baseRev:1});core.saveProse(second.id,{text:'Second passage.',baseRev:1});const settings=await import('../src/lib/server/ai/settings');settings.saveConfig({provider:'openai',apiKey:'mock',modelWrite:'mock',modelStruct:'mock'});const prompts:string[]=[];let structuredPrompt='';api.setProviderFactory(()=>({async *stream(o:any){prompts.push(o.messages[0].content);yield `## Issue ${prompts.length}\nWhere: detail\nConflicts with: fact\nFix option: fix`;},async structured(o:any){structuredPrompt=o.prompt;return {suggestions:[]};},async test(){return {ok:true,msg:'Connected'};},async listModels(){return [];}}));const request=(path:string,method='GET',body?:any)=>api.handleAI({url:new URL('http://localhost/api/'+path),request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})})});const turn=await(await request(`novels/${n}/turns`,'POST',{scope:chapter.id,flow:'check'})).json();await(await request(`turns/${turn.turnId}/stream`)).text();assert.equal(prompts.length,2);assert(prompts[0].includes('Alice fact.'));assert(!prompts[0].includes('Bob fact.'));assert(prompts[1].includes('Bob fact.'));assert(!prompts[1].includes('Alice fact.'));const structured=JSON.parse(structuredPrompt);assert.equal(Object.keys(structured.sections).length,3);assert.equal(structured.sections.S2.title,'Issue 2');});

test('adapters parse final SSE line, redact errors, respect struct temperature and reasoning profile',async()=>{const original=globalThis.fetch;const {createProvider}=await import('../src/lib/server/ai/providers');const {z}=await import('zod');let body:any;try{globalThis.fetch=async(_url:any,opts:any)=>{body=JSON.parse(opts.body);return new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"ok":true}'}}]}));};const provider=createProvider({provider:'openai',apiKey:'test-secret',modelWrite:'mock',modelStruct:'mock',temps:{struct:.3}});assert.deepEqual(await provider.structured({model:'mock',system:'',prompt:'',schema:z.object({ok:z.boolean()}),maxTokens:100}),{ok:true});assert.equal(body.temperature,.3);for await(const _ of provider.stream({model:'gpt-5',system:'',messages:[],maxTokens:100,temperature:.9})){}assert.equal(body.max_completion_tokens,100);assert(!('temperature' in body));globalThis.fetch=async()=>new Response('data: '+JSON.stringify({error:{message:'test-secret leaked'}}));let error='';try{for await(const _ of provider.stream({model:'mock',system:'',messages:[],maxTokens:100,temperature:0})){} }catch(e){error=String(e);}assert(!error.includes('test-secret'));assert(error.includes('[redacted]'));}finally{globalThis.fetch=original;}});

test('conversation-only turn preserves history and excludes cards and structuring',async()=>{
 const n=novel(),card=core.createCard(n,{type:'character',title:'Secret card',body:'DO NOT SEND THIS CARD'});
 db.prepare('INSERT INTO messages(id,novel_id,scope,role,text,created_at) VALUES(?,?,?,?,?,?)').run('history-'+n,n,card.id,'assistant','Earlier idea to refine',Date.now()-1000);
 let prompt='',structured=false;
 api.setProviderFactory(()=>({async *stream(o:any){prompt=o.messages[0].content;yield 'Refined idea';},async structured(){structured=true;return {suggestions:[]};},async test(){return {ok:true,msg:'OK'};},async listModels(){return [];}}));
 const settings=await import('../src/lib/server/ai/settings');settings.saveConfig({provider:'openai',modelWrite:'mock',modelStruct:'mock'});
 const request=(path:string,method='GET',body?:any)=>api.handleAI({url:new URL('http://localhost/api/'+path),request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})})});
 const {turnId}=await(await request(`novels/${n}/turns`,'POST',{scope:card.id,flow:'card_chat',text:'Refine that idea',includeCardContext:false})).json();
 await(await request(`turns/${turnId}/stream`)).text();
 assert(prompt.includes('Earlier idea to refine'));assert(prompt.includes('Refine that idea'));assert(!prompt.includes('DO NOT SEND THIS CARD'));assert(!prompt.includes('Secret card'));assert.equal(structured,false);
 assert.deepEqual(JSON.parse(db.prepare('SELECT context_manifest FROM turns WHERE id=?').get(turnId).context_manifest),[]);
});

test('provider logs streaming usage and latency, including failed requests',async()=>{
 const {createProvider}=await import('../src/lib/server/ai/providers');const original=globalThis.fetch;
 try{
 globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7}}\n\ndata: [DONE]\n');
 const p=createProvider({provider:'openai',modelWrite:'usage-test',modelStruct:'usage-test'});
 for await(const _ of p.stream({model:'usage-test',system:'Help',messages:[{role:'user',content:'Hi'}],maxTokens:100,temperature:0})){}
 const row=db.prepare("SELECT * FROM llm_requests WHERE model='usage-test'").get();assert.equal(row.tokens_in,42);assert.equal(row.tokens_out,7);assert.equal(row.status,'done');assert(row.latency_ms>=0);
 globalThis.fetch=async()=>new Response('Denied',{status:401});
 await assert.rejects(async()=>{for await(const _ of p.stream({model:'failure-test',system:'Help',messages:[],maxTokens:10,temperature:0})){};});
 const failed=db.prepare("SELECT * FROM llm_requests WHERE model='failure-test'").get();assert.equal(failed.status,'error');assert.equal(failed.tokens_in,null);
 }finally{globalThis.fetch=original;}
});

test('prompt settings validate edits, persist overrides, and reset individual or all prompts',async()=>{
 const prompts=await import('../src/lib/server/ai/prompts');
 const request=(method:string,body?:any)=>api.handleAI({url:new URL('http://localhost/api/settings/prompts'),request:new Request('http://localhost/api/settings/prompts',{method,...(body?{body:JSON.stringify(body)}:{})})});
 try{
 const defaults=await(await request('GET')).json();const original=defaults.find((p:any)=>p.id==='preamble').value;
 assert.equal((await request('PUT',{id:'preamble',value:'Custom writing instructions'})).status,200);
 assert.equal(prompts.getPrompt('preamble'),'Custom writing instructions');
 const persisted=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='ai_prompts'").get().value);assert.equal(persisted.preamble,'Custom writing instructions');
 assert.equal((await request('PUT',{id:'preamble',value:'   '})).status,400);
 assert.equal((await request('PUT',{id:'context',value:'Change cards'})).status,400);
 assert.equal((await request('PUT',{id:'preamble',value:'Other',cards:[]})).status,400);
 await request('PUT',{id:'flow.capture',value:'Custom capture'});
 await request('PUT',{id:'preamble',value:null});assert.equal(prompts.getPrompt('preamble'),original);assert.equal(prompts.getPrompt('flow.capture'),'Custom capture');
 await request('DELETE');assert(prompts.listPrompts().every(p=>!p.modified));
 }finally{prompts.resetPrompts();}
});

test('writing uses saved prompts while card context stays identical',async()=>{
 const prompts=await import('../src/lib/server/ai/prompts'),{assemble}=await import('../src/lib/server/ai/context');
 const settings=await import('../src/lib/server/ai/settings');const c={provider:'openai',modelWrite:'mock',modelStruct:'mock'};settings.saveConfig(c);
 const n=novel(),card=core.createCard(n,{type:'character',title:'Ada',body:'Fixed card context'});
 const before=assemble(n,card.id,'earned','Explain',c);let system='',content='';
 try{
 prompts.savePrompt('preamble','CUSTOM SHARED');prompts.savePrompt('flow.earned','CUSTOM ACTION');
 const after=assemble(n,card.id,'earned','Explain',c);assert.deepEqual(after,before);
 api.setProviderFactory(()=>({async *stream(o:any){system=o.system;content=o.messages[0].content;yield 'Answer';},async structured(){throw new Error('Should not structure earned');},async test(){return {ok:true,msg:'OK'};},async listModels(){return [];}}));
 const request=(path:string,method='GET',body?:any)=>api.handleAI({url:new URL('http://localhost/api/'+path),request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})})});
 const {turnId}=await(await request(`novels/${n}/turns`,'POST',{scope:card.id,flow:'earned',text:'Explain'})).json();await(await request(`turns/${turnId}/stream`)).text();
 assert.equal(system,'CUSTOM SHARED\nCUSTOM ACTION');assert(content.includes('Fixed card context'));
 }finally{prompts.resetPrompts();}
});

test('current-card-only turn excludes other cards from writing and structuring',async()=>{
 const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'Hidden parent',body:'PRIVATE PARENT'}),scene=core.createCard(n,{type:'scene',title:'Current scene',body:'CURRENT NOTES',parentId:chapter.id}),other=core.createCard(n,{type:'character',title:'Hidden character',body:'PRIVATE CHARACTER'});
 core.createLink({fromId:scene.id,toId:other.id,label:'present'});
 core.saveProse(scene.id,{text:'CURRENT PROSE',baseRev:1});
 let prompt='',index:any[]=[];
 api.setProviderFactory(()=>({async *stream(o:any){prompt=o.messages[0].content;yield '## Current scene\nUpdated notes';},async structured(o:any){index=JSON.parse(o.prompt).cards;return {suggestions:[]};},async test(){return {ok:true,msg:'OK'};},async listModels(){return [];}}));
 const settings=await import('../src/lib/server/ai/settings');settings.saveConfig({provider:'openai',modelWrite:'mock',modelStruct:'mock'});
 const request=(path:string,method='GET',body?:any)=>api.handleAI({url:new URL('http://localhost/api/'+path),request:new Request('http://localhost/api/'+path,{method,...(body?{body:JSON.stringify(body)}:{})})});
 const {turnId}=await(await request(`novels/${n}/turns`,'POST',{scope:scene.id,flow:'flesh',text:'Refine this scene',onlyCurrentCard:true})).json();
 await(await request(`turns/${turnId}/stream`)).text();
 assert(prompt.includes('CURRENT NOTES'));assert(prompt.includes('CURRENT PROSE'));assert(prompt.includes('Refine this scene'));
 assert(!prompt.includes('Hidden parent'));assert(!prompt.includes('Hidden character'));assert(!prompt.includes('PRIVATE'));
 const turn=db.prepare('SELECT * FROM turns WHERE id=?').get(turnId);assert.equal(turn.only_current_card,1);assert(JSON.parse(turn.context_manifest).every((x:any)=>x.card_id===scene.id));
 assert.equal(turn.error,null);assert.deepEqual(index.map(x=>x.id),[scene.id]);
});

test('suggestion reasons stay outside saved bodies and updates identify the exact card',async()=>{
 const n=novel(),card=core.createCard(n,{type:'object',title:'FUNERALPRODUCE',body:'Old account'});
 const writing='## FUNERALPRODUCE\nReason: Reframe its purpose as environmental cleanup.\nType: cosmic entity\nThe entity cleans ruined sectors.\n';
 const [suggestion]=structure.materialize(n,card.id,'card_chat',writing,{suggestions:[{action:'update_card',card_id:card.id,field:'body',mode:'replace',text_ref:'S1',what:'Revise purpose',why:''}]},null);
 assert.equal(suggestion.why,'Reframe its purpose as environmental cleanup.');
 assert.equal(suggestion.payload.text,'The entity cleans ruined sectors.\n');
 const response=await api.handleAI({url:new URL(`http://localhost/api/novels/${n}/suggestions`),request:new Request(`http://localhost/api/novels/${n}/suggestions`)});
 const [listed]=await response.json();
 assert.equal(listed.target_title,'FUNERALPRODUCE');assert.equal(listed.target_type,'object');assert.equal(listed.target_card_id,card.id);
 assert.equal(api.acceptSuggestion(suggestion.id).card.body,'The entity cleans ruined sectors.\n');
 const legacy=structure.sections('## Entity\n*(Updated to remove references to failed experiments)*\nStory content.\n').S1;
 assert.equal(legacy.reason,'Updated to remove references to failed experiments');assert.equal(legacy.text,'Story content.\n');
 const ordinary=structure.sections('## Entity\n*(A traveler whispers from the darkness)*\nStory content.\n').S1;
 assert.equal(ordinary.text,'*(A traveler whispers from the darkness)*\nStory content.\n');
});

test('structuring retries card suggestions that omit a reason',async()=>{
 const {convertWriting}=await import('../src/lib/server/ai/convert');let calls=0;
 const provider:any={structured:async()=>{calls++;return {suggestions:[{action:'create_card',type:'object',title:'Entity',text_ref:'S1',what:'Create Entity',...(calls>1?{why:'The writer introduced a distinct entity.'}:{})}]};}};
 const out=await convertWriting(provider,{model:'mock',flow:'capture',scope:'world',text:'## Entity\nStory content.\n',cards:[]});
 assert.equal(calls,2);assert.equal(out.suggestions[0].why,'The writer introduced a distinct entity.');
});

test('chapter chat refreshes later characters, scene links, and reserves earlier writer decisions',async()=>{
 const n=novel(),chapter=core.createCard(n,{type:'chapter',title:'Prologue'}),scene=core.createCard(n,{type:'scene',title:'Council',body:'COUNCIL PLAN',parentId:chapter.id});
 const {assemble}=await import('../src/lib/server/ai/context');const config={provider:'openai',modelWrite:'mock',modelStruct:'mock',budget:12000};
 const before=assemble(n,chapter.id,'card_chat','Rewrite',config);
 const character=core.createCard(n,{type:'character',title:'Tsering-Ma',body:'CURRENT CHARACTER BACKSTORY'});
 core.createLink({fromId:scene.id,toId:character.id,label:''});
 const unlinked=core.createCard(n,{type:'character',title:'Amissa',body:'The renamed machine.'});
 const rule=core.createCard(n,{type:'rule',title:'Names',body:'Use Balti inspired names.'});
 db.prepare('INSERT INTO messages(id,novel_id,scope,role,text,created_at) VALUES(?,?,?,?,?,?)').run('decision-'+n,n,chapter.id,'user','Rename Nyx-7 to Amissa.',1);
 for(let i=0;i<14;i++)db.prepare('INSERT INTO messages(id,novel_id,scope,role,text,created_at) VALUES(?,?,?,?,?,?)').run(`long-${n}-${i}`,n,chapter.id,i%2?'assistant':'user',i%2?'Old draft. '.repeat(3000):'Continue.',i+2);
 const after=assemble(n,chapter.id,'card_chat','Rewrite using the new names.',config);
 assert(!before.manifest.some(x=>x.card_id===character.id));
 assert(after.manifest.some(x=>x.card_id===character.id&&x.form==='full'));
 assert(after.manifest.some(x=>x.card_id===unlinked.id));assert(after.manifest.some(x=>x.card_id===rule.id));
 assert(after.text.includes('CURRENT CHARACTER BACKSTORY'));assert(after.text.includes('COUNCIL PLAN'));
 assert(after.text.includes('Rename Nyx-7 to Amissa.'));assert(after.text.endsWith('Current writer request: Rewrite using the new names.'));
 const restricted=assemble(n,chapter.id,'card_chat','Rewrite',config,1,true,true);
 assert(!restricted.manifest.some(x=>x.card_id===character.id));assert(restricted.text.includes('Rename Nyx-7 to Amissa.'));
});

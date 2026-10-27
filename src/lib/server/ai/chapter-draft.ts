import db from '../db';
import {assemble} from './context';
import {getPrompt} from './prompts';
import {storeSuggestion} from './structure';
import type {Config,Provider} from './providers';

// Scene boundaries and destinations are owned by the app, never inferred by a second model.
export async function draftChapter(novel:string,chapter:string,turn:string,user:string,c:Config,provider:Provider,signal:AbortSignal,excluded:string[],emit:(name:string,data:any)=>void){
 const scenes=db.prepare("SELECT * FROM cards WHERE novel_id=? AND parent_id=? AND type='scene' ORDER BY position,id").all(novel,chapter) as any[];
 if(!scenes.length)throw new Error('Add scenes to this chapter before drafting it.');
 const manifest:any[]=[],styles:any[]=[],suggestions:any[]=[];
 let text='',previous:string|undefined;
 const sequence=scenes.map((s,i)=>`${i+1}. ${s.title}`).join('\n');
 for(let i=0;i<scenes.length;i++){
  if(signal.aborted)throw new Error('Stopped.');
  const scene=scenes[i];
  const context=assemble(novel,scene.id,'draft',user,c,1,true,false,excluded,previous,chapter);
  // Do not silently draft a scene from references when the plan cannot fit.
  const required=context.cards.filter(x=>x.id===scene.id||x.id===chapter||x.parent_id===scene.id&&x.type==='beat');
  if(required.some(x=>!context.manifest.some(m=>m.card_id===x.id&&m.form==='full')))throw new Error(`The plan for “${scene.title}” exceeds the context budget. Increase it in Settings before drafting.`);
  for(const item of context.manifest)if(!manifest.some(m=>m.card_id===item.card_id&&m.form===item.form))manifest.push(item);
  for(const layer of context.styleLayers||[])if(!styles.some(l=>l.id===layer.id))styles.push(layer);
  db.prepare('UPDATE turns SET context_manifest=?,style_context=? WHERE id=?').run(JSON.stringify(manifest),JSON.stringify(styles),turn);
  emit('context',manifest);emit('style',context.styleLayers||[]);
  emit('progress',{completed:i,total:scenes.length,message:`Drafting scene ${i+1} of ${scenes.length}: ${scene.title}…`});
  const heading=`${i?'\n\n':''}## ${scene.title.replace(/[\r\n]/g,' ')}\n`;
  text+=heading;emit('text',heading);
  let prose='';
  for await(const delta of provider.stream({model:c.modelWrite,system:[getPrompt('preamble'),context.styleText,getPrompt('flow.chapter_draft')].filter(Boolean).join('\n'),messages:[{role:'user',content:context.text+'\n\nChapter scene order:\n'+sequence+`\nWrite scene ${i+1} of ${scenes.length}: ${scene.title}. `+(i===scenes.length-1?'This is the final scene; land the chapter closing hook.':'Do not write later scenes or resolve their events early.')+'\nWriter request: '+user}],maxTokens:8192,temperature:c.temps?.write??.9,signal})){
   prose+=delta;text+=delta;emit('text',delta);
  }
  if(signal.aborted)throw new Error('Stopped.');
  if(!prose.trim())throw new Error(`No prose was returned for “${scene.title}”. Try drafting again.`);
  const suggestion=storeSuggestion(novel,chapter,'update_card',{card_id:scene.id,field:'prose',mode:'replace',text:prose},`Draft ${scene.title}`,'Draft this scene from its plan, optional beats, cast and chapter context.',scene.id,turn,'ai',prose);
  if(suggestion){
   // Edits made during generation must also trigger the usual stale-change review.
   db.prepare('UPDATE suggestions SET base_rev=? WHERE id=?').run(scene.rev,suggestion.id);
   suggestions.push({...suggestion,base_rev:scene.rev});
  }
  previous=prose;
  // Keep completed scenes available if a later provider request fails or is stopped.
  db.prepare("DELETE FROM messages WHERE turn_id=? AND role='assistant'").run(turn);
  db.prepare('INSERT INTO messages(id,novel_id,scope,role,text,turn_id,created_at) VALUES(?,?,?,?,?,?,?)').run(turn+'-chapter',novel,chapter,'assistant',text,turn,Date.now());
  emit('suggestions',suggestions);
 }
 return {text,suggestions};
}

import {proseContext} from '../../subplots/generation';
import db from '../../db';
import {styleForScope,prepareStyle,formatStyle} from '../../style/resolve';
import {withoutVoice} from '../../../style';
import {libraryList} from '../../style/library';
import {tokens} from '../tokens';
import {modelWindow} from '../providers/models';
import type {Config} from '../providers';
import {enqueue} from '../../queue';
export const sectionTypes:Record<string,string[]>={premise:['premise'],outline:['outline'],characters:['character','group','relationship'],arcs:['arc'],world:['setting','rule','object','event'],styles:['style'],plots:['plot','secret','theme','question'],chapters:['chapter','scene','beat']};
const recipes:Record<string,string[][]>={
 capture:[['user','premise'],['section','thread'],['rules','outline'],['rejections']],
 brainstorm:[['user','self','section','premise'],['linked','thread'],['rules','outline','threads'],['rejections']],
 flesh:[['self'],['linked','ancestors','premise'],['rules','outline','thread'],['linked2','rejections']],
 links:[['self','candidates'],[],[],['rejections']],who:[['self','prose_head','candidates'],['ancestors'],[],['rejections']],
 threads:[['self','children','all_threads'],['ancestors'],[],['rejections']],
 scenes:[['self','children'],['threads','premise','outline'],['story','rules'],['rejections']],
 beats:[['self','children','cast'],['ancestors','threads'],['rules'],['rejections']],
 payoff:[['self','ancestors'],['story','later'],['threads'],['rejections']],
 escapes:[['self','ancestors'],['cast','linked','story'],['rules'],[]],
 draft:[['self','children','cast','linked','previous'],['ancestors','threads','next','rules'],['chapter','story'],['thread']],
 dialogue:[['self','cast','prose_tail'],['children','previous'],['rules'],['thread']],
 check:[['self','cast','linked','rules'],['ancestors','story'],[],[]],
 ask:[['user','retrieval'],['overview'],[],[]]
};
for(const flow of ['expand','wantneed','hooks','card_chat'])recipes[flow]=recipes.flesh;
recipes.earned=recipes.escapes;
type Item={card?:any;form?:string;text?:string;id?:string};
export function assemble(novel:string,scope:string,flow:string,user:string,c:Config,scale=1,includeCardContext=true,onlyCurrentCard=false,styleExclusions:string[]=[],previousDraft?:string,historyScope=scope){
 if(!includeCardContext){
  const budget=Math.floor(Math.min((c.contextWindow||modelWindow(c.modelWrite))*.6,c.budget||60000)*scale);
  const history=(db.prepare('SELECT role,text FROM messages WHERE novel_id=? AND chat_id IS (SELECT id FROM chats WHERE novel_id=messages.novel_id AND scope=? AND archived_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 10').all(novel,historyScope) as Array<{role:string;text:string}>).reverse();
  const text=history.map(m=>`${m.role}: ${m.text}`).join('\n\n');
  return {text:text.slice(-Math.floor(budget*3.6)),manifest:[] as Array<{card_id:string;form:string;tokens:number}>,budget,self:undefined,cards:[] as any[]};
 }
 const subplot=db.prepare('SELECT * FROM subplots WHERE id=? AND novel_id=?').get(scope,novel) as any;
 if(subplot){const turningPoints=db.prepare('SELECT id,text,status FROM turning_points WHERE subplot_id=? ORDER BY position,id').all(scope);const scenes=db.prepare('SELECT e.scene_id,c.title,e.purpose,e.summary,e.status FROM elements e JOIN cards c ON c.id=e.scene_id WHERE e.subplot_id=? ORDER BY e.position,e.scene_id').all(scope);const history=(db.prepare('SELECT role,text FROM messages WHERE novel_id=? AND chat_id IS (SELECT id FROM chats WHERE novel_id=messages.novel_id AND scope=? AND archived_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 10').all(novel,historyScope) as any[]).reverse();const text=JSON.stringify({subplot,turning_points:turningPoints,scenes,conversation:history,request:user});return {text,manifest:[{card_id:scope,form:'subplot plan and summaries',tokens:tokens(text)}],budget:c.budget||60000,self:undefined,cards:[] as any[],styleLayers:[],styleText:''};}
 const subplotElement=db.prepare('SELECT e.*,c.novel_id FROM elements e JOIN cards c ON c.id=e.scene_id WHERE e.scene_id=? AND e.subplot_id IS NOT NULL AND c.novel_id=?').get(scope,novel) as any;
 if(subplotElement&&['card_chat','capture','brainstorm','ask'].includes(flow)){const target=db.prepare('SELECT * FROM cards WHERE id=?').get(scope) as any;const prose=db.prepare('SELECT text FROM scene_prose WHERE scene_id=?').get(scope) as any;const context=onlyCurrentCard?{element:subplotElement,card:target}:proseContext(scope);const history=historyScope===scope?db.prepare('SELECT role,text FROM messages WHERE novel_id=? AND chat_id IS (SELECT id FROM chats WHERE novel_id=messages.novel_id AND scope=? AND archived_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 10').all(novel,scope):[];const text=JSON.stringify({context,target_prose:prose?.text||'',conversation:[...history].reverse(),request:user});const cards=onlyCurrentCard?[target]:[target,...db.prepare('SELECT c.* FROM element_cards ec JOIN cards c ON c.id=ec.card_id WHERE ec.element_id=?').all(scope)] as any[];return {text,manifest:cards.map(card=>({card_id:card.id,form:card.id===scope?'target scene and prose':'linked card',tokens:tokens(card.body||'')})),budget:c.budget||60000,self:target,cards,styleLayers:[],styleText:''};}
 const styleActive=['draft','dialogue','card_chat','capture'].includes(flow);
 const styleLayers=styleActive?prepareStyle(styleForScope(novel,scope,onlyCurrentCard),styleExclusions,c.styleBudget||2000):[];
 const styleText=formatStyle(styleLayers);
 const cards=(db.prepare('SELECT * FROM cards WHERE novel_id=? ORDER BY position,id').all(novel) as any[]).filter(x=>!onlyCurrentCard||x.id===scope).map(x=>{if(!styleActive)return x;const fields=JSON.parse(x.fields);delete fields.styleNotes;delete fields.stylePresetMode;return {...x,body:x.type==='character'?withoutVoice(x.body):x.type==='style'?'':x.body,fields:JSON.stringify(fields),digest:x.type==='character'?'':x.digest};});
 const links=onlyCurrentCard?[]:db.prepare('SELECT * FROM links WHERE novel_id=?').all(novel) as any[];
 const self=cards.find(x=>x.id===scope),byId=new Map(cards.map(x=>[x.id,x]));
 const ancestors:any[]=[];let parent=self?.parent_id;while(parent&&byId.has(parent)){const card=byId.get(parent);ancestors.push(card);parent=card.parent_id;}
 const scene=self?.type==='scene'?self:ancestors.find(x=>x.type==='scene');
 const chapter=self?.type==='chapter'?self:ancestors.find(x=>x.type==='chapter');
 const chapters=cards.filter(x=>x.type==='chapter');
 const scenes=cards.filter(x=>x.type==='scene').sort((a,b)=>(chapters.findIndex(x=>x.id===a.parent_id)-chapters.findIndex(x=>x.id===b.parent_id))||a.position-b.position||a.id.localeCompare(b.id));
 const sceneAt=scene?scenes.findIndex(x=>x.id===scene.id):-1;
 const budget=Math.floor(Math.min((c.contextWindow||modelWindow(c.modelWrite))*.6,c.budget||60000)*scale);
 const styleCost=tokens(styleText);
 if(styleCost>budget-500)throw Object.assign(new Error('Required style text exceeds this request’s context budget. Shorten notes, exclude layers, or increase the context budget.'),{status:400});
 // Reserve space for recent conversation and the current request before packing cards.
 const historyRows=db.prepare('SELECT role,text FROM messages WHERE novel_id=? AND chat_id IS (SELECT id FROM chats WHERE novel_id=messages.novel_id AND scope=? AND archived_at IS NULL) ORDER BY created_at DESC,id DESC LIMIT 50').all(novel,historyScope) as Array<{role:string;text:string}>;
 const historyLimit=Math.floor((budget-styleCost)*.3);
 const history:string[]=[];let historyCost=0;
 for(const row of historyRows){
  // Long generated drafts must not crowd out earlier writer decisions.
  const limit=row.role==='assistant'?1600:6000;
  const excerpt=row.text.length>limit?row.text.slice(0,limit)+'\n[Message shortened]':row.text;
  const message=`${row.role}: ${excerpt}`;
  if(historyCost+tokens(message)>historyLimit)continue;
  history.unshift(message);historyCost+=tokens(message)+1;
 }
 const conversation=history.length?'Recent conversation (chronological; follow the latest writer decisions):\n'+history.join('\n\n'):'';
 const request='Current writer request: '+user;
 const reserved=[conversation,request].filter(Boolean).join('\n\n').slice(-Math.floor((budget-styleCost)*.4*3.6));
 const contextBudget=budget-styleCost-tokens(reserved)-2;
 const manifest:Array<{card_id:string;form:string;tokens:number}>=[],pieces:string[]=[];let used=0;
 const seen=new Set<string>();
 const proseExcerpt=(id:string,tail=false,size=5400)=>{const row=db.prepare(tail?'SELECT substr(text,max(1,length(text)-?+1)) excerpt FROM scene_prose WHERE scene_id=?':'SELECT substr(text,1,?) excerpt FROM scene_prose WHERE scene_id=?').get(size,id) as any;return row?.excerpt||'';};
 function fallback(card:any){if(card.type==='chapter')return cards.filter(x=>x.parent_id===card.id&&x.type==='scene').map(s=>s.title+': '+(s.digest_rev>=s.rev&&s.digest?s.digest:s.body.slice(0,430)+' '+proseExcerpt(s.id,false,430))).join('\n').slice(0,1600);return card.body.slice(0,430)+'\n'+JSON.stringify(JSON.parse(card.fields)).slice(0,250);}
 function forms(card:any,preferred='full'){
  const heading=`=== ${card.type.toUpperCase()}: ${card.title} (${card.subtype}) [id:${card.id}] ===\n`;
  const related=links.filter(l=>l.from_id===card.id||l.to_id===card.id).map(l=>`${l.label} → ${byId.get(l.from_id===card.id?l.to_id:l.from_id)?.title||''}`).join('; ');
  const full=heading+`Also called: ${JSON.parse(card.aliases).join(', ')}\n`+card.body+'\n'+Object.entries(JSON.parse(card.fields)).map(([k,v])=>`${k}: ${v}`).join('\n')+'\nLinks: '+related;
  const digest=heading+(card.digest_rev>=card.rev&&card.digest?card.digest:fallback(card));
  if(card.digest_rev<card.rev)enqueue('digest',`digest:${card.id}`,{cardId:card.id},30000);
  return preferred==='ref'?[{form:'ref',text:heading}]:preferred==='digest'?[{form:'digest',text:digest},{form:'ref',text:heading}]:[{form:'full',text:full},{form:'digest',text:digest},{form:'ref',text:heading}];
 }
 const cardItems=(cs:any[],form='full'):Item[]=>cs.filter(Boolean).map(card=>({card,form}));
 const linked=(id:string)=>links.filter(l=>l.from_id===id||l.to_id===id).map(l=>byId.get(l.from_id===id?l.to_id:l.from_id)).filter(Boolean);
 const descendants=new Set<string>([scope]);let changed=true;while(changed){changed=false;for(const card of cards)if(descendants.has(card.parent_id)&&!descendants.has(card.id)){descendants.add(card.id);changed=true;}}
 function candidates():Item[]{
  const prose=scene?proseExcerpt(scene.id,false,7200):'';
  const source=(self?.body||'')+'\n'+Object.values(JSON.parse(self?.fields||'{}')).join('\n')+'\n'+prose;
  const rejected=db.prepare('SELECT fingerprint FROM rejections WHERE novel_id=?').all(novel) as any[];
  const eligible=cards.filter(x=>x.id!==scope&&(flow!=='who'||['character','group','setting','object'].includes(x.type))&&!links.some(l=>(l.from_id===scope&&l.to_id===x.id)||(l.to_id===scope&&l.from_id===x.id))&&!rejected.some(r=>r.fingerprint.startsWith(`link:${scope}:${x.id}:`)||r.fingerprint.startsWith(`link:${x.id}:${scope}:`)));
  return eligible.map(card=>{const aliases=[card.title,...JSON.parse(card.aliases),...(card.type==='character'?[card.title.split(' ')[0]]:[])];let candidateSource=source;if(scene){for(const alias of aliases){try{const hit=db.prepare("SELECT card_id FROM fts WHERE fts MATCH ? AND card_id=? AND kind='prose' LIMIT 1").get('"'+alias.replaceAll('"','""')+'"',scene.id);if(hit){const row=db.prepare('SELECT substr(text,max(1,instr(lower(text),lower(?))-200),600) excerpt FROM scene_prose WHERE scene_id=?').get(alias,scene.id) as any;if(row?.excerpt)candidateSource+='\n'+row.excerpt;}}catch{}}}const matches=aliases.filter(a=>a&&new RegExp(`(?:^|\\W)${a.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|\\W)`,'i').test(candidateSource));const at=matches.length?candidateSource.toLowerCase().indexOf(matches[0].toLowerCase()):-1;const sentence=at>=0?candidateSource.slice(Math.max(0,candidateSource.lastIndexOf('.',at)+1,candidateSource.lastIndexOf('\n',at)+1),Math.min(candidateSource.length,candidateSource.indexOf('.',at)>at?candidateSource.indexOf('.',at)+1:at+220)).trim():'';return {card,form:'ref',text:`Candidate ${card.id}; aliases: ${aliases.join(', ')}${matches.length?`; mention: ${sentence}`:'; implied candidate (confirm from context)'}`};});
 }
 function retrieval():Item[]{const terms=user.match(/[\p{L}\p{N}]{3,}/gu)||[];if(!terms.length)return [];try{const hits=db.prepare('SELECT card_id,kind FROM fts WHERE fts MATCH ? AND novel_id=? ORDER BY bm25(fts) LIMIT 20').all(terms.map(t=>'"'+t+'"').join(' OR '),novel) as any[];return hits.flatMap(h=>{const card=byId.get(h.card_id);if(!card)return [];const items:Item[]=[{card,form:'digest'}];if(h.kind==='prose'){const row=db.prepare('SELECT text FROM scene_prose WHERE scene_id=?').get(h.card_id) as any;const prose=row?.text||'';const at=terms.map(t=>prose.toLowerCase().indexOf(t.toLowerCase())).filter(i=>i>=0).sort((a,b)=>a-b)[0]||0;const start=Math.max(0,at-720);items.push({id:card.id+'#retrieval',text:`Retrieved passage from ${card.title} at character ${start}:\n${prose.slice(start,start+1440)}`});}return items;});}catch{return [];}}
 function items(name:string):Item[]{switch(name){
 case 'style_library':return [{text:'Available style library (recommend exact category/slug identifiers; these are editable starting points):\n'+libraryList().filter(e=>{if(self?.type==='character')return e.category==='character-voices';if(['scene','chapter'].includes(self?.type)||self?.type==='style'&&self.subtype==='preset')return e.category==='scene-presets';return e.category==='book-voice';}).map(e=>`${e.category}/${e.slug}: ${e.title} — ${e.summary}`).join('\n')}];
 case 'user':return [{text:'Writer request: '+user}];case 'self':return cardItems([self]);
 case 'premise':return cardItems(cards.filter(x=>x.type==='premise'));
 case 'section':return self?[]:cardItems(cards.filter(x=>!x.parent_id&&sectionTypes[scope]?.includes(x.type)),'digest');
 case 'ancestors':return ancestors.map((card,i)=>({card,form:i?'digest':'full'}));
 case 'children':return cardItems(cards.filter(x=>x.parent_id===scope),self?.type==='scene'?'full':'digest');
 case 'linked':return cardItems(linked(scope));case 'linked2':return cardItems(linked(scope).flatMap(x=>linked(x.id)),'ref');
 case 'chapter_context':{
  if(!chapter)return [];
  const chapterScenes=cards.filter(x=>x.parent_id===chapter.id&&x.type==='scene');
  const sourceIds=new Set([chapter.id,...chapterScenes.map(x=>x.id)]);
  const related=links.filter(l=>sourceIds.has(l.from_id)||sourceIds.has(l.to_id)).map(l=>byId.get(sourceIds.has(l.from_id)?l.to_id:l.from_id));
  return [...cardItems(chapterScenes),...cardItems(related)];
 }
 case 'characters':return cardItems(cards.filter(x=>x.type==='character'),'digest');
 case 'cast':return cardItems(links.filter(l=>l.from_id===scene?.id&&['POV','present','set in','features'].includes(l.label)).map(l=>byId.get(l.to_id)));
 case 'threads':return cardItems(links.filter(l=>descendants.has(l.from_id)&&['opens','advances','resolves','explores'].includes(l.label)).map(l=>byId.get(l.to_id)));
 case 'all_threads':return cardItems(cards.filter(x=>['plot','secret','theme','question'].includes(x.type)),'digest');
 case 'rules':return cardItems(cards.filter(x=>x.type==='rule'),'digest');case 'outline':return cardItems(cards.filter(x=>x.type==='outline'),'digest');
 case 'previous':if(previousDraft!==undefined)return [{id:scenes[sceneAt-1]?.id+'#tail',text:'Previous newly drafted scene ending:\n'+previousDraft.slice(-5400)}];return sceneAt>0?[{id:scenes[sceneAt-1].id+'#tail',text:'Previous scene ending:\n'+proseExcerpt(scenes[sceneAt-1].id,true)}]:[];
 case 'next':return sceneAt>=0?cardItems([scenes[sceneAt+1]]):[];
 case 'chapter':return cardItems(scenes.filter(x=>x.parent_id===chapter?.id&&scenes.indexOf(x)<sceneAt),'digest');
 case 'story':return chapter?cardItems(chapters.slice(0,chapters.findIndex(x=>x.id===chapter.id)),'digest'):[];
 case 'later':return cardItems(cards.filter(x=>(x.type==='chapter'&&chapters.indexOf(x)>chapters.findIndex(y=>y.id===chapter?.id))||(x.type==='scene'&&scenes.indexOf(x)>sceneAt)),'digest');
 case 'prose_head':return scene?[{id:scene.id+'#head',text:'Scene prose head:\n'+proseExcerpt(scene.id,false,7200)}]:[];
 case 'prose_tail':return scene?[{id:scene.id+'#tail',text:'Scene prose tail:\n'+proseExcerpt(scene.id,true,7200)}]:[];
 case 'candidates':return candidates();case 'retrieval':return retrieval();
 case 'overview':return cardItems(cards.filter(x=>!x.parent_id),'digest');
 case 'thread':return []; // Conversation is reserved separately for every flow.

 case 'rejections':{const rows=db.prepare('SELECT DISTINCT r.what,r.created_at FROM rejections r JOIN suggestions s ON s.novel_id=r.novel_id AND s.fingerprint=r.fingerprint WHERE r.novel_id=? AND s.scope=? ORDER BY r.created_at DESC LIMIT 20').all(novel,scope) as any[];return rows.length?[{text:'The writer already rejected these; do not suggest them again:\n'+rows.map(x=>x.what).join('\n')}]:[];}
 default:return [];
 }}
 const activeRecipe=['recommend_style'].includes(flow)?[['self','premise','outline','style_library']]:recipes[flow]||recipes.flesh;
 const writingChapter=chapter&&['card_chat','draft','dialogue','chapter_draft','brainstorm'].includes(flow);
 const expandedRecipe=activeRecipe.map((group,i)=>writingChapter&&i===1?[...group,'chapter_context','characters']:group);
 const priorities=(onlyCurrentCard?[['self','prose_head'],['thread']]:expandedRecipe).map(group=>group.filter(name=>name!=='user').flatMap(items));
 for(let priority=0;priority<priorities.length;priority++){
  const group=priorities[priority];
  // Degrade all equally important cards together before dropping any one of them.
  let level=0;const options=group.map(item=>item.card?forms(item.card,item.form):[{form:'text',text:item.text||''}]);
  while(priority===0&&level<2&&options.reduce((sum,list)=>sum+tokens(list[Math.min(level,list.length-1)].text),0)>contextBudget-used)level++;
  for(let i=0;i<group.length;i++){
   const item=group[i];if(item.card&&seen.has(item.card.id))continue;
   const list=options[i];let chosen=list[Math.min(level,list.length-1)];
   for(const option of list.slice(Math.min(level,list.length-1))){chosen=option;if(tokens(option.text)<=contextBudget-used)break;}
   let text=chosen.text;
   if(tokens(text)>contextBudget-used){if(priority>0)continue;text=text.slice(0,Math.max(0,Math.floor((contextBudget-used)*3.6)));}
   if(!text)continue;pieces.push(text);const count=tokens(text);used+=count;
   if(item.card){seen.add(item.card.id);manifest.push({card_id:item.card.id,form:chosen.form,tokens:count});}
   if(item.id)manifest.push({card_id:item.id.split('#')[0],form:item.id.split('#')[1],tokens:count});
   if(item.card&&item.text){const extra=item.text.slice(0,Math.max(0,Math.floor((contextBudget-used)*3.6)));if(extra){pieces.push(extra);used+=tokens(extra);}}
  }
 }
 return {text:[...pieces,reserved].filter(Boolean).join('\n\n'),manifest,budget,self,cards,styleLayers,styleText};
}

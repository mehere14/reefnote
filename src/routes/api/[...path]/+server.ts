import {migratePlots} from '$lib/server/db/plot-migration';
import { handleSubplots } from '$lib/server/subplots/api';
import type { RequestHandler } from './$types';
import db from '$lib/server/db';
import {handleStyle} from '$lib/server/style/api';
import { handleAI } from '$lib/server/ai/api';
import { CoreError, SECTIONS, getNovel, getCard, createCard, updateCard, saveProse, createLink, restoreVersion, moveCard, listCards, cardDetail, readChapter, splitScene, deleteCard, removeLink } from '$lib/server/core';
import { exportManuscript } from '$lib/server/manuscript';
import { ulid } from 'ulid';
import { ZodError } from 'zod';
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const handler:RequestHandler=async(event)=>{try{const {request,url}=event;const parts=(event.params.path||'').split('/');const [kind,id,action]=parts;const method=request.method;const body=async()=>{try{const value=await request.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected object');return value;}catch{throw new CoreError(400,'Invalid JSON request');}};
const subplotResponse=await handleSubplots(event);if(subplotResponse)return subplotResponse;
const styleResponse=await handleStyle(event);if(styleResponse)return styleResponse;
if(kind==='novels'){
 if(!id&&method==='GET')return json(db.prepare('SELECT * FROM novels ORDER BY COALESCE(last_opened_at,updated_at) DESC').all());
 if(!id&&method==='POST'){const d=await body();if(d.title!==undefined&&typeof d.title!=='string')throw new CoreError(400,'title must be text');return json(db.transaction(()=>{const novel={id:ulid(),title:d.title||'Untitled novel',tagline:'a novel in progress',created_at:Date.now(),updated_at:Date.now(),last_opened_at:Date.now()};db.prepare('INSERT INTO novels(id,title,tagline,created_at,updated_at,last_opened_at) VALUES(@id,@title,@tagline,@created_at,@updated_at,@last_opened_at)').run(novel);const premiseCard=d.premise?createCard(novel.id,{type:'premise',title:'Premise',body:d.premise}):undefined;return{novel,premiseCard};})(),201);}
 if(id&&!action&&method==='GET')return json(getNovel(id));
 if(id&&!action&&method==='PATCH'){getNovel(id);const d=await body();for(const k of ['title','tagline'])if(d[k]!==undefined&&typeof d[k]!=='string')throw new CoreError(400,`${k} must be text`);for(const k of ['title','tagline'])if(d[k]!==undefined){db.prepare(`UPDATE novels SET ${k}=?,updated_at=? WHERE id=?`).run(d[k],Date.now(),id);}return json({novel:getNovel(id)});}
 if(id&&!action&&method==='DELETE'){getNovel(id);db.transaction(()=>{db.prepare('DELETE FROM fts WHERE novel_id=?').run(id);db.prepare('DELETE FROM novels WHERE id=?').run(id);})();return json({deleted:true});}
 if(action==='export'&&method==='GET')return await exportManuscript(id,url.searchParams.get('format'),url.searchParams.get('pageSize')??undefined);
 if(action==='open'&&method==='POST'){getNovel(id);db.prepare('UPDATE novels SET last_opened_at=? WHERE id=?').run(Date.now(),id);return json({novel:getNovel(id)});}
 if(action==='search'&&method==='GET'){
  getNovel(id);const query=(url.searchParams.get('q')||'').trim().toLowerCase();if(!query)return json([]);
  const prose=new Map((db.prepare('SELECT p.scene_id,p.text FROM scene_prose p JOIN cards c ON c.id=p.scene_id WHERE c.novel_id=?').all(id) as any[]).map(p=>[p.scene_id,p.text]));
  const textValues=(value:any):string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(textValues):[];
  return json(listCards(id).flatMap(c=>{const text=[c.title,c.type,c.subtype,...textValues(c.aliases),c.body,...textValues(c.fields),prose.get(c.id)||''].join('\n');const at=text.toLowerCase().indexOf(query);return at<0?[]:[{id:c.id,title:c.title,type:c.type,subtype:c.subtype,snippet:(at>70?'…':'')+text.slice(Math.max(0,at-70),at+query.length+150)+(at+query.length+150<text.length?'…':'')}];}));
 }
 if(action==='cards'&&method==='GET')return json(listCards(id,url.searchParams.get('section')||undefined));
 if(action==='cards'&&method==='POST')return json({card:createCard(id,await body())},201);
 if(action==='overview'&&method==='GET'){getNovel(id);migratePlots(db,id);const cards=listCards(id);const pending:any[]=db.prepare("SELECT scope,target_card_id,action FROM suggestions WHERE novel_id=? AND status='pending'").all(id);const sectionOf=(cardId:string):string|undefined=>{let c=cards.find(c=>c.id===cardId);while(c?.parent_id)c=cards.find(a=>a.id===c.parent_id);return Object.keys(SECTIONS).find(k=>SECTIONS[k].includes(c?.type));};return json({sections:Object.entries(SECTIONS).map(([key,types])=>({key,count:cards.filter(c=>!c.parent_id&&types.includes(c.type)&&c.type!=='plot').length+(key==='plots'?(db.prepare('SELECT count(*) n FROM subplots WHERE novel_id=? AND NOT EXISTS(SELECT 1 FROM plot_aliases WHERE alias_id=subplots.id)').get(id) as any).n:0),...(key==='chapters'?{sceneCount:cards.filter(c=>c.type==='scene').length}:{}),pending:pending.filter(s=>s.scope===key||sectionOf(s.target_card_id||s.scope)===key).length})),flagsPending:pending.filter(s=>s.action==='flag_issue').length});}
}
if(kind==='cards'&&id){
 if(!action&&method==='GET')return json(cardDetail(id));
 if(!action&&method==='PATCH'){const d=await body();if(!Number.isInteger(d.baseRev))throw new CoreError(400,'baseRev is required');return json(updateCard(id,d));}
 if(!action&&method==='DELETE'){return json(deleteCard(id));}
 if(action==='split'&&method==='POST')return json(splitScene(id,await body()),201);
 if(action==='move'&&method==='POST')return json(moveCard(id,await body()));
 if(action==='prose'&&method==='GET'){const c=getCard(id);if(c.type!=='scene')throw new CoreError(400,'Only scenes have prose');const p:any=db.prepare('SELECT * FROM scene_prose WHERE scene_id=?').get(id);const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||200000);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1)throw new CoreError(400,'Invalid prose page');return json({text:p.text.slice(offset,offset+limit),rev:p.rev,word_count:p.word_count,total:p.text.length,next:offset+limit<p.text.length?offset+limit:null});}
 if(action==='prose'&&['PUT','PATCH'].includes(method))return json(saveProse(id,await body()));
 if(action==='read'&&method==='GET'){const cursor=url.searchParams.get('cursor')||'0';return json(readChapter(id,cursor));}
 if(action==='links'&&method==='GET'){getCard(id);const rows:any[]=db.prepare('SELECT l.*, c.id other_id,c.title other_title,c.type other_type FROM links l JOIN cards c ON c.id=CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END WHERE l.from_id=? OR l.to_id=? ORDER BY l.created_at,l.id').all(id,id,id);return json(rows.map(r=>({...r,other:{id:r.other_id,title:r.other_title,type:r.other_type},direction:r.from_id===id?'out':'in'})));}
 if(action==='versions'&&method==='GET'){getCard(id);return json(db.prepare('SELECT id,note,source,created_at FROM versions WHERE card_id=? ORDER BY created_at DESC,id DESC').all(id));}
}
if(kind==='links'&&!id&&method==='POST')return json({link:createLink(await body())},201);
if(kind==='links'&&id&&method==='DELETE')return json(removeLink(id));
if(kind==='versions'&&action==='restore'&&method==='POST')return json(restoreVersion(id));
const ai=await handleAI(event);return ai||json({error:'Endpoint not found'},404);
}catch(error){if(error instanceof CoreError)return json({error:error.message,...error.details},error.status);if(error instanceof ZodError)return json({error:'Invalid request',issues:error.issues},400);console.error(error);return json({error:'The request could not be completed'},500);}};
export const GET=handler,POST=handler,PATCH=handler,PUT=handler,DELETE=handler;

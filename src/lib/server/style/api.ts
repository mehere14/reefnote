import {CoreError,getCard,getNovel,setStyle,setPOV} from '../core';
import db from '../db';
import {getConfig} from '../ai/settings';
import {resolveStyle,styleForScope,prepareStyle} from './resolve';
import {libraryList,saveEntry,libraryAction,importLibrary,exportLibrary,applyLibrary} from './library';
export async function handleStyle(event:any):Promise<Response|null>{const {request,url}=event,method=request.method,path=url.pathname.slice(5).split('/'),[kind,id,action]=path;const json=(v:any,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
 if(kind==='style-library'){
  if(!id&&method==='GET')return json(libraryList(url.searchParams.get('all')==='1'));
  if(id==='export'&&method==='GET')return new Response(exportLibrary(),{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="reefnote-style-library.zip"'}});
  if(id==='import'&&method==='POST'){if(Number(request.headers.get('content-length')||0)>5_000_000)throw new CoreError(400,'Import is limited to 5 MB');return json(importLibrary(new Uint8Array(await request.arrayBuffer()),url.searchParams.get('name')||'',url.searchParams.get('category')||undefined,url.searchParams.get('overwrite')==='1'));}
  if(id&&action){if(method==='GET'){const e=libraryList(true).find(e=>e.category===id&&e.slug===action);if(!e)throw new CoreError(404,'Entry not found');return json(e);}if(method==='PUT')return json(saveEntry(id,action,await request.json()));if(method==='DELETE')return json(libraryAction(id,action,'delete'));if(method==='POST'&&['reset','hide','show'].includes(path[3]))return json(libraryAction(id,action,path[3]));}
 }
 if(kind==='novels'&&action==='style'&&path[3]==='resolve'&&method==='GET'){getNovel(id);const current=url.searchParams.get('scope');const only=url.searchParams.get('onlyCurrentCard')==='1';const layers=current?styleForScope(id,current,only):resolveStyle(id,{chapterId:url.searchParams.get('chapterId')||'',sceneId:url.searchParams.get('sceneId')||undefined},only);return json(prepareStyle(layers,[],getConfig()?.styleBudget||2000));}
 if(kind==='cards'&&action==='style'&&method==='PUT')return json(setStyle(id,await request.json()));
 if(kind==='cards'&&action==='apply-style'&&method==='POST')return json(applyLibrary(id,await request.json()));
 if(kind==='scenes'&&action==='pov'&&method==='PUT')return json(setPOV(id,await request.json()));
 if(kind==='style'&&action==='usage'&&method==='GET'){const c=getCard(id);if(c.type!=='style')throw new CoreError(400,'Not a style card');return json(db.prepare("SELECT c.id,c.title,c.type FROM links l JOIN cards c ON c.id=l.from_id WHERE l.to_id=? AND l.label='uses_style' ORDER BY c.title").all(id));}
 return null;
}

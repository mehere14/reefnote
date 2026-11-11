import {CoreError} from '../core';
import * as l from './service';
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
/** Lane grid routes (docs/lane-view-plan.md §4). Returns null for paths it does not own. */
export async function handleLanes(event:any){
 const [kind,id,action]=(event.params.path||'').split('/'),method=event.request.method;
 const body=async()=>{try{const value=await event.request.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new CoreError(400,'Invalid JSON request');}};
 const optionalBody=async()=>{const text=await event.request.text();if(!text)return {};try{return JSON.parse(text);}catch{throw new CoreError(400,'Invalid JSON request');}};
 if(kind==='novels'&&id){
  if(action==='grid'&&method==='GET')return json(l.grid(id));
  if(action==='lanes'&&method==='POST')return json(l.createLane(id,await body()),201);
  if(action==='beats'&&method==='POST')return json(l.createBeat(id,await body()),201);
 }
 if(kind==='lanes'&&id&&!action){
  if(method==='PATCH')return json(l.updateLane(id,await body()));
  if(method==='DELETE')return json(l.deleteLane(id));
 }
 if(kind==='lanes'&&id&&action==='layout'&&method==='POST')return json(l.layoutLane(id,await optionalBody()));
 if(kind==='beats'&&id&&action==='placement'){
  if(method==='PUT')return json(l.placeBeat(id,await body()));
  if(method==='DELETE')return json(l.unplaceBeat(id,await optionalBody()));
 }
 if(kind==='scenes'){
  if(id==='group'&&!action&&method==='POST')return json(l.groupScene(await body()),201);
  if(id&&action==='ungroup'&&method==='POST')return json(l.ungroupBeat(id,await body()));
  if(id&&action==='move'&&method==='POST')return json(l.moveScene(id,await body()));
 }
 return null;
}

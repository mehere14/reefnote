import db from '../db';
import {promptDefaults} from './prompt-defaults';
export function promptOverrides():Record<string,string>{
 const row=db.prepare("SELECT value FROM settings WHERE key='ai_prompts'").get() as {value:string}|undefined;
 return row?JSON.parse(row.value):{};
}
export function getPrompt(id:string){if(!Object.hasOwn(promptDefaults,id))throw new Error('Unknown prompt');return promptOverrides()[id]??promptDefaults[id];}
export function listPrompts(){const overrides=promptOverrides();return Object.entries(promptDefaults).map(([id,defaultValue])=>({id,defaultValue,value:overrides[id]??defaultValue,modified:Object.hasOwn(overrides,id)}));}
export function savePrompt(id:string,value:string|null){
 if(!Object.hasOwn(promptDefaults,id))throw new Error('Unknown prompt');
 const overrides=promptOverrides();
 if(value===null||value===promptDefaults[id])delete overrides[id];else overrides[id]=value;
 db.prepare("INSERT INTO settings(key,value) VALUES('ai_prompts',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(overrides));
 return listPrompts();
}
export function resetPrompts(){db.prepare("DELETE FROM settings WHERE key='ai_prompts'").run();return listPrompts();}

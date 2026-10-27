import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
export function secretKey(){ const dir=process.env.DATA_DIR||join(process.cwd(),'data'); mkdirSync(dir,{recursive:true}); const path=join(dir,'secret.key'); if(!existsSync(path)) {try{writeFileSync(path,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e){if(!existsSync(path))throw e;}} const key=readFileSync(path); if(key.length!==32)throw new Error('Invalid secret.key'); return key; }
export function encrypt(text:string){const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',secretKey(),iv); const data=Buffer.concat([c.update(text,'utf8'),c.final()]); return [iv,c.getAuthTag(),data].map(x=>x.toString('base64')).join('.');}
export function decrypt(text:string){const [iv,tag,data]=text.split('.').map(x=>Buffer.from(x,'base64'));const d=createDecipheriv('aes-256-gcm',secretKey(),iv);d.setAuthTag(tag);return Buffer.concat([d.update(data),d.final()]).toString('utf8');}

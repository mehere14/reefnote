import db from '../db';
import {encrypt,decrypt} from '../crypto';
import type {Config} from './providers';
export function getConfig():Config|null {const row=db.prepare("SELECT value FROM settings WHERE key='ai'").get() as any;if(!row)return null;const c=JSON.parse(row.value);if(c.encryptedKey)c.apiKey=decrypt(c.encryptedKey);delete c.encryptedKey;return c;}
export function publicConfig(){const c=getConfig();if(!c)return {provider:'',modelWrite:'',modelStruct:'',hasKey:false};const {apiKey,...rest}=c;return {...rest,hasKey:!!apiKey};}
export function saveConfig(c:Config){const previous=getConfig();const key=c.apiKey===undefined&&c.provider===previous?.provider?previous?.apiKey:c.apiKey;const {apiKey,...rest}=c;db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('ai',JSON.stringify({...rest,...(key?{encryptedKey:encrypt(key)}:{})}));return publicConfig();}

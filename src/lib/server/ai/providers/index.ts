import {getPrompt} from '../prompts';
import db from '../../db';
import {ulid} from 'ulid';
import type { ZodType } from 'zod';
export type Config={provider:string;apiKey?:string;baseUrl?:string;modelWrite:string;modelStruct:string;styleBudget?:number;budget?:number;temps?:{write?:number;struct?:number};contextWindow?:number};
export type Options={model:string;system:string;messages:Array<{role:string;content:string}>;maxTokens:number;temperature:number;signal?:AbortSignal};
export interface Provider{listModels():Promise<Array<{id:string;contextWindow?:number}>>;stream(opts:Options):AsyncIterable<string>;structured<T>(opts:{model:string;system:string;prompt:string;schema:ZodType<T>;maxTokens:number;signal?:AbortSignal}):Promise<T>;test(model:string):Promise<{ok:boolean;msg:string}>;}
export function providerError(e:any){const text=String(e?.message||e);if(/401|403|api.?key|unauthorized/i.test(text))return 'The provider rejected the API key. Check it in Settings.';if(/429|rate.?limit/i.test(text))return 'The provider is rate-limiting requests. Try again in a minute.';if(/context|token.*limit/i.test(text))return 'The request exceeds the model context window.';if(/fetch|network|ENOTFOUND|ECONN/i.test(text))return "Couldn't reach the provider.";return text;}
export function createProvider(config:Config):Provider{
 const kind=config.provider;
 const defaults:Record<string,string>={openai:'https://api.openai.com/v1',openrouter:'https://openrouter.ai/api/v1',anthropic:'https://api.anthropic.com/v1',google:'https://generativelanguage.googleapis.com/v1beta',ollama:'http://127.0.0.1:11434'};
 const base=(config.baseUrl||defaults[kind]||'').replace(/\/$/,'')+(kind==='ollama'?'/v1':'');
 const redact=(text:string)=>config.apiKey?text.replaceAll(config.apiKey,'[redacted]'):text;
 const headers:Record<string,string>={'content-type':'application/json'};
 if(config.apiKey)headers[kind==='anthropic'?'x-api-key':kind==='google'?'x-goog-api-key':'authorization']=kind==='anthropic'||kind==='google'?config.apiKey:`Bearer ${config.apiKey}`;
 if(kind==='anthropic')headers['anthropic-version']='2023-06-01';
 async function request(path:string,body?:any,signal?:AbortSignal){const response=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal});if(!response.ok)throw new Error(`${response.status}: ${redact(await response.text())}`);return response;}
 function parseLine(line:string,usage:{input:number|null;output:number|null}){line=line.trim();if(!line.startsWith('data:'))return '';const raw=line.slice(5).trim();if(raw==='[DONE]')return '';let data:any;try{data=JSON.parse(raw);}catch{return '';}
  const u=data.usage||data.message?.usage||data.usageMetadata;
  if(u){usage.input=u.prompt_tokens??u.input_tokens??u.promptTokenCount??usage.input;usage.output=u.completion_tokens??u.output_tokens??u.candidatesTokenCount??usage.output;}
  if(data.error)throw new Error(redact(data.error.message||JSON.stringify(data.error)));
  return data.choices?.[0]?.delta?.content||data.delta?.text||data.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('')||'';
 }
 async function* stream(o:Options){
  const started=Date.now(),usage:{input:number|null;output:number|null}={input:null,output:null};let status='error';
  try{
  let path='/chat/completions';let body:any={model:o.model,messages:[{role:'system',content:o.system},...o.messages],max_tokens:o.maxTokens,temperature:o.temperature,stream:true};
  if(kind==='openai'&&/^(o[134](?:-|$)|gpt-5(?:\.|-|$))/.test(o.model)){delete body.max_tokens;delete body.temperature;body.max_completion_tokens=o.maxTokens;}
  if(kind==='anthropic'){path='/messages';body={model:o.model,system:o.system,messages:o.messages,max_tokens:o.maxTokens,temperature:Math.min(1,o.temperature),stream:true};}
  if(kind==='google'){path=`/models/${encodeURIComponent(o.model.replace(/^models\//,''))}:streamGenerateContent?alt=sse`;body={systemInstruction:{parts:[{text:o.system}]},contents:o.messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:o.maxTokens,temperature:o.temperature}};}
  if(!['anthropic','google'].includes(kind))body.stream_options={include_usage:true};
  const r=await request(path,body,o.signal);if(!r.body)throw new Error('Provider returned no response body');const reader=r.body.getReader(),decoder=new TextDecoder();let pending='';
  try{while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);const delta=parseLine(line,usage);if(delta)yield delta;}}pending+=decoder.decode();const delta=parseLine(pending,usage);if(delta)yield delta;}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  status='done';
  }finally{if(o.signal?.aborted)status='stopped';db.prepare('INSERT INTO llm_requests(id,provider,model,started_at,latency_ms,tokens_in,tokens_out,status) VALUES(?,?,?,?,?,?,?,?)').run(ulid(),kind,o.model,started,Date.now()-started,usage.input,usage.output,status);}
 }
 const p:Provider={stream,
  async listModels(){const d=await(await request('/models')).json();return (d.data||d.models||[]).map((m:any)=>({id:m.id||m.name?.replace(/^models\//,''),contextWindow:m.context_length||m.inputTokenLimit}));},
  async structured(o){let text='';for await(const s of stream({model:o.model,system:o.system+getPrompt('json'),messages:[{role:'user',content:o.prompt}],maxTokens:o.maxTokens,temperature:config.temps?.struct??0,signal:o.signal}))text+=s;return o.schema.parse(JSON.parse(text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,'')));},
  async test(model){try{for await(const _ of stream({model,system:getPrompt('connection'),messages:[{role:'user',content:'Connection test'}],maxTokens:/^(o[134]|gpt-5)/.test(model)?128:8,temperature:0})){}return {ok:true,msg:'Connected.'};}catch(e){return {ok:false,msg:providerError(e)};}}
 };return p;
}

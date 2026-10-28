import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'reefnote-scene-chat-'));
const port=4328,base=`http://127.0.0.1:${port}`,calls=[];
let browser,app,logs='';
const fake=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);calls.push(body);
 res.writeHead(200,{'content-type':'text/event-stream'});
 const text=calls.length===1?'The first scene draft.':'The revised scene draft, with a quieter ending.';
 res.write('data: '+JSON.stringify({choices:[{delta:{content:text.slice(0,10)}}]})+'\n\n');
 setTimeout(()=>{res.end('data: '+JSON.stringify({choices:[{delta:{content:text.slice(10)}}]})+'\n\ndata: [DONE]\n\n');},1200);
});
async function api(path,method='GET',body){const r=await fetch(base+'/api/'+path,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})});const data=await r.json();assert(r.ok,JSON.stringify(data));return data;}
try{
 await new Promise(resolve=>fake.listen(0,'127.0.0.1',resolve));
 app=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,PORT:String(port),ORIGIN:base,DATA_DIR:dir,NOVEL_STUDIO_DB:join(dir,'test.db')},stdio:['ignore','pipe','pipe']});
 app.stdout.on('data',d=>logs+=d);app.stderr.on('data',d=>logs+=d);
 for(let i=0;i<100;i++){try{await fetch(base);break;}catch{if(i===99)throw new Error(logs);await new Promise(resolve=>setTimeout(resolve,100));}}
 await api('settings','PUT',{provider:'openai',baseUrl:`http://127.0.0.1:${fake.address().port}/v1`,apiKey:'local-test',modelWrite:'test-writer',modelStruct:'test-structure'});
 const {novel}=await api('novels','POST',{title:'Scene chat verification'});
 let plot=await api(`novels/${novel.id}/subplots`,'POST',{title:'The discovery',premise:'A clue changes everything.'});
 await api(`subplots/${plot.id}/approve`,'POST',{baseRev:plot.rev});
 let scene=await api(`subplots/${plot.id}/elements`,'POST',{title:'The clue',purpose:'Mira finds a clue.',target_length:1200});
 scene=await api(`elements/${scene.scene_id}/approve`,'POST',{baseVersion:scene.version});
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/n/${novel.id}/plots?subplot=${plot.id}&element=${scene.scene_id}`);
 await page.getByRole('button',{name:'Draft scene with AI',exact:true}).click();
 await page.getByText('Draft this scene from its approved plan and story context.',{exact:false}).first().waitFor();
 await page.locator('.pass').waitFor();
 await page.getByText('Context sent to AI · test-writer',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Prepare scene draft',exact:true}).waitFor();
 assert.equal((await api(`elements/${scene.scene_id}`)).prose.text,'');
 await page.getByLabel('Message to co-writer').fill('Make the ending quieter. Return the complete revised prose only.');await page.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('The revised scene draft, with a quieter ending.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Prepare scene draft',exact:true}).last().click();
 await page.getByLabel('Final scene draft').fill('The finalized scene draft.');
 await page.getByRole('button',{name:'Accept into scene prose',exact:true}).click();
 await page.getByText('Draft accepted into scene prose',{exact:true}).waitFor();
 assert.equal((await api(`elements/${scene.scene_id}`)).prose.text,'The finalized scene draft.');
 assert(calls[1].messages[1].content.includes('The first scene draft.'));assert.equal(calls.length,2);assert.deepEqual(errors,[]);
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Chat',exact:true}).last().click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/tmp/reefnote-scene-chat-phone.png'});
 console.log('Passed desktop and phone: visible context, streaming, conversational revision, editable acceptance card, explicit application to prose.');
}finally{await browser?.close();app?.kill('SIGTERM');if(app)await new Promise(resolve=>app.once('exit',resolve));await new Promise(resolve=>fake.close(resolve));rmSync(dir,{recursive:true,force:true});}

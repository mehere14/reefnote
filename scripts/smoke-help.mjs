import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'reefnote-help-')),base='http://127.0.0.1:4329';let app,browser;
async function api(path,body){const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.clone().text());return r.json();}
try{
 app=spawn(process.execPath,['scripts/start.mjs'],{env:{...process.env,PORT:'4329',ORIGIN:base,DATA_DIR:dir,NOVEL_STUDIO_DB:join(dir,'test.db')},stdio:'ignore'});
 for(let i=0;i<100;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const {novel}=await api('novels',{title:'Help verification'});const plot=await api(`novels/${novel.id}/subplots`,{title:'Test plot',premise:'A test.'});await api(`subplots/${plot.id}/approve`,{baseRev:plot.rev});const scene=await api(`subplots/${plot.id}/elements`,{title:'Test scene',purpose:'A discovery.'});
 browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/n/${novel.id}/plots?subplot=${plot.id}`);await page.getByText('Theme and start / end states',{exact:false}).click();const theme=page.getByRole('button',{name:'Help: Theme',exact:true});await theme.hover();await page.getByRole('tooltip').waitFor();assert((await page.getByRole('tooltip').innerText()).includes('underlying idea'));await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);await theme.focus();await page.getByRole('tooltip').waitFor();await page.keyboard.press('Escape');
 await page.goto(`${base}/n/${novel.id}/plots?subplot=${plot.id}&element=${scene.scene_id}`);await page.getByRole('tab',{name:'Plan',exact:true}).click();const time=page.getByRole('button',{name:'Help: Time marker',exact:true});await time.click();await page.getByRole('tooltip').waitFor();assert((await page.getByRole('tooltip').innerText()).includes('Three days'));await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Help: New draft card',exact:true}).click();assert.equal(await page.getByText('Add to spec',{exact:true}).isVisible(),false);await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await time.scrollIntoViewIfNeeded();await time.tap({force:true}).catch(()=>time.click());await page.getByRole('tooltip').waitFor();const box=await page.getByRole('tooltip').boundingBox();assert(box.x>=0&&box.x+box.width<=390);assert(box.y>=0&&box.y+box.height<=844);await page.screenshot({path:'/tmp/reefnote-help-mobile.png'});assert.deepEqual(errors,[]);console.log('Help verified: hover, focus, Escape, click/tap, closed disclosure, mobile viewport, no browser errors.');
}finally{await browser?.close();app?.kill();rmSync(dir,{recursive:true,force:true});}

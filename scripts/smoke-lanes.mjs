// Lane grid browser smoke. Runs against an isolated test server (never the live writing database):
//   REEFNOTE_TEST_URL=http://127.0.0.1:4318 node scripts/smoke-lanes.mjs
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const base=process.env.REEFNOTE_TEST_URL||'http://127.0.0.1:4318';
async function api(path,method='GET',body){const response=await fetch(base+'/api/'+path,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
const {novel}=await api('novels','POST',{title:'Lane grid verification'});
const {card:joss}=await api(`novels/${novel.id}/cards`,'POST',{type:'character',title:'Joss',body:'Friendly, talkative.'});
let subplot=await api(`novels/${novel.id}/subplots`,'POST',{title:'The Engineer’s Betrayal',premise:'Mira sabotages the ship to return to her daughter.'});
subplot=await api(`subplots/${subplot.id}/approve`,'POST',{baseRev:subplot.rev});
const tp=await api(`subplots/${subplot.id}/turning-points`,'POST',{text:'Joss nearly catches her.'});
const browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',err=>errors.push(err.stack));page.setDefaultTimeout(15000);mkdirSync('/tmp/reefnote-lanes-browser',{recursive:true});
try{
 // Reached from Contents.
 await page.goto(`${base}/n/${novel.id}/chapters`);await page.locator('.app.workspace').waitFor();await page.waitForFunction(()=>!document.querySelector('.app')?.textContent?.includes('Loading your story'));await page.getByRole('textbox',{name:'Message to co-writer'}).waitFor();await page.getByRole('button',{name:'Lane grid'}).first().click();await page.waitForURL('**/lanes');await page.getByRole('heading',{name:'No lanes yet'}).waitFor();
 // Add the plot lane through the dialog; its turning point appears in the plot's tray.
 const plotCard=(await api(`novels/${novel.id}/cards?section=plots`)).find(c=>c.type==='plot');
 await page.getByRole('button',{name:'+ Add your first lane'}).click();await page.getByRole('combobox',{name:'Follow this card'}).selectOption(plotCard.id);await page.getByRole('button',{name:'Add lane',exact:true}).click();
 await page.locator('.tray .beat.tp').filter({hasText:'Joss nearly catches her.'}).waitFor();
 const jossLane=await api(`novels/${novel.id}/lanes`,'POST',{card_id:joss.id});const plotLane=(await api(`novels/${novel.id}/grid`)).lanes[0];
 // Place via the inspector (keyboard-reachable path), then build a collision through the API and reload.
 await page.reload();await page.locator('.tray .beat.tp').filter({hasText:'Joss nearly catches her.'}).click();await page.getByRole('combobox',{name:'Place in column'}).selectOption('end');
 await page.locator('.grid .beat').filter({hasText:'Joss nearly catches her.'}).waitFor();
 const grid=await api(`novels/${novel.id}/grid`);const bridge=grid.beats.find(b=>b.turning_point_id===tp.id);assert(bridge,'turning point bridge beat');
 const {card:hides}=await api(`novels/${novel.id}/beats`,'POST',{title:'Joss hides the logs',lane_id:jossLane.id,slot:grid.placements[0].slot});
 await api('scenes/group','POST',{beat_ids:[bridge.id,hides.id],title:'Caught in the bay'});
 const {card:old}=await api(`novels/${novel.id}/beats`,'POST',{type:'event',subtype:'backstory',title:'Mira’s daughter is left behind',lane_id:plotLane.id,slot:-1});
 await api('links','POST',{fromId:hides.id,toId:old.id,label:'because of'});
 await page.reload();await page.locator('.bracket.collision').filter({hasText:'Caught in the bay'}).waitFor();
 await page.getByRole('button',{name:'Expand backstory'}).click();await page.locator('.grid .beat.event').filter({hasText:'left behind'}).waitFor();
 await page.screenshot({path:'/tmp/reefnote-lanes-browser/lanes.png'});
 // Phone: one lane at a time.
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('combobox',{name:'Lane'}).selectOption(jossLane.id);await page.getByRole('button',{name:/Joss hides the logs/}).waitFor();await page.screenshot({path:'/tmp/reefnote-lanes-browser/lanes-phone.png'});
 // Subplot mode still opens for the same plot.
 await page.setViewportSize({width:1440,height:1000});await page.goto(`${base}/n/${novel.id}/plots?subplot=${subplot.id}`);await page.getByRole('combobox',{name:'Switch plot'}).waitFor();
 assert.deepEqual(errors,[]);console.log('Lane grid: navigation, add lane, turning point tray and bridge, collision, backstory, phone view, and subplot mode passed.');
}catch(error){console.log('URL',page.url());console.log('Page errors',errors);console.log((await page.locator('body').innerText()).slice(0,1500));await page.screenshot({path:'/tmp/reefnote-lanes-browser/failure.png'});throw error;}finally{await browser.close();await api(`novels/${novel.id}`,'DELETE');}

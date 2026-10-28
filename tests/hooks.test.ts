import {describe, it, expect, vi} from 'vitest';
vi.mock('$app/environment', () => ({building:false}));
vi.mock('$env/dynamic/private', () => ({env:{NOVEL_STUDIO_PASSWORD:'test-password',HOST:'127.0.0.1'}}));
vi.mock('$lib/server/db', () => ({default:{}}));
vi.mock('$lib/server/crypto', () => ({secretKey:() => new Uint8Array(32)}));
vi.mock('$lib/server/queue', () => ({startQueue:() => {}}));
vi.mock('$lib/server/subplots/indexing', () => ({backfillSceneSummaries:() => {}}));
import {handle} from '../src/hooks.server';
function event(path:string, init:RequestInit={}) {
 const url=new URL(path,'http://127.0.0.1:4317');
 return {url,request:new Request(url,init),cookies:{get:()=>undefined},getClientAddress:()=> '127.0.0.1'} as any;
}
describe('authentication hook response', () => {
 it('sets a secure session cookie on an early login redirect', async () => {
  const response=await handle({event:event('/login',{method:'POST',headers:{origin:'http://127.0.0.1:4317','content-type':'application/x-www-form-urlencoded'},body:'password=test-password'}),resolve:vi.fn()} as any);
  expect(response.status).toBe(303);
  expect(response.headers.get('set-cookie')).toMatch(/novel_session=.+; Path=\/; HttpOnly; SameSite=Strict/);
 });
 it('rejects unauthenticated API access and foreign-origin mutations', async () => {
  const denied=await handle({event:event('/api/novels'),resolve:vi.fn()} as any);
  expect(denied.status).toBe(401);
  const foreign=await handle({event:event('/login',{method:'POST',headers:{origin:'https://unrelated.example'}}),resolve:vi.fn()} as any);
  expect(foreign.status).toBe(403);
 });
});

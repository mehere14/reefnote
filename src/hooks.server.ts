import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createSession, validPassword, validSession, isLocalHost } from '$lib/server/security/session';

const loginPage = (failed = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Open Reefnote</title><meta name="theme-color" content="#EAF0EE"><style>body{background:#eaf0ee;color:#132a2c;font:17px Georgia,serif;display:grid;place-items:center;min-height:95vh;margin:0 16px}main{background:white;padding:2.5rem;max-width:24rem;width:100%;border:1px solid #d3dfdb;border-radius:12px;box-shadow:0 20px 40px -24px rgba(10,40,40,.35)}h1{font-style:italic;font-weight:500;margin:0 0 .5rem}input,button{box-sizing:border-box;padding:.8rem;width:100%;margin-top:.5rem;font:inherit;border-radius:8px}input{border:1px solid #d3dfdb}button{background:#0e6964;color:white;border:0;margin-top:1rem;font:600 15px system-ui,sans-serif;cursor:pointer}label{display:block;font:600 13px system-ui,sans-serif;color:#587070;margin-top:1rem}p{line-height:1.5}[role=alert]{color:#a3263a}@media(prefers-color-scheme:dark){body{background:#0f1d1e;color:#e3eeec}main{background:#152627;border-color:#2a4143}input{background:#1c2f30;color:#e3eeec;border-color:#2a4143}label{color:#93aba9}button{background:#5cc2b8;color:#08201f}[role=alert]{color:#f6a3ae}}</style></head><body><main><h1>Reefnote</h1><p>Your writing room is password protected.</p>${failed ? '<p role="alert">That password did not match. Try again.</p>' : ''}<form method="post" action="/login"><label>Password<input type="password" name="password" autocomplete="current-password" required autofocus></label><button>Open Reefnote</button></form></main></body></html>`;
let boot: Promise<void> | undefined;
function initialize() {
  return boot ||= (async () => {
    await import('$lib/server/db');
    const {secretKey} = await import('$lib/server/crypto');
    secretKey();
    const {startQueue} = await import('$lib/server/queue');
    startQueue();
  })();
}
const attempts = new Map<string, {count: number; until: number}>();

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);
  const password = env.NOVEL_STUDIO_PASSWORD;
  if (!isLocalHost(env.HOST || '127.0.0.1') && !password) return new Response('Set NOVEL_STUDIO_PASSWORD before exposing Novel Studio on a public interface.', { status: 503 });
  await initialize();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    const origin = event.request.headers.get('origin');
    if (origin && origin !== event.url.origin) return new Response('Cross-origin requests are not allowed.', {status: 403});
  }
  if (password) {
    if (event.url.pathname === '/login') {
      if (event.request.method === 'POST') {
        const ip = event.getClientAddress();
        const attempt = attempts.get(ip);
        if (attempt && attempt.until > Date.now() && attempt.count >= 10) return new Response('Too many attempts. Try again in a minute.', {status:429});
        const form = await event.request.formData();
        if (validPassword(String(form.get('password') || ''), password)) {
          attempts.delete(ip);
          const cookie = `novel_session=${createSession(password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*7}${event.url.protocol === 'https:' ? '; Secure' : ''}`;
          return new Response(null, {status:303, headers:{location:'/', 'set-cookie':cookie}});
        }
        attempts.set(ip, {count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now()+60000});
        return new Response(loginPage(true), {status:401, headers:{'content-type':'text/html'}});
      }
      return new Response(loginPage(), {headers:{'content-type':'text/html'}});
    }
    if (!validSession(event.cookies.get('novel_session'), password)) {
      if (event.url.pathname.startsWith('/api/')) return Response.json({error:'Please sign in to your writing room.'}, {status:401});
      return new Response(null, {status:303, headers:{location:'/login'}});
    }
  }
  return resolve(event);
};

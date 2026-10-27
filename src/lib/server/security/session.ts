import { createHmac, timingSafeEqual } from 'node:crypto';

const lifetime = 60 * 60 * 24 * 7;
export function validPassword(input: string, password: string): boolean {
  const left = createHmac('sha256', 'novel-studio-password-check').update(input).digest();
  const right = createHmac('sha256', 'novel-studio-password-check').update(password).digest();
  return timingSafeEqual(left, right);
}
export function createSession(password: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + lifetime;
  const signature = createHmac('sha256', password).update(`novel-studio:${expires}`).digest('hex');
  return `${expires}.${signature}`;
}
export function validSession(token: string | undefined, password: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expiry, signature, extra] = token.split('.');
  if (extra || !/^\d+$/.test(expiry) || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  const expires = Number(expiry);
  if (expires < now / 1000 || expires > now / 1000 + lifetime + 1) return false;
  const expected = createHmac('sha256', password).update(`novel-studio:${expires}`).digest('hex');
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
}
export function isLocalHost(host: string): boolean { return ['127.0.0.1', 'localhost', '::1'].includes(host); }

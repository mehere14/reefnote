import { describe, it, expect } from 'vitest';
import { createSession, validPassword, validSession } from '../src/lib/server/security/session';
describe('password-protected studio', () => {
  it('rejects mismatched passwords and tampered sessions', () => {
    expect(validPassword('correct', 'correct')).toBe(true);
    expect(validPassword('incorrect', 'correct')).toBe(false);
    const token = createSession('correct', 1000000);
    expect(validSession(token, 'correct', 1000001)).toBe(true);
    expect(validSession(token, 'changed', 1000001)).toBe(false);
    expect(validSession(token.replace(/.$/, 'z'), 'correct', 1000001)).toBe(false);
    expect(validSession(token, 'correct', 1000000 + 8*86400000)).toBe(false);
    expect(validSession(undefined, 'correct')).toBe(false);
  });
});

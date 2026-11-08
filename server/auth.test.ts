import { describe, expect, it } from 'vitest';
import { RateLimiter, hashPassword, hashToken, newSessionToken, validateCredentials, verifyPassword } from './auth';

describe('auth', () => {
  it('parola doğrulama doğru/yanlış', async () => {
    const h = await hashPassword('gizli-parola-1');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('gizli-parola-1', h)).toBe(true);
    expect(await verifyPassword('yanlis-parola', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
  it('aynı parola farklı hash üretir (tuz)', async () => {
    expect(await hashPassword('aynı-parola-12')).not.toBe(await hashPassword('aynı-parola-12'));
  });
  it('belirteç özeti sabit ve belirteçten farklı', () => {
    const t = newSessionToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(t);
  });
  it('kimlik bilgisi doğrulama', () => {
    expect(validateCredentials('Naruto_01', '12345678')).toBeNull();
    expect(validateCredentials('ab', '12345678')).not.toBeNull();
    expect(validateCredentials('a<b>c', '12345678')).not.toBeNull();
    expect(validateCredentials('Şükrü', '12345678')).toBeNull();
    expect(validateCredentials('geçerli', '1234')).not.toBeNull();
  });
  it('hız sınırı', () => {
    const r = new RateLimiter(3, 1000);
    expect([r.take('a', 0), r.take('a', 1), r.take('a', 2), r.take('a', 3)]).toEqual([true, true, true, false]);
    expect(r.take('a', 1500)).toBe(true);
    expect(r.take('b', 3)).toBe(true);
  });
});

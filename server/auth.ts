import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Parola: scrypt (Node yerleşik, bellek-zor) + kullanıcıya özel rastgele tuz.
 * Oturum belirteci: 256 bit rastgele; veritabanında yalnızca SHA-256 özeti saklanır,
 * bu yüzden veritabanı sızsa bile belirteçler kullanılamaz.
 */
const KEYLEN = 64;
const COST = { N: 16384, r: 8, p: 1 } as const;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEYLEN, COST, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

const DUMMY = hashPassword('boş-parola-zamanlama-koruması');

/** hash null ise (kullanıcı yok) yine de aynı maliyetle hesaplar: kullanıcı adı sızdırmaz. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const hash = stored ?? (await DUMMY);
  const [scheme, saltB64, keyB64] = hash.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'));
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  return stored !== null && ok;
}

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export const USERNAME_RE = /^[\p{L}\p{N}_-]{3,16}$/u;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Kullanıcı adı 3-16 karakter olmalı (harf, rakam, _ veya -)';
  }
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `Parola ${PASSWORD_MIN}-${PASSWORD_MAX} karakter olmalı`;
  }
  return null;
}

/** Basit bellek içi hız sınırlayıcı (kaba kuvvet denemelerini yavaşlatır). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  /** true: izin verildi ve sayıldı; false: sınır aşıldı */
  take(key: string, now = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}

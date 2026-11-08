import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteDb } from './db';
import { createStore, type Store } from './store';

let store: Store;
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ uid: `t${n}-${i}-${Math.random()}`, catalogId: 'naruto-001', level: 1, xp: 0 }));

beforeEach(async () => {
  store = createStore(await createPgliteDb());
  await store.migrate();
});
afterEach(() => store.close());

async function user(name: string, tiles = mk(5)) {
  const id = `u-${name}`;
  const ok = await store.createUser({ id, username: name, passwordHash: 'h', starter: tiles, shooterUid: tiles[0].uid });
  return { id, ok, tiles };
}

describe('store', () => {
  it('kullanıcı + envanter oluşturur, aynı ad (büyük/küçük harf fark etmez) reddedilir', async () => {
    const a = await user('Ali');
    expect(a.ok).toBe(true);
    expect((await store.loadInventory(a.id)).length).toBe(5);
    const dup = await store.createUser({ id: 'x', username: 'ALI', passwordHash: 'h', starter: mk(2), shooterUid: 'z' });
    expect(dup).toBe(false);
    expect(await store.loadInventory('x')).toEqual([]);
  });
  it('oturum süresi ve silme', async () => {
    const a = await user('Veli');
    await store.createSession(a.id, 'hash1', 60_000);
    expect(await store.userIdForSession('hash1')).toBe(a.id);
    await store.deleteSession('hash1');
    expect(await store.userIdForSession('hash1')).toBeNull();
    await store.createSession(a.id, 'hash2', -1000);
    expect(await store.userIdForSession('hash2')).toBeNull();
  });
  it('transfer taso sayısını korur ve çift işlemez', async () => {
    const a = await user('A'); const b = await user('B');
    const mv = [{ uid: a.tiles[0].uid, from: a.id, to: b.id }];
    expect(await store.moveTasos(mv)).toBe(1);
    expect(await store.moveTasos(mv)).toBe(0);
    expect((await store.loadInventory(a.id)).length).toBe(4);
    expect((await store.loadInventory(b.id)).length).toBe(6);
  });
  it('XP yükleme: kaynak silinir, hedef güncellenir; kilitli/yabancı kaynak işlemi iptal eder', async () => {
    const a = await user('C'); const b = await user('D');
    const [t, s1, s2, s3] = a.tiles;
    await store.setFlag(a.id, s3.uid, 'locked', true);
    expect(await store.consumeXp({ userId: a.id, targetUid: t.uid, sourceUids: [s1.uid, s3.uid], level: 5, xp: 1 })).toBe(false);
    expect(await store.consumeXp({ userId: a.id, targetUid: t.uid, sourceUids: [b.tiles[0].uid], level: 5, xp: 1 })).toBe(false);
    expect((await store.loadInventory(a.id)).length).toBe(5);
    expect(await store.consumeXp({ userId: a.id, targetUid: t.uid, sourceUids: [s1.uid, s2.uid], level: 5, xp: 1 })).toBe(true);
    const inv = await store.loadInventory(a.id);
    expect(inv.length).toBe(3);
    expect(inv.find((x) => x.uid === t.uid)).toMatchObject({ level: 5, xp: 1 });
  });
  it('favori/kilit yalnız sahibi için', async () => {
    const a = await user('E'); const b = await user('F');
    expect(await store.setFlag(b.id, a.tiles[0].uid, 'favorite', true)).toBe(false);
    expect(await store.setFlag(a.id, a.tiles[0].uid, 'favorite', true)).toBe(true);
    expect((await store.loadInventory(a.id)).find((x) => x.uid === a.tiles[0].uid)?.favorite).toBe(true);
  });
});

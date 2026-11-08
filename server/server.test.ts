import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { ROOM_BY_ID } from '../src/data/rooms';
import type { MatchView, MeView, ShotBegin, ShotResultMsg } from '../src/net/protocol';
import { createPgliteDb } from './db';
import { createGameServer } from './gameServer';
import { createStore } from './store';

const store = createStore(await createPgliteDb());
await store.migrate();
const server = createGameServer(store, {
  port: 0,
  authRateMax: 10000,
  introMs: 40,
  animMs: 40,
  barTimeoutMs: 600,
  decisionMs: 1500,
  stakeMs: 8000,
  graceMs: 400,
  staticDir: undefined,
});
let port = 0;

beforeAll(async () => {
  port = await server.start();
});
afterAll(async () => {
  await server.stop();
});

class TestClient {
  socket: Socket;
  me!: MeView;
  view: MatchView | null = null;
  results: ShotResultMsg[] = [];
  errors: string[] = [];
  autoShoot = false;
  constructor(public token: string, public name: string, public userId = '') {
    this.socket = this.connect();
  }
  connect(): Socket {
    const s = ioc(`http://localhost:${port}`, {
      auth: { token: this.token },
      transports: ['websocket'],
      forceNew: true,
    });
    s.on('me', (m: MeView) => (this.me = m));
    s.on('match:snapshot', (v: MatchView) => (this.view = v));
    s.on('error:msg', (e: { message: string }) => this.errors.push(e.message));
    s.on('shot:result', (r: ShotResultMsg) => this.results.push(r));
    s.on('shot:begin', (b: ShotBegin) => {
      if (!this.autoShoot || b.center === undefined || !this.view) return;
      const period = ROOM_BY_ID[this.view.roomId].barPeriodMs;
      const wait = (b.center * period) / 2; // ibre merkeze geldiği an
      setTimeout(() => this.socket.emit('shot:tap', { shotId: b.shotId, elapsedMs: wait }), wait);
    });
    return s;
  }
  reconnect() {
    this.socket.disconnect();
    this.socket = this.connect();
  }
  async until<T>(fn: () => T | undefined | false, ms = 15000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error(`zaman aşımı (${this.name})`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  stakes(n: number): string[] {
    return this.me.inventory
      .filter((t) => t.uid !== this.me.shooterUid)
      .slice(0, n)
      .map((t) => t.uid);
  }
  close() {
    this.socket.disconnect();
  }
}

const base = () => `http://localhost:${port}`;
async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(base() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, string> };
}
const PASS = 'test-parola-123';
let n = 0;
/** Gerçek kayıt uç noktasıyla hesap açar ve bağlanır */
async function signup(name: string): Promise<TestClient> {
  const uname = `${name}${++n}`.slice(0, 16);
  const r = await post('/api/register', { username: uname, password: PASS });
  expect(r.status).toBe(201);
  const row = await store.findUserByName(uname);
  return new TestClient(r.body.token, uname, row!.id);
}

describe('çevrim içi maç', () => {
  it('eşleşir, tasolar sunucuda çevrilir/aktarılır, devam seçeneği çalışır, envanter korunur', async () => {
    const a = await signup('Ayşe');
    const b = await signup('Berk');
    await a.until(() => a.me);
    await b.until(() => b.me);
    const before = new Set([...a.me.inventory, ...b.me.inventory].map((t) => t.uid));
    const countBefore = a.me.inventory.length + b.me.inventory.length;

    a.socket.emit('queue:join', { roomId: 'acemi' });
    await a.until(() => a.me.queued === 'acemi');
    b.socket.emit('queue:join', { roomId: 'acemi' });
    await a.until(() => a.view?.phase === 'stakes');
    await b.until(() => b.view?.phase === 'stakes');
    expect(a.view!.you).not.toBe(b.view!.you);

    // geçersiz seçimler reddedilir
    a.socket.emit('match:stakes', { uids: a.stakes(2) });
    await a.until(() => a.errors.length > 0);
    a.socket.emit('match:stakes', { uids: [a.me.shooterUid, ...a.stakes(2)] });
    await a.until(() => a.errors.length > 1);
    a.socket.emit('match:stakes', { uids: b.stakes(3) }); // rakibin tasoları bende yok
    await a.until(() => a.errors.length > 2);
    expect(a.view!.phase).toBe('stakes');

    // sadece biri onaylarsa maç başlamaz
    a.socket.emit('match:stakes', { uids: a.stakes(3) });
    await b.until(() => b.view?.stakesConfirmed.some(Boolean));
    expect(b.view!.phase).toBe('stakes');
    expect(b.view!.state).toBeNull();

    // yeniden bağlanma: sayfa yenileyen taraf maça döner
    b.socket.emit('match:stakes', { uids: b.stakes(3) });
    await a.until(() => a.view?.phase === 'playing');
    const matchId = a.view!.matchId;
    b.reconnect();
    await b.until(() => b.view?.phase === 'playing' && b.view.matchId === matchId);
    expect(b.view!.state!.table).toHaveLength(6);

    // masada 6 taso, ilk atan rastgele; atışlar sırayla
    a.autoShoot = true;
    b.autoShoot = true;
    await a.until(() => a.view?.phase === 'decision', 40000);
    await b.until(() => b.view?.phase === 'decision', 5000);

    // sıra her atışta değişti
    const shooters = a.results.map((r) => r.shooter);
    for (let i = 1; i < shooters.length; i++) expect(shooters[i]).not.toBe(shooters[i - 1]);
    const totalFlipped = a.results.reduce((n, r) => n + r.flipped.length, 0);
    expect(totalFlipped).toBe(6);

    // transfer: kazanılan tasolar yeni sahibinde, eskisinde yok, hiçbiri çoğalmadı
    await a.until(() => a.me.inventory.length + b.me.inventory.length === countBefore);
    const idsA = new Set(a.me.inventory.map((t) => t.uid));
    const idsB = new Set(b.me.inventory.map((t) => t.uid));
    for (const u of idsA) expect(idsB.has(u)).toBe(false);
    expect(new Set([...idsA, ...idsB])).toEqual(before);
    const final = a.results.at(-1)!.state;
    for (const t of final.players[a.view!.you].won) expect(idsA.has(t.uid)).toBe(true);
    for (const t of final.players[b.view!.you].won) expect(idsB.has(t.uid)).toBe(true);

    // veritabanındaki envanter, oyuncunun gördüğüyle birebir aynı (kalıcı)
    await server.flush();
    expect((await store.loadInventory(a.userId)).map((t) => t.uid).sort()).toEqual([...idsA].sort());
    expect((await store.loadInventory(b.userId)).map((t) => t.uid).sort()).toEqual([...idsB].sort());

    // ikisi de DEVAM derse yeni tur taso seçimine döner; biri BİTİR derse maç biter
    a.socket.emit('round:decision', { continue: true });
    b.socket.emit('round:decision', { continue: true });
    await a.until(() => a.view?.phase === 'stakes' && a.view.round === 2);
    expect(a.view!.stakesConfirmed).toEqual([false, false]);
    a.socket.emit('match:leave', {});
    await b.until(() => b.view?.phase === 'ended');
    await a.until(() => a.me.inMatch === false);

    a.close();
    b.close();
  }, 70000);

  it('yalnız bir taraf DEVAM derse maç biter; süre dolarsa devam sayılmaz', async () => {
    const a = await signup('Can');
    const b = await signup('Deniz');
    await a.until(() => a.me);
    await b.until(() => b.me);
    a.socket.emit('queue:join', { roomId: 'acemi' });
    b.socket.emit('queue:join', { roomId: 'acemi' });
    await a.until(() => a.view?.phase === 'stakes');
    a.socket.emit('match:stakes', { uids: a.stakes(3) });
    b.socket.emit('match:stakes', { uids: b.stakes(3) });
    a.autoShoot = true;
    b.autoShoot = true;
    await a.until(() => a.view?.phase === 'decision', 40000);
    a.socket.emit('round:decision', { continue: true });
    // b hiçbir şey yapmaz -> süre dolar -> devam etmeme
    await a.until(() => a.view?.phase === 'ended', 8000);
    expect(a.view!.endReason).toBe('finished');
    expect(a.view!.summary.rounds).toBe(1);
    expect(a.view!.summary.won[0].length + a.view!.summary.won[1].length).toBe(6);
    a.close();
    b.close();
  }, 70000);

  it('rakip koparsa süre dolunca maç terk sayılır ve tasolar çoğalmaz', async () => {
    const a = await signup('Ela');
    const b = await signup('Fatih');
    await a.until(() => a.me);
    await b.until(() => b.me);
    const total = a.me.inventory.length + b.me.inventory.length;
    a.socket.emit('queue:join', { roomId: 'usta' });
    b.socket.emit('queue:join', { roomId: 'usta' });
    await a.until(() => a.view?.phase === 'stakes');
    a.socket.emit('match:stakes', { uids: a.stakes(5) });
    b.socket.emit('match:stakes', { uids: b.stakes(5) });
    await a.until(() => a.view?.phase === 'playing');
    b.close();
    await a.until(() => a.view?.phase === 'ended', 8000);
    expect(a.view!.endReason).toBe('abandoned');
    await a.until(() => a.me.inMatch === false);
    await server.flush();
    const dbA = await store.loadInventory(a.userId);
    const dbB = await store.loadInventory(b.userId);
    expect(dbA.length + dbB.length).toBe(total);
    expect(dbA.map((t) => t.uid).sort()).toEqual(a.me.inventory.map((t) => t.uid).sort());
    a.close();
  }, 30000);

  it('atış tasosu maç sırasında değiştirilemez; kuyruktan çıkılabilir', async () => {
    const a = await signup('Gül');
    await a.until(() => a.me);
    a.socket.emit('queue:join', { roomId: 'efsane' });
    await a.until(() => a.me.queued === 'efsane');
    a.socket.emit('queue:leave', {});
    await a.until(() => a.me.queued === null);
    const other = a.me.inventory.find((t) => t.uid !== a.me.shooterUid)!;
    a.socket.emit('shooter:set', { uid: other.uid });
    await a.until(() => a.me.shooterUid === other.uid);
    a.socket.emit('shooter:set', { uid: 'yok-boyle-bir-taso' });
    await a.until(() => a.errors.length > 0);
    a.close();
  });

  it('hesap: kayıt, aynı ad reddi, yanlış parola, oturum, çıkış', async () => {
    const r1 = await post('/api/register', { username: 'HesapTest', password: PASS });
    expect(r1.status).toBe(201);
    expect((await post('/api/register', { username: 'hesaptest', password: PASS })).status).toBe(409);
    expect((await post('/api/register', { username: 'a', password: PASS })).status).toBe(400);
    expect((await post('/api/register', { username: 'KisaParola', password: '123' })).status).toBe(400);
    expect((await post('/api/login', { username: 'HesapTest', password: 'yanlis-parola-1' })).status).toBe(401);
    expect((await post('/api/login', { username: 'yok-boyle-biri', password: PASS })).status).toBe(401);
    const l = await post('/api/login', { username: 'hesaptest', password: PASS });
    expect(l.status).toBe(200);
    const sess = await fetch(base() + '/api/session', { headers: { authorization: `Bearer ${l.body.token}` } });
    expect(sess.status).toBe(200);
    // parola veritabanında düz metin değil
    const row = await store.findUserByName('HesapTest');
    expect(row!.password_hash.includes(PASS)).toBe(false);
    await post('/api/logout', {}, l.body.token);
    expect((await fetch(base() + '/api/session', { headers: { authorization: `Bearer ${l.body.token}` } })).status).toBe(401);
    // geçersiz belirteçle socket bağlanamaz
    const bad = ioc(base(), { auth: { token: 'x'.repeat(43) }, transports: ['websocket'], forceNew: true });
    const err = await new Promise<string>((res) => bad.on('connect_error', (e) => res(e.message)));
    expect(err).toBe('Oturum geçersiz');
    bad.close();
  });

  it('kalıcılık: envanter, atış tasosu, favori/kilit çıkış-girişten sonra aynı gelir', async () => {
    const a = await signup('Kalici');
    await a.until(() => a.me);
    const [t1, t2] = a.me.inventory.filter((t) => t.uid !== a.me.shooterUid);
    a.socket.emit('shooter:set', { uid: t1.uid });
    a.socket.emit('taso:flag', { uid: t2.uid, field: 'favorite', value: true });
    a.socket.emit('taso:flag', { uid: t1.uid, field: 'locked', value: true });
    await a.until(() => a.me.inventory.find((t) => t.uid === t2.uid)?.favorite && a.me.inventory.find((t) => t.uid === t1.uid)?.locked);
    const count = a.me.inventory.length;
    a.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.players.has(a.userId)).toBe(false); // bellekten atıldı
    const l = await post('/api/login', { username: a.name, password: PASS });
    const a2 = new TestClient(l.body.token, a.name, a.userId);
    await a2.until(() => a2.me);
    expect(a2.me.inventory).toHaveLength(count);
    expect(a2.me.shooterUid).toBe(t1.uid);
    expect(a2.me.inventory.find((t) => t.uid === t2.uid)?.favorite).toBe(true);
    expect(a2.me.inventory.find((t) => t.uid === t1.uid)?.locked).toBe(true);
    a2.close();
  });

  it('XP yükleme: dönüştürür, seviye atlatır, korumalı/yabancı/kendi tasoyu reddeder, kalıcıdır', async () => {
    const a = await signup('XpUsta');
    const other = await signup('XpDiger');
    await a.until(() => a.me);
    await other.until(() => other.me);
    const inv = a.me.inventory;
    const target = inv.find((t) => t.uid !== a.me.shooterUid)!;
    const rest = inv.filter((t) => t.uid !== a.me.shooterUid && t.uid !== target.uid);
    const [fav, lock, ...free] = rest;
    a.socket.emit('taso:flag', { uid: fav.uid, field: 'favorite', value: true });
    a.socket.emit('taso:flag', { uid: lock.uid, field: 'locked', value: true });
    await a.until(() => a.me.inventory.find((t) => t.uid === lock.uid)?.locked);
    const countBefore = a.me.inventory.length;

    const bad = async (sourceUids: string[], targetUid = target.uid) => {
      const k = a.errors.length;
      a.socket.emit('taso:xp', { targetUid, sourceUids });
      await a.until(() => a.errors.length > k);
      expect(a.me.inventory).toHaveLength(countBefore);
    };
    await bad([lock.uid]);
    await bad([fav.uid]);
    await bad([a.me.shooterUid]);
    await bad([target.uid]);
    await bad([other.me.inventory[0].uid]);
    await bad([free[0].uid, free[0].uid]);

    let result: { gained: number; levelAfter: number; consumed: number } | undefined;
    a.socket.on('xp:result', (r) => (result = r));
    const src = free.slice(0, 5).map((t) => t.uid);
    a.socket.emit('taso:xp', { targetUid: target.uid, sourceUids: src });
    await a.until(() => result);
    expect(result!.consumed).toBe(5);
    expect(result!.gained).toBeGreaterThan(0);
    expect(a.me.inventory).toHaveLength(countBefore - 5);
    for (const u of src) expect(a.me.inventory.some((t) => t.uid === u)).toBe(false);
    const t2 = a.me.inventory.find((t) => t.uid === target.uid)!;
    expect(t2.level).toBe(result!.levelAfter);
    expect(t2.level).toBeGreaterThan(1);

    // aynı tasolar ikinci kez harcanamaz
    const k = a.errors.length;
    a.socket.emit('taso:xp', { targetUid: target.uid, sourceUids: [src[0]] });
    await a.until(() => a.errors.length > k);

    await server.flush();
    const db = await store.loadInventory(a.userId);
    expect(db).toHaveLength(countBefore - 5);
    expect(db.find((t) => t.uid === target.uid)).toMatchObject({ level: t2.level, xp: t2.xp });
    a.close();
    other.close();
  });
});

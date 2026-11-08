import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as ioc, type Socket } from 'socket.io-client';
import { ROOM_BY_ID } from '../src/data/rooms';
import type { MatchView, MeView, ShotBegin, ShotResultMsg } from '../src/net/protocol';
import { createGameServer } from './gameServer';

const server = createGameServer({
  port: 0,
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
  constructor(public token: string, public name: string) {
    this.socket = this.connect();
  }
  connect(): Socket {
    const s = ioc(`http://localhost:${port}`, {
      auth: { token: this.token, name: this.name },
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

const tok = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}-abcdef`;

describe('çevrim içi maç', () => {
  it('eşleşir, tasolar sunucuda çevrilir/aktarılır, devam seçeneği çalışır, envanter korunur', async () => {
    const a = new TestClient(tok(), 'Ayşe');
    const b = new TestClient(tok(), 'Berk');
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
    const a = new TestClient(tok(), 'Can');
    const b = new TestClient(tok(), 'Deniz');
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
    const a = new TestClient(tok(), 'Ela');
    const b = new TestClient(tok(), 'Fatih');
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
    const bPlayer = [...server.players.values()].find((p) => p.name === 'Fatih')!;
    expect(a.me.inventory.length + bPlayer.inventory.length).toBe(total);
    a.close();
  }, 30000);

  it('atış tasosu maç sırasında değiştirilemez; kuyruktan çıkılabilir', async () => {
    const a = new TestClient(tok(), 'Gül');
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
});

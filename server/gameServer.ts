import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import { ROOM_BY_ID } from '../src/data/rooms';
import {
  createRound,
  resolveShot,
  type MatchState,
  type PlayerSetup,
  type StakeTile,
} from '../src/engine/engine';
import { defaultRng } from '../src/engine/rng';
import { clampReportedElapsed, gradeShot, pointerAt } from '../src/engine/timing';
import type {
  MatchSummary,
  MatchView,
  MeView,
  OnlinePhase,
  ShotBegin,
  ShotResultMsg,
} from '../src/net/protocol';
import { CATALOG_BY_ID } from '../src/data/catalog';
import { addXp, tileXpValue, XP } from '../src/engine/xp';
import { createStarterInventory } from '../src/lib/inventory';
import {
  RateLimiter,
  hashPassword,
  hashToken,
  newSessionToken,
  validateCredentials,
  verifyPassword,
} from './auth';
import type { Store } from './store';
import { applyRoundTransfer } from '../src/lib/transfer';
import type { OwnedTaso, RoomId, ShotGrade } from '../src/types';

export interface ServerConfig {
  port: number;
  /** Tur başında ilk atıştan önceki bekleme */
  introMs: number;
  /** Bir atışın istemci animasyonunun bitmesini beklenen süre */
  animMs: number;
  /** Oyuncu bu sürede dokunmazsa atış ZAYIF sayılır */
  barTimeoutMs: number;
  /** Tur sonu DEVAM ET / BİTİR karar süresi */
  decisionMs: number;
  /** Taso seçip onaylama süresi */
  stakeMs: number;
  /** Bağlantı koparsa yeniden bağlanma süresi */
  graceMs: number;
  /** Bu süre içinde ücretsiz kurtarma tekrar alınamaz */
  rescueCooldownMs: number;
  /** Oturum geçerlilik süresi */
  sessionTtlMs: number;
  /** Kimlik doğrulama uç noktaları için pencere başına izin verilen deneme (IP başına) */
  authRateMax: number;
  clientOrigin?: string;
  staticDir?: string;
}

export const DEFAULT_CONFIG: ServerConfig = {
  port: Number(process.env.PORT ?? 3001),
  introMs: 2000,
  animMs: 2700,
  barTimeoutMs: 10000,
  decisionMs: 20000,
  stakeMs: 60000,
  graceMs: 60000,
  rescueCooldownMs: 24 * 3600 * 1000,
  sessionTtlMs: 30 * 24 * 3600 * 1000,
  authRateMax: 40,
  clientOrigin: process.env.CLIENT_ORIGIN,
  staticDir: path.resolve(process.cwd(), 'dist'),
};

interface Player {
  id: string;
  name: string;
  /** Çevrim içi oyuncunun çalışma kopyası; kalıcı kayıt PostgreSQL'dedir (sıralı yazma kuyruğu). */
  inventory: OwnedTaso[];
  shooterUid: string;
  matchId: string | null;
  queued: RoomId | null;
  rescuedAt: number;
  sockets: Set<string>;
}

interface ActiveShot {
  id: number;
  shooter: 0 | 1;
  startedAt: number;
  center: number;
  resolved: boolean;
}

interface Match {
  id: string;
  roomId: RoomId;
  ids: [string, string];
  names: [string, string];
  phase: OnlinePhase;
  round: number;
  stakes: [StakeTile[] | null, StakeTile[] | null];
  stakeDeadline: number;
  introUntil: number;
  state: MatchState | null;
  shooterCatalog: [string, string] | null;
  shot: ActiveShot | null;
  decision: [boolean | null, boolean | null];
  decisionDeadline: number;
  summary: MatchSummary;
  endReason?: MatchView['endReason'];
  timers: Set<NodeJS.Timeout>;
  grace: [NodeJS.Timeout | null, NodeJS.Timeout | null];
}

const emptySummary = (): MatchSummary => ({
  rounds: 0,
  won: [[], []],
  shots: [0, 0],
  successes: [0, 0],
  perfects: [0, 0],
});

export function createGameServer(store: Store, partial: Partial<ServerConfig> = {}) {
  const cfg: ServerConfig = { ...DEFAULT_CONFIG, ...partial };
  const app = express();
  const http = createServer(app);
  const io = new Server(http, {
    cors: cfg.clientOrigin ? { origin: cfg.clientOrigin } : undefined,
    pingInterval: 5000,
    pingTimeout: 8000,
  });

  const players = new Map<string, Player>();
  const matches = new Map<string, Match>();
  const queues: Record<RoomId, string[]> = { acemi: [], usta: [], efsane: [] };
  let shotCounter = 0;

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb' }));
  if (cfg.clientOrigin) {
    app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', cfg.clientOrigin!);
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      if (req.method === 'OPTIONS') return void res.sendStatus(204);
      next();
    });
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, players: players.size, matches: matches.size });
  });

  // ---------- hesap uç noktaları ----------
  const authLimiter = new RateLimiter(cfg.authRateMax, 10 * 60 * 1000);
  const loginFails = new RateLimiter(10, 10 * 60 * 1000);
  const bearer = (h: string | undefined) => (h?.startsWith('Bearer ') ? h.slice(7).trim() : '');

  async function issueSession(userId: string): Promise<string> {
    const token = newSessionToken();
    await store.createSession(userId, hashToken(token), cfg.sessionTtlMs);
    return token;
  }

  app.post('/api/register', async (req, res) => {
    try {
      if (!authLimiter.take(`ip:${req.ip}`)) return void res.status(429).json({ error: 'Çok fazla deneme, biraz bekle' });
      const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
      const bad = validateCredentials(username, password);
      if (bad) return void res.status(400).json({ error: bad });
      const name = (username as string).trim();
      if (await store.findUserByName(name)) return void res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });
      const starter = createStarterInventory(defaultRng, randomUUID().slice(0, 8));
      const id = randomUUID();
      const ok = await store.createUser({
        id,
        username: name,
        passwordHash: await hashPassword(password as string),
        starter,
        shooterUid: starter[0].uid,
      });
      if (!ok) return void res.status(409).json({ error: 'Bu kullanıcı adı alınmış' });
      res.status(201).json({ token: await issueSession(id), username: name });
    } catch (e) {
      console.error('[register]', e);
      res.status(500).json({ error: 'Sunucu hatası, tekrar dene' });
    }
  });

  app.post('/api/login', async (req, res) => {
    try {
      if (!authLimiter.take(`ip:${req.ip}`)) return void res.status(429).json({ error: 'Çok fazla deneme, biraz bekle' });
      const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) {
        return void res.status(400).json({ error: 'Kullanıcı adı ve parola gerekli' });
      }
      const key = `u:${username.toLowerCase()}`;
      if (!loginFails.take(key)) return void res.status(429).json({ error: 'Bu hesap için çok fazla deneme, biraz bekle' });
      const row = await store.findUserByName(username.trim());
      const ok = await verifyPassword(password, row?.password_hash ?? null);
      if (!row || !ok) return void res.status(401).json({ error: 'Kullanıcı adı veya parola hatalı' });
      res.json({ token: await issueSession(row.id), username: row.username });
    } catch (e) {
      console.error('[login]', e);
      res.status(500).json({ error: 'Sunucu hatası, tekrar dene' });
    }
  });

  app.get('/api/session', async (req, res) => {
    try {
      const token = bearer(req.headers.authorization);
      const uid = token ? await store.userIdForSession(hashToken(token)) : null;
      const u = uid ? await store.getUser(uid) : null;
      if (!u) return void res.status(401).json({ error: 'Oturum geçersiz' });
      res.json({ username: u.username });
    } catch (e) {
      console.error('[session]', e);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  });

  app.post('/api/logout', async (req, res) => {
    try {
      const token = bearer(req.headers.authorization);
      if (token) await store.deleteSession(hashToken(token));
      res.json({ ok: true });
    } catch (e) {
      console.error('[logout]', e);
      res.status(500).json({ error: 'Sunucu hatası' });
    }
  });
  app.use('/api', (_req, res) => void res.status(404).json({ error: 'Bulunamadı' }));
  app.use(((err, _req, res, _next) => {
    void _next;
    res.status(err?.status === 400 || err?.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Geçersiz istek' });
  }) as express.ErrorRequestHandler);
  if (cfg.staticDir && existsSync(path.join(cfg.staticDir, 'index.html'))) {
    app.use(express.static(cfg.staticDir));
    // SPA yedeği (Express 5'te '*' deseni geçersiz olduğu için ara katman olarak)
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io') || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(cfg.staticDir!, 'index.html'));
    });
  }

  // ---------- yardımcılar ----------
  const room = (token: string) => `p:${token}`;
  const emitTo = (token: string, event: string, payload: unknown) => io.to(room(token)).emit(event, payload);

  function meView(p: Player): MeView {
    return {
      name: p.name,
      inventory: p.inventory,
      shooterUid: p.shooterUid,
      queued: p.queued,
      inMatch: p.matchId !== null,
      canRescue: p.inventory.length < 4 && Date.now() - p.rescuedAt > cfg.rescueCooldownMs,
    };
  }
  const sendMe = (p: Player) => emitTo(p.id, 'me', meView(p));

  function viewFor(m: Match, idx: 0 | 1): MatchView {
    const now = Date.now();
    const shot = m.shot && !m.shot.resolved ? m.shot : null;
    const opp = players.get(m.ids[idx === 0 ? 1 : 0]);
    return {
      matchId: m.id,
      roomId: m.roomId,
      phase: m.phase,
      you: idx,
      names: m.names,
      round: m.round,
      stakesConfirmed: [m.stakes[0] !== null, m.stakes[1] !== null],
      stakeRemainingMs: m.phase === 'stakes' ? Math.max(0, m.stakeDeadline - now) : 0,
      introMs: Math.max(0, m.introUntil - now),
      state: m.state,
      shooters: m.state && m.shooterCatalog
        ? [
            { catalogId: m.shooterCatalog[0], level: m.state.players[0].shooterLevel },
            { catalogId: m.shooterCatalog[1], level: m.state.players[1].shooterLevel },
          ]
        : null,
      shot: shot
        ? {
            shotId: shot.id,
            shooter: shot.shooter,
            elapsedMs: now - shot.startedAt,
            center: shot.shooter === idx ? shot.center : undefined,
          }
        : null,
      decision:
        m.phase === 'decision'
          ? {
              remainingMs: Math.max(0, m.decisionDeadline - now),
              mine: m.decision[idx],
              opponentDecided: m.decision[idx === 0 ? 1 : 0] !== null,
            }
          : null,
      summary: m.summary,
      endReason: m.endReason,
      opponentConnected: !!opp && opp.sockets.size > 0,
    };
  }
  function sendSnapshot(m: Match) {
    emitTo(m.ids[0], 'match:snapshot', viewFor(m, 0));
    emitTo(m.ids[1], 'match:snapshot', viewFor(m, 1));
  }
  function later(m: Match, fn: () => void, ms: number) {
    const t = setTimeout(() => {
      m.timers.delete(t);
      fn();
    }, ms);
    m.timers.add(t);
  }
  function clearTimers(m: Match) {
    m.timers.forEach(clearTimeout);
    m.timers.clear();
  }
  const idxOf = (m: Match, token: string): 0 | 1 | -1 => (m.ids[0] === token ? 0 : m.ids[1] === token ? 1 : -1);

  // ---------- kalıcılık: tek sıralı yazma kuyruğu ----------
  // Oyun içi durum bellekte yürür; her değişiklik SIRAYLA veritabanına yazılır.
  // Bir yazma başarısız olursa etkilenen oyuncuların envanteri veritabanından yeniden yüklenir.
  let chain: Promise<unknown> = Promise.resolve();
  function persist<T>(label: string, fn: () => Promise<T>, affected: string[] = []): Promise<T | undefined> {
    const run = chain.then(fn).catch(async (e) => {
      console.error(`[db] ${label} başarısız:`, e);
      for (const id of affected) await resync(id).catch(() => undefined);
      return undefined;
    });
    chain = run;
    return run as Promise<T | undefined>;
  }
  const flush = async () => {
    await chain;
  };
  async function resync(id: string) {
    const p = players.get(id);
    if (!p) return;
    p.inventory = await store.loadInventory(id);
    if (!p.inventory.some((t) => t.uid === p.shooterUid) && p.inventory[0]) p.shooterUid = p.inventory[0].uid;
    sendMe(p);
  }

  const loading = new Map<string, Promise<Player | null>>();
  function loadPlayer(userId: string): Promise<Player | null> {
    const existing = players.get(userId);
    if (existing) return Promise.resolve(existing);
    let l = loading.get(userId);
    if (!l) {
      l = (async () => {
        await flush(); // bekleyen yazmalar bitmeden okuma yapma
        const u = await store.getUser(userId);
        if (!u) return null;
        const inventory = await store.loadInventory(userId);
        const p: Player = {
          id: userId,
          name: u.username,
          inventory,
          shooterUid: inventory.some((t) => t.uid === u.shooter_uid) ? u.shooter_uid! : (inventory[0]?.uid ?? ''),
          matchId: null,
          queued: null,
          rescuedAt: u.rescued_at ? new Date(u.rescued_at).getTime() : 0,
          sockets: new Set(),
        };
        players.set(userId, p);
        return p;
      })().finally(() => loading.delete(userId));
      loading.set(userId, l);
    }
    return l;
  }
  /** Bağlantısı, sırası ve maçı olmayan oyuncuyu bellekten at (veritabanı kaynak). */
  function maybeEvict(p: Player) {
    if (p.sockets.size === 0 && !p.matchId && !p.queued) players.delete(p.id);
  }

  /** Ortaya konabilecek taso sayısı: kilitsiz ve atış tasosu olmayanlar */
  const stakeable = (p: Player) => p.inventory.filter((t) => !t.locked && t.uid !== p.shooterUid).length;

  // ---------- eşleşme ----------
  function leaveQueue(p: Player) {
    if (p.queued) {
      queues[p.queued] = queues[p.queued].filter((t) => t !== p.id);
      p.queued = null;
    }
  }
  function tryMatch(roomId: RoomId) {
    const q = queues[roomId];
    while (q.length >= 2) {
      const a = players.get(q.shift()!);
      const b = players.get(q.shift()!);
      if (!a || !b || a.id === b.id) continue;
      const alive = [a, b].filter((p) => p.sockets.size > 0);
      if (alive.length < 2) {
        // kopmuş olanı at, bağlı olanı sıraya geri koy
        for (const p of [a, b]) {
          if (p.sockets.size === 0) p.queued = null;
          else q.unshift(p.id);
        }
        continue;
      }
      createMatch(roomId, a, b);
    }
  }
  function createMatch(roomId: RoomId, a: Player, b: Player) {
    a.queued = null;
    b.queued = null;
    const m: Match = {
      id: randomUUID(),
      roomId,
      ids: [a.id, b.id],
      names: [a.name, b.name],
      phase: 'stakes',
      round: 1,
      stakes: [null, null],
      stakeDeadline: Date.now() + cfg.stakeMs,
      introUntil: 0,
      state: null,
      shooterCatalog: null,
      shot: null,
      decision: [null, null],
      decisionDeadline: 0,
      summary: emptySummary(),
      timers: new Set(),
      grace: [null, null],
    };
    matches.set(m.id, m);
    a.matchId = m.id;
    b.matchId = m.id;
    later(m, () => endMatch(m, 'cancelled'), cfg.stakeMs);
    sendMe(a);
    sendMe(b);
    sendSnapshot(m);
  }

  // ---------- tur akışı ----------
  function startRound(m: Match) {
    const [pa, pb] = [players.get(m.ids[0])!, players.get(m.ids[1])!];
    const mk = (p: Player, stakes: StakeTile[]): PlayerSetup => {
      const sh = p.inventory.find((t) => t.uid === p.shooterUid)!;
      return { name: p.name, stakes, shooterUid: sh.uid, shooterLevel: sh.level };
    };
    m.state = createRound(m.roomId, [mk(pa, m.stakes[0]!), mk(pb, m.stakes[1]!)]);
    m.shooterCatalog = [
      pa.inventory.find((t) => t.uid === pa.shooterUid)!.catalogId,
      pb.inventory.find((t) => t.uid === pb.shooterUid)!.catalogId,
    ];
    m.phase = 'playing';
    m.shot = null;
    m.introUntil = Date.now() + cfg.introMs;
    clearTimers(m);
    sendSnapshot(m);
    later(m, () => beginShot(m), cfg.introMs);
  }

  function beginShot(m: Match) {
    if (!m.state || m.state.phase !== 'playing' || m.phase !== 'playing') return;
    const shooter = m.state.turn;
    m.shot = {
      id: ++shotCounter,
      shooter,
      startedAt: Date.now(),
      center: 0.28 + Math.random() * 0.44,
      resolved: false,
    };
    const base = { shotId: m.shot.id, shooter, elapsedMs: 0 };
    const forShooter: ShotBegin = { ...base, center: m.shot.center };
    emitTo(m.ids[shooter], 'shot:begin', forShooter);
    emitTo(m.ids[shooter === 0 ? 1 : 0], 'shot:begin', base satisfies ShotBegin);
    const id = m.shot.id;
    later(m, () => {
      if (m.shot && m.shot.id === id && !m.shot.resolved) applyShot(m, 'weak', 0);
    }, cfg.barTimeoutMs + 400);
  }

  function handleTap(m: Match, idx: 0 | 1, shotId: number, reported: number) {
    const s = m.shot;
    if (!s || s.resolved || s.id !== shotId || s.shooter !== idx || m.phase !== 'playing') return;
    if (!Number.isFinite(reported) || reported < 0) return;
    const roomCfg = ROOM_BY_ID[m.roomId];
    const serverElapsed = Date.now() - s.startedAt;
    if (serverElapsed > cfg.barTimeoutMs + 400) return;
    const e = clampReportedElapsed(reported, serverElapsed);
    const pointer = pointerAt(e, roomCfg.barPeriodMs);
    const { grade } = gradeShot(pointer, s.center, roomCfg.barHalfWidth);
    applyShot(m, grade, pointer);
  }

  function applyShot(m: Match, grade: ShotGrade, pointer: number) {
    if (!m.state || !m.shot || m.shot.resolved) return;
    m.shot.resolved = true;
    const res = resolveShot(m.state, grade, defaultRng);
    m.state = res.state;
    const msg: ShotResultMsg = {
      shotId: m.shot.id,
      shooter: res.shooter,
      grade,
      pointer,
      flipped: res.flipped,
      chance: res.chance,
      rolls: res.rolls,
      state: res.state,
    };
    emitTo(m.ids[0], 'shot:result', msg);
    emitTo(m.ids[1], 'shot:result', msg);
    if (res.state.phase === 'roundOver') later(m, () => finishRound(m), cfg.animMs);
    else later(m, () => beginShot(m), cfg.animMs);
  }

  function addToSummary(m: Match, state: MatchState) {
    const s = m.summary;
    ([0, 1] as const).forEach((i) => {
      s.won[i] = [...s.won[i], ...state.players[i].won];
      s.shots[i] += state.players[i].shots;
      s.successes[i] += state.players[i].successfulShots;
      s.perfects[i] += state.players[i].perfectShots;
    });
  }

  /**
   * Tasoların el değiştirmesi: tek, eşzamanlı (await içermeyen) adım.
   * Bellekteki değişiklik bölünemez; veritabanı tarafı tek bir PostgreSQL işlemidir
   * (taso satırının tek sahibi vardır, koşullu UPDATE çift işlemeyi engeller).
   */
  function settleTransfer(m: Match) {
    if (!m.state) return;
    const [pa, pb] = [players.get(m.ids[0])!, players.get(m.ids[1])!];
    const [ia0, ib0] = applyRoundTransfer(pa.inventory, pb.inventory, m.state);
    const hadA = new Set(pa.inventory.map((t) => t.uid));
    const hadB = new Set(pb.inventory.map((t) => t.uid));
    const moves = [
      ...ib0.filter((t) => hadA.has(t.uid)).map((t) => ({ uid: t.uid, from: pa.id, to: pb.id })),
      ...ia0.filter((t) => hadB.has(t.uid)).map((t) => ({ uid: t.uid, from: pb.id, to: pa.id })),
    ];
    const reset = (t: OwnedTaso, had: Set<string>): OwnedTaso => (had.has(t.uid) ? t : { ...t, favorite: false, locked: false });
    pa.inventory = ia0.map((t) => reset(t, hadA));
    pb.inventory = ib0.map((t) => reset(t, hadB));
    if (moves.length) void persist('transfer', () => store.moveTasos(moves), [pa.id, pb.id]);
    addToSummary(m, m.state);
    m.summary.rounds += 1;
    m.state = null; // aynı tur iki kez işlenemez
  }

  function finishRound(m: Match) {
    if (m.phase !== 'playing' || !m.state) return;
    const finalState = m.state;
    settleTransfer(m);
    m.state = finalState; // masayı karar ekranı için sakla (transfer artık yapıldı)
    m.phase = 'decision';
    m.shot = null;
    m.decision = [null, null];
    m.decisionDeadline = Date.now() + cfg.decisionMs;
    clearTimers(m);
    later(m, () => resolveDecision(m, true), cfg.decisionMs);
    m.ids.forEach((t) => sendMe(players.get(t)!));
    sendSnapshot(m);
  }

  function resolveDecision(m: Match, timedOut: boolean) {
    if (m.phase !== 'decision') return;
    const need = ROOM_BY_ID[m.roomId].stakeCount;
    const pa = players.get(m.ids[0])!;
    const pb = players.get(m.ids[1])!;
    const wants = m.decision[0] === true && m.decision[1] === true;
    if (!wants) return void endMatch(m, 'finished');
    if (timedOut && (m.decision[0] === null || m.decision[1] === null)) return void endMatch(m, 'finished');
    if (stakeable(pa) < need || stakeable(pb) < need) return void endMatch(m, 'noTiles');
    // yeni tur: taso seçimi
    clearTimers(m);
    m.round += 1;
    m.phase = 'stakes';
    m.stakes = [null, null];
    m.state = null;
    m.shot = null;
    m.stakeDeadline = Date.now() + cfg.stakeMs;
    later(m, () => endMatch(m, 'cancelled'), cfg.stakeMs);
    sendSnapshot(m);
  }

  function endMatch(m: Match, reason: NonNullable<MatchView['endReason']>) {
    if (m.phase === 'ended') return;
    clearTimers(m);
    m.grace.forEach((g) => g && clearTimeout(g));
    // tur ortasında bitiyorsa, o ana kadar çevrilen tasolar da işlenir; kalanlar sahibinde kalır
    if (m.phase === 'playing' && m.state) settleTransfer(m);
    m.phase = 'ended';
    m.endReason = reason;
    m.shot = null;
    m.state = null;
    for (const t of m.ids) {
      const p = players.get(t);
      if (p) {
        p.matchId = null;
        sendMe(p);
        maybeEvict(p);
      }
    }
    sendSnapshot(m);
    setTimeout(() => matches.delete(m.id), 5 * 60 * 1000).unref?.();
  }

  // ---------- socket olayları ----------
  io.use(async (socket, next) => {
    try {
      const { token } = socket.handshake.auth as { token?: unknown };
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next(new Error('Oturum gerekli'));
      const userId = await store.userIdForSession(hashToken(token));
      if (!userId) return next(new Error('Oturum geçersiz'));
      const p = await loadPlayer(userId);
      if (!p) return next(new Error('Hesap bulunamadı'));
      socket.data.userId = userId;
      next();
    } catch (e) {
      console.error('[socket auth]', e);
      next(new Error('Sunucu hatası'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const token = socket.data.userId as string;
    const p = players.get(token);
    if (!p) return void socket.disconnect(true);
    p.sockets.add(socket.id);
    socket.join(room(token));

    const m0 = p.matchId ? matches.get(p.matchId) : undefined;
    if (m0) {
      const i = idxOf(m0, token);
      if (i !== -1 && m0.grace[i]) {
        clearTimeout(m0.grace[i]!);
        m0.grace[i] = null;
      }
    }
    sendMe(p);
    if (m0) sendSnapshot(m0);

    const myMatch = () => (p.matchId ? matches.get(p.matchId) : undefined);
    const fail = (message: string) => socket.emit('error:msg', { message });

    socket.on('queue:join', (payload: { roomId?: RoomId }) => {
      const roomId = payload?.roomId;
      if (!roomId || !(roomId in ROOM_BY_ID)) return fail('Geçersiz oda');
      if (p.matchId) return fail('Zaten bir maçtasın');
      const need = ROOM_BY_ID[roomId].stakeCount;
      if (stakeable(p) < need) return fail(`Bu oda için atış tasosu dışında ${need} kilitsiz tasoya ihtiyacın var`);
      leaveQueue(p);
      p.queued = roomId;
      queues[roomId].push(p.id);
      sendMe(p);
      tryMatch(roomId);
    });

    socket.on('queue:leave', () => {
      leaveQueue(p);
      sendMe(p);
    });

    socket.on('shooter:set', (payload: { uid?: string }) => {
      if (p.matchId) return fail('Maç sırasında atış tasosu değiştirilemez');
      if (!payload?.uid || !p.inventory.some((t) => t.uid === payload.uid)) return fail('Bu taso sende yok');
      p.shooterUid = payload.uid;
      void persist('shooter', () => store.setShooter(p.id, payload.uid!), [p.id]);
      sendMe(p);
    });

    socket.on('rescue', () => {
      if (p.inventory.length >= 4) return fail('Kurtarma yalnızca tasosu azalanlar içindir');
      if (Date.now() - p.rescuedAt <= cfg.rescueCooldownMs) return fail('Bugünkü kurtarma hakkını kullandın');
      p.rescuedAt = Date.now();
      const gift = createStarterInventory(defaultRng, randomUUID().slice(0, 8)).slice(0, 12);
      p.inventory = [...p.inventory, ...gift];
      const needShooter = !p.inventory.some((t) => t.uid === p.shooterUid);
      if (needShooter) p.shooterUid = p.inventory[0].uid;
      void persist(
        'rescue',
        async () => {
          await store.addTasos(p.id, gift);
          await store.setRescuedAt(p.id);
          if (needShooter) await store.setShooter(p.id, p.shooterUid);
        },
        [p.id],
      );
      sendMe(p);
    });

    socket.on('match:stakes', (payload: { uids?: unknown }) => {
      const m = myMatch();
      const i = m ? idxOf(m, token) : -1;
      if (!m || i < 0) return fail('Aktif maç yok');
      if (m.phase !== 'stakes') return fail('Şu an taso seçilemez');
      if (m.stakes[i as 0 | 1]) return fail('Tasolarını zaten onayladın');
      const uids = Array.isArray(payload?.uids) ? (payload.uids as unknown[]) : [];
      const need = ROOM_BY_ID[m.roomId].stakeCount;
      if (uids.length !== need || uids.some((u) => typeof u !== 'string')) return fail(`${need} taso seçmelisin`);
      if (new Set(uids).size !== uids.length) return fail('Aynı taso iki kez seçilemez');
      const chosen: StakeTile[] = [];
      for (const u of uids as string[]) {
        const t = p.inventory.find((x) => x.uid === u);
        if (!t) return fail('Seçtiğin taso sende yok');
        if (t.uid === p.shooterUid) return fail('Atış tasosu ortaya konamaz');
        if (t.locked) return fail('Kilitli taso ortaya konamaz');
        chosen.push({ uid: t.uid, catalogId: t.catalogId });
      }
      m.stakes[i as 0 | 1] = chosen; // onaylanan tasolar kilitlenir (envanterden ayrı sayılır)
      if (m.stakes[0] && m.stakes[1]) startRound(m);
      else sendSnapshot(m);
    });

    socket.on('shot:tap', (payload: { shotId?: number; elapsedMs?: number }) => {
      const m = myMatch();
      const i = m ? idxOf(m, token) : -1;
      if (!m || i < 0 || typeof payload?.shotId !== 'number' || typeof payload?.elapsedMs !== 'number') return;
      handleTap(m, i as 0 | 1, payload.shotId, payload.elapsedMs);
    });

    socket.on('round:decision', (payload: { continue?: boolean }) => {
      const m = myMatch();
      const i = m ? idxOf(m, token) : -1;
      if (!m || i < 0 || m.phase !== 'decision') return;
      if (m.decision[i as 0 | 1] !== null) return; // karar bir kez verilir
      m.decision[i as 0 | 1] = payload?.continue === true;
      if (m.decision[0] !== null && m.decision[1] !== null) resolveDecision(m, false);
      else if (m.decision[i as 0 | 1] === false) endMatch(m, 'finished');
      else sendSnapshot(m);
    });

    socket.on('taso:flag', (payload: { uid?: unknown; field?: unknown; value?: unknown }) => {
      const { uid, field, value } = payload ?? {};
      if (typeof uid !== 'string' || typeof value !== 'boolean' || (field !== 'favorite' && field !== 'locked')) return;
      const i = p.inventory.findIndex((t) => t.uid === uid);
      if (i < 0) return fail('Bu taso sende yok');
      if (p.matchId) return fail('Maç sırasında taso ayarı değiştirilemez');
      p.inventory = p.inventory.map((t, k) => (k === i ? { ...t, [field]: value } : t));
      void persist('flag', () => store.setFlag(p.id, uid, field, value), [p.id]);
      sendMe(p);
    });

    socket.on('taso:xp', async (payload: { targetUid?: unknown; sourceUids?: unknown }) => {
      const { targetUid, sourceUids } = payload ?? {};
      if (p.matchId) return fail('Maç sırasında XP yüklenemez');
      if (typeof targetUid !== 'string' || !Array.isArray(sourceUids)) return fail('Geçersiz istek');
      if (sourceUids.length < 1 || sourceUids.length > 200 || sourceUids.some((u) => typeof u !== 'string')) {
        return fail('1-200 taso seçmelisin');
      }
      const srcIds = [...new Set(sourceUids as string[])];
      if (srcIds.length !== sourceUids.length) return fail('Aynı taso iki kez seçilemez');
      if (srcIds.includes(targetUid)) return fail('Taso kendi kendine XP olamaz');
      const target = p.inventory.find((t) => t.uid === targetUid);
      if (!target) return fail('Hedef taso sende yok');
      if (target.level >= XP.maxLevel) return fail('Bu taso zaten maksimum seviyede');
      const sources = srcIds.map((u) => p.inventory.find((t) => t.uid === u));
      if (sources.some((t) => !t)) return fail('Seçtiğin taso sende yok');
      for (const t of sources as OwnedTaso[]) {
        if (t.locked) return fail('Kilitli taso XP\'ye dönüştürülemez');
        if (t.favorite) return fail('Favori taso XP\'ye dönüştürülemez (önce favoriden çıkar)');
        if (t.uid === p.shooterUid) return fail('Atış tasosu XP\'ye dönüştürülemez');
      }
      const gain = (sources as OwnedTaso[]).reduce((sum, t) => {
        const rarity = CATALOG_BY_ID[t.catalogId]?.rarity ?? 'common';
        return sum + tileXpValue(rarity, t.level, t.xp);
      }, 0);
      const r = addXp(target.level, target.xp, gain);
      // Bellekte hemen uygula (aynı tasoyu ikinci kez harcamayı engeller), sonra veritabanını bekle
      const gone = new Set(srcIds);
      p.inventory = p.inventory
        .filter((t) => !gone.has(t.uid))
        .map((t) => (t.uid === targetUid ? { ...t, level: r.level, xp: r.xp } : t));
      const ok = await persist(
        'xp',
        () => store.consumeXp({ userId: p.id, targetUid, sourceUids: srcIds, level: r.level, xp: r.xp }),
        [p.id],
      );
      if (!ok) {
        await resync(p.id);
        return fail('XP yüklenemedi, tekrar dene');
      }
      socket.emit('xp:result', {
        targetUid,
        consumed: srcIds.length,
        gained: gain,
        wasted: r.wasted,
        levelBefore: target.level,
        levelAfter: r.level,
        levelsGained: r.levelsGained,
        crossed: r.crossed,
        xp: r.xp,
      });
      sendMe(p);
    });

    socket.on('match:leave', () => {
      const m = myMatch();
      if (!m || m.phase === 'ended') return;
      endMatch(m, m.phase === 'stakes' ? 'cancelled' : 'abandoned');
    });

    socket.on('disconnect', () => {
      p.sockets.delete(socket.id);
      if (p.sockets.size > 0) return;
      leaveQueue(p);
      const m = myMatch();
      if (!m || m.phase === 'ended') return void maybeEvict(p);
      const i = idxOf(m, token) as 0 | 1;
      sendSnapshot(m); // rakibe "bağlantı koptu" bilgisi
      m.grace[i] = setTimeout(() => endMatch(m, 'abandoned'), cfg.graceMs);
    });
  });

  return {
    app,
    http,
    io,
    config: cfg,
    players,
    matches,
    store,
    /** Bekleyen tüm veritabanı yazmalarının bitmesini bekler (test/kapanış için). */
    flush,
    start(): Promise<number> {
      return new Promise((resolve) => {
        http.listen(cfg.port, () => {
          const addr = http.address();
          resolve(typeof addr === 'object' && addr ? addr.port : cfg.port);
        });
      });
    },
    async stop() {
      matches.forEach(clearTimers);
      await io.close();
      await flush();
    },
  };
}


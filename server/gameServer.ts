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
import { createStarterInventory } from '../src/lib/inventory';
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
  clientOrigin: process.env.CLIENT_ORIGIN,
  staticDir: path.resolve(process.cwd(), 'dist'),
};

interface Player {
  token: string;
  name: string;
  /** Aşama 2: bellekte. Aşama 3'te PostgreSQL. */
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
  tokens: [string, string];
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

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) : '';
  return s.length >= 2 ? s : `Oyuncu${Math.floor(1000 + Math.random() * 9000)}`;
}

function validToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(t);
}

export function createGameServer(partial: Partial<ServerConfig> = {}) {
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

  app.get('/health', (_req, res) => {
    res.json({ ok: true, players: players.size, matches: matches.size });
  });
  if (cfg.staticDir && existsSync(path.join(cfg.staticDir, 'index.html'))) {
    app.use(express.static(cfg.staticDir));
    // SPA yedeği (Express 5'te '*' deseni geçersiz olduğu için ara katman olarak)
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/socket.io')) return next();
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
  const sendMe = (p: Player) => emitTo(p.token, 'me', meView(p));

  function viewFor(m: Match, idx: 0 | 1): MatchView {
    const now = Date.now();
    const shot = m.shot && !m.shot.resolved ? m.shot : null;
    const opp = players.get(m.tokens[idx === 0 ? 1 : 0]);
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
    emitTo(m.tokens[0], 'match:snapshot', viewFor(m, 0));
    emitTo(m.tokens[1], 'match:snapshot', viewFor(m, 1));
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
  const idxOf = (m: Match, token: string): 0 | 1 | -1 => (m.tokens[0] === token ? 0 : m.tokens[1] === token ? 1 : -1);

  function getPlayer(token: string, name: string): Player {
    let p = players.get(token);
    if (!p) {
      const inventory = createStarterInventory(defaultRng, `u${players.size}`);
      p = {
        token,
        name,
        inventory,
        shooterUid: inventory[0].uid,
        matchId: null,
        queued: null,
        rescuedAt: 0,
        sockets: new Set(),
      };
      players.set(token, p);
    } else {
      p.name = name;
    }
    return p;
  }

  // ---------- eşleşme ----------
  function leaveQueue(p: Player) {
    if (p.queued) {
      queues[p.queued] = queues[p.queued].filter((t) => t !== p.token);
      p.queued = null;
    }
  }
  function tryMatch(roomId: RoomId) {
    const q = queues[roomId];
    while (q.length >= 2) {
      const a = players.get(q.shift()!);
      const b = players.get(q.shift()!);
      if (!a || !b || a.token === b.token) continue;
      const alive = [a, b].filter((p) => p.sockets.size > 0);
      if (alive.length < 2) {
        // kopmuş olanı at, bağlı olanı sıraya geri koy
        for (const p of [a, b]) {
          if (p.sockets.size === 0) p.queued = null;
          else q.unshift(p.token);
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
      tokens: [a.token, b.token],
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
    const [pa, pb] = [players.get(m.tokens[0])!, players.get(m.tokens[1])!];
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
    emitTo(m.tokens[shooter], 'shot:begin', forShooter);
    emitTo(m.tokens[shooter === 0 ? 1 : 0], 'shot:begin', base satisfies ShotBegin);
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
    emitTo(m.tokens[0], 'shot:result', msg);
    emitTo(m.tokens[1], 'shot:result', msg);
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
   * Node tek iş parçacıklı çalıştığı için bu blok bölünemez; Aşama 3'te
   * aynı mantık tek bir PostgreSQL işlemine (transaction) dönüşecek.
   */
  function settleTransfer(m: Match) {
    if (!m.state) return;
    const [pa, pb] = [players.get(m.tokens[0])!, players.get(m.tokens[1])!];
    const [ia, ib] = applyRoundTransfer(pa.inventory, pb.inventory, m.state);
    pa.inventory = ia;
    pb.inventory = ib;
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
    m.tokens.forEach((t) => sendMe(players.get(t)!));
    sendSnapshot(m);
  }

  function resolveDecision(m: Match, timedOut: boolean) {
    if (m.phase !== 'decision') return;
    const need = ROOM_BY_ID[m.roomId].stakeCount + 1;
    const pa = players.get(m.tokens[0])!;
    const pb = players.get(m.tokens[1])!;
    const wants = m.decision[0] === true && m.decision[1] === true;
    if (!wants) return void endMatch(m, 'finished');
    if (timedOut && (m.decision[0] === null || m.decision[1] === null)) return void endMatch(m, 'finished');
    if (pa.inventory.length < need || pb.inventory.length < need) return void endMatch(m, 'noTiles');
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
    for (const t of m.tokens) {
      const p = players.get(t);
      if (p) {
        p.matchId = null;
        sendMe(p);
      }
    }
    sendSnapshot(m);
    setTimeout(() => matches.delete(m.id), 5 * 60 * 1000).unref?.();
  }

  // ---------- socket olayları ----------
  io.use((socket, next) => {
    const { token, name } = socket.handshake.auth as { token?: unknown; name?: unknown };
    if (!validToken(token)) return next(new Error('Geçersiz oturum'));
    socket.data.token = token;
    socket.data.name = cleanName(name);
    next();
  });

  io.on('connection', (socket: Socket) => {
    const token = socket.data.token as string;
    const p = getPlayer(token, socket.data.name as string);
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
      const need = ROOM_BY_ID[roomId].stakeCount + 1;
      if (p.inventory.length < need) return fail(`Bu oda için en az ${need} tasoya ihtiyacın var`);
      leaveQueue(p);
      p.queued = roomId;
      queues[roomId].push(p.token);
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
      sendMe(p);
    });

    socket.on('rescue', () => {
      if (p.inventory.length >= 4) return fail('Kurtarma yalnızca tasosu azalanlar içindir');
      if (Date.now() - p.rescuedAt <= cfg.rescueCooldownMs) return fail('Bugünkü kurtarma hakkını kullandın');
      p.rescuedAt = Date.now();
      p.inventory = [...p.inventory, ...createStarterInventory(defaultRng, `r${Date.now()}`).slice(0, 12)];
      if (!p.inventory.some((t) => t.uid === p.shooterUid)) p.shooterUid = p.inventory[0].uid;
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
      if (!m || m.phase === 'ended') return;
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
    },
  };
}


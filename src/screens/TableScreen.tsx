import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Taso } from '../components/Taso';
import { TimingBar } from '../components/TimingBar';
import { CATALOG_BY_ID } from '../data/catalog';
import { ROOM_BY_ID } from '../data/rooms';
import type { MatchState, TableTile } from '../engine/engine';
import { useCountdown } from '../lib/useCountdown';
import { sfx } from '../lib/sound';
import type { MatchView, ShotBegin, ShotResultMsg } from '../net/protocol';
import type { CatalogEntry, ShotGrade } from '../types';

type Ui = 'intro' | 'ready' | 'aim' | 'oppAim' | 'waiting' | 'flying' | 'impact' | 'collect' | 'over';

const FLY_MS = 650;
const IMPACT_MS = 950;
const COLLECT_MS = 750;

const BANNER: Record<ShotGrade, string> = {
  perfect: 'MÜKEMMEL ATIŞ!',
  good: 'İYİ ATIŞ',
  weak: 'ZAYIF ATIŞ',
};

interface Pos {
  x: number;
  y: number;
  rot: number;
  z: number;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Tasolar üst üste, hafif kayık bir yığın olarak başlar. */
function pilePositions(tiles: TableTile[]): Map<string, Pos> {
  const m = new Map<string, Pos>();
  tiles.forEach((t, i) => {
    m.set(t.uid, {
      x: 50 + (Math.random() - 0.5) * 5,
      y: 50 + (Math.random() - 0.5) * 4,
      rot: (Math.random() - 0.5) * 70,
      z: i * 2.4,
    });
  });
  return m;
}

/** Yeniden bağlanmada (zaten dağılmış masa) rastgele ama taşmayan konumlar. */
function scatteredPositions(tiles: TableTile[], yFactor: number): Map<string, Pos> {
  const m = new Map<string, Pos>();
  tiles.forEach((t, i) => {
    const a = i * 2.39996 + 0.6;
    const r = 6 + 4.2 * Math.sqrt(i + 0.6);
    m.set(t.uid, {
      x: clamp(50 + r * Math.cos(a), 12, 88),
      y: clamp(50 + r * Math.sin(a) * yFactor, 14, 86),
      rot: (Math.random() - 0.5) * 120,
      z: 0,
    });
  });
  return m;
}

/** Atış çarpınca kalan tasolar merkezden dışarı doğru dağılır. */
function scatter(prev: Map<string, Pos>, skip: Set<string>, strength: number, yFactor: number): Map<string, Pos> {
  const next = new Map(prev);
  prev.forEach((p, uid) => {
    if (skip.has(uid)) return;
    const dx = p.x - 50;
    const dy = (p.y - 50) / yFactor;
    const d = Math.hypot(dx, dy);
    const ang = (d < 1.5 ? Math.random() * Math.PI * 2 : Math.atan2(dy, dx)) + (Math.random() - 0.5) * 0.9;
    const push = strength * (0.55 + Math.random() * 0.9) * (d < 8 ? 1.25 : 1);
    next.set(uid, {
      x: clamp(p.x + Math.cos(ang) * push, 12, 88),
      y: clamp(p.y + Math.sin(ang) * push * yFactor, 14, 86),
      rot: p.rot + (Math.random() - 0.5) * 110,
      z: 0,
    });
  });
  return next;
}

interface Props {
  view: MatchView;
  viewAt: number;
  socket: Socket;
  onDecision: (cont: boolean) => void;
}

export function TableScreen({ view, viewAt, socket, onDecision }: Props) {
  const you = view.you;
  const opp = you === 0 ? 1 : 0;
  const room = ROOM_BY_ID[view.roomId];
  const shooters = useMemo(
    () => view.shooters!.map((s) => ({ entry: CATALOG_BY_ID[s.catalogId] as CatalogEntry, level: s.level })),
    [view.shooters],
  );

  const [tableState, setTableState] = useState<MatchState>(view.state!);
  const shotsSoFar = view.state!.players[0].shots + view.state!.players[1].shots;
  const yFactor = typeof window !== 'undefined' && window.innerWidth < window.innerHeight ? 0.95 : 1.25;
  const [pos, setPos] = useState<Map<string, Pos>>(() =>
    shotsSoFar === 0 ? pilePositions(view.state!.table) : scatteredPositions(view.state!.table, yFactor),
  );
  const [ui, setUi] = useState<Ui>(() =>
    view.phase === 'decision'
      ? 'over'
      : view.shot
        ? view.shot.shooter === you
          ? 'aim'
          : 'oppAim'
        : shotsSoFar === 0
          ? 'intro'
          : 'ready',
  );
  const [shot, setShot] = useState<ShotBegin | null>(view.shot);
  const [pending, setPending] = useState<ShotResultMsg | null>(null);
  const [shake, setShake] = useState(false);

  const startedShot = useRef<number | null>(view.shot?.shotId ?? null);
  const timers = useRef<number[]>([]);
  const animating = useRef(false);
  const queue = useRef<ShotResultMsg[]>([]);
  const handled = useRef<Set<number>>(new Set());
  const shotCount = useRef(shotsSoFar);

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  // Giriş mesajı
  useEffect(() => {
    if (ui !== 'intro') return;
    const id = window.setTimeout(() => setUi((u) => (u === 'intro' ? 'ready' : u)), 1900);
    return () => clearTimeout(id);
  }, [ui]);

  // Sunucu yeni atış başlattığında
  useEffect(() => {
    const s = view.shot;
    if (!s || s.shotId === startedShot.current) return;
    if (ui !== 'ready' && ui !== 'intro') return;
    startedShot.current = s.shotId;
    setShot(s);
    setUi(s.shooter === you ? 'aim' : 'oppAim');
  }, [view.shot, ui, you]);

  const runResult = useCallback(
    (msg: ShotResultMsg) => {
      animating.current = true;
      const flippedIds = new Set(msg.flipped.map((t) => t.uid));
      const first = shotCount.current === 0;
      shotCount.current += 1;
      setPending(msg);
      setUi('flying');
      sfx.throw();
      later(() => {
        setUi('impact');
        sfx.hit();
        setShake(true);
        setPos((prev) => scatter(prev, flippedIds, first ? 13 : 5.5, yFactor));
        if (msg.flipped.length > 0) later(() => sfx.flip(), 120);
        if (msg.grade === 'perfect') later(() => sfx.perfect(), 200);
        else if (msg.flipped.length === 0) later(() => sfx.miss(), 150);
      }, FLY_MS);
      later(() => setShake(false), FLY_MS + 400);
      later(() => setUi('collect'), FLY_MS + IMPACT_MS);
      later(() => {
        setTableState(msg.state);
        setPending(null);
        setShot(null);
        animating.current = false;
        const nextMsg = queue.current.shift();
        if (nextMsg) runResult(nextMsg);
        else setUi(msg.state.phase === 'roundOver' ? 'over' : 'ready');
      }, FLY_MS + IMPACT_MS + COLLECT_MS);
    },
    [later, yFactor],
  );

  // Sunucudan gelen atış sonuçları (hem kendi hem rakip atışı)
  useEffect(() => {
    const onResult = (msg: ShotResultMsg) => {
      if (handled.current.has(msg.shotId)) return;
      handled.current.add(msg.shotId);
      if (animating.current) queue.current.push(msg);
      else runResult(msg);
    };
    socket.on('shot:result', onResult);
    return () => {
      socket.off('shot:result', onResult);
    };
  }, [socket, runResult]);

  const decisionSecs = useCountdown(view.decision?.remainingMs ?? 0, viewAt);

  const flippedIds = new Set(pending?.flipped.map((t) => t.uid) ?? []);
  const flippedById = new Map(pending?.flipped.map((t) => [t.uid, t]) ?? []);
  const collecting = ui === 'collect';
  const impacting = ui === 'impact' || collecting;
  const showBanner = pending && impacting;
  const youShooting = ui === 'aim' || ui === 'waiting' || (pending !== null && pending.shooter === you);

  const sizeBasis = room.stakeCount * 2;
  const tSize = sizeBasis <= 6 ? '14cqw' : sizeBasis <= 10 ? '11.5cqw' : '9.2cqw';
  const shSize = sizeBasis <= 6 ? '13cqw' : sizeBasis <= 10 ? '10.5cqw' : '8.6cqw';
  const pileMode = shotCount.current === 0 && ui !== 'impact' && ui !== 'collect' && !pending;

  return (
    <div className="flex h-full flex-col">
      <PlayerBar
        name={view.names[opp]}
        player={tableState.players[opp]}
        shooter={shooters[opp]}
        active={tableState.turn === opp && tableState.phase === 'playing' && ui !== 'over'}
        padRight
      />

      <div className="relative min-h-0 flex-1">
        <div className={`arena ${shake ? 'table-shake' : ''}`}>
          <div className="arena-floor" style={{ containerType: 'inline-size' }}>
            {tableState.table.map((t, i) => {
              const p = pos.get(t.uid) ?? { x: 50, y: 50, rot: 0, z: 0 };
              const isFlip = flippedIds.has(t.uid);
              const isFlipped = isFlip && impacting;
              const shownFaceUp = isFlipped ? flippedById.get(t.uid)!.faceUp : t.faceUp;
              const winnerBottom = (pending?.shooter ?? 0) === you;
              const left = collecting && isFlip ? 50 : p.x;
              const top = collecting && isFlip ? (winnerBottom ? 150 : -45) : p.y;
              return (
                <div
                  key={t.uid}
                  className={`arena-tile ${pileMode ? 'piled' : ''} ${isFlipped && !collecting ? 'flipping' : ''} ${collecting && isFlip ? 'collect' : ''}`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    zIndex: 5 + i,
                    transform: `translate(-50%, -50%) translateZ(${p.z}px) rotate(${p.rot}deg)`,
                  }}
                >
                  <Taso entry={CATALOG_BY_ID[t.catalogId]} size={tSize} face={shownFaceUp ? 'front' : 'back'} />
                </div>
              );
            })}

            {(ui === 'flying' || ui === 'impact') && pending && (
              <div
                key={`fly-${pending.shotId}`}
                className="shooter-fly"
                style={
                  {
                    left: '50%',
                    top: '50%',
                    '--sx': pending.shooter === you ? '30px' : '-30px',
                    '--sy': pending.shooter === you ? '420px' : '-420px',
                  } as React.CSSProperties
                }
              >
                <Taso entry={shooters[pending.shooter].entry} size={shSize} />
              </div>
            )}
            {ui === 'impact' && <div className="impact-ring" style={{ left: '50%', top: '50%' }} />}
          </div>

          {showBanner && (
            <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
              <div className="banner text-center">
                <div className="text-xs font-extrabold uppercase tracking-widest text-white/80">
                  {pending.shooter === you ? 'Sen' : view.names[pending.shooter]}
                </div>
                <div
                  className="text-4xl font-black sm:text-6xl"
                  style={{
                    color: pending.grade === 'perfect' ? '#fde047' : pending.grade === 'good' ? '#86efac' : '#cbd5e1',
                    textShadow: '0 4px 0 #000a, 0 0 28px rgba(250,204,21,.7)',
                  }}
                >
                  {BANNER[pending.grade]}
                </div>
                <div className="mt-1 text-xl font-extrabold text-white drop-shadow sm:text-2xl">
                  {pending.flipped.length > 0 ? `+${pending.flipped.length} taso` : 'Iskaladı'}
                </div>
              </div>
            </div>
          )}

          {ui === 'intro' && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="pop rounded-3xl bg-slate-900/90 px-8 py-6 text-center shadow-2xl">
                <div className="text-sm font-bold uppercase tracking-widest text-amber-300">
                  {room.name} · Tur {view.round}
                </div>
                <div className="mt-2 text-2xl font-black sm:text-3xl">
                  İlk atışı {tableState.turn === you ? 'SEN' : view.names[tableState.turn].toUpperCase()} yapacak!
                </div>
                <div className="mt-1 text-slate-300">Masada {tableState.table.length} taso var</div>
              </div>
            </div>
          )}

          <div className="absolute bottom-3 right-3 z-40 sm:right-8">
            {youShooting && shot && (
              <TimingBar
                key={shot.shotId}
                periodMs={room.barPeriodMs}
                halfWidth={room.barHalfWidth}
                center={shot.center ?? 0.5}
                offsetMs={shot.elapsedMs}
                active={ui === 'aim'}
                onStop={(r) => {
                  socket.emit('shot:tap', { shotId: shot.shotId, elapsedMs: r.elapsedMs });
                  setUi('waiting');
                }}
              />
            )}
          </div>

          <div className="pointer-events-none absolute left-1/2 top-2 z-40 -translate-x-1/2 text-center">
            <div className="rounded-full bg-black/55 px-4 py-1 text-sm font-bold">
              {ui === 'aim' && 'SENİN SIRAN — kırmızı bölgenin ortasında dur!'}
              {ui === 'waiting' && 'Atış gönderildi…'}
              {ui === 'oppAim' && `${view.names[opp]} nişan alıyor…`}
              {ui === 'ready' && 'Sıradaki atış hazırlanıyor…'}
              {(ui === 'flying' || ui === 'impact' || ui === 'collect') && 'Atış!'}
              {ui === 'intro' && 'Başlıyoruz'}
              {ui === 'over' && 'Tur bitti'}
            </div>
            {!view.opponentConnected && view.phase !== 'ended' && (
              <div className="mt-1 rounded-full bg-rose-600/80 px-3 py-0.5 text-xs font-bold">
                Rakibin bağlantısı koptu, yeniden bağlanması bekleniyor…
              </div>
            )}
          </div>

          {ui === 'over' && view.phase === 'decision' && view.decision && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="pop w-full max-w-md rounded-3xl bg-slate-900 p-6 text-center shadow-2xl ring-1 ring-white/20">
                <div className="text-2xl font-black text-amber-300">TUR BİTTİ</div>
                <div className="mt-2 text-slate-200">
                  Sen {tableState.players[you].won.length} · {view.names[opp]} {tableState.players[opp].won.length}
                </div>
                <div className="mt-4 text-xl font-extrabold">Yeni tur oynamak ister misin?</div>
                <div className="mt-1 text-sm text-slate-400">
                  Karar süresi: {decisionSecs} sn · {view.decision.opponentDecided ? 'Rakip kararını verdi' : 'Rakip düşünüyor'}
                </div>
                {view.decision.mine === null ? (
                  <div className="mt-5 flex justify-center gap-3">
                    <button className="btn btn-primary" onClick={() => onDecision(true)}>
                      DEVAM ET
                    </button>
                    <button className="btn btn-ghost" onClick={() => onDecision(false)}>
                      OYUNU BİTİR
                    </button>
                  </div>
                ) : (
                  <div className="mt-5 text-slate-300">Kararın: {view.decision.mine ? 'DEVAM' : 'BİTİR'} — rakip bekleniyor…</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <PlayerBar
        name="Sen"
        player={tableState.players[you]}
        shooter={shooters[you]}
        active={tableState.turn === you && tableState.phase === 'playing' && ui !== 'over'}
      />
    </div>
  );
}

function PlayerBar({
  name,
  player,
  shooter,
  active,
  padRight,
}: {
  name: string;
  player: MatchState['players'][0];
  shooter: { entry: CatalogEntry; level: number };
  active: boolean;
  padRight?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 transition ${padRight ? 'pr-36' : ''} ${active ? 'bg-amber-400/20' : 'bg-black/20'}`}>
      <Taso entry={shooter.entry} size={46} level={shooter.level} showName={false} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-extrabold">
          {name}
          {active && <span className="ml-1 text-amber-300">● sırada</span>}
        </div>
        <div className="truncate text-xs text-slate-300">
          Atış tasosu: {shooter.entry.name}
          {shooter.entry.form ? ` (${shooter.entry.form})` : ''} · Sv {shooter.level}
        </div>
      </div>
      <div className="text-right text-xs text-slate-300">
        <div className="text-lg font-black text-white">{player.won.length}</div>
        kazanılan
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Taso, RARITY_LABEL } from '../components/Taso';
import { CATALOG_BY_ID, COLLECTION_SIZE } from '../data/catalog';
import { ROOMS, ROOM_BY_ID } from '../data/rooms';
import { SERIES } from '../data/series';
import { useCountdown } from '../lib/useCountdown';
import type { MatchSummary, MatchView, MeView } from '../net/protocol';
import type { OwnedTaso, RoomConfig, RoomId } from '../types';

export function MenuScreen({
  me,
  onPlay,
  onRescue,
  onCollection,
  onProfile,
}: {
  me: MeView;
  onPlay: () => void;
  onRescue: () => void;
  onCollection: () => void;
  onProfile: () => void;
}) {
  const unique = (sid: string) =>
    new Set(me.inventory.filter((t) => CATALOG_BY_ID[t.catalogId].seriesId === sid).map((t) => t.catalogId)).size;
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <div className="text-sm font-bold uppercase tracking-[0.3em] text-amber-300">Hoş geldin, {me.name}</div>
        <h1 className="mt-2 text-5xl font-black leading-none sm:text-6xl">
          ANIME
          <br />
          TASO ARENA
        </h1>
      </div>
      <button className="btn btn-primary w-full max-w-xs py-5 text-2xl" onClick={onPlay}>
        OYNA
      </button>
      {me.canRescue && (
        <button className="btn btn-ghost w-full max-w-xs" onClick={onRescue}>
          Günlük ücretsiz kurtarma al
        </button>
      )}
      <div className="grid w-full max-w-xs gap-2 text-left text-sm">
        {SERIES.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl bg-white/10 px-4 py-2">
            <span className="font-bold">{s.name.toUpperCase()} KOLEKSİYONU</span>
            <span className="font-black text-amber-300">
              {unique(s.id)} / {COLLECTION_SIZE}
            </span>
          </div>
        ))}
        <div className="text-center text-xs text-slate-400">Toplam {me.inventory.length} tasoya sahipsin</div>
      </div>
      <div className="grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <button className="btn btn-ghost py-2 text-sm" onClick={onCollection}>
          Koleksiyon
        </button>
        <button className="btn btn-ghost py-2 text-sm" onClick={onProfile}>
          Profil
        </button>
        {['Çark / Paket', 'Günlük Görevler'].map((l) => (
          <button key={l} className="btn btn-ghost py-2 text-sm" disabled title="Sonraki aşamada">
            {l}
            <div className="text-[10px] font-normal opacity-70">Aşama 4</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RoomSelectScreen({
  me,
  onPick,
  onBack,
  onShooter,
}: {
  me: MeView;
  onPick: (r: RoomConfig) => void;
  onBack: () => void;
  onShooter: (uid: string) => void;
}) {
  const sorted = useMemo(() => me.inventory.slice().sort((a, b) => a.catalogId.localeCompare(b.catalogId)), [me.inventory]);
  const shooter = me.inventory.find((t) => t.uid === me.shooterUid);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-5">
      <button className="self-start text-slate-300" onClick={onBack}>
        ← Ana menü
      </button>
      <h2 className="text-3xl font-black">Oda seç</h2>

      <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3">
        {shooter && <Taso entry={CATALOG_BY_ID[shooter.catalogId]} size={56} level={shooter.level} showName={false} />}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Atış tasosu</div>
          <select
            className="mt-1 w-full rounded-lg bg-slate-800 p-2 text-sm"
            value={me.shooterUid}
            onChange={(e) => onShooter(e.target.value)}
          >
            {sorted.map((t) => {
              const c = CATALOG_BY_ID[t.catalogId];
              return (
                <option key={t.uid} value={t.uid}>
                  {c.name}
                  {c.form ? ` — ${c.form}` : ''} · Sv {t.level}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div className="grid gap-4">
        {ROOMS.map((r) => {
          const can = me.inventory.filter((t) => !t.locked && t.uid !== me.shooterUid).length >= r.stakeCount;
          return (
            <button
              key={r.id}
              disabled={!can}
              onClick={() => onPick(r)}
              className={`rounded-3xl bg-gradient-to-br ${r.gradient} p-5 text-left shadow-xl transition active:scale-[0.98] disabled:opacity-40`}
            >
              <div className="text-2xl font-black">{r.name}</div>
              <div className="mt-1 text-white/90">{r.description}</div>
              <div className="mt-3 text-xs font-bold uppercase tracking-widest text-white/80">
                {can ? `Zamanlama barı: ${r.barPeriodMs < 1300 ? 'çok hızlı' : r.barPeriodMs < 1700 ? 'hızlı' : 'normal'}` : `Atış tasosu dışında ${r.stakeCount} kilitsiz taso gerekli`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SearchingScreen({ roomId, onCancel }: { roomId: RoomId; onCancel: () => void }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="h-20 w-20 animate-spin rounded-full border-8 border-white/20 border-t-amber-300" />
      <div>
        <div className="text-2xl font-black">Rakip aranıyor…</div>
        <div className="mt-1 text-slate-300">{ROOM_BY_ID[roomId].name}</div>
      </div>
      <p className="text-sm text-slate-400">Aynı odayı seçen başka bir gerçek oyuncu bulununca maç başlar.</p>
      <button className="btn btn-ghost" onClick={onCancel}>
        VAZGEÇ
      </button>
    </div>
  );
}

export function StakePickScreen({
  view,
  viewAt,
  inventory,
  shooterUid,
  onConfirm,
  onLeave,
}: {
  view: MatchView;
  viewAt: number;
  inventory: OwnedTaso[];
  shooterUid: string;
  onConfirm: (uids: string[]) => void;
  onLeave: () => void;
}) {
  const room = ROOM_BY_ID[view.roomId];
  const [picked, setPicked] = useState<string[]>([]);
  const secs = useCountdown(view.stakeRemainingMs, viewAt);
  const confirmed = view.stakesConfirmed[view.you];
  const oppConfirmed = view.stakesConfirmed[view.you === 0 ? 1 : 0];
  const oppName = view.names[view.you === 0 ? 1 : 0];
  const shooter = inventory.find((t) => t.uid === shooterUid);
  const sorted = useMemo(
    () => inventory.filter((t) => t.uid !== shooterUid && !t.locked).slice().sort((a, b) => a.catalogId.localeCompare(b.catalogId)),
    [inventory, shooterUid],
  );
  const toggle = (uid: string) =>
    setPicked((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : p.length < room.stakeCount ? [...p, uid] : p));
  const ready = picked.length === room.stakeCount;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <button className="text-slate-300" onClick={onLeave}>
          ← Maçtan ayrıl
        </button>
        <div className="text-sm font-bold text-amber-300">
          {room.name} · Tur {view.round} · {secs} sn
        </div>
      </div>
      <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm">
        Rakip: <b>{oppName}</b> — {oppConfirmed ? <span className="text-emerald-300">tasolarını onayladı ✓</span> : 'tasolarını seçiyor…'}
      </div>
      <h2 className="text-2xl font-black">
        {confirmed ? 'Tasolar kilitlendi, rakip bekleniyor…' : `${room.stakeCount} taso seç (${picked.length}/${room.stakeCount})`}
      </h2>

      {shooter && (
        <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3">
          <Taso entry={CATALOG_BY_ID[shooter.catalogId]} size={50} level={shooter.level} showName={false} />
          <div className="min-w-0 text-sm">
            <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Atış tasosu (sabit)</div>
            <div className="truncate font-bold">
              {CATALOG_BY_ID[shooter.catalogId].name}
              {CATALOG_BY_ID[shooter.catalogId].form ? ` — ${CATALOG_BY_ID[shooter.catalogId].form}` : ''}
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-black/20 p-3">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {sorted.map((t) => {
            const c = CATALOG_BY_ID[t.catalogId];
            const on = picked.includes(t.uid);
            return (
              <button
                key={t.uid}
                disabled={confirmed}
                onClick={() => toggle(t.uid)}
                className={`flex flex-col items-center gap-1 rounded-2xl p-2 transition ${on ? 'bg-amber-400/30 ring-2 ring-amber-300' : 'bg-white/5'}`}
              >
                <Taso entry={c} size="clamp(64px, 16vw, 92px)" level={t.level} showName={false} />
                <div className="line-clamp-1 w-full text-[11px] font-bold">{c.name}</div>
                <div className="text-[10px] text-slate-400">{c.form ?? RARITY_LABEL[c.rarity]}</div>
              </button>
            );
          })}
        </div>
      </div>

      <button className="btn btn-primary w-full" disabled={!ready || confirmed} onClick={() => onConfirm(picked)}>
        {confirmed ? 'ONAYLANDI ✓' : 'ONAYLA'}
      </button>
    </div>
  );
}

const END_TEXT: Record<NonNullable<MatchView['endReason']>, string> = {
  finished: '',
  cancelled: 'Maç iptal edildi (taso seçimi zamanında tamamlanmadı ya da biri ayrıldı). Hiçbir taso el değiştirmedi.',
  abandoned: 'Rakip ayrıldı ya da bağlantısı koptu. O ana kadar çevrilen tasolar işlendi, kalanlar sahibinde kaldı.',
  opponentLeft: 'Rakip ayrıldı.',
  noTiles: 'Yeni tur için yeterli taso kalmadı.',
};

export function ResultsScreen({
  summary,
  names,
  you,
  reason,
  onMenu,
}: {
  summary: MatchSummary;
  names: [string, string];
  you: 0 | 1;
  reason?: MatchView['endReason'];
  onMenu: () => void;
}) {
  const mine = summary.won[you].length;
  const theirs = summary.won[you === 0 ? 1 : 0].length;
  const title = summary.rounds === 0 ? 'MAÇ İPTAL' : mine === theirs ? 'BERABERLİK' : mine > theirs ? 'KAZANDIN!' : 'KAYBETTİN';
  const order: [0 | 1, 0 | 1] = [you, you === 0 ? 1 : 0];
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col items-center gap-4 overflow-y-auto p-6 text-center">
      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">{summary.rounds} tur oynandı</div>
      <h2 className={`text-5xl font-black ${mine > theirs ? 'text-amber-300' : mine < theirs ? 'text-rose-300' : 'text-sky-300'}`}>
        {title}
      </h2>
      {reason && END_TEXT[reason] && <p className="text-sm text-slate-300">{END_TEXT[reason]}</p>}
      {summary.rounds > 0 && (
        <div className="grid w-full grid-cols-2 gap-3">
          {order.map((i, k) => (
            <div key={i} className="rounded-2xl bg-white/10 p-4">
              <div className="truncate text-sm font-bold">{k === 0 ? 'Sen' : names[i]}</div>
              <div className="text-4xl font-black text-amber-300">{summary.won[i].length}</div>
              <div className="text-xs text-slate-300">kazanılan taso</div>
              <div className="mt-3 space-y-1 text-sm">
                <div>Toplam atış: <b>{summary.shots[i]}</b></div>
                <div>Başarılı atış: <b>{summary.successes[i]}</b></div>
                <div>Mükemmel atış: <b>{summary.perfects[i]}</b></div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="w-full rounded-2xl bg-white/5 p-3 text-xs text-slate-400">
        Paket jetonu ödülleri Aşama 4'te eklenecek; bu sürümde jeton verilmez.
      </div>
      <button className="btn btn-primary" onClick={onMenu}>
        ANA MENÜ
      </button>
    </div>
  );
}

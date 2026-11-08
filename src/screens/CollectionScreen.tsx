import { useMemo, useState } from 'react';
import { RARITY_LABEL, Taso } from '../components/Taso';
import { CATALOG, CATALOG_BY_ID, COLLECTION_SIZE } from '../data/catalog';
import { SERIES } from '../data/series';
import { levelBonus } from '../engine/engine';
import { XP, addXp, progress, tileXpValue } from '../engine/xp';
import type { MeView } from '../net/protocol';
import type { OwnedTaso } from '../types';

type Tab = 'all' | 'fav' | 'dupes' | string;

interface Group {
  catalogId: string;
  copies: OwnedTaso[]; // en güçlüden zayıfa
}

const byPower = (a: OwnedTaso, b: OwnedTaso) => b.level - a.level || b.xp - a.xp;

export function groupInventory(inv: OwnedTaso[]): Group[] {
  const m = new Map<string, OwnedTaso[]>();
  for (const t of inv) m.set(t.catalogId, [...(m.get(t.catalogId) ?? []), t]);
  return [...m.entries()].map(([catalogId, copies]) => ({ catalogId, copies: copies.sort(byPower) }));
}

interface Props {
  me: MeView;
  onBack: () => void;
  onShooter: (uid: string) => void;
  onFlag: (uid: string, field: 'favorite' | 'locked', value: boolean) => void;
  onUploadXp: (targetUid: string, sourceUids: string[]) => void;
}

export function CollectionScreen({ me, onBack, onShooter, onFlag, onUploadXp }: Props) {
  const [tab, setTab] = useState<Tab>('all');
  const [showMissing, setShowMissing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = useMemo(() => groupInventory(me.inventory), [me.inventory]);
  const owned = useMemo(() => new Map(groups.map((g) => [g.catalogId, g])), [groups]);

  const unique = (sid: string) => groups.filter((g) => CATALOG_BY_ID[g.catalogId].seriesId === sid).length;

  const visible = useMemo(() => {
    let list: { catalogId: string; group?: Group }[];
    if (tab === 'fav') list = groups.filter((g) => g.copies.some((t) => t.favorite)).map((g) => ({ catalogId: g.catalogId, group: g }));
    else if (tab === 'dupes') list = groups.filter((g) => g.copies.length > 1).map((g) => ({ catalogId: g.catalogId, group: g }));
    else {
      const entries = CATALOG.filter((c) => tab === 'all' || c.seriesId === tab);
      list = entries
        .map((c) => ({ catalogId: c.id, group: owned.get(c.id) }))
        .filter((x) => x.group || showMissing);
    }
    return list;
  }, [tab, groups, owned, showMissing]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'Tüm Tasolar' },
    ...SERIES.map((s) => ({ id: s.id, label: s.name })),
    { id: 'fav', label: 'Favoriler' },
    { id: 'dupes', label: 'Kopya Tasolar' },
  ];
  const openGroup = openId ? owned.get(openId) : undefined;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <button className="text-slate-300" onClick={onBack}>
          ← Ana menü
        </button>
        <h2 className="text-2xl font-black">Koleksiyon</h2>
        <span className="w-16" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${tab === t.id ? 'bg-amber-300 text-slate-900' : 'bg-white/10'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="font-black text-amber-300">
          {tab === 'all' || tab === 'fav' || tab === 'dupes' ? (
            <span className="flex flex-wrap gap-x-4">
              {SERIES.map((s) => (
                <span key={s.id}>
                  {s.name.toUpperCase()} KOLEKSİYONU: {unique(s.id)} / {COLLECTION_SIZE}
                </span>
              ))}
            </span>
          ) : (
            <span>
              {SERIES.find((s) => s.id === tab)?.name.toUpperCase()} KOLEKSİYONU: {unique(tab)} / {COLLECTION_SIZE}
            </span>
          )}
        </div>
        {tab !== 'fav' && tab !== 'dupes' && (
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={showMissing} onChange={(e) => setShowMissing(e.target.checked)} />
            Sahip olmadıklarını da göster
          </label>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 && (
          <div className="mt-10 text-center text-slate-400">
            {tab === 'fav' ? 'Henüz favori tasonun yok. Bir tasonun detayından ⭐ ile ekleyebilirsin.' : tab === 'dupes' ? 'Kopya tasonun yok.' : 'Burada gösterilecek taso yok.'}
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-3">
          {visible.map(({ catalogId, group }) => {
            const entry = CATALOG_BY_ID[catalogId];
            if (!group) {
              return (
                <div key={catalogId} className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 p-2 opacity-40">
                  <div className="grayscale">
                    <Taso entry={entry} size={72} showName={false} />
                  </div>
                  <div className="w-full truncate text-center text-xs font-bold">{entry.name}</div>
                  <div className="text-[10px] text-slate-400">Sahip değilsin</div>
                </div>
              );
            }
            const best = group.copies[0];
            const p = progress(best.level, best.xp);
            const series = SERIES.find((s) => s.id === entry.seriesId)!;
            return (
              <button
                key={catalogId}
                onClick={() => setOpenId(catalogId)}
                className="relative flex flex-col items-center gap-1 rounded-2xl bg-white/10 p-2 text-center transition active:scale-95"
              >
                {group.copies.length > 1 && (
                  <span className="absolute right-1 top-1 z-10 rounded-full bg-slate-900/80 px-2 text-[11px] font-black">x{group.copies.length}</span>
                )}
                {group.copies.some((t) => t.favorite) && <span className="absolute left-1 top-1 z-10 text-sm">⭐</span>}
                {group.copies.some((t) => t.locked) && <span className="absolute bottom-[58px] left-1 z-10 text-sm">🔒</span>}
                <Taso entry={entry} size={72} showName={false} />
                <div className="w-full truncate text-xs font-bold">{entry.name}</div>
                <div className="w-full truncate text-[10px] text-slate-300">{series.name}</div>
                <div className="text-[11px] font-black text-amber-300">Sv {best.level}</div>
                <div className="h-1.5 w-full overflow-hidden rounded bg-black/40">
                  <div className="h-full bg-amber-300" style={{ width: `${p.ratio * 100}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {openGroup && (
        <DetailModal
          key={openGroup.catalogId}
          group={openGroup}
          me={me}
          onClose={() => setOpenId(null)}
          onShooter={onShooter}
          onFlag={onFlag}
          onUploadXp={onUploadXp}
        />
      )}
    </div>
  );
}

function DetailModal({
  group,
  me,
  onClose,
  onShooter,
  onFlag,
  onUploadXp,
}: {
  group: Group;
  me: MeView;
  onClose: () => void;
  onShooter: (uid: string) => void;
  onFlag: Props['onFlag'];
  onUploadXp: Props['onUploadXp'];
}) {
  const [uid, setUid] = useState(group.copies[0].uid);
  const [picking, setPicking] = useState(false);
  const t = group.copies.find((c) => c.uid === uid) ?? group.copies[0];
  const entry = CATALOG_BY_ID[t.catalogId];
  const series = SERIES.find((s) => s.id === entry.seriesId)!;
  const p = progress(t.level, t.xp);
  const bonus = Math.round(levelBonus(t.level) * 100);
  const maxed = t.level >= XP.maxLevel;
  const isShooter = me.shooterUid === t.uid;
  const nextTier = (Math.floor(t.level / 100) + 1) * 100;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-t-3xl bg-slate-900 p-5 ring-1 ring-white/15 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300">{series.name} · {RARITY_LABEL[entry.rarity]}</div>
          <button onClick={onClose} aria-label="Kapat" className="text-xl leading-none">
            ✕
          </button>
        </div>
        <div className="my-3 flex justify-center">
          <Taso entry={entry} size={150} level={t.level} showName={false} />
        </div>
        <h3 className="text-center text-2xl font-black">{entry.name}</h3>
        {entry.form && <div className="text-center text-sm text-slate-300">{entry.form}</div>}

        {group.copies.length > 1 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {group.copies.map((c, i) => (
              <button
                key={c.uid}
                onClick={() => setUid(c.uid)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${c.uid === t.uid ? 'bg-amber-300 text-slate-900' : 'bg-white/10'}`}
              >
                Kopya {i + 1} · Sv {c.level}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-2 rounded-2xl bg-white/5 p-3 text-sm">
          <div className="flex justify-between">
            <span>Seviye</span>
            <b>{maxed ? `${t.level} (MAKS)` : t.level}</b>
          </div>
          <div className="flex justify-between">
            <span>Sahip olunan adet</span>
            <b>{group.copies.length}</b>
          </div>
          {!maxed && (
            <>
              <div>
                <div className="mb-1 flex justify-between">
                  <span>XP</span>
                  <b>
                    {t.xp} / {p.need}
                  </b>
                </div>
                <div className="h-3 overflow-hidden rounded bg-black/40">
                  <div className="h-full bg-gradient-to-r from-amber-300 to-orange-400" style={{ width: `${p.ratio * 100}%` }} />
                </div>
              </div>
              <div className="flex justify-between">
                <span>Sonraki seviyeye</span>
                <b>{p.remaining} XP kaldı</b>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span>Güç bonusu</span>
            <b>{bonus > 0 ? `+${bonus} puan çevirme şansı` : 'Henüz yok'}</b>
          </div>
          {levelBonus(t.level) < 0.15 && <div className="text-xs text-slate-400">Sonraki bonus basamağı: Seviye {nextTier} (+3 puan). Zamanlama becerisi her zaman daha önemlidir.</div>}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="btn btn-primary py-3 text-sm" disabled={isShooter || me.inMatch} onClick={() => onShooter(t.uid)}>
            {isShooter ? 'Atış tasosu ✓' : 'Atış tasosu seç'}
          </button>
          <button className="btn btn-ghost py-3 text-sm" disabled={maxed || me.inMatch} onClick={() => setPicking(true)}>
            XP yükle
          </button>
          <button className="btn btn-ghost py-3 text-sm" disabled={me.inMatch} onClick={() => onFlag(t.uid, 'favorite', !t.favorite)}>
            {t.favorite ? '⭐ Favoriden çıkar' : '☆ Favori yap'}
          </button>
          <button className="btn btn-ghost py-3 text-sm" disabled={me.inMatch} onClick={() => onFlag(t.uid, 'locked', !t.locked)}>
            {t.locked ? '🔓 Kilidi aç' : '🔒 Kilitle'}
          </button>
        </div>
        <div className="mt-2 text-center text-[11px] text-slate-400">
          Kilitli, favori ve atış tasoları XP'ye dönüştürülemez. Kilitli taso maça konamaz.
          {me.inMatch ? ' Maç sırasında değişiklik yapılamaz.' : ''}
        </div>
      </div>

      {picking && (
        <XpPicker
          me={me}
          target={t}
          onClose={() => setPicking(false)}
          onConfirm={(srcs) => {
            onUploadXp(t.uid, srcs);
            setPicking(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

function XpPicker({ me, target, onClose, onConfirm }: { me: MeView; target: OwnedTaso; onClose: () => void; onConfirm: (uids: string[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const groups = useMemo(() => new Map(groupInventory(me.inventory).map((g) => [g.catalogId, g])), [me.inventory]);

  const rows = useMemo(() => {
    const isExtra = (t: OwnedTaso) => {
      const g = groups.get(t.catalogId)!;
      if (g.catalogId === target.catalogId) return true;
      return g.copies.length > 1 && g.copies[0].uid !== t.uid;
    };
    return me.inventory
      .filter((t) => t.uid !== target.uid && !t.locked && !t.favorite && t.uid !== me.shooterUid)
      .map((t) => ({ t, extra: isExtra(t), value: tileXpValue(CATALOG_BY_ID[t.catalogId].rarity, t.level, t.xp) }))
      .sort((a, b) => Number(b.extra) - Number(a.extra) || a.value - b.value);
  }, [me.inventory, me.shooterUid, target, groups]);

  const chosen = rows.filter((r) => sel.has(r.t.uid));
  const gain = chosen.reduce((s, r) => s + r.value, 0);
  const after = addXp(target.level, target.xp, gain);
  const rare = chosen.filter((r) => ['epic', 'legendary'].includes(CATALOG_BY_ID[r.t.catalogId].rarity)).length;
  const toggle = (uid: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid);
      else if (n.size < 200) n.add(uid);
      return n;
    });

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 sm:items-center sm:p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="flex max-h-full w-full max-w-lg flex-col gap-3 rounded-t-3xl bg-slate-900 p-4 ring-1 ring-white/15 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <div className="grid gap-4 p-2 text-center">
            <div className="text-xl font-black">Emin misin?</div>
            <p className="text-sm">
              <b>{chosen.length}</b> taso <b>kalıcı olarak yok edilecek</b> ve <b>{gain} XP</b> olarak {CATALOG_BY_ID[target.catalogId].name} tasosuna eklenecek. Bu işlem geri alınamaz.
            </p>
            {rare > 0 && <p className="rounded-xl bg-rose-600/80 p-2 text-sm font-bold">Dikkat: seçtiklerin arasında {rare} epik/efsanevi taso var!</p>}
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Vazgeç</button>
              <button className="btn btn-primary" onClick={() => onConfirm(chosen.map((r) => r.t.uid))}>Evet, dönüştür</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">XP yüklemek için taso seç</h3>
              <button onClick={onClose} aria-label="Kapat">✕</button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button className="rounded-full bg-white/10 px-3 py-1 font-bold" onClick={() => setSel(new Set(rows.filter((r) => r.extra).slice(0, 200).map((r) => r.t.uid)))}>
                Tüm kopyaları seç
              </button>
              <button className="rounded-full bg-white/10 px-3 py-1 font-bold" onClick={() => setSel(new Set())}>
                Temizle
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 && <div className="p-6 text-center text-slate-400">Dönüştürülebilecek taso yok (kilitli, favori ve atış tasoları hariç).</div>}
              <div className="grid gap-1">
                {rows.map(({ t, extra, value }) => {
                  const c = CATALOG_BY_ID[t.catalogId];
                  return (
                    <label key={t.uid} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${sel.has(t.uid) ? 'bg-amber-300/20' : 'bg-white/5'}`}>
                      <input type="checkbox" checked={sel.has(t.uid)} onChange={() => toggle(t.uid)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{c.name}{c.form ? ` — ${c.form}` : ''}</div>
                        <div className="text-[11px] text-slate-400">{RARITY_LABEL[c.rarity]} · Sv {t.level}{extra ? ' · kopya' : ''}</div>
                      </div>
                      <div className="text-sm font-black text-amber-300">+{value}</div>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="rounded-xl bg-white/5 p-3 text-sm">
              <div className="flex justify-between"><span>Seçilen</span><b>{chosen.length} taso</b></div>
              <div className="flex justify-between"><span>Kazanılacak XP</span><b>+{gain}</b></div>
              <div className="flex justify-between"><span>Sonuç seviye</span><b>{target.level} → {after.level}</b></div>
            </div>
            <button className="btn btn-primary" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
              DEVAM ET
            </button>
          </>
        )}
      </div>
    </div>
  );
}

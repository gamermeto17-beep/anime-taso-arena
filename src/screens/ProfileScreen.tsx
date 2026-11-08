import { RARITY_LABEL, Taso } from '../components/Taso';
import { CATALOG_BY_ID, COLLECTION_SIZE } from '../data/catalog';
import { SERIES } from '../data/series';
import type { MeView } from '../net/protocol';
import type { Rarity } from '../types';

export function ProfileScreen({ me, onBack, onLogout }: { me: MeView; onBack: () => void; onLogout: () => void }) {
  const shooter = me.inventory.find((t) => t.uid === me.shooterUid);
  const strongest = me.inventory.slice().sort((a, b) => b.level - a.level || b.xp - a.xp)[0];
  const uniq = new Set(me.inventory.map((t) => t.catalogId)).size;
  const rarity = (r: Rarity) => me.inventory.filter((t) => CATALOG_BY_ID[t.catalogId].rarity === r).length;
  const seriesUnique = (sid: string) => new Set(me.inventory.filter((t) => CATALOG_BY_ID[t.catalogId].seriesId === sid).map((t) => t.catalogId)).size;
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-4 overflow-y-auto p-5">
      <button className="self-start text-slate-300" onClick={onBack}>← Ana menü</button>
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Profil</div>
        <h2 className="text-3xl font-black">{me.name}</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <Stat label="Toplam taso" value={me.inventory.length} />
        <Stat label="Farklı taso" value={`${uniq} / ${COLLECTION_SIZE * SERIES.length}`} />
        <Stat label="En yüksek seviye" value={strongest ? strongest.level : 1} />
        <Stat label="Kopya taso" value={me.inventory.length - uniq} />
      </div>
      <div className="grid gap-2 rounded-2xl bg-white/5 p-3 text-sm">
        {SERIES.map((s) => (
          <div key={s.id} className="flex justify-between">
            <span className="font-bold">{s.name.toUpperCase()} KOLEKSİYONU</span>
            <b className="text-amber-300">{seriesUnique(s.id)} / {COLLECTION_SIZE}</b>
          </div>
        ))}
        {(['common', 'rare', 'epic', 'legendary'] as Rarity[]).map((r) => (
          <div key={r} className="flex justify-between text-slate-300"><span>{RARITY_LABEL[r]}</span><b>{rarity(r)}</b></div>
        ))}
      </div>
      {shooter && (
        <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-3">
          <Taso entry={CATALOG_BY_ID[shooter.catalogId]} size={64} level={shooter.level} showName={false} />
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Atış tasosu</div>
            <div className="font-black">{CATALOG_BY_ID[shooter.catalogId].name}</div>
            <div className="text-sm text-slate-300">Seviye {shooter.level}</div>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-400">Maç istatistikleri (galibiyet/mağlubiyet) henüz kaydedilmiyor; sonraki aşamalarda eklenecek.</p>
      <button className="btn btn-ghost" onClick={onLogout}>Çıkış yap</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-white/10 p-3">
      <div className="text-2xl font-black">{value}</div>
      <div className="text-xs text-slate-300">{label}</div>
    </div>
  );
}

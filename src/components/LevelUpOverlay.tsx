import { useEffect } from 'react';
import { Taso } from './Taso';
import { CATALOG_BY_ID } from '../data/catalog';
import type { XpResultMsg } from '../net/protocol';
import type { OwnedTaso } from '../types';
import { sfx } from '../lib/sound';

export function LevelUpOverlay({ result, tile, onClose }: { result: XpResultMsg; tile?: OwnedTaso; onClose: () => void }) {
  const milestone = result.crossed.length > 0 ? Math.max(...result.crossed) : 0;
  const leveled = result.levelsGained > 0;
  useEffect(() => {
    if (leveled) sfx.levelUp(milestone > 0);
    const t = setTimeout(onClose, milestone ? 6000 : 4500);
    return () => clearTimeout(t);
  }, [leveled, milestone, onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center" onClick={onClose}>
      {milestone > 0 && <div className="milestone-rays" aria-hidden />}
      <div className="relative z-10 flex flex-col items-center gap-3">
        {milestone > 0 && <div className="milestone-title text-4xl font-black text-amber-300">{milestone}. SEVİYE EŞİĞİ!</div>}
        <div className={leveled ? 'levelup-pop' : ''}>
          {tile && <Taso entry={CATALOG_BY_ID[tile.catalogId]} size={160} level={result.levelAfter} showName={false} />}
        </div>
        {leveled ? (
          <div className="text-3xl font-black">SEVİYE ATLADIN! {result.levelBefore} → {result.levelAfter}</div>
        ) : (
          <div className="text-2xl font-black">+{result.gained} XP</div>
        )}
        <div className="text-sm text-slate-200">
          {result.consumed} taso dönüştürüldü · +{result.gained} XP
          {result.wasted > 0 ? ` · ${result.wasted} XP maksimum seviye yüzünden boşa gitti` : ''}
        </div>
        {milestone > 0 && <div className="text-sm font-bold text-amber-200">Yeni güç bonusu açıldı: +3 puan çevirme şansı!</div>}
        <div className="text-xs text-slate-400">Kapatmak için dokun</div>
      </div>
    </div>
  );
}

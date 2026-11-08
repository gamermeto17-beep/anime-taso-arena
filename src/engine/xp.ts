import type { Rarity } from '../types';

/**
 * XP ve seviye parametreleri (tek yerden ayarlanır).
 * Seviye başına gereken XP aşamalı artar: 1→2 için 17 XP, 100. seviyede ~700 XP, 499. seviyede ~8 bin XP.
 */
export const XP = {
  maxLevel: 500,
  base: 15,
  growth: 1.6,
  /** Bir tasoyu XP'ye dönüştürünce verdiği temel değer (nadirliğe göre) */
  rarityValue: { common: 25, rare: 60, epic: 140, legendary: 320 } as Record<Rarity, number>,
  /** Dönüştürülen tasonun biriktirdiği toplam XP'nin ne kadarı aktarılır */
  inheritRatio: 0.5,
} as const;

export function xpToNext(level: number): number {
  if (level >= XP.maxLevel) return 0;
  return Math.round(XP.base * Math.pow(1 + level / 10, XP.growth));
}

/** Seviye 1'den bu seviyeye gelmek için harcanan toplam XP */
export function cumulativeXp(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

export function tileXpValue(rarity: Rarity, level: number, xp: number): number {
  const total = cumulativeXp(level) + xp;
  return XP.rarityValue[rarity] + Math.floor(total * XP.inheritRatio);
}

export interface XpGain {
  level: number;
  xp: number;
  levelsGained: number;
  /** Bu kazanımda geçilen 100'lük eşikler (100, 200, ...) */
  crossed: number[];
  /** Maksimum seviye nedeniyle boşa giden XP */
  wasted: number;
}

export function addXp(level: number, xp: number, gain: number): XpGain {
  let lv = Math.min(Math.max(Math.floor(level), 1), XP.maxLevel);
  let cur = Math.max(0, xp) + Math.max(0, Math.floor(gain));
  const crossed: number[] = [];
  const start = lv;
  while (lv < XP.maxLevel) {
    const need = xpToNext(lv);
    if (cur < need) break;
    cur -= need;
    lv += 1;
    if (lv % 100 === 0) crossed.push(lv);
  }
  let wasted = 0;
  if (lv >= XP.maxLevel) {
    wasted = cur;
    cur = 0;
  }
  return { level: lv, xp: cur, levelsGained: lv - start, crossed, wasted };
}

export function progress(level: number, xp: number): { need: number; remaining: number; ratio: number } {
  const need = xpToNext(level);
  if (need === 0) return { need: 0, remaining: 0, ratio: 1 };
  return { need, remaining: need - xp, ratio: Math.min(1, xp / need) };
}

import { describe, expect, it } from 'vitest';
import { levelBonus } from './engine';
import { XP, addXp, cumulativeXp, progress, tileXpValue, xpToNext } from './xp';

describe('XP eğrisi', () => {
  it('seviye başına gereken XP aşamalı artar, 500. seviyede 0 olur', () => {
    for (let l = 1; l < 499; l++) expect(xpToNext(l + 1)).toBeGreaterThanOrEqual(xpToNext(l));
    expect(xpToNext(1)).toBe(17);
    expect(xpToNext(500)).toBe(0);
  });
  it('tam eşikte seviye atlar, artan XP taşınır', () => {
    const r = addXp(1, 0, xpToNext(1) + 5);
    expect(r.level).toBe(2);
    expect(r.xp).toBe(5);
    expect(r.levelsGained).toBe(1);
  });
  it('bir eşikten az XP seviye atlatmaz', () => {
    const r = addXp(10, 3, xpToNext(10) - 4);
    expect(r.level).toBe(10);
    expect(r.xp).toBe(xpToNext(10) - 1);
  });
  it('birden fazla seviye atlanabilir', () => {
    const r = addXp(1, 0, cumulativeXp(6));
    expect(r.level).toBe(6);
    expect(r.xp).toBe(0);
    expect(r.levelsGained).toBe(5);
  });
  it('100/200/300/400/500 eşikleri bildirilir ve bonus basamağı doğru artar', () => {
    for (const hundred of [100, 200, 300, 400, 500]) {
      const r = addXp(hundred - 1, 0, xpToNext(hundred - 1));
      expect(r.level).toBe(hundred);
      expect(r.crossed).toEqual([hundred]);
      expect(levelBonus(hundred)).toBeGreaterThan(levelBonus(hundred - 1));
    }
    const jump = addXp(95, 0, cumulativeXp(305) - cumulativeXp(95));
    expect(jump.crossed).toEqual([100, 200, 300]);
  });
  it('maksimum seviyede kalır, fazla XP boşa gider', () => {
    const r = addXp(499, 0, xpToNext(499) + 1000);
    expect(r.level).toBe(XP.maxLevel);
    expect(r.xp).toBe(0);
    expect(r.wasted).toBe(1000);
    expect(addXp(500, 0, 50).level).toBe(500);
  });
  it('taso XP değeri nadirliğe ve birikmiş XP\'ye bağlıdır', () => {
    expect(tileXpValue('common', 1, 0)).toBe(25);
    expect(tileXpValue('legendary', 1, 0)).toBeGreaterThan(tileXpValue('rare', 1, 0));
    expect(tileXpValue('common', 20, 10)).toBeGreaterThan(tileXpValue('common', 1, 0));
  });
  it('ilerleme çubuğu', () => {
    expect(progress(1, 0).ratio).toBe(0);
    expect(progress(1, 17).ratio).toBe(1);
    expect(progress(500, 0).ratio).toBe(1);
    expect(progress(10, 5).remaining).toBe(xpToNext(10) - 5);
  });
});

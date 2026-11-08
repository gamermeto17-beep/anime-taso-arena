import { describe, expect, it } from 'vitest';
import { CATALOG, COLLECTION_SIZE, catalogOfSeries } from '../data/catalog';
import { ROOMS } from '../data/rooms';
import { SERIES } from '../data/series';
import { BALANCE } from './balance';
import {
  createRound,
  flipChance,
  levelBonus,
  matchOutcome,
  resolveShot,
  type PlayerSetup,
} from './engine';
import { seededRng } from './rng';
import { gradeShot, pointerAt } from './timing';

function setup(prefix: string, n: number): PlayerSetup {
  return {
    name: prefix,
    stakes: Array.from({ length: n }, (_, i) => ({ uid: `${prefix}-${i}`, catalogId: `naruto-${String(i + 1).padStart(3, '0')}` })),
    shooterUid: `${prefix}-shooter`,
    shooterLevel: 1,
  };
}

describe('katalog', () => {
  it('her seride tam 250 kayıt var ve kimlikler benzersiz', () => {
    for (const s of SERIES) expect(catalogOfSeries(s.id)).toHaveLength(COLLECTION_SIZE);
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
  });
  it('aynı karakter+form ikilisi tekrar etmez', () => {
    const keys = CATALOG.map((c) => `${c.seriesId}|${c.name}|${c.form ?? ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('odalar', () => {
  it('3, 5 ve 10 tasoluk odalar doğru masa büyüklüğü üretir', () => {
    expect(ROOMS.map((r) => r.stakeCount)).toEqual([3, 5, 10]);
    for (const r of ROOMS) {
      const st = createRound(r.id, [setup('a', r.stakeCount), setup('b', r.stakeCount)], seededRng(1));
      expect(st.table).toHaveLength(r.stakeCount * 2);
    }
  });
  it('yanlış sayıda taso reddedilir', () => {
    expect(() => createRound('usta', [setup('a', 3), setup('b', 5)])).toThrow();
  });
  it('atış tasosu ortaya konamaz', () => {
    const a = setup('a', 3);
    a.shooterUid = 'a-0';
    expect(() => createRound('acemi', [a, setup('b', 3)])).toThrow();
  });
});

describe('ilk atış ve sıra', () => {
  it('ilk atış rastgele: iki oyuncu da başlayabilir', () => {
    const firsts = new Set<number>();
    for (let s = 0; s < 40; s++) {
      firsts.add(createRound('acemi', [setup('a', 3), setup('b', 3)], seededRng(s)).turn);
    }
    expect(firsts.size).toBe(2);
  });
  it('sıra her atıştan sonra değişir', () => {
    let st = createRound('efsane', [setup('a', 10), setup('b', 10)], seededRng(7));
    const rng = seededRng(99);
    const first = st.turn;
    const r = resolveShot(st, 'weak', rng);
    expect(r.shooter).toBe(first);
    if (r.state.phase === 'playing') expect(r.state.turn).toBe(first === 0 ? 1 : 0);
    st = r.state;
  });
});

describe('çevirme ve transfer', () => {
  it('çevrilen tasolar atan oyuncuya geçer, masadan çıkar, yüzü ters döner', () => {
    const st = createRound('acemi', [setup('a', 3), setup('b', 3)], seededRng(3));
    const before = new Map(st.table.map((t) => [t.uid, t.faceUp]));
    const r = resolveShot(st, 'perfect', () => 0); // her deneme başarılı
    expect(r.flipped).toHaveLength(BALANCE.rollsPerShot.perfect);
    expect(r.state.players[r.shooter].won).toHaveLength(r.flipped.length);
    expect(r.state.table).toHaveLength(6 - r.flipped.length);
    for (const t of r.flipped) {
      expect(before.get(t.uid)).toBe(!t.faceUp);
      expect(r.state.table.find((x) => x.uid === t.uid)).toBeUndefined();
    }
    const other = r.shooter === 0 ? 1 : 0;
    expect(r.state.players[other].won).toHaveLength(0);
  });
  it('hiç çevrilmezse kazanım olmaz', () => {
    const st = createRound('acemi', [setup('a', 3), setup('b', 3)], seededRng(5));
    const r = resolveShot(st, 'weak', () => 0.9999);
    expect(r.flipped).toHaveLength(0);
    expect(r.state.table).toHaveLength(6);
  });
  it('hiçbir taso iki oyuncuda birden bulunmaz; masa bitince tur biter', () => {
    let st = createRound('acemi', [setup('a', 3), setup('b', 3)], seededRng(11));
    const rng = seededRng(2);
    let guard = 0;
    while (st.phase === 'playing' && guard++ < 500) st = resolveShot(st, 'perfect', rng).state;
    expect(st.phase).toBe('roundOver');
    expect(st.table).toHaveLength(0);
    const all = [...st.players[0].won, ...st.players[1].won].map((t) => t.uid);
    expect(new Set(all).size).toBe(6);
    expect(() => resolveShot(st, 'good')).toThrow();
  });
  it('sonuç: fazla taso kazanan galip, eşitlik beraberlik', () => {
    let st = createRound('acemi', [setup('a', 3), setup('b', 3)], seededRng(11));
    const rng = seededRng(2);
    while (st.phase === 'playing') st = resolveShot(st, 'perfect', rng).state;
    const a = st.players[0].won.length;
    const b = st.players[1].won.length;
    expect(matchOutcome(st)).toBe(a === b ? 'draw' : a > b ? 'win0' : 'win1');
  });
});

describe('seviye bonusları', () => {
  it('100/200/300/400/500 doğru, +15 puanı geçmez', () => {
    const cases: [number, number][] = [[1, 0], [99, 0], [100, 0.03], [199, 0.03], [200, 0.06], [300, 0.09], [400, 0.12], [500, 0.15]];
    for (const [lv, bonus] of cases) expect(levelBonus(lv)).toBeCloseTo(bonus, 10);
    expect(levelBonus(500)).toBeCloseTo(0.15);
    expect(levelBonus(9999)).toBeCloseTo(0.15);
  });
  it('mükemmel atış zayıf atıştan daima iyidir, yüzde yüz garanti vermez', () => {
    for (const lv of [1, 100, 300, 500]) {
      expect(flipChance('perfect', lv)).toBeGreaterThan(flipChance('weak', lv));
      expect(flipChance('perfect', lv)).toBeLessThan(1);
    }
    // 500. seviye zayıf atış, 1. seviye mükemmel atışı geçmemeli: zamanlama önemli kalır
    expect(flipChance('weak', 500)).toBeLessThan(flipChance('perfect', 1));
  });
});

describe('zamanlama', () => {
  it('ibre 0..1 arasında üçgen dalgadır', () => {
    expect(pointerAt(0, 1000)).toBe(0);
    expect(pointerAt(500, 1000)).toBe(1);
    expect(pointerAt(1000, 1000)).toBe(0);
    expect(pointerAt(250, 1000)).toBeCloseTo(0.5);
    for (let t = 0; t < 5000; t += 37) {
      const p = pointerAt(t, 1300);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
  it('merkez = mükemmel, yakın = iyi, uzak = zayıf', () => {
    expect(gradeShot(0.5, 0.5, 0.1).grade).toBe('perfect');
    expect(gradeShot(0.54, 0.5, 0.1).grade).toBe('good');
    expect(gradeShot(0.2, 0.5, 0.1).grade).toBe('weak');
  });
});

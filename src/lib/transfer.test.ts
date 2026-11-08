import { describe, expect, it } from 'vitest';
import { createRound, resolveShot, type PlayerSetup } from '../engine/engine';
import { seededRng } from '../engine/rng';
import type { OwnedTaso } from '../types';
import { applyRoundTransfer } from './transfer';

function inv(prefix: string, n: number): OwnedTaso[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    uid: i === n ? `${prefix}-shooter` : `${prefix}-${i}`,
    catalogId: `naruto-${String(i + 1).padStart(3, '0')}`,
    level: 1,
    xp: 0,
  }));
}
const setupOf = (name: string, items: OwnedTaso[]): PlayerSetup => ({
  name,
  stakes: items.filter((t) => !t.uid.endsWith('shooter')).map((t) => ({ uid: t.uid, catalogId: t.catalogId })),
  shooterUid: `${name}-shooter`,
  shooterLevel: 1,
});

describe('envanter transferi', () => {
  it('kaybedilen taso eski sahibinden silinir, yeni sahipte tek kopya olur; toplam korunur', () => {
    const a = inv('a', 3);
    const b = inv('b', 3);
    let st = createRound('acemi', [setupOf('a', a), setupOf('b', b)], seededRng(21));
    const rng = seededRng(8);
    while (st.phase === 'playing') st = resolveShot(st, 'perfect', rng).state;
    const [na, nb] = applyRoundTransfer(a, b, st);
    expect(na.length + nb.length).toBe(a.length + b.length);
    const ids = [...na, ...nb].map((t) => t.uid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of st.players[0].won) expect(na.some((x) => x.uid === t.uid)).toBe(true);
    for (const t of st.players[1].won) expect(nb.some((x) => x.uid === t.uid)).toBe(true);
    // atış tasoları yerinde kalır
    expect(na.some((t) => t.uid === 'a-shooter')).toBe(true);
    expect(nb.some((t) => t.uid === 'b-shooter')).toBe(true);
  });
});

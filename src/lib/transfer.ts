import type { MatchState } from '../engine/engine';
import type { OwnedTaso } from '../types';

/**
 * Tur sonunda kazanılan tasoları envanterler arasında taşır.
 * Saf fonksiyon: bir taso (uid) asla iki envanterde birden bulunmaz.
 * Aşama 2-3'te aynı mantık sunucuda tek bir veritabanı işlemi içinde çalışacak.
 */
export function applyRoundTransfer(
  inv0: OwnedTaso[],
  inv1: OwnedTaso[],
  state: MatchState,
): [OwnedTaso[], OwnedTaso[]] {
  let a = inv0.slice();
  let b = inv1.slice();
  // 0. oyuncunun kazandığı ve 1'e ait olan tasolar 1'den 0'a geçer
  for (const t of state.players[0].won) {
    if (t.owner === 1) {
      const i = b.findIndex((x) => x.uid === t.uid);
      if (i >= 0) a.push(b.splice(i, 1)[0]);
    }
  }
  // 1. oyuncunun kazandığı ve 0'a ait olan tasolar 0'dan 1'e geçer
  for (const t of state.players[1].won) {
    if (t.owner === 0) {
      const i = a.findIndex((x) => x.uid === t.uid);
      if (i >= 0 && !state.players[0].won.some((w) => w.uid === t.uid)) b.push(a.splice(i, 1)[0]);
    }
  }
  a = dedupe(a);
  b = dedupe(b);
  return [a, b];
}

function dedupe(list: OwnedTaso[]): OwnedTaso[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.uid) ? false : (seen.add(t.uid), true)));
}

import { CATALOG, catalogOfSeries } from '../data/catalog';
import { SERIES } from '../data/series';
import { shuffle, defaultRng, type Rng } from '../engine/rng';
import type { OwnedTaso } from '../types';

let counter = 0;
export function newUid(prefix = 't'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/**
 * Aşama 1: yalnızca bellekte tutulan başlangıç koleksiyonu.
 * Aşama 3'te PostgreSQL envanterine taşınacak; envanter sunucuda yetkili olacak.
 */
export function createStarterInventory(rng: Rng = defaultRng, prefix = 't'): OwnedTaso[] {
  const out: OwnedTaso[] = [];
  for (const s of SERIES) {
    const pool = shuffle(catalogOfSeries(s.id), rng);
    const unique = pool.slice(0, 14);
    const dupes = unique.slice(0, 4); // 4 kopya taso
    for (const c of [...unique, ...dupes]) {
      out.push({ uid: newUid(prefix), catalogId: c.id, level: 1, xp: 0 });
    }
  }
  return out;
}

export const TOTAL_CATALOG = CATALOG.length;

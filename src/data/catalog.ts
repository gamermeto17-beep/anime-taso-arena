import type { CatalogEntry, Rarity } from '../types';
import { NARUTO_RAW } from './narutoRaw';
import { ONEPIECE_RAW } from './onepieceRaw';

export const COLLECTION_SIZE = 250;

const RAW_BY_SERIES: Record<string, string[]> = {
  naruto: NARUTO_RAW,
  onepiece: ONEPIECE_RAW,
};

const RARITY_CODE: Record<string, Rarity> = {
  c: 'common',
  r: 'rare',
  e: 'epic',
  l: 'legendary',
};

export function parseSeries(seriesId: string, lines: string[]): CatalogEntry[] {
  return lines.map((line, i) => {
    const [name, form, code] = line.split(';').map((p) => p.trim());
    const number = i + 1;
    const id = `${seriesId}-${String(number).padStart(3, '0')}`;
    return {
      id,
      seriesId,
      number,
      name,
      form: form || undefined,
      rarity: RARITY_CODE[code ?? 'c'] ?? 'common',
      image: `/assets/tasos/${seriesId}/${id}.webp`,
    };
  });
}

export const CATALOG: CatalogEntry[] = Object.entries(RAW_BY_SERIES).flatMap(([sid, lines]) =>
  parseSeries(sid, lines),
);

export const CATALOG_BY_ID: Record<string, CatalogEntry> = Object.fromEntries(
  CATALOG.map((c) => [c.id, c]),
);

export function catalogOfSeries(seriesId: string): CatalogEntry[] {
  return CATALOG.filter((c) => c.seriesId === seriesId);
}

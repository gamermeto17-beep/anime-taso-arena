import type { SeriesInfo } from '../types';

/**
 * Yeni anime eklemek: buraya bir SeriesInfo ekle, 250 satırlık bir ham liste
 * dosyası yaz (src/data/<seri>Raw.ts) ve catalog.ts içindeki RAW_BY_SERIES'e bağla.
 * Oyun motoru değişmez.
 */
export const SERIES: SeriesInfo[] = [
  { id: 'naruto', name: 'Naruto', packName: 'Naruto Paketi', hue: 28, accentHue: 215, pattern: 'rays', emblem: 'swirl' },
  { id: 'onepiece', name: 'One Piece', packName: 'One Piece Paketi', hue: 195, accentHue: 45, pattern: 'waves', emblem: 'skull' },
];

export const SERIES_BY_ID: Record<string, SeriesInfo> = Object.fromEntries(
  SERIES.map((s) => [s.id, s]),
);

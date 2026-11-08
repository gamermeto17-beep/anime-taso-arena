export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type PlayerIndex = 0 | 1;
export type ShotGrade = 'perfect' | 'good' | 'weak';
export type BackPattern = 'rays' | 'waves';
export type EmblemKind = 'swirl' | 'skull';

export interface SeriesInfo {
  id: string;
  name: string;
  packName: string;
  hue: number;
  accentHue: number;
  pattern: BackPattern;
  /** Arka yüzdeki seriye özel sembol */
  emblem?: EmblemKind;
}

export interface CatalogEntry {
  id: string;
  seriesId: string;
  number: number;
  name: string;
  form?: string;
  rarity: Rarity;
  /** Lisanslı/kendi görselinizi bu yola koyun: public/assets/tasos/<seri>/<id>.webp */
  image: string;
}

export interface OwnedTaso {
  uid: string;
  catalogId: string;
  level: number;
  xp: number;
}

export type RoomId = 'acemi' | 'usta' | 'efsane';

export interface RoomConfig {
  id: RoomId;
  name: string;
  description: string;
  stakeCount: number;
  /** Zamanlama barının bir gidiş-geliş süresi (ms). Düşük = zor. */
  barPeriodMs: number;
  /** Kırmızı bölgenin yarı genişliği (0-1 bar oranı). */
  barHalfWidth: number;
  gradient: string;
}

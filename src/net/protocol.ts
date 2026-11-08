import type { MatchState, TableTile } from '../engine/engine';
import type { OwnedTaso, RoomId, ShotGrade } from '../types';

/** İstemci ↔ sunucu ortak tipler. Sunucu tek yetkili kaynaktır. */

export interface MatchSummary {
  rounds: number;
  won: [TableTile[], TableTile[]];
  shots: [number, number];
  successes: [number, number];
  perfects: [number, number];
}

export interface MeView {
  name: string;
  inventory: OwnedTaso[];
  shooterUid: string;
  queued: RoomId | null;
  inMatch: boolean;
  /** Tasosu azaldıysa ve bugün hakkı varsa günlük ücretsiz kurtarma alınabilir. */
  canRescue: boolean;
}

export interface XpResultMsg {
  targetUid: string;
  consumed: number;
  gained: number;
  wasted: number;
  levelBefore: number;
  levelAfter: number;
  levelsGained: number;
  /** Bu yüklemede geçilen 100'lük eşikler */
  crossed: number[];
  xp: number;
}

export type OnlinePhase = 'stakes' | 'playing' | 'decision' | 'ended';

export interface ShotBegin {
  shotId: number;
  shooter: 0 | 1;
  /** Kırmızı bölge merkezi: yalnızca atan oyuncuya gönderilir. */
  center?: number;
  /** Atış başladığından beri sunucuda geçen süre (yeniden bağlanma için). */
  elapsedMs: number;
}

export interface ShotResultMsg {
  shotId: number;
  shooter: 0 | 1;
  grade: ShotGrade;
  pointer: number;
  flipped: TableTile[];
  chance: number;
  rolls: number;
  state: MatchState;
}

export interface MatchView {
  matchId: string;
  roomId: RoomId;
  phase: OnlinePhase;
  you: 0 | 1;
  names: [string, string];
  round: number;
  stakesConfirmed: [boolean, boolean];
  stakeRemainingMs: number;
  introMs: number;
  state: MatchState | null;
  shooters: [{ catalogId: string; level: number }, { catalogId: string; level: number }] | null;
  shot: ShotBegin | null;
  decision: { remainingMs: number; mine: boolean | null; opponentDecided: boolean } | null;
  summary: MatchSummary;
  endReason?: 'finished' | 'cancelled' | 'abandoned' | 'opponentLeft' | 'noTiles';
  opponentConnected: boolean;
}

export interface ClientToServer {
  'queue:join': { roomId: RoomId };
  'queue:leave': Record<string, never>;
  'shooter:set': { uid: string };
  'match:stakes': { uids: string[] };
  'shot:tap': { shotId: number; elapsedMs: number };
  'round:decision': { continue: boolean };
  'match:leave': Record<string, never>;
  rescue: Record<string, never>;
  'taso:flag': { uid: string; field: 'favorite' | 'locked'; value: boolean };
  'taso:xp': { targetUid: string; sourceUids: string[] };
}

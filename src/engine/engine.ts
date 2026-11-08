import { BALANCE } from './balance';
import { defaultRng, shuffle, type Rng } from './rng';
import { ROOM_BY_ID } from '../data/rooms';
import type { PlayerIndex, RoomId, ShotGrade } from '../types';

export interface TableTile {
  uid: string;
  catalogId: string;
  /** Masaya koyan oyuncu */
  owner: PlayerIndex;
  /** Masada hangi yüzü görünüyor (çevrilince tersine döner) */
  faceUp: boolean;
}

export interface MatchPlayer {
  name: string;
  shooterUid: string;
  shooterLevel: number;
  /** Bu oyuncunun kazandığı tasolar */
  won: TableTile[];
  shots: number;
  successfulShots: number;
  perfectShots: number;
}

export type MatchPhase = 'playing' | 'roundOver';

export interface MatchState {
  roomId: RoomId;
  round: number;
  players: [MatchPlayer, MatchPlayer];
  table: TableTile[];
  turn: PlayerIndex;
  phase: MatchPhase;
}

export interface StakeTile {
  uid: string;
  catalogId: string;
}

export interface PlayerSetup {
  name: string;
  stakes: StakeTile[];
  shooterUid: string;
  shooterLevel: number;
}

export interface ShotResult {
  state: MatchState;
  flipped: TableTile[];
  chance: number;
  rolls: number;
  grade: ShotGrade;
  shooter: PlayerIndex;
}

export function levelBonus(level: number): number {
  const lv = Math.min(Math.max(Math.floor(level), BALANCE.minLevel), BALANCE.maxLevel);
  const tiers = Math.floor(lv / 100);
  return Math.min(tiers * BALANCE.levelBonusPerHundred, BALANCE.levelBonusCap);
}

export function flipChance(grade: ShotGrade, level: number): number {
  const p = BALANCE.baseFlipChance + BALANCE.timingBonus[grade] + levelBonus(level);
  return Math.min(p, 0.95);
}

export function other(p: PlayerIndex): PlayerIndex {
  return p === 0 ? 1 : 0;
}

export function createRound(
  roomId: RoomId,
  setups: [PlayerSetup, PlayerSetup],
  rng: Rng = defaultRng,
  previous?: MatchState,
): MatchState {
  const room = ROOM_BY_ID[roomId];
  const seen = new Set<string>();
  setups.forEach((s) => {
    if (s.stakes.length !== room.stakeCount) {
      throw new Error(`${room.name}: ${room.stakeCount} taso gerekli, ${s.stakes.length} verildi`);
    }
    if (s.stakes.some((t) => t.uid === s.shooterUid)) {
      throw new Error('Atış tasosu ortaya konamaz');
    }
    s.stakes.forEach((t) => {
      if (seen.has(t.uid)) throw new Error('Aynı taso iki kez kullanılamaz');
      seen.add(t.uid);
    });
  });
  const tiles: TableTile[] = setups.flatMap((s, i) =>
    s.stakes.map((t) => ({
      uid: t.uid,
      catalogId: t.catalogId,
      owner: i as PlayerIndex,
      faceUp: rng() < 0.5,
    })),
  );
  const mk = (s: PlayerSetup, idx: 0 | 1): MatchPlayer => ({
    name: s.name,
    shooterUid: s.shooterUid,
    shooterLevel: s.shooterLevel,
    won: [],
    shots: previous ? previous.players[idx].shots : 0,
    successfulShots: previous ? previous.players[idx].successfulShots : 0,
    perfectShots: previous ? previous.players[idx].perfectShots : 0,
  });
  return {
    roomId,
    round: (previous?.round ?? 0) + 1,
    players: [mk(setups[0], 0), mk(setups[1], 1)],
    table: shuffle(tiles, rng),
    turn: rng() < 0.5 ? 0 : 1,
    phase: 'playing',
  };
}

export function resolveShot(
  state: MatchState,
  grade: ShotGrade,
  rng: Rng = defaultRng,
): ShotResult {
  if (state.phase !== 'playing') throw new Error('Tur bitti, atış yapılamaz');
  const shooter = state.turn;
  const me = state.players[shooter];
  const chance = flipChance(grade, me.shooterLevel);
  const rolls = BALANCE.rollsPerShot[grade];

  let remaining = state.table.slice();
  const flipped: TableTile[] = [];
  for (let i = 0; i < rolls && remaining.length > 0; i++) {
    if (rng() < chance) {
      const idx = Math.floor(rng() * remaining.length);
      const [t] = remaining.splice(idx, 1);
      flipped.push({ ...t, faceUp: !t.faceUp });
    }
  }

  const players: [MatchPlayer, MatchPlayer] = [state.players[0], state.players[1]];
  players[shooter] = {
    ...me,
    won: [...me.won, ...flipped],
    shots: me.shots + 1,
    successfulShots: me.successfulShots + (flipped.length > 0 ? 1 : 0),
    perfectShots: me.perfectShots + (grade === 'perfect' ? 1 : 0),
  };
  remaining = remaining.slice();
  const over = remaining.length === 0;
  const next: MatchState = {
    ...state,
    players,
    table: remaining,
    phase: over ? 'roundOver' : 'playing',
    turn: over ? state.turn : other(shooter),
  };
  return { state: next, flipped, chance, rolls, grade, shooter };
}

export type Outcome = 'win0' | 'win1' | 'draw';

export function matchOutcome(state: MatchState): Outcome {
  const a = state.players[0].won.length;
  const b = state.players[1].won.length;
  return a === b ? 'draw' : a > b ? 'win0' : 'win1';
}

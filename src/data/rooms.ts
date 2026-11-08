import type { RoomConfig } from '../types';

export const ROOMS: RoomConfig[] = [
  {
    id: 'acemi',
    name: 'ACEMİ ARENA',
    description: 'Herkes 3 taso koyar · masada 6 taso',
    stakeCount: 3,
    barPeriodMs: 1900,
    barHalfWidth: 0.11,
    gradient: 'from-emerald-500 to-teal-700',
  },
  {
    id: 'usta',
    name: 'USTA ARENA',
    description: 'Herkes 5 taso koyar · masada 10 taso',
    stakeCount: 5,
    barPeriodMs: 1500,
    barHalfWidth: 0.09,
    gradient: 'from-sky-500 to-indigo-700',
  },
  {
    id: 'efsane',
    name: 'EFSANE ARENA',
    description: 'Herkes 10 taso koyar · masada 20 taso',
    stakeCount: 10,
    barPeriodMs: 1200,
    barHalfWidth: 0.07,
    gradient: 'from-amber-500 to-rose-700',
  },
];

export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r])) as Record<
  RoomConfig['id'],
  RoomConfig
>;

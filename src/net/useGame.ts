import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomId } from '../types';
import type { MatchView, MeView, ShotBegin } from './protocol';

const TOKEN_KEY = 'taso.token';
const NAME_KEY = 'taso.name';

export function getStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function getToken(): string {
  try {
    let t = localStorage.getItem(TOKEN_KEY);
    if (!t || !/^[A-Za-z0-9-]{16,64}$/.test(t)) {
      t = crypto.randomUUID();
      localStorage.setItem(TOKEN_KEY, t);
    }
    return t;
  } catch {
    return crypto.randomUUID();
  }
}

export interface Game {
  socket: Socket | null;
  connected: boolean;
  everConnected: boolean;
  me: MeView | null;
  view: MatchView | null;
  error: string | null;
  clearError: () => void;
  clearMatch: () => void;
  joinQueue: (roomId: RoomId) => void;
  leaveQueue: () => void;
  setShooter: (uid: string) => void;
  confirmStakes: (uids: string[]) => void;
  decide: (cont: boolean) => void;
  leaveMatch: () => void;
  rescue: () => void;
  /** Gelen anlık görüntünün istemci zamanı (geri sayımlar için) */
  viewAt: number;
}

export function useGame(name: string | null): Game {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [me, setMe] = useState<MeView | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [viewAt, setViewAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!name) return;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* gizli mod */
    }
    const s = io({ auth: { token: getToken(), name }, transports: ['websocket', 'polling'] });
    sockRef.current = s;
    setSocket(s);
    s.on('connect', () => {
      setConnected(true);
      setEverConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => setError(e.message === 'xhr poll error' ? 'Sunucuya ulaşılamıyor' : e.message));
    s.on('me', (m: MeView) => setMe(m));
    s.on('match:snapshot', (v: MatchView) => {
      setView(v);
      setViewAt(performance.now());
    });
    s.on('shot:begin', (b: ShotBegin) => {
      setView((v) => (v ? { ...v, shot: b } : v));
      setViewAt(performance.now());
    });
    s.on('error:msg', (e: { message: string }) => setError(e.message));
    return () => {
      s.close();
      sockRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [name]);

  const emit = useCallback((event: string, payload: unknown = {}) => {
    sockRef.current?.emit(event, payload);
  }, []);

  return {
    socket,
    connected,
    everConnected,
    me,
    view,
    viewAt,
    error,
    clearError: () => setError(null),
    clearMatch: () => setView(null),
    joinQueue: (roomId) => emit('queue:join', { roomId }),
    leaveQueue: () => emit('queue:leave'),
    setShooter: (uid) => emit('shooter:set', { uid }),
    confirmStakes: (uids) => emit('match:stakes', { uids }),
    decide: (cont) => emit('round:decision', { continue: cont }),
    leaveMatch: () => emit('match:leave'),
    rescue: () => emit('rescue'),
  };
}

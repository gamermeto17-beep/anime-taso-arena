import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomId } from '../types';
import type { MatchView, MeView, ShotBegin, XpResultMsg } from './protocol';

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
  setFlag: (uid: string, field: 'favorite' | 'locked', value: boolean) => void;
  uploadXp: (targetUid: string, sourceUids: string[]) => void;
  xpResult: XpResultMsg | null;
  clearXpResult: () => void;
  /** Oturum geçersiz (süresi dolmuş/silinmiş): kullanıcı yeniden giriş yapmalı */
  authFailed: boolean;
  /** Gelen anlık görüntünün istemci zamanı (geri sayımlar için) */
  viewAt: number;
}

export function useGame(token: string | null): Game {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const [me, setMe] = useState<MeView | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [viewAt, setViewAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [xpResult, setXpResult] = useState<XpResultMsg | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!token) return;
    setAuthFailed(false);
    const s = io({ auth: { token }, transports: ['websocket', 'polling'] });
    sockRef.current = s;
    setSocket(s);
    s.on('connect', () => {
      setConnected(true);
      setEverConnected(true);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => {
      if (e.message === 'Oturum geçersiz' || e.message === 'Oturum gerekli' || e.message === 'Hesap bulunamadı') {
        s.close(); // yeniden denemeyi bırak
        setAuthFailed(true);
        return;
      }
      setError(e.message === 'xhr poll error' ? 'Sunucuya ulaşılamıyor' : e.message);
    });
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
    s.on('xp:result', (r: XpResultMsg) => setXpResult(r));
    return () => {
      s.close();
      sockRef.current = null;
      setSocket(null);
      setConnected(false);
      setMe(null);
      setView(null);
    };
  }, [token]);

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
    setFlag: (uid, field, value) => emit('taso:flag', { uid, field, value }),
    uploadXp: (targetUid, sourceUids) => emit('taso:xp', { targetUid, sourceUids }),
    xpResult,
    clearXpResult: () => setXpResult(null),
    authFailed,
  };
}

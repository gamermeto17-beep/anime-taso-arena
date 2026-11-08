import { useCallback, useEffect, useRef, useState } from 'react';
import { gradeShot, pointerAt, type TimingResult } from '../engine/timing';

interface Props {
  periodMs: number;
  halfWidth: number;
  /** Kırmızı bölge merkezi (0..1, 0 = alt) */
  center: number;
  active: boolean;
  /** Sunucudan gelen, atış başladığından beri geçen süre (yeniden bağlanma) */
  offsetMs?: number;
  onStop: (r: TimingResult & { pointer: number; elapsedMs: number }) => void;
}

/**
 * Dikey zamanlama barı. İbre konumu yalnızca (geçen süre, periyot) ile belirlenir
 * ve tıklama anı olarak olayın kendi zaman damgası kullanılır; böylece render
 * gecikmesi oyuncuyu haksız yere cezalandırmaz.
 */
export function TimingBar({ periodMs, halfWidth, center, active, offsetMs = 0, onStop }: Props) {
  const startRef = useRef(0);
  const doneRef = useRef(false);
  const rafRef = useRef(0);
  const [pos, setPos] = useState(0);
  const [stopped, setStopped] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    doneRef.current = false;
    setStopped(null);
    startRef.current = performance.now() - offsetMs;
    const loop = () => {
      if (doneRef.current) return;
      setPos(pointerAt(performance.now() - startRef.current, periodMs));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, periodMs, center, offsetMs]);

  const stop = useCallback(
    (eventTime: number) => {
      if (!active || doneRef.current) return;
      doneRef.current = true;
      cancelAnimationFrame(rafRef.current);
      const elapsed = Math.max(0, eventTime - startRef.current);
      const p = pointerAt(elapsed, periodMs);
      setPos(p);
      setStopped(p);
      onStop({ ...gradeShot(p, center, halfWidth), pointer: p, elapsedMs: elapsed });
    },
    [active, center, halfWidth, onStop, periodMs],
  );

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        stop(e.timeStamp);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);

  const shown = stopped ?? pos;

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="timing-bar"
        role="button"
        aria-label="Atış zamanlama barı"
        onPointerDown={(e) => {
          e.preventDefault();
          stop(e.timeStamp);
        }}
        style={{ opacity: active || stopped !== null ? 1 : 0.5 }}
      >
        <div
          className="timing-zone"
          style={{ bottom: `${(center - halfWidth) * 100}%`, height: `${halfWidth * 2 * 100}%` }}
        />
        <div className="timing-center" style={{ bottom: `${center * 100}%` }} />
        <div className="timing-pointer" style={{ bottom: `calc(${shown * 100}% - 4px)` }} />
      </div>
      <button
        className="btn btn-primary w-36"
        disabled={!active}
        onPointerDown={(e) => {
          e.preventDefault();
          stop(e.timeStamp);
        }}
      >
        ATIŞ!
      </button>
    </div>
  );
}

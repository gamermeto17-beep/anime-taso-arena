import { useEffect, useState } from 'react';

/** Sunucudan gelen "kalan süre"yi (ms) istemci saatiyle saniye saniye geri sayar. */
export function useCountdown(remainingMs: number, receivedAt: number): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.ceil((remainingMs - (now - receivedAt)) / 1000));
}

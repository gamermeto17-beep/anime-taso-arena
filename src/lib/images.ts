import { useEffect, useState } from 'react';

/**
 * Karakter görselleri public/assets/tasos/manifest.json içinden bulunur
 * (id -> dosya yolu). Manifest `npm run gorsel:manifest` / `gorsel:ice` ile üretilir.
 * Manifestte olmayan tasolar şık geçici yüzle gösterilir; 404 gürültüsü oluşmaz.
 */
type Manifest = Record<string, string>;
let manifestPromise: Promise<Manifest> | null = null;
let manifestCache: Manifest | null = null;

export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch('/assets/tasos/manifest.json')
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => (j && typeof j === 'object' ? (j as Manifest) : {}))
    .catch(() => ({}))
    .then((m) => (manifestCache = m));
  return manifestPromise;
}

export function useTasoImage(id: string): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    manifestCache && manifestCache[id] ? `/assets/tasos/${manifestCache[id]}` : null,
  );
  useEffect(() => {
    let alive = true;
    void loadManifest().then((m) => {
      if (alive) setSrc(m[id] ? `/assets/tasos/${m[id]}` : null);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return src;
}

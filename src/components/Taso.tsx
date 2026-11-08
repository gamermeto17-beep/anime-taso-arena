import type { CSSProperties } from 'react';
import { useTasoImage } from '../lib/images';
import { Emblem } from './Emblem';
import { SERIES_BY_ID } from '../data/series';
import type { CatalogEntry, Rarity } from '../types';

const RIM: Record<Rarity, string> = {
  common: '#cbd5e1',
  rare: '#38bdf8',
  epic: '#c084fc',
  legendary: '#fbbf24',
};
const EDGE: Record<Rarity, string> = {
  common: '#64748b',
  rare: '#0369a1',
  epic: '#7e22ce',
  legendary: '#b45309',
};
export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Yaygın',
  rare: 'Nadir',
  epic: 'Epik',
  legendary: 'Efsanevi',
};

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} .-]/gu, '').split(/[ .-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

interface Props {
  entry: CatalogEntry;
  size?: number | string;
  face?: 'front' | 'back';
  level?: number;
  className?: string;
  style?: CSSProperties;
  showName?: boolean;
}

export function Taso({ entry, size = 96, face = 'front', level, className, style, showName = true }: Props) {
  const series = SERIES_BY_ID[entry.seriesId];
  const imgSrc = useTasoImage(entry.id);
  const imgOk = imgSrc !== null;
  const sizeCss = typeof size === 'number' ? `${size}px` : size;

  const c1 = `hsl(${series.hue} 85% 62%)`;
  const c2 = `hsl(${series.accentHue} 70% 28%)`;

  return (
    <div
      className={`taso ${className ?? ''}`}
      data-face={face}
      style={
        {
          '--size': sizeCss,
          '--rim': RIM[entry.rarity],
          '--edge': EDGE[entry.rarity],
          '--c1': c1,
          '--c2': c2,
          ...style,
        } as CSSProperties
      }
    >
      <div className="taso-inner">
        {/* ÖN YÜZ */}
        <div className="taso-face taso-front">
          {/* Eksik görsel için şık geçici yüz; gerçek görsel public/assets/tasos/ altına konunca otomatik gelir. */}
          {imgSrc && (
            <img
              src={imgSrc}
              alt={entry.name}
              draggable={false}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
          {!imgOk && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: `conic-gradient(from 0deg, hsl(${series.hue} 80% 55% / .35), transparent 25%, hsl(${series.accentHue} 80% 55% / .35) 50%, transparent 75%, hsl(${series.hue} 80% 55% / .35))`,
              }}
            >
              <div
                style={{
                  fontWeight: 900,
                  fontSize: `calc(${sizeCss} * 0.34)`,
                  lineHeight: 1,
                  color: '#fff',
                  textShadow: '0 2px 0 rgba(0,0,0,.45)',
                  letterSpacing: '-0.03em',
                }}
              >
                {initials(entry.name)}
              </div>
              {showName && (
                <div
                  style={{
                    marginTop: `calc(${sizeCss} * 0.04)`,
                    fontSize: `calc(${sizeCss} * 0.105)`,
                    fontWeight: 800,
                    textAlign: 'center',
                    lineHeight: 1.05,
                    color: '#fff',
                    maxWidth: '78%',
                    textShadow: '0 1px 2px rgba(0,0,0,.7)',
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {entry.name}
                </div>
              )}
              <div
                style={{
                  marginTop: `calc(${sizeCss} * 0.03)`,
                  fontSize: `calc(${sizeCss} * 0.085)`,
                  color: 'rgba(255,255,255,.8)',
                  fontWeight: 700,
                }}
              >
                #{String(entry.number).padStart(3, '0')}
              </div>
            </div>
          )}
          {level !== undefined && (
            <div
              style={{
                position: 'absolute',
                bottom: '6%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,.65)',
                color: '#fde047',
                fontSize: `calc(${sizeCss} * 0.11)`,
                fontWeight: 900,
                borderRadius: 99,
                padding: '0 .5em',
              }}
            >
              Sv {level}
            </div>
          )}
          <div className="taso-shine" />
        </div>

        {/* ARKA YÜZ: seriye özel desen */}
        <div
          className="taso-face taso-back"
          style={{
            background:
              series.pattern === 'rays'
                ? `repeating-conic-gradient(from 0deg, hsl(${series.hue} 85% 52%) 0 12deg, hsl(${series.accentHue} 70% 24%) 12deg 24deg)`
                : `repeating-radial-gradient(circle at 50% 120%, hsl(${series.hue} 80% 45%) 0 7%, hsl(${series.accentHue} 80% 65%) 7% 14%)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '22%',
              borderRadius: '50%',
              background: `radial-gradient(circle at 35% 30%, #fff8, ${c2})`,
              boxShadow: 'inset 0 0 0 3px rgba(255,255,255,.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 900,
              fontSize: `calc(${sizeCss} * 0.2)`,
              textShadow: '0 1px 2px #000a',
            }}
          >
            {series.emblem ? (
              <div style={{ width: '78%', height: '78%' }}>
                <Emblem kind={series.emblem} dark={c2} />
              </div>
            ) : (
              series.name[0]
            )}
          </div>
          <div className="taso-shine" />
        </div>
      </div>
    </div>
  );
}

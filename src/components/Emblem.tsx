import type { EmblemKind } from '../types';

/** Telifsiz, bu proje için çizilmiş genel semboller (hiçbir resmi logo değildir). */
function spiralPath(): string {
  const pts: string[] = [];
  for (let t = 0; t <= Math.PI * 6; t += 0.18) {
    const r = 3 + t * 1.85;
    pts.push(`${(50 + r * Math.cos(t)).toFixed(1)},${(50 + r * Math.sin(t)).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
}
const SPIRAL = spiralPath();

export function Emblem({ kind, color = '#fff', dark = '#0b1020' }: { kind: EmblemKind; color?: string; dark?: string }) {
  if (kind === 'swirl') {
    return (
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
        <path d={SPIRAL} fill="none" stroke={color} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="50" cy="50" r="4" fill={color} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
      {/* çapraz kemikler */}
      <g stroke={color} strokeWidth="7" strokeLinecap="round">
        <line x1="20" y1="22" x2="80" y2="78" />
        <line x1="80" y1="22" x2="20" y2="78" />
      </g>
      {[[18, 18], [82, 18], [18, 82], [82, 82], [14, 27], [86, 27], [14, 73], [86, 73]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5.5" fill={color} />
      ))}
      {/* kafatası */}
      <circle cx="50" cy="45" r="22" fill={color} stroke={dark} strokeWidth="2.5" />
      <rect x="38" y="58" width="24" height="16" rx="5" fill={color} stroke={dark} strokeWidth="2.5" />
      <circle cx="42" cy="45" r="6" fill={dark} />
      <circle cx="58" cy="45" r="6" fill={dark} />
      <path d="M50 52 L46 60 L54 60 Z" fill={dark} />
      <path d="M44 66 V73 M50 66 V73 M56 66 V73" stroke={dark} strokeWidth="2" />
    </svg>
  );
}

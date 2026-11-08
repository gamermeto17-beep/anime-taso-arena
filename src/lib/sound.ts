let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}
export function isSoundEnabled() {
  return enabled;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, delay = 0, slideTo?: number) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export const sfx = {
  tap: () => tone(520, 0.08, 'square', 0.06),
  throw: () => tone(700, 0.35, 'sawtooth', 0.08, 0, 160),
  hit: () => {
    tone(140, 0.18, 'triangle', 0.25);
    tone(90, 0.25, 'sine', 0.25, 0.02);
  },
  flip: () => tone(880, 0.12, 'triangle', 0.1, 0.05, 1320),
  perfect: () => {
    [660, 880, 1100, 1320].forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, i * 0.07));
  },
  miss: () => tone(220, 0.25, 'sine', 0.1, 0, 120),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, i * 0.12)),
};

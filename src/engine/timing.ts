import { BALANCE } from './balance';
import type { ShotGrade } from '../types';

/**
 * İbre konumu 0 (alt) ile 1 (üst) arasında üçgen dalga olarak hareket eder.
 * Konum yalnızca (geçen süre, periyot) ile belirlenir; bu sayede sunucu da
 * aynı fonksiyonla, istemcinin bildirdiği süreden konumu yeniden hesaplayabilir.
 */
export function pointerAt(elapsedMs: number, periodMs: number): number {
  const phase = (((elapsedMs % periodMs) + periodMs) % periodMs) / periodMs; // 0..1
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

export interface TimingResult {
  grade: ShotGrade;
  /** Merkeze uzaklık / yarı genişlik (0 = tam merkez, 1 = bölge kenarı). */
  ratio: number;
  /** 0..1 arası yakınlık puanı (1 = mükemmel). */
  accuracy: number;
}

export function gradeShot(pointer: number, center: number, halfWidth: number): TimingResult {
  const ratio = Math.abs(pointer - center) / halfWidth;
  const accuracy = Math.max(0, 1 - ratio);
  let grade: ShotGrade = 'weak';
  if (ratio <= BALANCE.perfectRatio) grade = 'perfect';
  else if (ratio <= BALANCE.goodRatio) grade = 'good';
  return { grade, ratio, accuracy };
}

/**
 * Gecikme toleransı: istemci kendi yerel saatiyle "başlangıçtan tıklamaya kadar
 * geçen süreyi" bildirir; sunucu bu süreyi RTT'den bağımsız olarak kullanır ve
 * yalnızca makul sınırlar içindeyse kabul eder (Aşama 2'de kullanılacak).
 */
export function clampReportedElapsed(
  reportedMs: number,
  serverElapsedMs: number,
  toleranceMs = 250,
  maxLagMs = 3000,
): number {
  // İstemci barı, 'shot:begin' mesajı ona ulaştıktan sonra başlatır; bildirdiği süre bu yüzden
  // sunucunun ölçtüğünden (gecikme kadar) kısadır. Gerçekçi pencerenin dışı sıkıştırılır.
  const hi = serverElapsedMs + toleranceMs;
  const lo = Math.max(0, serverElapsedMs - maxLagMs);
  return Math.min(Math.max(reportedMs, lo), hi);
}

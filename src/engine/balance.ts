/**
 * Oyun dengesi parametreleri — tek yerden ayarlanır.
 * Sunucu (Aşama 2) da aynı dosyayı kullanacak.
 */
export const BALANCE = {
  /** Her çevirme denemesinin temel başarı ihtimali. */
  baseFlipChance: 0.2,
  /** Atış kalitesine göre ek ihtimal (yüzde puanı / 100). */
  timingBonus: { perfect: 0.3, good: 0.15, weak: 0 },
  /** Atış kalitesine göre tek atışta yapılan çevirme denemesi sayısı. */
  rollsPerShot: { perfect: 3, good: 2, weak: 1 },
  /** Atış sınıfı eşikleri: |ibre - merkez| / yarıGenişlik oranı. */
  perfectRatio: 0.15,
  goodRatio: 0.65,
  /** Seviye bonusu: her 100 seviyede +3 puan, toplam en fazla +15 puan. */
  levelBonusPerHundred: 0.03,
  levelBonusCap: 0.15,
  maxLevel: 500,
  /** Başlangıç seviyesi. */
  minLevel: 1,
} as const;

export type Balance = typeof BALANCE;

// Yardim Sayac - barkod yazicisina gonderildiginde kaydi tutulan yardim
// turleri. Bu dort tur DISINDAKI yazdirmalar sayaca islenmez.
// Degerler, dosya yardim kayitlarindaki `type` etiketleriyle BIREBIR ayni
// olmali (bkz. lib/services/legacyDesigns.service.ts tur haritasi).
export const TRACKED_YARDIM_TURLERI = [
  'Gıda Bankası',
  'Dönem Dışı Gıda',
  'Destek Paketi',
  'Giyim',
] as const

export type TrackedYardimTuru = (typeof TRACKED_YARDIM_TURLERI)[number]

export function isTrackedYardimTuru(value: unknown): value is TrackedYardimTuru {
  return typeof value === 'string' && (TRACKED_YARDIM_TURLERI as readonly string[]).includes(value)
}

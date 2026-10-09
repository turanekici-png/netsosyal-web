import 'server-only'

import { prisma } from '@/lib/db/prisma'

// Kullanici istegi (28 Agustos 2026): "Cop Kutusu"nda (silinen kayitlar)
// bir kayit yalnizca 30 GUN saklanir - suresi gecenler kalici olarak
// silinir. Cop Kutusu, `sistem_hareket_log` tablosundaki "sil" tipi
// hareketlerin `eski_deger` (silinmeden onceki tam kayit) snapshot'undan
// beslenir (bkz. app/api/logs/route.ts, app/api/logs/restore/route.ts).
// 30 gunu gecen "sil" hareketleri buradan temizlenir - snapshot da gider,
// yani o kayit artik geri alinamaz.
//
// Uygulama: kurum ici iletisim saklama temizligi (communicationRetention.
// service.ts) ile AYNI desen - saatte en fazla bir kez, ilgili API
// cagrilarinda tetiklenen "atesle ve unut" temizlik.

export const TRASH_RETENTION_DAYS = 30

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

// "sil" hareketini yakalayan kosul - app/api/logs/route.ts'teki DELETE_MATCH
// ile AYNI mantik.
const DELETE_MATCH_SQL = `(
  islem_tipi ILIKE '%sil%' OR islem_tipi ILIKE '%delete%'
  OR COALESCE(aciklama, '') ILIKE '%sil%' OR COALESCE(aciklama, '') ILIKE '%delete%'
)`

const globalForTrashRetention = globalThis as unknown as {
  trashRetentionLastCleanupAt?: number
  trashRetentionCleanupPromise?: Promise<void> | null
}

async function cleanupExpiredTrash() {
  // Ilk calismada 30 gunu asan on binlerce "sil" hareketi olabilir -
  // tek bir dev DELETE uzak veritabaninda uzun kilit/sisme yaratir.
  // Bu yuzden 5000'lik PARTILER halinde, en fazla 40 tur (=200k satir)
  // silinir; kalani bir sonraki saatlik turda temizlenir.
  // "geri_al" hareketleri haric tutulur (silme snapshot'i tasimazlar).
  const BATCH = 5000
  const MAX_ROUNDS = 40
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const deleted = await prisma.$executeRawUnsafe(
      `
        DELETE FROM sistem_hareket_log
        WHERE id IN (
          SELECT id FROM sistem_hareket_log
          WHERE ${DELETE_MATCH_SQL}
            AND islem_tipi NOT ILIKE '%geri%'
            AND tarih < (now() - interval '${TRASH_RETENTION_DAYS} days')
          LIMIT ${BATCH}
        )
      `,
    )
    if (!deleted || deleted < BATCH) break
  }
}

export function scheduleTrashRetentionCleanup() {
  const now = Date.now()
  const lastCleanupAt = globalForTrashRetention.trashRetentionLastCleanupAt || 0
  if (globalForTrashRetention.trashRetentionCleanupPromise || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return

  globalForTrashRetention.trashRetentionLastCleanupAt = now
  globalForTrashRetention.trashRetentionCleanupPromise = cleanupExpiredTrash()
    .catch((error) => {
      globalForTrashRetention.trashRetentionLastCleanupAt = 0
      console.error('[Çöp Kutusu] 30 gün saklama temizliği başarısız:', error)
    })
    .finally(() => {
      globalForTrashRetention.trashRetentionCleanupPromise = null
    })
}

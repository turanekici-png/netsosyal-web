import { prisma } from '@/lib/db/prisma'

// Kullanici istegi: Ayni/Nakdi muracaatinda "Yardım Kişileri (TC)" alanina
// girilen TC kimlik no'lari - bu TEK dogru kaynak, hem canli/UI amacli
// kontrol ucu (app/api/documents/applications/check-person-tc) hem de
// asil kaydetme/guncelleme (app/api/documents/applications) tarafindan
// kullanilir. HER TC ICIN EN FAZLA 1 nakit yardimi yapilabilir kurali:
// HALEN BEKLEYEN (durumu = 0) BASKA bir muracaatta zaten kayitli bir TC
// varsa, o TC "cakisan" sayilir.
export type AssistPersonTcConflict = {
  tc: string
  recordId: string
  dosyaNo: string
  applicantName: string
}

export async function findConflictingAssistPersonTcs(
  tcs: string[],
  excludeRecordId?: string | null,
): Promise<AssistPersonTcConflict[]> {
  if (tcs.length === 0) return []
  const tcSet = new Set(tcs)
  const normalizedExcludeId = excludeRecordId && /^\d+$/.test(excludeRecordId) ? excludeRecordId : null

  const rows = await prisma.$queryRaw<{
    record_id: bigint
    dosyano: string | null
    muracaateden: string | null
    yardimkisitc: string | null
  }[]>`
    SELECT
      t.id::bigint AS record_id,
      d.dosyano::text AS dosyano,
      t.muracaateden,
      t.yardimkisitc::text AS yardimkisitc
    FROM yrd_ayninakti t
    LEFT JOIN dosyalar d ON d.id = t.dosyaid
    WHERE t.durumu = 0
      AND t.yardimkisitc IS NOT NULL
      AND t.yardimkisitc <> ''
      AND (${normalizedExcludeId}::bigint IS NULL OR t.id <> ${normalizedExcludeId}::bigint)
  `

  const matches: AssistPersonTcConflict[] = []
  for (const row of rows) {
    const recordTcs = (row.yardimkisitc || '').split('-').map((tc) => tc.trim())
    for (const tc of recordTcs) {
      if (tcSet.has(tc)) {
        matches.push({
          tc,
          recordId: row.record_id.toString(),
          dosyaNo: row.dosyano || '-',
          applicantName: row.muracaateden || '-',
        })
      }
    }
  }
  return matches
}

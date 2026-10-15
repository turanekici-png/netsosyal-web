import { prisma } from '@/lib/db/prisma'
import { ensureMonthlyFoodBankPeriods } from '@/lib/services/foodBankPeriod.service'
import { ensureMonthlySupportPackagePeriods } from '@/lib/services/supportPackagePeriod.service'

const EXPIRING_ASSISTANCE_TABLES = [
  'yrd_ekmek',
  'yrd_gidabankasi',
  'yrd_destekpaketi',
  'yrd_haziryemek',
  'yrd_ddgidadosyali',
] as const

const globalForAssistanceExpiry = globalThis as unknown as {
  assistanceExpiryRunDate?: string
  assistanceExpiryPromise?: Promise<void>
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export async function updateExpiredAssistanceStatuses() {
  const key = todayKey()

  if (globalForAssistanceExpiry.assistanceExpiryRunDate === key) {
    return
  }

  if (globalForAssistanceExpiry.assistanceExpiryPromise) {
    await globalForAssistanceExpiry.assistanceExpiryPromise
    return
  }

  globalForAssistanceExpiry.assistanceExpiryPromise = (async () => {
    await ensureMonthlyFoodBankPeriods()
    await ensureMonthlySupportPackagePeriods()

    for (const tableName of EXPIRING_ASSISTANCE_TABLES) {
      // 2026-10-15: Kış Dönemi yardimlarini winterSeasonalAid.service.ts
      // bitiste 3 "İptal Edildi" yapar - burada 4'e cekilmez.
      const kisDonemiHaric = tableName === 'yrd_ddgidadosyali' ? '' : ` AND COALESCE(donem, '') <> 'Kış Dönemi'`
      await prisma.$executeRawUnsafe(
        // 2026-10-15: kesilen yardimin donemi "Kapalı" (ddgidadosyali'da donem yok)
        `UPDATE ${tableName}
         SET durumu = 4,
             durumutarih = CURRENT_DATE${tableName === 'yrd_ddgidadosyali' ? '' : ", donem = 'Kapalı'"}
         WHERE bittarih IS NOT NULL
           AND bittarih <= CURRENT_DATE
           AND durumu = 2${kisDonemiHaric}`,
      )
    }

    globalForAssistanceExpiry.assistanceExpiryRunDate = key
  })()

  try {
    await globalForAssistanceExpiry.assistanceExpiryPromise
  } finally {
    globalForAssistanceExpiry.assistanceExpiryPromise = undefined
  }
}

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { foldTurkish } from '@/lib/utils'

// Kullanici istegi (2026-10-08): "65 mahalleyi yakinlik sirasina gore
// birkac gruba ayiracagim, sonra bu mahalle gruplarini bir tahkikat
// personeline tanimlayacagim ... bu personellere ait paketler HER AY
// degisecek, bir tahkikat personeli digerinin dosyalarini gormeyecek."
//
// Veri modeli: "paket" (ekip) dogrudan bir mahalle listesi tutar:
//   tahkikat_paketleri (id, ad, sira, mahalleler jsonb[string])
// Sahiplik (hangi tarihte hangi personele ait) AYRI bir takvim tablosunda
// tutulur - bkz. ./schedule.ts (tahkikat_atama_takvimi). ONCEKI surumde
// (2026-10-08, 1-4. turlar) burada OTOMATIK "ayin kacinci ayi, kac
// personel var" formulu vardi - kullanici istegi (5. tur): "admin'in elle
// belirlediği özel tarihler" secilince bu formul KALDIRILDI, yerini
// schedule.ts'teki takvime birakti.
export async function ensureTahkikatPaketleriTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.tahkikat_paketleri (
      id BIGSERIAL PRIMARY KEY,
      ad TEXT NOT NULL,
      sira INTEGER NOT NULL DEFAULT 0,
      mahalleler JSONB NOT NULL DEFAULT '[]'::jsonb,
      olusturulmatarihi TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      guncellemetarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

export type TahkikatPaket = {
  id: string
  ad: string
  sira: number
  mahalleler: string[]
}

export type PersonelEntry = { id: string; name: string }

export function resolveOwnerForNeighborhood(mahalleToOwnerId: Map<string, string>, neighborhood: string): string | null {
  const normalized = foldTurkish(neighborhood).trim()
  if (!normalized) return null
  return mahalleToOwnerId.get(normalized) ?? null
}

type PaketMahalleRow = { id: bigint | number | string; mahalleler: unknown }

// Kullanici istegi (2026-10-08, 3. tur): "bir mahalleyi bir ekipten
// çıkararak başka ekibe ekleyebilelim" - bir mahalle AYNI ANDA en fazla
// BIR ekipte olmalidir (aksi halde hangi ekibin gecerli oldugu
// belirsizlesir). Bu yuzden bir ekibin mahalle listesi kaydedildiginde, o
// mahalleler DIGER TUM ekiplerden OTOMATIK cikarilir - kullanicinin "once
// eski ekipten cikar, sonra yeni ekibe ekle" diye iki ayri islem yapmasina
// gerek kalmaz.
export async function stripMahallelerFromOtherPaketler(
  tx: Prisma.TransactionClient,
  excludePaketId: bigint | null,
  mahalleler: string[],
) {
  if (mahalleler.length === 0) return

  const rows = excludePaketId
    ? await tx.$queryRaw<PaketMahalleRow[]>`SELECT id, mahalleler FROM tahkikat_paketleri WHERE id != ${excludePaketId};`
    : await tx.$queryRaw<PaketMahalleRow[]>`SELECT id, mahalleler FROM tahkikat_paketleri;`

  const claimed = new Set(mahalleler)

  for (const row of rows) {
    const current = Array.isArray(row.mahalleler) ? row.mahalleler.filter((m): m is string => typeof m === 'string') : []
    const filtered = current.filter((m) => !claimed.has(m))
    if (filtered.length !== current.length) {
      await tx.$executeRaw`
        UPDATE tahkikat_paketleri SET mahalleler = ${JSON.stringify(filtered)}::jsonb, guncellemetarihi = NOW()
        WHERE id = ${row.id};
      `
    }
  }
}

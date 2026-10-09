import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { findConflictingAssistPersonTcs } from '@/lib/services/assistPersonTc.service'
import { isValidTcKimlikNo } from '@/lib/utils/tcKimlikNo'

export const dynamic = 'force-dynamic'

// Kullanici istegi: Ayni/Nakdi muracaatinda "Yardım Kişileri (TC)" alanina
// girilen bir TC kimlik no, HALEN BEKLEYEN (durumu = 0) baska bir muracaatin
// "yardimkisitc" listesinde ZATEN varsa (yani o kisiye ayni donemde/baska
// bir muracaatta zaten yardim yapilmasi planlanmissa - her TC icin EN FAZLA
// 1 nakit yardimi yapilabilir), kullaniciya hangi dosyada oldugunu gosteren
// bir uyari verilir - bkz. documents/page.tsx (assistPersonTcConflicts
// state'i, ilgili useEffect VE handleSaveApplication'daki sert/engelleyici
// tekrar-kontrol). Eslesme mantigi lib/services/assistPersonTc.service.ts
// icinde TEK yerde tutulur - kaydetme sirasindaki asil kontrol de AYNI
// fonksiyonu kullanir.
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ page: '/documents' })
    if (accessDenied) return accessDenied

    const body = (await request.json()) as { tcs?: unknown; excludeRecordId?: unknown }
    const tcs = Array.isArray(body.tcs)
      ? Array.from(new Set(body.tcs.filter((tc): tc is string => typeof tc === 'string' && isValidTcKimlikNo(tc))))
      : []
    const excludeRecordId = typeof body.excludeRecordId === 'string' ? body.excludeRecordId : null

    const matches = await findConflictingAssistPersonTcs(tcs, excludeRecordId)

    return NextResponse.json({ success: true, matches })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'TC kimlik no kontrolü yapılamadı.' },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'

export const dynamic = 'force-dynamic'

type DeletePayload = {
  ids?: Array<string | number>
}

export async function DELETE(request: Request) {
  // Kullanici istegi (2026-09-22): "yetkisi olmayan kullanıcı hiçbir işlem
  // yapamasın ... sadece arama yapabilsin ve başvuruları görebilsin" -
  // eskiden bu uc nokta SADECE sayfa erisimini (page: '/online') kontrol
  // ediyordu, "action" BELIRTILMEMISTI - lib/apiAuth.ts'deki kural geregi
  // bu, SAYFAYI GOREBILEN (sadece goruntuleme/arama icin yetkilendirilmis)
  // HERHANGI bir kullanicinin da kayit SILEBILMESI anlamina geliyordu -
  // diger islemlerle (duzenleme/toplu guncelleme/nakite aktarma) AYNI
  // "online.forms.manage" yetkisi zorunlu kilinarak duzeltildi.
  const accessResponse = await requireApiAccess({ action: 'online.forms.manage', page: '/online' })
  if (accessResponse) return accessResponse

  try {
    const body = await request.json().catch(() => ({})) as DeletePayload
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.map((id) => String(id).trim()).filter((id) => /^\d+$/.test(id))))
      : []

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt seçilmedi.' }, { status: 400 })
    }

    const pool = getSqlMonitorPool()
    const result = await pool.query(
      'DELETE FROM public.online_basvurular WHERE id = ANY($1::bigint[]);',
      [ids],
    )

    return NextResponse.json({
      success: true,
      data: { requested: ids.length, deleted: result.rowCount || 0 },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar silinemedi.' },
      { status: 500 },
    )
  }
}

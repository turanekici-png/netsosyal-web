import { NextResponse } from 'next/server'
import { getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { getProvisioningState, runProvisioning } from '@/lib/services/provisioning.service'

export const dynamic = 'force-dynamic'

// POST - HERKESE AÇIK (oturum gerektirmez - kurulum anında henüz kimse
// giriş yapamaz, bkz. middleware.ts). "/kurulum" sayfasındaki "Kurulumu
// Onayla ve Başlat" butonu buraya bağlanır. GÜVENLİK: bu uç nokta sadece
// sistem GERÇEKTEN "needs-setup" durumundaysa bir şey yapar - zaten kurulu
// (canlı, veri dolu) bir sisteme karşı çağrılırsa hiçbir etkisi olmaz (bkz.
// runProvisioning'in en baştaki durum kontrolü).
export async function POST(request: Request) {
  const stateBefore = await getProvisioningState()
  if (stateBefore.status === 'ready') {
    return NextResponse.json({ success: true, message: 'Sistem zaten kurulu.' })
  }

  const result = await runProvisioning(getAuditMetaFromRequest(request))

  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, message: result.message })
}

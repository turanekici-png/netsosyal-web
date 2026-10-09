import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getWolvoxConnectionConfig, testWolvoxConnection } from '@/lib/services/wolvox.service'

export const dynamic = 'force-dynamic'

// Kaydetmeden ONCE formdaki degerlerle de test edilebilsin diye - body'de
// gecerli bir "host" gelirse O bilgilerle, gelmezse (ör. sayfa acilista
// kayitli baglantiyi hemen test etmek icin) kayitli ayarlarla dener.
export async function POST(request: Request) {
  const accessDenied = await requireApiAccess({ page: '/muhasebe' })
  if (accessDenied) return accessDenied

  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>))
    const bodyHost = typeof body.host === 'string' ? body.host.trim() : ''

    const config = bodyHost
      ? {
          host: bodyHost,
          port: Number(body.port) || 3050,
          database: typeof body.database === 'string' ? body.database.trim() : '',
          user: typeof body.user === 'string' && body.user.trim() ? body.user.trim() : 'SYSDBA',
          password: typeof body.password === 'string' ? body.password : '',
        }
      : await getWolvoxConnectionConfig()

    if (!config || !config.host || !config.database) {
      return NextResponse.json(
        { success: false, error: 'Bağlantı bilgileri eksik. Önce sunucu adresi ve veritabanı yolunu doldurun.' },
        { status: 400 },
      )
    }

    const result = await testWolvoxConnection(config)
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 502 })
    }

    return NextResponse.json({ success: true, tableCount: result.tableCount })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

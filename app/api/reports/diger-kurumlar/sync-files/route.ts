import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

// POST - "Diğer Kurumlar" raporundaki "Kayıtları Güncelle" butonu içindir.
//
// Kullanıcı isteği: daha önce "Diğer Kurumlardan Alınan Yardım" kaydı
// girilirken kişinin HENÜZ bir dosyası yoktu (dosyaid boş kaldı) - sonradan
// o kişi için bir dosya açılmış (bireyler tablosuna eklenmiş) olabilir. Bu
// buton TÜM "Diğer Kurumlar" kayıtlarının TC kimlik numarasını bireyler
// tablosunda arar; eşleşme bulunursa kaydın dosyaid'i, bulunan bireyler
// kaydının dosyaid'i İLE DEĞİŞTİRİLİR - böylece kayıt artık doğru dosyada
// görünür. Bu, app/api/assistance/nakit/sync-applications-to-files/
// route.ts'teki AYNI TC-eşleştirme mantığının (aynı öncelik sırasıyla:
// önce dosya sahibi bireyi, sonra "kendisi" yakınlığı, sonra ilk eşleşen)
// birebir eşdeğeridir - SADECE dosyasız kayıtlarla sınırlı değil, zaten
// (yanlış/eski) bir dosyaya bağlı kayıtlar da bireylerdeki GÜNCEL kayıtla
// uyuşmuyorsa doğru dosyaya taşınır. Sadece GERÇEKTEN DEĞİŞECEK kayıtlar
// işlenir - zaten doğru olanlara dokunulmaz.
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/reports/diger-kurumlar' })
    if (accessDenied) return accessDenied

    const updatedRows = await withAuditedWrite(
      (tx) => tx.$queryRaw<{ id: bigint; dosyaid: bigint }[]>`
        UPDATE yrd_digerkrmalyrdm t
        SET dosyaid = matched.dosyaid
        FROM (
          SELECT DISTINCT ON (t2.id)
            t2.id AS kayit_id,
            b.dosyaid AS dosyaid
          FROM yrd_digerkrmalyrdm t2
          JOIN bireyler b ON b.tckimlikno = t2.tckimlikno
          WHERE t2.tckimlikno IS NOT NULL
            AND BTRIM(t2.tckimlikno) <> ''
            AND b.dosyaid IS NOT NULL
            AND b.dosyaid IS DISTINCT FROM t2.dosyaid
          ORDER BY
            t2.id,
            CASE
              WHEN b.tipi = 1 THEN 0
              WHEN b.yakinligi = 0 THEN 1
              ELSE 2
            END,
            b.id ASC
        ) matched
        WHERE t.id = matched.kayit_id
        RETURNING t.id, t.dosyaid
      `,
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      data: {
        updatedCount: updatedRows.length,
      },
    })
  } catch (error) {
    console.error('Diger Kurumlar sync-files error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Kayıtlar güncellenemedi.' },
      { status: 500 },
    )
  }
}

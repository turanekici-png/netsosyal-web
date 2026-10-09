import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

// POST - Nakit Yardımı modülünün TÜM sekmelerinde (Müracaatlar, Yardımlar,
// İptal Edilenler) görünen "Müracaatları Güncelle" butonu içindir.
//
// Kullanıcı isteği (kesin akış): TÜM nakit yardımı müracaatlarının TC
// kimlik numarası bireyler tablosunda aranır; eşleşme bulunursa müracaatın
// dosyaid'i, bulunan bireyler kaydının dosyaid'i İLE DEĞİŞTİRİLİR - böylece
// müracaat, o TC'nin GERÇEKTEN kayıtlı olduğu dosyada görünür. Bu artık
// SADECE dosyasız müracaatlarla sınırlı değil - zaten (yanlış/eski) bir
// dosyaya bağlı müracaatlar da, bireylerdeki GÜNCEL kayıtla uyuşmuyorsa
// doğru dosyaya taşınır (ör. bir kişinin TC'si yanlışlıkla başka bir
// dosyadaki müracaata girilmiş olabilir - bkz. app/api/assistance/
// nakit/create-file/route.ts ve app/api/documents/transfer-person/
// route.ts'teki AYNI TC-eşleştirme mantığı - burada TEK SEFERDE, TÜM
// müracaatlar için toplu çalıştırılır). Sadece GERÇEKTEN DEĞİŞECEK
// kayıtlar (mevcut dosyaid'i bireylerdeki kayıttan FARKLI olanlar) işlenir
// - zaten doğru olanlara dokunulmaz.
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
    if (accessDenied) return accessDenied

    const updatedRows = await withAuditedWrite(
      (tx) => tx.$queryRaw<{ id: bigint; dosyaid: bigint }[]>`
        UPDATE yrd_ayninakti n
        SET dosyaid = matched.dosyaid
        FROM (
          SELECT DISTINCT ON (n2.id)
            n2.id AS nakit_id,
            b.dosyaid AS dosyaid
          FROM yrd_ayninakti n2
          JOIN bireyler b ON b.tckimlikno = n2.tckimlikno
          WHERE n2.tckimlikno IS NOT NULL
            AND BTRIM(n2.tckimlikno) <> ''
            AND b.dosyaid IS NOT NULL
            AND b.dosyaid IS DISTINCT FROM n2.dosyaid
          ORDER BY
            n2.id,
            CASE
              WHEN b.tipi = 1 THEN 0
              WHEN b.yakinligi = 0 THEN 1
              ELSE 2
            END,
            b.id ASC
        ) matched
        WHERE n.id = matched.nakit_id
        RETURNING n.id, n.dosyaid
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
    console.error('Nakit sync-applications-to-files error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Müracaatlar güncellenemedi.' },
      { status: 500 },
    )
  }
}

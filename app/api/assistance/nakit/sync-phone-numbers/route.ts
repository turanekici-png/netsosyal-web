import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

// POST - Nakit Yardımı modülünün TÜM sekmelerinde (Müracaatlar, Yardımlar,
// İptal Edilenler) görünen "Telefonları Kontrol Et" butonu içindir.
//
// Kullanıcı isteği: listedeki "Dosya Telefonu" sütununda bazen ESKİ/hatalı
// bir numara (ör. bir test kaydından kalma "555555555") görünüyor, oysa
// dosya sahibinin GERÇEK cep telefonu bireyler tablosunda doğru şekilde
// kayıtlı. Bu buton, Nakit Yardımı ile ilişkili (yrd_ayninakti'de en az bir
// kaydı olan) TÜM dosyaları tarar; her dosyanın SAHİBİNİN (bireyler.tipi=1
// "başvuru sahibi", yoksa yakinligi=0 "hane reisi" - diğer sync
// butonlarıyla AYNI öncelik sırası) cep telefonunu bulur ve dosyalar.telefon
// bununla UYUŞMUYORSA (boş, eksik ya da farklıysa) GÜNCELLER. SADECE
// GERÇEKTEN değişecek kayıtlar işlenir - zaten doğru/eşleşen olanlara
// dokunulmaz. Otomatik/sessiz DEĞİLDİR - kullanıcı bu butona kendisi
// bastığında çalışır (bilerek farklı girilmiş numaraların sessizce toplu
// değiştirilmesi riskine karşı - kullanıcı isteği).
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.update', page: '/assistance/nakit' })
    if (accessDenied) return accessDenied

    const updatedRows = await withAuditedWrite(
      (tx) => tx.$queryRaw<{ id: bigint; telefon: string | null }[]>`
        UPDATE dosyalar d
        SET telefon = matched.ceptel
        FROM (
          SELECT DISTINCT ON (d2.id)
            d2.id AS dosya_id,
            b.ceptel AS ceptel
          FROM dosyalar d2
          JOIN bireyler b ON b.dosyaid = d2.id
          WHERE b.ceptel IS NOT NULL
            AND BTRIM(b.ceptel) <> ''
            AND EXISTS (SELECT 1 FROM yrd_ayninakti n WHERE n.dosyaid = d2.id)
          ORDER BY
            d2.id,
            CASE
              WHEN b.tipi = 1 THEN 0
              WHEN b.yakinligi = 0 THEN 1
              ELSE 2
            END,
            b.id ASC
        ) matched
        WHERE d.id = matched.dosya_id
          AND (
            d.telefon IS NULL
            OR BTRIM(d.telefon) = ''
            OR BTRIM(d.telefon) IS DISTINCT FROM BTRIM(matched.ceptel)
          )
        RETURNING d.id, d.telefon
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
    console.error('Nakit sync-phone-numbers error:', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Telefon numaraları güncellenemedi.' },
      { status: 500 },
    )
  }
}

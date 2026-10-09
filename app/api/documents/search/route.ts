import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { foldTurkish, prepareSqlSearchTerm, sqlFoldExpr } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type DocumentSearchResultRow = {
  file_id: bigint
  dosyano: string | null
  tckimlikno: string | null
  adisoyadi: string | null
  adres: string | null
  ceptel: string | null
  dogumtarihi: string | null
  anaadi: string | null
  babaadi: string | null
}

const NOT_FOUND_MESSAGE = 'Dosya bulunamadı.'

function notFound() {
  return NextResponse.json({ success: false, error: NOT_FOUND_MESSAGE }, { status: 404 })
}

function toJsonRows(rows: DocumentSearchResultRow[]) {
  return rows.map((row) => ({ ...row, file_id: row.file_id.toString() }))
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('query')?.trim() || ''

    if (!query) {
      return NextResponse.json({ success: false, error: 'Arama terimi zorunludur.' }, { status: 400 })
    }

    const normalizedQuery = query.replace(/\s+/g, ' ').trim()
    const digitsOnly = normalizedQuery.replace(/\D/g, '')
    const hasLetter = /[a-zA-ZçÇğĞıİöÖşŞüÜ]/.test(normalizedQuery)
    const hasDigit = digitsOnly.length > 0

    // Kullanicinin istedigi siniflandirma - girilen deger:
    // - SADECE rakam VE en fazla 5 haneyse -> DOSYA NO
    // - SADECE rakam VE 5 haneden uzunsa -> TELEFON NO
    // - SADECE harflerden olusuyorsa (rakam yok) -> AD SOYAD
    // - Hem rakam hem harf birlikte varsa -> KART NO
    // Her dal SADECE kendi alaninda arar; eslesme yoksa "Dosya bulunamadi"
    // donuyor (arama turleri arasinda otomatik fallback/geçiş YOK - bu
    // bilincli bir tercih, kullanicinin acikca istedigi davranis).

    if (hasDigit && !hasLetter) {
      if (digitsOnly.length <= 5) {
        // DOSYA NO araması - eski kayitlarla uyum icin 5 haneye
        // tamamlanmis hali de deneniyor (ör. "7" -> "00007").
        const paddedFileNo = digitsOnly.padStart(5, '0')
        const safeQuery = prepareSqlSearchTerm(normalizedQuery)
        const safePaddedFileNo = prepareSqlSearchTerm(paddedFileNo)

        const matches = await prisma.$queryRaw<DocumentSearchResultRow[]>`
          SELECT DISTINCT ON (d.id)
            d.id AS file_id,
            d.dosyano,
            b.tckimlikno,
            b.adisoyadi,
            d.adres,
            b.ceptel,
            to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
            b.anaadi,
            b.babaadi
          FROM dosyalar d
          LEFT JOIN bireyler b ON b.dosyaid = d.id
          WHERE d.dosyano = ${safeQuery} OR d.dosyano = ${safePaddedFileNo}
          ORDER BY d.id, b.yakinligi ASC NULLS LAST
        `

        if (matches.length === 0) return notFound()

        return NextResponse.json({ success: true, data: toJsonRows(matches), searchType: 'direct' })
      }

      if (digitsOnly.length === 11 && !digitsOnly.startsWith('0')) {
        // T.C. KİMLİK NO araması - Turkiye'de TC kimlik no her zaman TAM
        // 11 hanedir VE ILK HANESI ASLA 0 OLAMAZ (resmi kural). 11 haneli
        // Turkiye cep telefonlari ise (ör. 05321234567) her zaman "0" ile
        // baslar - bu yuzden 11 hane + bastaki "0" olan degerler asagida
        // TELEFON NO olarak, "0" ile baslamayanlar burada TC KIMLIK NO
        // olarak aranıyor.
        const matches = await prisma.$queryRaw<DocumentSearchResultRow[]>`
          SELECT
            d.id AS file_id,
            d.dosyano,
            b.tckimlikno,
            b.adisoyadi,
            d.adres,
            b.ceptel,
            to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
            b.anaadi,
            b.babaadi
          FROM bireyler b
          JOIN dosyalar d ON b.dosyaid = d.id
          WHERE regexp_replace(COALESCE(b.tckimlikno, ''), '[^0-9]', '', 'g') = ${digitsOnly}
          ORDER BY b.adisoyadi ASC
          LIMIT 50
        `

        if (matches.length === 0) return notFound()

        return NextResponse.json({ success: true, data: toJsonRows(matches), searchType: 'list' })
      }

      // TELEFON NO araması (6-10 hane, veya "0" ile baslayan 11 hane)
      const matches = await prisma.$queryRaw<DocumentSearchResultRow[]>`
        SELECT
          d.id AS file_id,
          d.dosyano,
          b.tckimlikno,
          b.adisoyadi,
          d.adres,
          b.ceptel,
          to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
          b.anaadi,
          b.babaadi
        FROM bireyler b
        JOIN dosyalar d ON b.dosyaid = d.id
        WHERE
          regexp_replace(COALESCE(b.ceptel, ''), '[^0-9]', '', 'g') LIKE ${'%' + digitsOnly + '%'}
          OR (
            regexp_replace(COALESCE(d.telefon, ''), '[^0-9]', '', 'g') LIKE ${'%' + digitsOnly + '%'}
            AND (b.yakinligi = 0 OR b.tipi = 0)
          )
        ORDER BY b.adisoyadi ASC
        LIMIT 50
      `

      if (matches.length === 0) return notFound()

      return NextResponse.json({ success: true, data: toJsonRows(matches), searchType: 'list' })
    }

    if (hasLetter && !hasDigit) {
      // AD SOYAD araması - Türkçe-duyarsız (büyük/küçük harf + aksan yok
      // sayılır): "Şişli"~"sisli", "GÜLER"~"guler". Kolon ve terim aynı
      // şekilde ASCII'ye + küçük harfe katlanır.
      //
      // NOT: Önceki sürüm `Prisma.raw(...)` + etiketli şablon (tagged
      // template) `$queryRaw` kullanıyordu - bu YEREL testte çalışıyor ama
      // CANLI derlemede (Next.js üretim paketleme - `Sql` sınıfının farklı
      // paketlerde/chunk'larda ayrı kopyalanması ihtimali) sessizce 0 sonuç
      // döndürüyordu (hata yok, ama eşleşme de yok - kullanıcı "Dosya
      // bulunamadı" görüyordu). `$queryRawUnsafe` + numaralı parametre bu
      // sınıf-kimliği bağımlılığına dayanmaz, sqlFoldExpr'de kullanıcı
      // girdisi olmadığı için sorgu metnine gömülmesi güvenlidir.
      const foldedNamePattern = `%${foldTurkish(normalizedQuery)}%`
      const foldedNameColumnSql = sqlFoldExpr(`regexp_replace(TRIM(COALESCE(b.adisoyadi, '')), '\\s+', ' ', 'g')`)

      const matches = await prisma.$queryRawUnsafe<DocumentSearchResultRow[]>(
        `SELECT
          d.id AS file_id,
          d.dosyano,
          b.tckimlikno,
          b.adisoyadi,
          d.adres,
          b.ceptel,
          to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
          b.anaadi,
          b.babaadi
        FROM bireyler b
        JOIN dosyalar d ON b.dosyaid = d.id
        WHERE ${foldedNameColumnSql} LIKE $1
        ORDER BY b.adisoyadi ASC
        LIMIT 50`,
        foldedNamePattern,
      )

      if (matches.length === 0) return notFound()

      return NextResponse.json({ success: true, data: toJsonRows(matches), searchType: 'list' })
    }

    // Hem harf hem rakam birlikte varsa (ör. "A123", "34AB56", NFC kart
    // okuyucudan gelen "25A501EE" gibi hex UID'ler): KART NO araması.
    // Hem dosyanın kendi genel kart no'su (d.kartno) hem de Ekmek
    // Yardımı'na özel ayrı kart no (yrd_ekmek.kartno - bkz. "Kart No
    // Tanımla" penceresi) kontrol edilir; NFC kart okuyucu hangi karta
    // okutulmuş olursa olsun (Gülkart/genel dosya kartı ya da ekmek
    // kartı) dosya bu tek arama kutusundan bulunabilsin diye.
    const safeCardNo = prepareSqlSearchTerm(normalizedQuery)
    const matches = await prisma.$queryRaw<DocumentSearchResultRow[]>`
      SELECT DISTINCT ON (d.id)
        d.id AS file_id,
        d.dosyano,
        b.tckimlikno,
        b.adisoyadi,
        d.adres,
        b.ceptel,
        to_char(b.dogumtarihi, 'DD.MM.YYYY') AS dogumtarihi,
        b.anaadi,
        b.babaadi
      FROM dosyalar d
      LEFT JOIN bireyler b ON b.dosyaid = d.id
      WHERE d.kartno = ${safeCardNo}
        OR EXISTS (SELECT 1 FROM yrd_ekmek e WHERE e.dosyaid = d.id AND e.kartno = ${safeCardNo})
      ORDER BY d.id, b.yakinligi ASC NULLS LAST
    `

    if (matches.length === 0) return notFound()

    return NextResponse.json({ success: true, data: toJsonRows(matches), searchType: 'direct' })
  } catch (error) {
    console.error('Search API Error:', error)
    return NextResponse.json({ success: false, error: 'Arama sırasında hata oluştu.' }, { status: 500 })
  }
}

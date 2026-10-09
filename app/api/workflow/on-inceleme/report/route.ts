import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getAuditMetaFromRequest, stampAuditUser } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

function cleanBigInt(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null

  try {
    return BigInt(text)
  } catch {
    return null
  }
}

function cleanDate(value: unknown) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

function cleanAnswers(value: unknown) {
  if (!value || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, answer]) => [key, String(answer ?? '').trim()])
      .filter(([, answer]) => answer !== ''),
  )
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function cleanStatusNumber(value: unknown) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  return Number(text)
}

function getCurrentUserId(request: NextRequest) {
  const userId = parseSessionValue(readSessionCookie(request.cookies))
  const numericUserId = userId ? Number(userId) : null

  return Number.isInteger(numericUserId) ? numericUserId : null
}

// On inceleme is akisi listesindeki "Rapor Ekle" islemi ile doldurulan form.
// Sorular/cevaplar Ayarlar > Sistem Ayarlari > "On Inceleme Formu Tasarimi"
// ekranindan tanimlanir (serbest metin cevapli); burada sadece cevaplar
// on_inceleme_raporlari tablosuna kaydedilir. Dosya durumunu DEGISTIRMEZ -
// bu, sadece incelemeyi yapan kisinin cevaplarini kayit altina almak icindir.
async function ensureOnIncelemeRaporlariTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.on_inceleme_raporlari (
      id BIGSERIAL PRIMARY KEY,
      dosyaid BIGINT NOT NULL,
      tarih DATE NOT NULL DEFAULT CURRENT_DATE,
      cevaplar JSONB NOT NULL DEFAULT '{}'::jsonb,
      kullaniciid INTEGER,
      ilkislemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      islemtarihi TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)

  // Bu veritabani sunucusu PostgreSQL 9.4 oldugu icin "CREATE INDEX IF NOT EXISTS"
  // desteklenmiyor (9.5+ ozelligi) - once pg_indexes'ten kontrol edip oyle olusturuyoruz,
  // inceleme_formu / guncelleme_formu tablolarindaki ayni desenle tutarli olarak.
  const indexResult = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'on_inceleme_raporlari'
      AND indexname = 'ind_on_inceleme_raporlari_dosyaid';
  `)

  if (indexResult.length === 0) {
    await prisma.$executeRawUnsafe(`
      CREATE INDEX ind_on_inceleme_raporlari_dosyaid ON public.on_inceleme_raporlari (dosyaid);
    `)
  }

  // "aciklama" sutunu sonradan eklendi. PostgreSQL 9.4'te "ADD COLUMN IF NOT EXISTS"
  // desteklenmedigi icin (9.6+ ozelligi) once information_schema'dan kontrol edip
  // oyle ekliyoruz.
  const columnResult = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'on_inceleme_raporlari'
      AND column_name = 'aciklama';
  `)

  if (columnResult.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.on_inceleme_raporlari ADD COLUMN aciklama TEXT;
    `)
  }

  const sonucColumnResult = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'on_inceleme_raporlari'
      AND column_name = 'sonuc';
  `)

  if (sonucColumnResult.length === 0) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE public.on_inceleme_raporlari ADD COLUMN sonuc TEXT;
    `)
  }
}

export async function GET(request: NextRequest) {
  try {
    const dosyaid = cleanBigInt(request.nextUrl.searchParams.get('fileId'))
    if (!dosyaid) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    await ensureOnIncelemeRaporlariTable()
    const rows = await prisma.$queryRaw<Array<{ id: bigint; tarih: Date; cevaplar: unknown; aciklama: string | null; sonuc: string | null; islemtarihi: Date }>>`
      SELECT id, tarih, cevaplar, aciklama, sonuc, islemtarihi
      FROM public.on_inceleme_raporlari
      WHERE dosyaid = ${dosyaid}
      ORDER BY tarih DESC, id DESC;
    `

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id.toString(),
        tarih: row.tarih,
        cevaplar: row.cevaplar || {},
        aciklama: row.aciklama,
        sonuc: row.sonuc,
        islemtarihi: row.islemtarihi,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'On inceleme raporlari alinamadi.' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/on-inceleme' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const fileId = cleanBigInt(payload.fileId)
    const date = cleanDate(payload.date)
    const answers = cleanAnswers(payload.cevaplar)
    const aciklama = cleanText(payload.aciklama)
    // nextStatus verilmezse varsayilan davranis: dosya "Tahkikat" asamasina gecer
    // (durumu = 1, /api/workflow/tahkikat listesinin filtreledigi kod). "İncelemeye
    // Uygun Değil" akisinda client, Hazir Degerler'den bulunan "Yardım Yapılamaz"
    // durum kodunu nextStatus olarak gonderir ve dosya dogrudan o duruma gecer.
    const nextStatus = cleanStatusNumber(payload.nextStatus) ?? 1

    if (!fileId || !date) {
      return NextResponse.json(
        { success: false, error: 'Dosya ve tarih bilgisi zorunludur.' },
        { status: 400 },
      )
    }

    if (Object.keys(answers).length === 0 && !aciklama) {
      return NextResponse.json(
        { success: false, error: 'En az bir soruya cevap veya aciklama yazilmalidir.' },
        { status: 400 },
      )
    }

    await ensureOnIncelemeRaporlariTable()
    const currentUserId = getCurrentUserId(request)

    const result = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const sonuc = nextStatus === 1 ? 'Tahkikata Gönderildi' : 'İncelemeye Uygun Değil'
      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        INSERT INTO public.on_inceleme_raporlari (dosyaid, tarih, cevaplar, aciklama, sonuc, kullaniciid, ilkislemtarihi, islemtarihi)
        VALUES (${fileId}, ${date}::date, ${JSON.stringify(answers)}::jsonb, ${aciklama}, ${sonuc}, ${currentUserId}, NOW(), NOW())
        RETURNING id;
      `

      const statusDescription = aciklama || (nextStatus === 1 ? 'Ön inceleme raporu eklendi' : 'İncelemeye uygun değil')
      const updatedCount = await tx.$executeRaw`
        UPDATE dosyalar
        SET
          durumu = ${nextStatus},
          durumutarih = ${date}::date,
          durumuaciklama = ${statusDescription},
          kullaniciid = ${currentUserId},
          islemtarihi = NOW()
        WHERE id = ${fileId};
      `

      if (Number(updatedCount) === 0) {
        throw new Error('Guncellenecek dosya bulunamadi.')
      }

      return rows[0]
    })

    return NextResponse.json({
      success: true,
      data: {
        reportId: result?.id ? String(result.id) : null,
        fileId: fileId.toString(),
        nextStatus,
      },
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Rapor kaydedilemedi.' },
      { status: 500 },
    )
  }
}

// Duzenleme: sadece cevaplar/aciklama/tarih guncellenir - dosya durumu (sonuc) bu
// kayit ilk kaydedildiginde zaten belirlenmis oldugu icin burada degistirilmez.
export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/on-inceleme' })
    if (accessDenied) return accessDenied

    const payload = await request.json()
    const id = cleanBigInt(payload.id)
    if (!id) {
      return NextResponse.json({ success: false, error: 'Guncellenecek rapor secilmedi.' }, { status: 400 })
    }

    const date = cleanDate(payload.date)
    const answers = cleanAnswers(payload.cevaplar)
    const aciklama = cleanText(payload.aciklama)

    await ensureOnIncelemeRaporlariTable()
    const updatedRow = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
        UPDATE public.on_inceleme_raporlari
        SET tarih = COALESCE(${date || null}::date, tarih),
            cevaplar = ${JSON.stringify(answers)}::jsonb,
            aciklama = ${aciklama},
            islemtarihi = NOW()
        WHERE id = ${id}
        RETURNING id;
      `

      return rows[0]
    })

    if (!updatedRow) {
      return NextResponse.json({ success: false, error: 'Rapor bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: { id: updatedRow.id.toString() } })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Rapor guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.update', page: '/workflow/on-inceleme' })
    if (accessDenied) return accessDenied

    const id = cleanBigInt(request.nextUrl.searchParams.get('id'))
    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek rapor secilmedi.' }, { status: 400 })
    }

    await ensureOnIncelemeRaporlariTable()
    const deletedCount = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))
      const result = await tx.$executeRaw`DELETE FROM public.on_inceleme_raporlari WHERE id = ${id};`
      return Number(result)
    })

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Rapor bulunamadi.' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Rapor silinemedi.' },
      { status: 500 },
    )
  }
}

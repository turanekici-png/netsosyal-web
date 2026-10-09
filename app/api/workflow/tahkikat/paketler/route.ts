import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser, requireApiAccess, requireAdminAccess } from '@/lib/apiAuth'
import { settingService } from '@/lib/services'
import { USER_PERMISSIONS_SETTING_KEY, type UserPermissionsById } from '@/lib/constants/userPermissions'
import { withAuditedWrite, getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { ensureTahkikatPaketleriTable, stripMahallelerFromOtherPaketler, type TahkikatPaket } from '../_lib/rotation'
import { ensureSorumluColumn, applyDueRotations } from '../_lib/autoRotate'
import { getTahkikatPersonelListesi } from '../_lib/personnel'

export const dynamic = 'force-dynamic'

type PaketRow = {
  id: bigint | number | string
  ad: string
  sira: number
  mahalleler: unknown
  sorumlukullaniciid: bigint | number | string | null
  sorumlu_ad: string | null
}

function toPaket(row: PaketRow): TahkikatPaket & { ownerUserId: string | null; ownerName: string | null } {
  return {
    id: String(row.id),
    ad: row.ad,
    sira: row.sira,
    mahalleler: Array.isArray(row.mahalleler) ? row.mahalleler.filter((m): m is string => typeof m === 'string') : [],
    ownerUserId: row.sorumlukullaniciid ? String(row.sorumlukullaniciid) : null,
    ownerName: row.sorumlu_ad,
  }
}

function cleanAd(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 150) : ''
}

function cleanSira(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function cleanMahalleler(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) seen.add(item.trim())
  }
  return [...seen]
}

function cleanSorumluKullaniciId(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? Number(text) : undefined
}

// GET - "Mahalle Grupları" sayfasindaki grup listesi + her grubun O ANKI
// sorumlusu (bkz. ../_lib/autoRotate.ts - tek global gun/saat tetikleyici
// ile otomatik kayan sorumlukullaniciid). Herhangi bir /workflow/tahkikat
// erisimi olan kullanici gorebilir (sadece yazma - POST/PATCH/DELETE -
// admin ile sinirli).
export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ page: '/workflow/tahkikat' })
    if (accessDenied) return accessDenied

    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const permissionsSetting = await settingService.getByKey(USER_PERMISSIONS_SETTING_KEY)
    const permissions = (permissionsSetting?.value as UserPermissionsById | undefined) ?? {}
    const currentPermissionConfig = permissions[String(sessionUser.id)] ?? null
    const canAssign = !currentPermissionConfig || currentPermissionConfig.isAdmin === true

    await ensureTahkikatPaketleriTable()
    await applyDueRotations()

    const rows = await prisma.$queryRaw<PaketRow[]>`
      SELECT p.id, p.ad, p.sira, p.mahalleler, p.sorumlukullaniciid,
        COALESCE(NULLIF(u.kullanicitamadi, ''), NULLIF(u.kullaniciadi, '')) AS sorumlu_ad
      FROM tahkikat_paketleri p
      LEFT JOIN kullanicilar u ON u.id::text = p.sorumlukullaniciid::text
      ORDER BY p.sira ASC, p.id ASC;
    `
    const personelListesi = await getTahkikatPersonelListesi()

    return NextResponse.json({
      success: true,
      data: {
        canAssign,
        paketler: rows.map(toPaket),
        personelListesi,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Gruplar alınamadı.' },
      { status: 500 },
    )
  }
}

// POST - yeni grup olustur (admin only) - ad, sira, mahalleler, sorumlu
// kullanici (nullable). Kullanici istegi (2026-10-08, 6. tur): "yeni grup
// ekleyelim, bu gruba mahalle seçelim ve en üstünde bu mahallelerden
// sorumlu olan kullanıcıyı seçelim".
export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireAdminAccess()
    if (accessDenied) return accessDenied

    await ensureTahkikatPaketleriTable()
    await ensureSorumluColumn()

    const payload = await request.json()
    const ad = cleanAd(payload.ad)
    if (!ad) {
      return NextResponse.json({ success: false, error: 'Grup adı zorunludur.' }, { status: 400 })
    }
    const sira = cleanSira(payload.sira)
    const mahalleler = cleanMahalleler(payload.mahalleler)
    const sorumluKullaniciId = cleanSorumluKullaniciId(payload.sorumluKullaniciId)
    if (sorumluKullaniciId === undefined) {
      return NextResponse.json({ success: false, error: 'Geçersiz sorumlu kullanıcı.' }, { status: 400 })
    }

    const rows = await withAuditedWrite(async (tx) => {
      const inserted = await tx.$queryRaw<Array<{ id: bigint | number | string }>>`
        INSERT INTO tahkikat_paketleri (ad, sira, mahalleler, sorumlukullaniciid, guncellemetarihi)
        VALUES (${ad}, ${sira}, ${JSON.stringify(mahalleler)}::jsonb, ${sorumluKullaniciId}, NOW())
        RETURNING id;
      `
      await stripMahallelerFromOtherPaketler(tx, BigInt(inserted[0].id), mahalleler)
      return tx.$queryRaw<PaketRow[]>`
        SELECT p.id, p.ad, p.sira, p.mahalleler, p.sorumlukullaniciid,
          COALESCE(NULLIF(u.kullanicitamadi, ''), NULLIF(u.kullaniciadi, '')) AS sorumlu_ad
        FROM tahkikat_paketleri p
        LEFT JOIN kullanicilar u ON u.id::text = p.sorumlukullaniciid::text
        WHERE p.id = ${inserted[0].id};
      `
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({ success: true, data: toPaket(rows[0]) }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Grup oluşturulamadı.' },
      { status: 500 },
    )
  }
}

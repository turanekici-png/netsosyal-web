import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { documentService } from '@/lib/services'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { buildAssistanceExistsCondition, readAssistanceFilterParams } from '@/lib/utils/assistanceFilter'
import { buildDocumentsConditions, buildDocumentsFromClause, buildDocumentsOrderBy, finalizeWhereClause } from '@/lib/documents/documentsListQuery'

export const dynamic = "force-dynamic"

type DocumentListRow = {
  id: string
  dosyaId: string
  dosyaNo: string | null
  incelemePuani: number | null
  dosyaSahibi: string | null
  durum: number | null
  kartNo: string | null
  muracaatTarihi: Date | null
  telefon: string | null
  ceptel: string | null
  mahalle: string | null
  cadde: string | null
  sokak: string | null
  binaNo: string | null
  daireNo: string | null
  adresNo: string | null
  adres: string | null
  toplamBirey: number | null
  aciklama: string | null
  olusturmaTarihi: Date | null
  guncellemeTarihi: Date | null
}

type DeletePayload = { ids?: Array<string | number> }

function getPositiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function buildWhereClause(searchParams: URLSearchParams, search: string) {
  const builder = buildDocumentsConditions(searchParams, search)

  const assistanceCondition = buildAssistanceExistsCondition(builder, 'd.id', readAssistanceFilterParams(searchParams))
  if (assistanceCondition) builder.clauses.push(assistanceCondition)

  return finalizeWhereClause(builder)
}

// GET all documents
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = getPositiveNumber(searchParams.get('page'), 1)
    const limit = Math.min(getPositiveNumber(searchParams.get('limit'), 50), 200)
    const queryLimit = limit + 1
    const offset = (page - 1) * limit
    const search = searchParams.get('search')?.trim() || ''
    const orderBy = buildDocumentsOrderBy(searchParams.get('sort'))
    const whereClause = buildWhereClause(searchParams, search)
    const exportAll = searchParams.get('export') === 'all'
    const limitClause = exportAll
      ? ''
      : `LIMIT $${whereClause.values.length + 1} OFFSET $${whereClause.values.length + 2}`
    const queryValues = exportAll
      ? whereClause.values
      : [...whereClause.values, queryLimit, offset]

    const documentsFromClause = buildDocumentsFromClause(whereClause.sql)
    // Toplam kayit sayisi (sayfalama icin) ve asil sayfa verisi birbirinden bagimsiz
    // sorgulardir; sirayla degil ayni anda calistirmak liste ekranini acma suresini
    // iki sorgunun toplami yerine en yavas olanin suresine indirir.
    const [totalRows, documents] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ total: bigint }>>(`
        SELECT COUNT(*)::bigint AS total
        ${documentsFromClause}
      `, ...whereClause.values),
      prisma.$queryRawUnsafe<DocumentListRow[]>(`
        SELECT
          d.id::text AS "id",
          d.id::text AS "dosyaId",
          d.dosyano AS "dosyaNo",
          d.inceleme_puani AS "incelemePuani",
          owner.adisoyadi AS "dosyaSahibi",
          d.durumu AS "durum",
          d.kartno AS "kartNo",
          d.muracaattarihi AS "muracaatTarihi",
          d.telefon AS "telefon",
          owner.ceptel AS "ceptel",
          d.mahalleadi AS "mahalle",
          d.cadde AS "cadde",
          d.sokak AS "sokak",
          d.binano AS "binaNo",
          d.daireno AS "daireNo",
          d.adresno AS "adresNo",
          d.adres AS "adres",
          COALESCE(household.toplam, 0) AS "toplamBirey",
          d.aciklama AS "aciklama",
          d.ilkislemtarihi AS "olusturmaTarihi",
          d.islemtarihi AS "guncellemeTarihi"
        ${documentsFromClause}
        ORDER BY ${orderBy}
        ${limitClause}
      `, ...queryValues),
    ])
    const hasNext = documents.length > limit
    const pagedDocuments = exportAll ? documents : hasNext ? documents.slice(0, limit) : documents

    return NextResponse.json({
      success: true,
      data: pagedDocuments,
      pagination: {
        page,
        limit,
        hasNext,
        total: Number(totalRows[0]?.total || 0),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    )
  }
}

// CREATE document
export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.create', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const document = await documentService.create(body)

    return NextResponse.json(
      { success: true, data: document },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}

// Kullanici istegi: bir dosya silindiginde, o dosyanin id'sini "dosyaid"
// sutununda tasiyan HER ILGILI kayit (bireyler + tum yardim/yrd_* tablolari
// ve bunlarin hareket/detay tablolari) da BIRLIKTE silinsin - "o dosya ile
// ilgili iz kalmasin". Kullanici SMS/WhatsApp gonderim loglari, dosya
// notlari, tahkikat/inceleme raporlari, ev ziyaretleri gibi KAYIT/LOG
// nitelikli tablolara (denetim izi olarak) DOKUNULMAMASINI ISTEDI - bu
// yuzden liste BILINCLI olarak sadece bireyler + yrd_* tablolariyla
// sinirlidir (bkz. information_schema sorgusuyla tespit edilen "dosyaid"
// sutunu olan TUM tablolar - bu, o listenin BILINCLI olarak daraltilmis
// halidir).
const CASCADE_DELETE_TABLES = [
  'bireyler',
  'yrd_aceze',
  'yrd_ayninakti',
  'yrd_ddgidadosyali',
  'yrd_destekpaketi',
  'yrd_destekpaketihrk',
  'yrd_digerkrmalyrdm',
  'yrd_ekmek',
  'yrd_ekmekhrk',
  'yrd_emtia',
  'yrd_emtia_log',
  'yrd_gidabankasi',
  'yrd_gidabankasidnm',
  'yrd_gidabankasihrk',
  'yrd_giyim',
  'yrd_haziryemek',
  'yrd_haziryemekhrk',
  'yrd_kirtasiye',
  'yrd_yakacak',
]

// Kullanici istegi ONCESINDE MEVCUT, sebep OLMADIGIMIZ bir veritabani
// hatasi: yrd_ekmek/yrd_gidabankasi/yrd_haziryemek uzerinde "AFTER DELETE"
// da tetiklenen fn_dosya_durum_guncelle() fonksiyonu, "COALESCE(NEW.dosyaid,
// OLD.dosyaid)" satirinda SILME (DELETE) sirasinda cokuyor - PL/pgSQL'de
// bir DELETE tetikleyicisinde "NEW" kaydi hic ATANMAMIS olur, COALESCE
// icinde bile olsa NEW.<alan> okumaya CALISMAK "record NEW is not assigned
// yet" hatasi verir (bu, DB tetikleyicisinde onceden var olan bir hata,
// canli ortamda dogrulandi). Bu 3 tablodan silme yaparken, SADECE bu
// transaction icinde, ilgili tetikleyici GECICI OLARAK devre disi
// birakilip hemen ardindan tekrar ACILIR - PostgreSQL'de ALTER TABLE ...
// TRIGGER degisiklikleri TAM TRANSAKSIYONEL oldugu icin, herhangi bir
// hata olursa (ROLLBACK ile) tetikleyici otomatik olarak eski (acik)
// haline doner, baska hicbir islemi etkilemez.
const DOSYA_DURUM_TRIGGERS: Record<string, string> = {
  yrd_ekmek: 'trg_dosya_durum_ekmek',
  yrd_gidabankasi: 'trg_dosya_durum_gidabankasi',
  yrd_haziryemek: 'trg_dosya_durum_haziryemek',
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.delete', page: '/documents' })
    if (accessDenied) return accessDenied

    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const payload = await request.json().catch(() => ({})) as DeletePayload
    const ids = normalizeIds(payload.ids)

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek dosya seçilmedi.' }, { status: 400 })
    }

    const deleted = await withAuditedWrite(
      async (tx) => {
        // Tablo adlari SABIT/HARDCODED (kullanici girdisinden gelmiyor) -
        // string enterpolasyonu bu yuzden guvenlidir. Once ILGILI tum
        // kayitlar, en son dosyalar kaydinin kendisi silinir.
        for (const table of CASCADE_DELETE_TABLES) {
          const triggerName = DOSYA_DURUM_TRIGGERS[table]
          if (triggerName) await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER ${triggerName}`)
          await tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE dosyaid = ANY($1::bigint[])`, ids)
          if (triggerName) await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER ${triggerName}`)
        }
        return tx.$executeRawUnsafe('DELETE FROM dosyalar WHERE id = ANY($1::bigint[])', ids)
      },
      getAuditMetaFromRequest(request),
    )

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        deleted,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const friendlyMessage = message.includes('foreign key') || message.includes('violates')
      ? 'Bu dosyaya bağlı birey, müracaat veya yardım kayıtları olduğu için dosya silinemedi.'
      : 'Dosya silinemedi.'

    return NextResponse.json(
      { success: false, error: friendlyMessage },
      { status: 500 },
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { Pool } from 'pg'
import { getSessionUser, requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'
import { getAuditMetaFromRequest } from '@/lib/db/auditContext'
import { reevaluateCashAutoRejectForFile } from '@/lib/services/cashAutoReject.service'
import { compressImageBuffer } from '@/lib/services/imageCompression.service'
import { compressPdfBuffer } from '@/lib/services/pdfCompression.service'
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/security/requestBody'

export const dynamic = 'force-dynamic'

// Belge govdesi base64 gorsel/PDF tasiyabilir - makul ust sinir (istemci
// tarafinda zaten kucultulup PDF'e ceviriliyor).
const BELGE_BODY_LIMIT_BYTES = 20 * 1024 * 1024

type BelgePayload = {
  id?: string
  dosyaid?: string
  tipi?: string | number
  baslik?: string
  icerik?: string
  tarih?: string
  gelir?: string
  aracModeli?: string
  tapuBilgisi?: string
  vergiMukellefiyeti?: string
  etiket?: string
  belgeData?: string
  belgeMime?: string
}

type BelgeRow = {
  id: string
  dosyaid: string | null
  tipi: number | null
  baslik: string | null
  icerik: string | null
  etiket: string | null
  hasBelge: boolean
  belgeSize: number
  ilkislemtarihi: string | null
  islemtarihi: string | null
  // Kullanici istegi: belge kaydini HANGI KULLANICININ EKLEDIGI listede
  // gorunsun - "belge" tablosunda zaten var olan (eski masaustu uygulamadan
  // kalma) ilkkullaniciid/kullaniciid kolonlari bu amacla okunuyor. Bu
  // kolonlar sosyalyardimdkm veritabaninda, ama kullanici ADLARI ana
  // sosyalyardim veritabanindaki "kullanicilar" tablosunda oldugundan (iki
  // AYRI veritabani - dogrudan JOIN yapilamaz), asagida attachAddedByNames
  // ile AYRI bir sorguyla eslestirilip eklenir (bkz. addedByUserId/addedByName).
  ilkkullaniciid: number | null
  kullaniciid: number | null
  // Kullanici istegi: belge eklenirken kisinin geliri, arac modeli ve tapu
  // bilgisi de girilebilsin - "belge" tablosuna sonradan eklenen kolonlar.
  gelir: string | null
  aracModeli: string | null
  tapuBilgisi: string | null
  // Kullanici istegi: belge eklenirken kisinin vergi mukellefiyeti durumu
  // (Var/Yok) da girilebilsin - "Var" ise Nakit Yardimi Otomatik Red
  // kontrolunde (gelir/arac siniri ne olursa olsun) KOSULSUZ red sebebidir
  // (bkz. cashAidAutoRejectCheck / cashAutoReject.service.ts).
  vergiMukellefiyeti: string | null
}

type BelgeRowWithAddedBy = BelgeRow & {
  addedByUserId: number | null
  addedByName: string | null
}

type BelgeDetailRow = BelgeRow & {
  belge_data: string | null
}

const globalForDkmBelgePool = globalThis as unknown as {
  dkmBelgePool: Pool | undefined
}

function getDkmConnectionString() {
  if (process.env.SOSYALYARDIMDKM_DATABASE_URL) {
    return process.env.SOSYALYARDIMDKM_DATABASE_URL
  }

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL tanimli degil.')
  }

  const url = new URL(connectionString)
  url.pathname = '/sosyalyardimdkm'
  return url.toString()
}

function getDkmBelgePool() {
  if (!globalForDkmBelgePool.dkmBelgePool) {
    globalForDkmBelgePool.dkmBelgePool = new Pool({ connectionString: getDkmConnectionString(), types: createUtcTypeOverrides() } as any)
  }

  return globalForDkmBelgePool.dkmBelgePool
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function normalizeBigInt(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d+$/.test(text) ? text : null
}

function normalizeInteger(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^-?\d+$/.test(text) ? Number(text) : null
}

function normalizeDate(value: unknown) {
  const text = normalizeText(value)
  if (text === null) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

// "belge.etiket" kolonu veritabaninda varchar(30) - kullanicinin serbestce
// yazdigi "Durumu" metni bu sinirin uzerinde olursa INSERT/UPDATE hata
// verir, bu yuzden burada da (istemcideki maxLength=30'a ek olarak) guvenlik
// icin kirpiliyor.
function normalizeEtiket(value: unknown) {
  const text = normalizeText(value)
  return text === null ? null : text.slice(0, 30)
}

// Kullanici istegi: veritabaninin (sosyalyardimdkm) surekli buyumesini
// onlemek icin - belge olarak yuklenen bir RESIM ise (image/...) kaydedilmeden
// once kucultulup JPEG olarak yeniden kodlanir (bkz. imageCompression.service.ts).
// PDF belgeler ise (application/pdf - "belge" tablosundaki kayitlarin
// NEREDEYSE TAMAMI bu formatta) Ghostscript ile yeniden kodlanir (bkz.
// pdfCompression.service.ts) - canli veriden alinan ornek belgelerde
// gorsel kalite kaybi olmadan %65-66 kucculme dogrulandi.
async function normalizeBelgeData(value: unknown): Promise<Buffer | null> {
  const text = normalizeText(value)
  if (text === null) return null

  const isImage = /^data:image\//i.test(text)
  const isPdf = /^data:application\/pdf/i.test(text)
  const base64 = text.includes(',') ? text.split(',').pop() || '' : text
  if (!base64) return null

  try {
    const buffer = Buffer.from(base64, 'base64')
    if (isImage) return await compressImageBuffer(buffer)
    if (isPdf) return await compressPdfBuffer(buffer)
    return buffer
  } catch {
    return null
  }
}

function mapBelgeRow(row: Record<string, unknown>): BelgeRow {
  return {
    id: String(row.id ?? ''),
    dosyaid: row.dosyaid === null || row.dosyaid === undefined ? null : String(row.dosyaid),
    tipi: typeof row.tipi === 'number' ? row.tipi : row.tipi === null ? null : Number(row.tipi),
    baslik: row.baslik === null || row.baslik === undefined ? null : String(row.baslik),
    icerik: row.icerik === null || row.icerik === undefined ? null : String(row.icerik),
    etiket: row.etiket === null || row.etiket === undefined ? null : String(row.etiket),
    hasBelge: Boolean(row.has_belge),
    belgeSize: Number(row.belge_size ?? 0),
    ilkislemtarihi: row.ilkislemtarihi === null || row.ilkislemtarihi === undefined ? null : String(row.ilkislemtarihi),
    islemtarihi: row.islemtarihi === null || row.islemtarihi === undefined ? null : String(row.islemtarihi),
    ilkkullaniciid: row.ilkkullaniciid === null || row.ilkkullaniciid === undefined ? null : Number(row.ilkkullaniciid),
    kullaniciid: row.kullaniciid === null || row.kullaniciid === undefined ? null : Number(row.kullaniciid),
    gelir: row.gelir === null || row.gelir === undefined ? null : String(row.gelir),
    aracModeli: row.arac_modeli === null || row.arac_modeli === undefined ? null : String(row.arac_modeli),
    tapuBilgisi: row.tapu_bilgisi === null || row.tapu_bilgisi === undefined ? null : String(row.tapu_bilgisi),
    vergiMukellefiyeti: row.vergi_mukellefiyeti === null || row.vergi_mukellefiyeti === undefined ? null : String(row.vergi_mukellefiyeti),
  }
}

// Belgeyi EKLEYEN kullanicinin adini ekler - "ilkkullaniciid" (belgeyi ILK
// olusturan) varsa o esas alinir, yoksa (eski kayitlarda sadece tek kolon
// dolu olabiliyor) "kullaniciid"e dusulur. Isimler AYRI (ana sosyalyardim)
// veritabanindaki "kullanicilar" tablosundan tek seferde toplu cekilir.
async function attachAddedByNames<T extends BelgeRow>(rows: T[]): Promise<(T & { addedByUserId: number | null; addedByName: string | null })[]> {
  const userIds = Array.from(new Set(
    rows
      .map((row) => row.ilkkullaniciid ?? row.kullaniciid)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
  ))

  const nameById = new Map<number, string>()
  if (userIds.length > 0) {
    try {
      const users = await prisma.user.findMany({
        where: { id: { in: userIds.map((id) => BigInt(id)) } },
        select: { id: true, kullanicitamadi: true, username: true },
      })
      for (const user of users) {
        const name = user.kullanicitamadi?.trim() || user.username?.trim() || null
        if (name) nameById.set(Number(user.id), name)
      }
    } catch {
      // Kullanici adlari alinamazsa belge listesi yine de gosterilsin -
      // sadece "Ekleyen" bilgisi bos kalir.
    }
  }

  return rows.map((row) => {
    const addedByUserId = row.ilkkullaniciid ?? row.kullaniciid
    return {
      ...row,
      addedByUserId,
      addedByName: addedByUserId !== null ? nameById.get(addedByUserId) ?? null : null,
    }
  })
}

function getBelgeMime(icerik: string | null) {
  if (!icerik) return ''
  return icerik
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^(image\/|application\/pdf)/i.test(line)) || ''
}

// Eski/onceden yuklenmis belgelerin "icerik" alaninda mime turu bilgisi
// (image/... veya application/pdf satiri) hic tutulmuyordu - bu bilgi
// sadece bu uygulama uzerinden yuklenen YENI belgelere eklenmeye baslandi.
// Eski belgeler icin getBelgeMime('') donup onizleme "desteklenmiyor"
// gorunuyordu (kullanicinin bildirdigi sorun buydu). Bunu cozmek icin, metin
// tabanli tespit basarisiz olursa dosyanin ILK BAYTLARINA (magic number/
// dosya imzasi) bakarak turu tespit ediyoruz - PDF/JPEG/PNG/GIF/WEBP/BMP
// icin standart imzalar.
function sniffMimeFromBytes(buffer: Buffer): string {
  if (buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf' // %PDF
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg' // JPEG SOI
  }
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png' // PNG signature
  }
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) {
    return 'image/gif'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return 'image/bmp' // BM
  }
  return ''
}

const belgeSelectSql = `
  SELECT id::text,
         dosyaid::text,
         tipi,
         baslik,
         icerik,
         etiket,
         belge IS NOT NULL AS has_belge,
         COALESCE(octet_length(belge), 0) AS belge_size,
         ilkislemtarihi,
         islemtarihi,
         ilkkullaniciid,
         kullaniciid,
         gelir,
         arac_modeli,
         tapu_bilgisi,
         vergi_mukellefiyeti
  FROM public.belge
`

export async function GET(request: NextRequest) {
  try {
    const id = normalizeBigInt(request.nextUrl.searchParams.get('id'))
    const dosyaId = normalizeBigInt(request.nextUrl.searchParams.get('dosyaId'))

    if (id) {
      const result = await getDkmBelgePool().query(
        `
          SELECT id::text,
                 dosyaid::text,
                 tipi,
                 baslik,
                 icerik,
                 etiket,
                 belge IS NOT NULL AS has_belge,
                 COALESCE(octet_length(belge), 0) AS belge_size,
                 CASE WHEN belge IS NULL THEN NULL ELSE encode(belge, 'base64') END AS belge_data,
                 ilkislemtarihi,
                 islemtarihi,
                 ilkkullaniciid,
                 kullaniciid,
                 gelir,
                 arac_modeli,
                 tapu_bilgisi,
                 vergi_mukellefiyeti
          FROM public.belge
          WHERE id = $1::bigint
          LIMIT 1;
        `,
        [id],
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Belge bulunamadi.' }, { status: 404 })
      }

      const row = result.rows[0] as BelgeDetailRow
      const record = mapBelgeRow(row)
      const [enrichedRecord] = await attachAddedByNames([record])
      const mime = getBelgeMime(record.icerik)
        || (row.belge_data ? sniffMimeFromBytes(Buffer.from(row.belge_data, 'base64')) : '')

      return NextResponse.json({
        success: true,
        data: {
          ...enrichedRecord,
          mimeType: mime,
          dataUrl: row.belge_data ? `data:${mime || 'application/octet-stream'};base64,${row.belge_data}` : '',
        },
      })
    }

    if (!dosyaId) {
      return NextResponse.json({ success: false, error: 'Dosya id bilgisi eksik.' }, { status: 400 })
    }

    const result = await getDkmBelgePool().query(
      `
        ${belgeSelectSql}
        WHERE dosyaid = $1::bigint
        ORDER BY COALESCE(islemtarihi, ilkislemtarihi) DESC NULLS LAST, id DESC;
      `,
      [dosyaId],
    )

    const enrichedRows = await attachAddedByNames(result.rows.map(mapBelgeRow))
    return NextResponse.json({ success: true, data: enrichedRows })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Belgeler alinamadi.' },
      { status: 500 },
    )
  }
}

// Kullanici istegi: bir belge kaydedildiginde/silindiginde, o dosyaya ait
// TUM durumu=0 Ayni/Nakdi müracaatları hemen yeniden degerlendirilip
// gerekirse Otomatik Red uygulanir/geri alinir - boylece Dosya Yönetimi
// sayfasi, müracaatın kendisi hiç açılmadan da GÜNCEL asama bilgisini
// gösterir (bkz. lib/services/cashAutoReject.service.ts). AWAIT edilir ki
// bu uc nokta yanit donmeden ONCE veritabani guncellensin (istemci hemen
// ardindan dosya bilgilerini tazeliyor - bkz. documents/page.tsx
// saveBelgeRecord/deleteBelgeRecord). Hata olursa YUTULUR - bu yan bir
// islemdir, belge kaydinin/silmenin basarisini ASLA etkilememeli.
async function reevaluateAutoRejectSilently(dosyaId: string | null | undefined, request: NextRequest) {
  if (!dosyaId) return
  try {
    await reevaluateCashAutoRejectForFile(dosyaId, getAuditMetaFromRequest(request))
  } catch (error) {
    console.error('[belgeler] Otomatik Red yeniden degerlendirme hatasi:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.attachments', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await readLimitedJson<BelgePayload>(request, BELGE_BODY_LIMIT_BYTES)
    const dosyaid = normalizeBigInt(payload.dosyaid)
    const baslik = normalizeText(payload.baslik)
    const tarih = normalizeDate(payload.tarih)
    const belgeData = await normalizeBelgeData(payload.belgeData)

    if (!dosyaid || !baslik) {
      return NextResponse.json({ success: false, error: 'Dosya id ve baslik zorunludur.' }, { status: 400 })
    }

    // Kullanici istegi: belgeyi EKLEYEN kullanici belge kaydina yazilsin -
    // "ilkkullaniciid" (ilk ekleyen) ve "kullaniciid" (son islemi yapan) ayni
    // oturum kullanicisiyla doldurulur.
    const sessionUser = await getSessionUser()
    const sessionUserId = sessionUser ? Number(sessionUser.id) : null

    const result = await getDkmBelgePool().query(
      `
        INSERT INTO public.belge
          (dosyaid, tipi, baslik, icerik, belge, ilkislemtarihi, islemtarihi, ilkkullaniciid, kullaniciid, gelir, arac_modeli, tapu_bilgisi, vergi_mukellefiyeti, etiket)
        VALUES
          ($1::bigint, $2::integer, $3, $4, $5::bytea, NOW(), COALESCE($6::date, CURRENT_DATE), $7::integer, $7::integer, $8, $9, $10, $11, $12)
        RETURNING id::text,
                  dosyaid::text,
                  tipi,
                  baslik,
                  icerik,
                  etiket,
                  belge IS NOT NULL AS has_belge,
                  COALESCE(octet_length(belge), 0) AS belge_size,
                  ilkislemtarihi,
                  islemtarihi,
                  ilkkullaniciid,
                  kullaniciid,
                  gelir,
                  arac_modeli,
                  tapu_bilgisi,
                  vergi_mukellefiyeti;
      `,
      [
        dosyaid,
        normalizeInteger(payload.tipi) ?? 0,
        baslik,
        // Kullanici istegi: Açıklama alanina sadece kullanicinin yazdigi
        // (ya da Gelir/Araç/Tapu alanlarindan otomatik olusturulan) metin
        // yazilsin - eskiden buraya mime turu (ör. "image/png") de EKLENIYORDU
        // (onizlemede tur tespiti icin), bu da bos birakilan belgelerde
        // Açıklama sutununda anlamsiz "image/png" gibi metinler gorunmesine
        // sebep oluyordu. Mime tespiti artik SADECE dosyanin ilk baytlarina
        // (magic number) bakan sniffMimeFromBytes ile yapiliyor (bkz. GET),
        // bu yuzden mime turunu metne eklemeye gerek kalmadi.
        normalizeText(payload.icerik),
        belgeData,
        tarih,
        sessionUserId,
        normalizeText(payload.gelir),
        normalizeText(payload.aracModeli),
        normalizeText(payload.tapuBilgisi),
        normalizeText(payload.vergiMukellefiyeti),
        // Kullanici istegi (2026-09-15): "Durumu" alani artik sabit bir
        // secim listesi degil, kullanicinin serbestce yazdigi metin -
        // "etiket" kolonuna yazilir (displayBelgeDurumu bu kolonu Durumu
        // sutununda ONCELIKLI olarak zaten gosteriyordu).
        normalizeEtiket(payload.etiket),
      ],
    )

    const [enrichedRecord] = await attachAddedByNames([mapBelgeRow(result.rows[0])])
    await reevaluateAutoRejectSilently(enrichedRecord.dosyaid, request)
    return NextResponse.json({ success: true, data: enrichedRecord })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Belge eklenemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.attachments', page: '/documents' })
    if (accessDenied) return accessDenied

    const payload = await readLimitedJson<BelgePayload>(request, BELGE_BODY_LIMIT_BYTES)
    const id = normalizeBigInt(payload.id)
    const baslik = normalizeText(payload.baslik)
    const tarih = normalizeDate(payload.tarih)
    const belgeData = await normalizeBelgeData(payload.belgeData)

    if (!id || !baslik) {
      return NextResponse.json({ success: false, error: 'Guncellenecek belge ve baslik zorunludur.' }, { status: 400 })
    }

    // Kullanici istegi: belgeyi kim EKLEDIYSE o bilgi (ilkkullaniciid)
    // duzenleme sirasinda DEGISTIRILMEZ - sadece "son islemi yapan"
    // (kullaniciid) guncel oturum kullanicisina cekilir. Eger ilkkullaniciid
    // daha once hic set edilmemisse (eski/legacy kayit), COALESCE ile bu ilk
    // duzenleyen "ekleyen" olarak kaydedilir.
    const sessionUser = await getSessionUser()
    const sessionUserId = sessionUser ? Number(sessionUser.id) : null

    const result = await getDkmBelgePool().query(
      `
        UPDATE public.belge
        SET tipi = $2::integer,
            baslik = $3,
            icerik = $4,
            belge = COALESCE($5::bytea, belge),
            islemtarihi = COALESCE($6::date, islemtarihi, CURRENT_DATE),
            ilkkullaniciid = COALESCE(ilkkullaniciid, $7::integer),
            kullaniciid = COALESCE($7::integer, kullaniciid),
            gelir = $8,
            arac_modeli = $9,
            tapu_bilgisi = $10,
            vergi_mukellefiyeti = $11,
            etiket = $12
        WHERE id = $1::bigint
        RETURNING id::text,
                  dosyaid::text,
                  tipi,
                  baslik,
                  icerik,
                  etiket,
                  belge IS NOT NULL AS has_belge,
                  COALESCE(octet_length(belge), 0) AS belge_size,
                  ilkislemtarihi,
                  islemtarihi,
                  ilkkullaniciid,
                  kullaniciid,
                  gelir,
                  arac_modeli,
                  tapu_bilgisi,
                  vergi_mukellefiyeti;
      `,
      [
        id,
        normalizeInteger(payload.tipi) ?? 0,
        baslik,
        // Bkz. POST'taki ayni-amacli aciklama - mime turu artik icerik
        // metnine eklenmiyor (sniffMimeFromBytes yeterli).
        normalizeText(payload.icerik),
        belgeData,
        tarih,
        sessionUserId,
        normalizeText(payload.gelir),
        normalizeText(payload.aracModeli),
        normalizeText(payload.tapuBilgisi),
        normalizeText(payload.vergiMukellefiyeti),
        normalizeEtiket(payload.etiket),
      ],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Guncellenecek belge bulunamadi.' }, { status: 404 })
    }

    const [enrichedRecord] = await attachAddedByNames([mapBelgeRow(result.rows[0])])
    await reevaluateAutoRejectSilently(enrichedRecord.dosyaid, request)
    return NextResponse.json({ success: true, data: enrichedRecord })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Belge guncellenemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.attachments', page: '/documents' })
    if (accessDenied) return accessDenied

    const id = normalizeBigInt(request.nextUrl.searchParams.get('id'))

    if (!id) {
      return NextResponse.json({ success: false, error: 'Silinecek belge secilmedi.' }, { status: 400 })
    }

    const result = await getDkmBelgePool().query<{ id: string; dosyaid: string | null }>(
      `
        DELETE FROM public.belge
        WHERE id = $1::bigint
        RETURNING id::text, dosyaid::text;
      `,
      [id],
    )

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek belge bulunamadi.' }, { status: 404 })
    }

    await reevaluateAutoRejectSilently(result.rows[0].dosyaid, request)
    return NextResponse.json({ success: true, data: result.rows[0] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Belge silinemedi.' },
      { status: 500 },
    )
  }
}

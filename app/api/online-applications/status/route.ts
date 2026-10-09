import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { checkRateLimit, getRequestClientKey } from '@/lib/security/rateLimit'
import { foldTurkish } from '@/lib/utils'

export const dynamic = 'force-dynamic'

// Kullanici istegi (14 Eylul 2026, 22. tur): "SADECE online islemlerdeki
// başvuru sorgulama listesinde" (bu uc nokta zaten SADECE /onlinebasvuru'daki
// vatandas sorgulama ekranina veri verir - baska hicbir ic yonetim ekranini
// ETKİLEMEZ) - asama bilgisine gore aciklama alani vatandasa daha anlasilir
// sabit bir metinle DEGISTIRILIR. foldTurkish (lib/utils.ts, Turkce-duyarsiz
// arama sisteminde kullanilan AYNI fonksiyon) ile buyuk/kucuk harf ve Turkce
// aksan farki gozetilmeden karsilastirilir.
function friendlyStatusNote(stage: string, fallbackNote: string): string {
  const foldedStage = foldTurkish(stage)
  if (foldedStage.includes('uygun degil')) return 'BAŞVURUNUZ YAPILAN İNCELEME SONUCU UYGUN GÖRÜLMEMİŞTİR.'
  if (foldedStage.includes('uygundur')) return 'BAŞVURUNUZ UYGUN GÖRÜLMÜŞTÜR.'
  if (foldedStage.includes('incelenecek')) return 'BAŞVURUNUZ HENÜZ İNCELEME AŞAMASINDADIR.'
  return fallbackNote
}

type StatusPayload = {
  tc?: string
  birthDate?: string
}

type OnlineApplicationRow = {
  id: number
  created_at: Date | string | null
  yardim_turu: string | null
  status: string | null
  asama: string | null
  aciklama: string | null
  ad: string | null
  soyad: string | null
  donem: string | null
}

// Kullanici istegi (14 Eylul 2026, 16. tur): "sorgulama hem online basvuru
// listesindeki hem de yrd_ayninakti (Nakit Yardimi muracaatlari) listesindeki
// TUM basvurularini gostersin". yrd_ayninakti'nin ayri kolonlari (isim
// yerine tek "muracaateden", "durumuaciklama" -> aciklama) asagida ayni
// cikti bicimine esleniyor.
type NakitApplicationRow = {
  id: bigint
  muracaattarihi: Date | string | null
  muracaateden: string | null
  donem: string | null
  asama: string | null
  durumuaciklama: string | null
}

function cleanTc(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D/g, '').slice(0, 11) : ''
}

export async function POST(request: Request) {
  try {
    // Ters proxy yokken getRequestClientKey sabittir -> bu sinir GLOBAL bir
    // tavandir; makul tutulur (vatandas durum sorgusu).
    const rateLimit = checkRateLimit(`online-status:${getRequestClientKey(request)}`, {
      limit: 120,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla sorgu yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
      )
    }

    const body = await request.json() as StatusPayload
    const tc = cleanTc(body.tc)
    const birthDate = typeof body.birthDate === 'string' ? body.birthDate.trim() : ''

    if (tc.length !== 11) {
      return NextResponse.json(
        { success: false, error: 'TC Kimlik No 11 haneli olmalidir.' },
        { status: 400 },
      )
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      return NextResponse.json(
        { success: false, error: 'Dogum tarihi zorunludur.' },
        { status: 400 },
      )
    }

    // IP bazli sinir tek basina yeterli degil (X-Forwarded-For istemci
    // tarafindan gonderilen, guvenilmeyen bir baslik - sahtelenebilir).
    // Bu yuzden AYNI TC numarasina karsi da (kaynaktan bagimsiz) ayri bir
    // sinir uyguluyoruz - boylece IP degistirilerek tek bir TC'nin/dogum
    // tarihi kombinasyonunun otomatik olarak taranmasi engellenir.
    const tcRateLimit = checkRateLimit(`online-status-tc:${tc}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!tcRateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'Çok fazla sorgu yapıldı. Lütfen kısa süre sonra tekrar deneyin.' },
        { status: 429, headers: { 'Retry-After': String(tcRateLimit.retryAfterSeconds) } },
      )
    }

    // Kullanici istegi (14 Eylul 2026, 17. tur): "son 180 gun icerisinde
    // yapilmis muracaatlari goster" - iki sorguya da tarih siniri eklendi.
    //
    // ONEMLI DUZELTME (19. tur): ilk denemede "(${LOOKUP_WINDOW_DAYS} || '
    // days')::interval" ve "CURRENT_DATE - ${LOOKUP_WINDOW_DAYS}" kullanildi -
    // ikisi de Postgres'in parametre tipini "integer" yerine BASKA bir seye
    // (belirsiz/varsayilan) cozmesine yol acip "operator does not exist:
    // date >= integer" hatasiyla TUM sorgulama ekranini bozdu (400 hatasi).
    // "make_interval(days => ...)" fonksiyonu parametre tipini ACIKCA
    // integer olarak zorunlu kildigi icin bu belirsizligi ortadan kaldirir.
    const LOOKUP_WINDOW_DAYS = 180

    const [onlineRows, nakitRows] = await Promise.all([
      prisma.$queryRaw<OnlineApplicationRow[]>`
        SELECT
          id,
          created_at,
          yardim_turu,
          status,
          asama,
          aciklama,
          ad,
          soyad,
          donem
        FROM online_basvurular
        WHERE tckimlikno = ${tc}
          AND dogumtarihi = ${birthDate}
          AND created_at >= NOW() - make_interval(days => ${LOOKUP_WINDOW_DAYS})
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 10
      `,
      // Kullanici istegi (20. tur): "yrd_ayninakti'de de sorgulasin, hepsini
      // listelesin" - TC eslesse bile, personel girisinde t.dogumtarihi
      // COGU ZAMAN bos birakildigi icin (canli veride ~30 bin kayittan
      // ~30 bininde bos - %25) asagidaki katı esitlik kontrolu bu
      // muracaatlarin NEREDEYSE TAMAMINI sessizce eliyordu ("sadece online
      // basvurularda buluyor" izlenimi buradan geliyordu). Dosyanin kendi
      // "bireyler" (hane/dosya kisileri) kaydinda AYNI TC icin dogum tarihi
      // NEREDEYSE HER ZAMAN dolu (bos olanlarin %99.5'i buradan
      // tamamlanabiliyor, dogrulandi) - bu yuzden t.dogumtarihi bossa
      // dosyanin kendi bireyler kaydina duser.
      //
      // Kullanici istegi (2026-09-29, devam): "müracaatçının AKTİF DOSYASI
      // YOK ise başvurusu sorgulanmıyor" - kok neden: yukaridaki fallback
      // SADECE "b.dosyaid = t.dosyaid" esleseni ariyordu; muracaatin
      // dosyaid'i artik gecerli/aktif bir dosyaya isaret etmiyorsa (dosya
      // silinmis/hic olusmamis) bu alt sorgu BOS donuyor, COALESCE null
      // kaliyor, esitlik hicbir zaman saglanmiyor, kayit vatandasa GORUNMEZ
      // oluyordu - dosyasi olmayan/olmus kisiler kendi nakit basvurularini
      // goremiyordu. Iki ek fallback eklendi: (1) AYNI TC'ye ait HERHANGI
      // bir bireyler kaydi (hangi dosyaya bagli olursa olsun - dosyaid sarti
      // KALDIRILDI), (2) online_basvurular'a bu TC ile daha once girilmis
      // (formda yakalanmis) dogum tarihi. Ucu de bulunamazsa kayit yine
      // eskisi gibi gorunmez (guvenlik: TC tek basina yeterli degil).
      prisma.$queryRaw<NakitApplicationRow[]>`
        SELECT
          t.id,
          t.muracaattarihi,
          t.muracaateden,
          t.donem,
          t.asama,
          t.durumuaciklama
        FROM yrd_ayninakti t
        WHERE t.tckimlikno = ${tc}
          AND COALESCE(
            t.dogumtarihi,
            (SELECT b.dogumtarihi FROM bireyler b WHERE b.tckimlikno = t.tckimlikno ORDER BY b.dosyaid DESC NULLS LAST LIMIT 1),
            (SELECT o.dogumtarihi::date FROM online_basvurular o WHERE o.tckimlikno = t.tckimlikno AND o.dogumtarihi IS NOT NULL AND o.dogumtarihi ~ '^\\d{4}-\\d{2}-\\d{2}$' ORDER BY o.created_at DESC LIMIT 1)
          ) = ${birthDate}::date
          AND t.muracaattarihi >= (CURRENT_DATE - make_interval(days => ${LOOKUP_WINDOW_DAYS}))::date
        ORDER BY t.muracaattarihi DESC NULLS LAST, t.id DESC
        LIMIT 10
      `,
    ])

    const results = [
      ...onlineRows.map((row) => ({
        id: `online-${row.id}`,
        date: row.created_at,
        name: [row.ad, row.soyad].filter(Boolean).join(' ').trim() || null,
        assistanceType: row.yardim_turu || 'Online Başvuru',
        period: row.donem || '',
        stage: row.asama || row.status || '',
        note: friendlyStatusNote(row.asama || row.status || '', row.aciklama || ''),
      })),
      ...nakitRows.map((row) => ({
        id: `nakit-${row.id.toString()}`,
        date: row.muracaattarihi,
        name: row.muracaateden || null,
        assistanceType: 'Nakit Yardımı',
        period: row.donem || '',
        stage: row.asama || '',
        note: friendlyStatusNote(row.asama || '', row.durumuaciklama || ''),
      })),
    ].sort((a, b) => {
      const aTime = a.date ? new Date(a.date).getTime() : 0
      const bTime = b.date ? new Date(b.date).getTime() : 0
      return bTime - aTime
    })

    return NextResponse.json({ success: true, data: results })
  } catch (error) {
    // Bu uc nokta oturumsuz/herkese acik oldugu icin ham hata mesaji
    // (ör. veritabani hata detayi) istemciye DONMEZ - sadece sunucu
    // loguna yazilir, disariya genel bir mesaj verilir.
    console.error('online-applications/status hatasi:', error)
    return NextResponse.json(
      { success: false, error: 'Basvuru durumu sorgulanamadi.' },
      { status: 400 },
    )
  }
}

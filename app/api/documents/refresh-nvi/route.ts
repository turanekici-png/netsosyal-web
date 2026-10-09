import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess } from '@/lib/apiAuth'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { regeocodeFileLocationInBackground } from '@/lib/services/fileLocation.service'
import { fetchKentRehberiAddressDetails } from '@/lib/services/geocoding'
import { internalOrigin } from '@/lib/internalOrigin'

export const dynamic = 'force-dynamic'

const ADDRESS_NOT_FOUND_TEXT = 'Adres Sorgulanamad\u0131'
const NVI_LABEL = 'NV\u0130'

type NviPersonData = {
  ad?: string
  soyad?: string
  anneAdi?: string
  babaAdi?: string
  dogumYeri?: string
  cinsiyet?: string
  medeniHal?: string
  dogumTarihi?: string
  olumTarihi?: string
  adres?: string
  adresNo?: string
  ilce?: string
  mahalle?: string
  cadde?: string
  sokak?: string
  caddeSokak?: string
  binaNo?: string
  daireNo?: string
}

function parseNviDate(value: unknown, fallback?: Date | null) {
  const text = String(value ?? '').trim()
  if (!text) return fallback ?? null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  const tr = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)
  const normalized = iso
    ? `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`
    : tr
      ? `${tr[3]}-${tr[2].padStart(2, '0')}-${tr[1].padStart(2, '0')}`
      : ''
  if (!normalized) return fallback ?? null
  const parsed = new Date(`${normalized}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? fallback ?? null : parsed
}

function cleanMaritalStatus(value: unknown, fallback?: number | null) {
  const numberValue = Number(value)
  if (Number.isFinite(numberValue) && String(value ?? '').trim() !== '') return numberValue

  const normalized = String(value ?? '')
    .toLocaleLowerCase('tr-TR')
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ö', 'o')
    .replaceAll('ü', 'u')
    .replaceAll('ğ', 'g')
    .replaceAll('ç', 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (normalized.includes('bekar') || normalized.includes('single')) return 1
  if (normalized.includes('evli') || normalized.includes('married')) return 2
  if (normalized.includes('dul')) return 3
  if (normalized.includes('bosan') || normalized.includes('boşan') || normalized.includes('divorc')) return 4

  return fallback ?? null
}

function normalizeGender(value: unknown, fallback?: string | null) {
  const normalized = String(value ?? '').toLocaleUpperCase('tr-TR')
  if (normalized === '1' || normalized === 'E' || normalized === 'ERKEK') return 'E'
  if (normalized === '2' || normalized === 'K' || normalized === 'KADIN') return 'K'
  return fallback ?? null
}

function isZeroCode(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === '') return false
  return Number(value) === 0
}

// BULUNAN GERCEK KOK NEDEN: "kimin hane reisi (mueracaat sahibi) oldugunu"
// belirlemek icin eskiden "isZeroCode(person.relation) || isZeroCode(person.status)"
// kullaniliyordu. person.status, veritabanindaki "tipi" kolonuna denk gelir -
// ve app/api/documents/update/route.ts'teki otomatik damga MANTIGINA gore
// "tipi=1" hane reisini, "tipi=0" ise DIGER TUM hane bireylerini isaretler
// (bkz. "SET tipi = CASE WHEN yakinligi = 0 THEN 1 ELSE 0 END"). Yani
// "isZeroCode(person.status)" (tipi===0 arayan) aslinda hane reisi HARICINDEKI
// HERKESLE eslesiyordu! "relation===0 (gercek hane reisi) VEYA tipi===0 (hane
// reisi OLMAYAN herkes)" OR'u pratikte NEREDEYSE HERKESI "ana basvurucu"
// sayiyordu - dongude EN SON islenen kisi (genelde hane reisi DEGIL, en son
// eklenen/en yuksek ID'li birey) kazanip dosyaya kendi (cogu zaman eksik)
// adresini yaziyordu. Bu, "Nüfus Güncelle butonuyla cadde/sokak
// kaydedilmiyor" sikayetinin GERCEK kok nedeniydi.
function isHaneReisi(candidate: { relation: unknown; status: unknown }) {
  return isZeroCode(candidate.relation) || Number(candidate.status) === 1
}

function toDateInput(value?: Date | string | null) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// Kullanici istegi (2026-09-28, dosya yonetiminde koy adresi test edilirken
// bulundu): "adres bilgisini dosyaya yazıyor ama ... hata oluştu diyor" -
// KOK NEDEN: NVİ/Kent Rehberi'nden gelen cadde/sokak/mahalle gibi alanlar
// "dosyalar" tablosundaki KISA varchar kolonlara (cadde/sokak/mahalleadi/
// site varchar(30), blok varchar(20), binano varchar(10), daireno
// varchar(5)) UZUNLUKLARI KONTROL EDILMEDEN yaziliyordu. Koy adreslerinde
// sokak/cadde adi genelde "... KÖY SOKAĞI KÜME EVLERİ" gibi uzun oldugundan
// (ör. 32 karakter, sinir 30) asagidaki aggregate UPDATE "value too long for
// type character varying(30)" hatasiyla TAMAMEN basarisiz oluyordu - kisinin
// KENDI (bireyler.adres, varchar(200), genis) kaydı ONCEDEN basariyla
// yazildigi icin "adres dosyaya yaziliyor ama hata da cikiyor" izlenimi
// olusuyordu (aslinda DOSYANIN KENDI cadde/sokak/mahalle/adres alanlari HİÇ
// güncellenemiyordu - butun UPDATE atomik oldugu icin). ".slice" bos/kisa
// degerlerin (mevcut '' veya dolu-ama-kisa) davranisini DEGISTIRMEZ, SADECE
// hedef kolondan uzun degerleri keser.

async function fetchNviData(
  request: NextRequest,
  tcNo: string,
  dogumYili: number,
  dogumTarihi: string,
  serviceId: 'tcKimlik'
) {
  const response = await fetch(`${internalOrigin()}/api/nvi`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: request.headers.get('cookie') || '',
    },
    body: JSON.stringify({ tcNo, dogumYili, dogumTarihi, serviceId }),
    next: { revalidate: 0 },
  })
  const payload = await response.json()

  if (!response.ok || !payload.success || !payload.data) {
    return null
  }

  return payload.data as NviPersonData
}

export async function POST(request: NextRequest) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.nvi', page: '/documents' })
    if (accessDenied) return accessDenied

    const { fileId, relationByTc } = await request.json() as {
      fileId?: string | number
      relationByTc?: Record<string, string | number>
    }
    if (!fileId) {
      return NextResponse.json({ success: false, error: 'Dosya ID eksik.' }, { status: 400 })
    }

    const beneficiaries = await prisma.beneficiary.findMany({
      where: { dosyaId: BigInt(fileId) },
      orderBy: [
        { relation: 'asc' },
        { status: 'asc' },
        { id: 'asc' },
      ],
    })

    if (beneficiaries.length === 0) {
      return NextResponse.json({ success: false, error: 'Birey bulunamad\u0131.' }, { status: 404 })
    }

    let updatedCount = 0
    let skippedCount = 0
    let addressFailedCount = 0
    let mainApplicantAddress: string | null = null
    let mainApplicantAddressNo: string | null = null
    let mainApplicantNeighborhood: string | null = null
    let mainApplicantAvenue: string | null = null
    let mainApplicantStreet: string | null = null
    let mainApplicantBuildingNo: string | null = null
    let mainApplicantApartmentNo: string | null = null
    let mainApplicantSite: string | null = null
    let mainApplicantBlok: string | null = null

    const refreshPeople = [...beneficiaries].sort((left, right) => {
      const leftMain = isHaneReisi(left)
      const rightMain = isHaneReisi(right)

      if (leftMain !== rightMain) return leftMain ? -1 : 1
      if (left.id === right.id) return 0
      return left.id < right.id ? -1 : 1
    })

    for (const [index, person] of refreshPeople.entries()) {
      if (!person.tc || person.tc.length !== 11 || !person.birthDate) {
        skippedCount += 1
        continue
      }

      // ÖNEMLİ: bu MANUEL "Nüfus Sorgula" butonu - kullanıcı bilinçli olarak
      // tıkladığı için adres sorgulama tarihi (adres_guncelleme_tarihi) ne
      // olursa olsun (1 aydan yeni bile olsa) HER ZAMAN sorgulanır ve tarih
      // bugüne güncellenir. "1 ay içinde tekrar sorgulanmasın" tazelik
      // eşiği SADECE dosya açılınca çalışan OTOMATİK arka plan tazelemesi
      // içindir (bkz. lib/services/addressAutoRefresh.service.ts) - manuel
      // butonu asla kısıtlamaz.
      const dogumYili = new Date(person.birthDate).getFullYear()
      const birthDate = toDateInput(person.birthDate)
      // Kullanici istegi: "Dosya Güncelle" ekranindaki (guvenilir calistigi
      // dogrulanan) "NVİ'den bilgileri getir" akisiyla AYNI yontem
      // kullanilir - AYRI 'tcKimlik' + 'adres' paralel sorgulari YERINE TEK
      // bir 'tcKimlik' sorgusu yapilir. /api/nvi bu servis turunde kimlik
      // bilgisiyle BIRLIKTE adres bilgisini (cadde/sokak/bina no/adres no
      // dahil) OTOMATIK olarak ayrica getirip birlestiriyor (bkz.
      // app/api/nvi/route.ts callNviBridge). STANDALONE 'adres' sorgusu
      // bazen cadde/sokak bilgisini eksik dondurebiliyordu - "sokak/cadde
      // isimlerini tam guncellemiyor" sikayetinin sebebi buydu.
      const nviData = await fetchNviData(request, person.tc, dogumYili, birthDate, 'tcKimlik')
      // Kullanici istegi (Ekim 2026): NVI'de kisi VEFAT etmis gorunuyorsa
      // olum tarihi de bireye islensin. Olum tarihi gelmezse mevcut deger
      // KORUNUR - bu akis kimseyi "diriltmez".
      const nviDeathDate = parseNviDate(nviData?.olumTarihi, null)
      const resolvedDeathDate = nviDeathDate ? nviDeathDate.toISOString().slice(0, 10) : (person.deathDate ?? null)
      const hasAddressData = Boolean(nviData?.adres?.trim())
      const resolvedAddress = hasAddressData ? nviData!.adres!.trim() : ADDRESS_NOT_FOUND_TEXT
      const resolvedAddressNo = hasAddressData ? (nviData?.adresNo?.trim() || '') : ''
      // Kullanici istegi: NVİ adresi SORGULAYAMADIYSA, o kisinin ESKI (artik
      // dogrulugu bilinmeyen) adres bilgisi ekranda YANLIŞLIKLA guncelmis
      // gibi durmasin - ilce/mahalle de "adres" ile TUTARLI sekilde
      // temizlenir/"Adres Sorgulanamadı" yazilir (eskiden SADECE "adres"
      // alani bunu gosteriyordu, mahalle ise eski degerinde KALIYORDU - bu,
      // "adres bulunamadi ama mahalle hala eskisi gorunuyor" tutarsizligina
      // yol aciyordu).
      // ÖNEMLİ: adres SORGULANDIYSA (hasAddressData=true), NVİ'nin O ANKI
      // yanitindaki ilce/mahalle ne ise (bos bile olsa) DOGRUDAN yazilir -
      // eski (person.district/neighborhood) deger ARTIK yedek olarak
      // KULLANILMAZ. Eskiden "|| person.district" gibi bir son-care yedek
      // vardi - bu, NVİ adresi basariyla dondugu halde alt alanlardan biri
      // (ör. sadece ilce) bos gelirse o alanin SESSIZCE eski/tutarsiz kalmasina
      // yol aciyordu ("bazen tam olarak dosyaya islemiyor" sikayetinin
      // sebebi).
      // Kullanici istegi: mahalle/cadde-sokak/dis-ic kapi no/site/blok gibi
      // detay adres alanlari NVİ'den GUVENILMEZ/EKSIK gelebiliyordu (ör.
      // "site"/"blok" NVİ'nin kendisinde COGUNLUKLA hic yok). Bu alanlar
      // icin, dosyanin UAVT adres numarasiyla (adresno) Sivas Belediyesi'nin
      // KENDI "Kent Rehberi" adres kartina sorulur (bu oturumda canli veriyle
      // dogrulanmis, guvenilir bir kaynak - bkz. lib/services/geocoding.ts) -
      // bulunursa bu ONCELIKLI kullanilir, bulunamazsa NVİ'nin kendi
      // alanlarina (varsa) dusulur.
      // ONEMLI: Kent Rehberi sorgusu icin SADECE bu YENI NVİ yanitindaki
      // adresno'ya degil, o BOSSA kisinin daha once KAYITLI (person.addressNo)
      // adres numarasina da bakilir - NVİ'nin kendi ic "kimlik+adres
      // birlestirme" mekanizmasi (bkz. app/api/nvi/route.ts) bazen (ic adres
      // alt-cagrisi basarisiz olursa) adresNo'yu BU sorguda DONDURMEYEBILIYOR,
      // ama kisi icin zaten bilinen bir adres numarasi varsa Kent Rehberi'nden
      // yine de dogru sonuc alinabilir.
      const addressNoForKentRehberi = hasAddressData ? (nviData?.adresNo?.trim() || person.addressNo || '') : ''
      const kentRehberiDetails = addressNoForKentRehberi
        ? await fetchKentRehberiAddressDetails(addressNoForKentRehberi)
        : null

      const resolvedDistrict = hasAddressData ? (nviData?.ilce || '').slice(0, 50) : null
      const resolvedNeighborhood = hasAddressData ? (kentRehberiDetails?.mahalle || nviData?.mahalle || '').slice(0, 50) : ADDRESS_NOT_FOUND_TEXT

      if (!hasAddressData) {
        addressFailedCount += 1
      }

      await withAuditedWrite((tx) => tx.beneficiary.update({
        where: { id: person.id },
        data: {
          firstName: nviData?.ad || person.firstName,
          lastName: nviData?.soyad || person.lastName,
          name: [nviData?.ad || person.firstName, nviData?.soyad || person.lastName].filter(Boolean).join(' '),
          fatherName: nviData?.babaAdi || person.fatherName,
          motherName: nviData?.anneAdi || person.motherName,
          birthPlace: nviData?.dogumYeri || person.birthPlace,
          birthDate: parseNviDate(nviData?.dogumTarihi, person.birthDate),
          deathDate: resolvedDeathDate,
          gender: normalizeGender(nviData?.cinsiyet, person.gender),
          maritalStatus: cleanMaritalStatus(nviData?.medeniHal, person.maritalStatus),
          relation: (() => {
            const relationValue = relationByTc?.[person.tc || '']
            const numericRelation = Number(relationValue)
            return Number.isInteger(numericRelation) && numericRelation >= 0 ? numericRelation : person.relation
          })(),
          district: resolvedDistrict,
          neighborhood: resolvedNeighborhood,
          address: resolvedAddress,
          addressNo: resolvedAddressNo,
          // NVİ'den adres sorgusu YAPILDI (sonucu boş çıksa bile) - bu, "1 ay
          // içinde tekrar otomatik sorgulanmasın" tazelik damgasıdır (bkz.
          // lib/services/addressAutoRefresh.service.ts).
          addressUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      }), getAuditMetaFromRequest(request))

      const isMainApplicant = isHaneReisi(person) || index === 0
      if (isMainApplicant) {
        mainApplicantAddress = resolvedAddress
        mainApplicantAddressNo = resolvedAddressNo
        if (hasAddressData) {
          // Ayni sebeple: bu alanlar da NVİ'nin O ANKI yanitini DOGRUDAN
          // yansitir - eskiden "|| mainApplicantX" son-care yedegi, o alan
          // NVİ'den bos donunce degiskenin baslangic degeri olan null'da
          // kalmasina, bu da asagidaki COALESCE'nin dosyadaki ESKI degeri
          // KORUMASINA (sessizce guncellenmemesine) yol aciyordu.
          mainApplicantNeighborhood = (kentRehberiDetails?.mahalle || nviData?.mahalle || '').slice(0, 30)
          mainApplicantAvenue = (kentRehberiDetails?.cadde || nviData?.cadde || '').slice(0, 30)
          mainApplicantStreet = (kentRehberiDetails?.sokak || nviData?.sokak || nviData?.caddeSokak || '').slice(0, 30)
          mainApplicantBuildingNo = (kentRehberiDetails?.binano || nviData?.binaNo || '').slice(0, 10)
          mainApplicantApartmentNo = (kentRehberiDetails?.daireno || nviData?.daireNo || '').slice(0, 5)
          // "site"/"blok" SADECE Kent Rehberi'nden gelir - NVİ'de bu alanlar
          // hic yok, bu yuzden NVİ'ye yedek olarak DUSULMEZ.
          mainApplicantSite = (kentRehberiDetails?.site || '').slice(0, 30)
          mainApplicantBlok = (kentRehberiDetails?.blok || '').slice(0, 20)
        } else {
          // Adres sorgulanamadi - dosyadaki mahalle/cadde/sokak/bina no/
          // site/blok da artik guvenilir degil, ayni sekilde temizlenir/
          // isaretlenir.
          mainApplicantNeighborhood = ADDRESS_NOT_FOUND_TEXT
          mainApplicantAvenue = ''
          mainApplicantStreet = ''
          mainApplicantBuildingNo = ''
          mainApplicantApartmentNo = ''
          mainApplicantSite = ''
          mainApplicantBlok = ''
        }
      }

      updatedCount += 1
    }

    if (
      mainApplicantAddress ||
      mainApplicantAddressNo ||
      mainApplicantNeighborhood ||
      mainApplicantAvenue ||
      mainApplicantStreet ||
      mainApplicantBuildingNo ||
      mainApplicantApartmentNo ||
      mainApplicantSite ||
      mainApplicantBlok
    ) {
      await withAuditedWrite((tx) => tx.$executeRaw`
        UPDATE dosyalar
        SET
          adres = COALESCE(${mainApplicantAddress}, adres),
          adresno = COALESCE(${mainApplicantAddressNo}, adresno),
          mahalleadi = COALESCE(${mainApplicantNeighborhood}, mahalleadi),
          cadde = COALESCE(${mainApplicantAvenue}, cadde),
          sokak = COALESCE(${mainApplicantStreet}, sokak),
          binano = COALESCE(${mainApplicantBuildingNo}, binano),
          daireno = COALESCE(${mainApplicantApartmentNo}, daireno),
          site = COALESCE(${mainApplicantSite}, site),
          blok = COALESCE(${mainApplicantBlok}, blok),
          islemtarihi = NOW(),
          -- Kullanici istegi: adres NVİ'den burada degisebildigi icin ESKI
          -- konum ARTIK GUVENILIR DEGIL - "ok" damgasi kaldirilir, asagida
          -- tetiklenen regeocodeFileLocationInBackground YENI adresle (once
          -- Kent Rehberi UAVT adres numarasiyla) konumu yeniden hesaplar.
          konum_durumu = NULL,
          konum_enlem = NULL,
          konum_boylam = NULL,
          konum_kaynagi = NULL,
          konum_guven = NULL,
          konum_hata = NULL,
          konum_adres_hash = NULL
        WHERE id = ${BigInt(fileId)};
      `, getAuditMetaFromRequest(request))

      regeocodeFileLocationInBackground(BigInt(fileId), getAuditMetaFromRequest(request))
    }

    return NextResponse.json({
      success: true,
      message: `${updatedCount} birey ${NVI_LABEL}'den g\u00fcncellendi${addressFailedCount ? `, ${addressFailedCount} bireyin adresi sorgulanamad\u0131` : ''}${skippedCount ? `, ${skippedCount} birey atland\u0131` : ''}.`,
    })
  } catch (error) {
    console.error('Refresh NVI error:', error)
    return NextResponse.json({ success: false, error: '\u0130\u015flem s\u0131ras\u0131nda hata olu\u015ftu.' }, { status: 500 })
  }
}

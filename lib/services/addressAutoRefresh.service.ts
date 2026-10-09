// Bir dosya açıldığında, o dosyadaki bireylerin adresi EN SON ne zaman
// NVİ'den (nüfus) sorgulandı kontrol edilir (bireyler.adres_guncelleme_tarihi) -
// bu tarih 1 aydan eskiyse (ya da hiç yoksa), kullanıcı hiçbir şey yapmadan,
// arka planda otomatik olarak NVİ'den güncellenir. NVİ sorguları (yavaş
// olabilecek dış servis çağrıları) ASLA dosya açma isteğini BEKLETMEZ - sadece
// "kaç bireyin adresi güncellenecek" tespiti (hızlı bir veritabanı sorgusu)
// senkron yapılır, gerçek güncelleme arka planda devam eder. Durum,
// /api/documents/address-refresh-status üzerinden anlık sorgulanabilir - bu
// sayede ekranda "Adres NVİ'den güncelleniyor..." bildirimi gösterilebilir
// (bkz. app/(modules)/documents/page.tsx).
//
// Manuel "Nüfus Sorgula" butonuyla (app/api/documents/refresh-nvi/route.ts)
// AYNI tazelik damgasını kullanır - biri diğerinin "1 ay içinde tekrar
// sorgulama" korumasını miras alır.
//
// Kullanıcı isteği (Eylül 2026): dosya adı hâlâ "address...AutoRefresh" olsa
// da bu akış artık SADECE adresi değil, manuel "Nüfus Sorgula" ile AYNI
// kimlik alanlarını da (ad/soyad/ana-baba adı/doğum yeri-tarihi/cinsiyet/
// medeni hal ve ÖLÜM TARİHİ) günceller - kişi vefat etmişse otomatik
// güncellemede de ölüm tarihi işlenir (eskiden bunun için ayrıca manuel
// butona basmak gerekiyordu).

import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAuditMetaFromRequest, withAuditedWrite } from '@/lib/db/auditContext'
import { regeocodeFileLocationInBackground } from '@/lib/services/fileLocation.service'
import { fetchKentRehberiAddressDetails } from '@/lib/services/geocoding'
import { internalOrigin } from '@/lib/internalOrigin'

// "bir ay" = 30 gün - hem OTOMATİK (aşağıdaki triggerStaleAddressAutoRefresh)
// hem de MANUEL ("Nüfus Sorgula" butonu, app/api/documents/refresh-nvi/route.ts)
// tazelik kontrolü AYNI eşiği kullanır (dışa aktarılmıştır).
export const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000
const STATUS_RETENTION_MS = 5 * 60 * 1000 // tamamlanan durum kaydı 5 dk sonra bellekten temizlenir

export type AddressRefreshStatus = {
  status: 'refreshing' | 'done'
  staleCount: number
  updatedCount: number
  startedAt: number
  finishedAt: number | null
}

const statusByDosyaId = new Map<string, AddressRefreshStatus>()
// Aynı dosya için aynı anda birden fazla tazeleme denemesi başlamasın diye.
const dosyaIdsInProgress = new Set<string>()

type NviAddressData = {
  adres?: string
  adresNo?: string
  ilce?: string
  mahalle?: string
  cadde?: string
  sokak?: string
  caddeSokak?: string
  binaNo?: string
  daireNo?: string
  // Kullanici istegi (Eylul 2026): /api/nvi 'tcKimlik' sorgusu adresle
  // BIRLIKTE kimlik alanlarini da donduruyor - otomatik guncelleme artik
  // (manuel "Nüfus Sorgula" gibi) bunlari da yaziyor.
  ad?: string
  soyad?: string
  anneAdi?: string
  babaAdi?: string
  dogumYeri?: string
  cinsiyet?: string
  medeniHal?: string
  dogumTarihi?: string
  olumTarihi?: string
}

function toDateInput(value: Date | string | null | undefined) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

// --- Kimlik alani ayristiricilari ---
// app/api/documents/refresh-nvi/route.ts'teki AYNI isimli fonksiyonlarin
// BIREBIR kopyasi (bu dosya zaten isZeroCode/isHaneReisi/toDateInput'u da
// oradan kopyaliyor - ayni desen). Ikisi DEGISIRSE birlikte degismeli.
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
    .replace(/[̀-ͯ]/g, '')

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

// BULUNAN GERCEK KOK NEDEN (bkz. app/api/documents/refresh-nvi/route.ts'teki
// AYNI isimli yorum): "hane reisi" tespiti icin eskiden
// "isZeroCode(person.relation) || isZeroCode(person.status)" kullaniliyordu.
// person.status = "tipi" kolonu, ve "tipi=1" hane reisini, "tipi=0" ise
// DIGER TUM hane bireylerini isaretler (bkz. app/api/documents/update/route.ts).
// "isZeroCode(status)" (tipi===0 arayan) hane reisi HARICINDEKI HERKESLE
// eslesiyordu - bu yuzden dosyaya cadde/sokak/bina no gibi bilgiler cogu
// zaman YANLIŞ (son islenen, genelde hane reisi OLMAYAN) kisiden yaziliyordu.
function isHaneReisi(candidate: { relation: unknown; status: unknown }) {
  return isZeroCode(candidate.relation) || Number(candidate.status) === 1
}

// Kullanici istegi: "Dosya Güncelle" ekranindaki (guvenilir calistigi
// dogrulanan) "NVİ'den bilgileri getir" akisiyla AYNI yontem kullanilir -
// serviceId 'adres' ile STANDALONE sorgu YERINE varsayilan 'tcKimlik'
// sorgusu yapilir. /api/nvi bu servis turunde kimlik bilgisiyle BIRLIKTE
// adres bilgisini (cadde/sokak/bina no/adres no dahil) OTOMATIK olarak
// ayrica getirip birlestiriyor (bkz. app/api/nvi/route.ts callNviBridge).
// STANDALONE 'adres' sorgusu bazen cadde/sokak bilgisini eksik
// dondurebiliyordu - "sokak/cadde isimlerini tam guncellemiyor" sikayetinin
// sebebi buydu.
async function fetchNviAddress(
  request: NextRequest,
  tcNo: string,
  dogumYili: number,
  dogumTarihi: string,
): Promise<NviAddressData | null> {
  try {
    const response = await fetch(`${internalOrigin()}/api/nvi`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: request.headers.get('cookie') || '',
      },
      body: JSON.stringify({ tcNo, dogumYili, dogumTarihi, serviceId: 'tcKimlik' }),
      next: { revalidate: 0 },
    })
    const payload = await response.json()
    if (!response.ok || !payload.success || !payload.data) return null
    return payload.data as NviAddressData
  } catch {
    return null
  }
}

export function getAddressRefreshStatus(dosyaId: bigint): AddressRefreshStatus | null {
  return statusByDosyaId.get(dosyaId.toString()) ?? null
}

// Bir dosyanın bireylerinden HANGİLERİNİN adresi 1 aydan eski (ya da hiç
// sorgulanmamış) olduğunu tespit eder (HIZLI, senkron beklenir), sadece
// ONLARI arka planda (bu fonksiyon dönmüş OLDUKTAN SONRA) NVİ'den günceller.
// Dönüş değeri, çağıran kodun ekranda anında bildirim göstermesini sağlar.
export async function triggerStaleAddressAutoRefresh(
  dosyaId: bigint,
  request: NextRequest,
): Promise<{ triggered: boolean; staleCount: number }> {
  const key = dosyaId.toString()
  if (dosyaIdsInProgress.has(key)) {
    const existing = statusByDosyaId.get(key)
    return { triggered: Boolean(existing), staleCount: existing?.staleCount ?? 0 }
  }

  const staleBefore = new Date(Date.now() - STALE_THRESHOLD_MS)
  const staleBeneficiaries = await prisma.beneficiary.findMany({
    where: {
      dosyaId,
      tc: { not: null },
      birthDate: { not: null },
      OR: [
        { addressUpdatedAt: null },
        { addressUpdatedAt: { lt: staleBefore } },
      ],
    },
  })

  if (staleBeneficiaries.length === 0) {
    return { triggered: false, staleCount: 0 }
  }

  dosyaIdsInProgress.add(key)
  statusByDosyaId.set(key, {
    status: 'refreshing',
    staleCount: staleBeneficiaries.length,
    updatedCount: 0,
    startedAt: Date.now(),
    finishedAt: null,
  })

  void runStaleAddressRefresh(dosyaId, staleBeneficiaries, request)
    .catch(() => { /* yan islem - sessizce yoksay */ })
    .finally(() => {
      dosyaIdsInProgress.delete(key)
      const current = statusByDosyaId.get(key)
      if (current) {
        statusByDosyaId.set(key, { ...current, status: 'done', finishedAt: Date.now() })
        setTimeout(() => statusByDosyaId.delete(key), STATUS_RETENTION_MS)
      }
    })

  return { triggered: true, staleCount: staleBeneficiaries.length }
}

async function runStaleAddressRefresh(
  dosyaId: bigint,
  staleBeneficiaries: Awaited<ReturnType<typeof prisma.beneficiary.findMany>>,
  request: NextRequest,
): Promise<void> {
  const key = dosyaId.toString()
  const auditMeta = getAuditMetaFromRequest(request)

  let mainApplicantAddress: string | null = null
  let mainApplicantAddressNo: string | null = null
  let mainApplicantNeighborhood: string | null = null
  let mainApplicantAvenue: string | null = null
  let mainApplicantStreet: string | null = null
  let mainApplicantBuildingNo: string | null = null
  let mainApplicantApartmentNo: string | null = null
  let mainApplicantSite: string | null = null
  let mainApplicantBlok: string | null = null

  for (const person of staleBeneficiaries) {
    if (!person.tc || person.tc.length !== 11 || !person.birthDate) continue

    const dogumYili = new Date(person.birthDate).getFullYear()
    const birthDate = toDateInput(person.birthDate)
    const nviData = await fetchNviAddress(request, person.tc, dogumYili, birthDate)
    const addressData = nviData
    const hasAddressData = Boolean(addressData?.adres?.trim())

    // Kullanici istegi (Eylul 2026): "otomatik nüfus güncellemesinde de TÜM
    // bilgileri güncellesin - kişi ölmüşse ölüm tarihini de işlesin, şu an
    // sadece adresi güncelliyor, ölüm tarihi için ayrıca 'Nüfus Sorgula'ya
    // basmak gerekiyor". /api/nvi 'tcKimlik' yaniti adresle BIRLIKTE kimlik
    // alanlarini da donduruyor - manuel "Nüfus Sorgula" (app/api/documents/
    // refresh-nvi/route.ts) ile AYNI kimlik alanlari burada da yazilir.
    // Adres SORGULANAMASA bile (NVİ kisiyi bulup kimlik dondurdugu surece)
    // kimlik + olum tarihi guncellenir. Olum tarihi NVİ'den GELMEZSE mevcut
    // deger KORUNUR - bu akis kimseyi "diriltmez".
    const nviDeathDate = parseNviDate(nviData?.olumTarihi, null)
    const identityUpdate = nviData
      ? {
          firstName: nviData.ad || person.firstName,
          lastName: nviData.soyad || person.lastName,
          name: [nviData.ad || person.firstName, nviData.soyad || person.lastName].filter(Boolean).join(' '),
          fatherName: nviData.babaAdi || person.fatherName,
          motherName: nviData.anneAdi || person.motherName,
          birthPlace: nviData.dogumYeri || person.birthPlace,
          birthDate: parseNviDate(nviData.dogumTarihi, person.birthDate),
          deathDate: nviDeathDate ? nviDeathDate.toISOString().slice(0, 10) : (person.deathDate ?? null),
          gender: normalizeGender(nviData.cinsiyet, person.gender),
          maritalStatus: cleanMaritalStatus(nviData.medeniHal, person.maritalStatus),
        }
      : null

    if (!hasAddressData) {
      // NVİ'den adres alınamadı - mevcut adres DEĞİŞTİRİLMEZ, ama tazelik
      // damgası yine de güncellenir ki her dosya açılışında boşuna tekrar
      // tekrar denenmesin (1 ay sonra tekrar denenir). Kimlik/ölüm tarihi
      // bilgisi geldiyse o yine de yazılır.
      await withAuditedWrite((tx) => tx.beneficiary.update({
        where: { id: person.id },
        data: { ...(identityUpdate ?? {}), addressUpdatedAt: new Date() },
      }), auditMeta).catch(() => { /* yoksay */ })
    } else {
      // Kullanici istegi: NVİ adresi BASARIYLA dondugunde, cekilen veri HER
      // ZAMAN oldugu gibi yazilsin - eskiden tek tek alt alanlar (ilce/
      // mahalle/adresno) NVİ'den BOS gelirse sessizce ESKI (person.*)
      // degerde birakiliyordu; bu da "adres guncellendi" derken aslinda
      // bazi alanlarin eski/tutarsiz kalmasina yol aciyordu ("bazen tam
      // olarak dosyaya islemiyor" sikayetinin sebebi). Artik NVİ'nin O ANKI
      // yanitindaki alan ne ise (bos bile olsa) DOGRUDAN yazilir - eski
      // deger ASLA yedek olarak kullanilmaz.
      const resolvedAddress = addressData!.adres!.trim()
      const resolvedAddressNo = addressData?.adresNo?.trim() || ''
      const resolvedDistrict = addressData?.ilce || ''
      // Kullanici istegi: mahalle/cadde-sokak/dis-ic kapi no/site/blok gibi
      // detay adres alanlari NVİ'den GUVENILMEZ/EKSIK gelebiliyordu (ör.
      // "site"/"blok" NVİ'nin kendisinde COGUNLUKLA hic yok). Bu alanlar icin,
      // dosyanin UAVT adres numarasiyla (adresno) Sivas Belediyesi'nin KENDI
      // "Kent Rehberi" adres kartina sorulur (canli veriyle dogrulanmis,
      // guvenilir bir kaynak - bkz. lib/services/geocoding.ts) - bulunursa
      // ONCELIKLI kullanilir, bulunamazsa NVİ'nin kendi alanlarina dusulur.
      // ONEMLI: Kent Rehberi sorgusu icin SADECE bu YENI NVİ yanitindaki
      // adresno'ya degil, o BOSSA kisinin daha once KAYITLI (person.addressNo)
      // adres numarasina da bakilir - bkz. app/api/documents/refresh-nvi/route.ts'teki
      // ayni yorum.
      const addressNoForKentRehberi = resolvedAddressNo || person.addressNo || ''
      const kentRehberiDetails = addressNoForKentRehberi ? await fetchKentRehberiAddressDetails(addressNoForKentRehberi) : null
      const resolvedNeighborhood = kentRehberiDetails?.mahalle || addressData?.mahalle || ''

      await withAuditedWrite((tx) => tx.beneficiary.update({
        where: { id: person.id },
        data: {
          ...(identityUpdate ?? {}),
          district: resolvedDistrict,
          neighborhood: resolvedNeighborhood,
          address: resolvedAddress,
          addressNo: resolvedAddressNo,
          addressUpdatedAt: new Date(),
        },
      }), auditMeta).catch(() => { /* yoksay - yan islem */ })

      const isMainApplicant = isHaneReisi(person)
      if (isMainApplicant) {
        mainApplicantAddress = resolvedAddress
        mainApplicantAddressNo = resolvedAddressNo
        mainApplicantNeighborhood = resolvedNeighborhood
        // Kullanici istegi: cadde/sokak/bina no/daire no da (mahalle ile
        // AYNI mantikla) dosyaya yazilsin - bu alanlar eskiden burada HIC
        // cekilmiyor/guncellenmiyordu, "otomatik sorgulamalarda adres
        // bilgilerini tam guncellemiyor" sikayetinin bas sebeplerinden biri
        // buydu.
        mainApplicantAvenue = kentRehberiDetails?.cadde || addressData?.cadde || ''
        mainApplicantStreet = kentRehberiDetails?.sokak || addressData?.sokak || addressData?.caddeSokak || ''
        mainApplicantBuildingNo = kentRehberiDetails?.binano || addressData?.binaNo || ''
        mainApplicantApartmentNo = kentRehberiDetails?.daireno || addressData?.daireNo || ''
        // "site"/"blok" SADECE Kent Rehberi'nden gelir - NVİ'de bu alanlar
        // hic yok, bu yuzden NVİ'ye yedek olarak DUSULMEZ.
        mainApplicantSite = kentRehberiDetails?.site || ''
        mainApplicantBlok = kentRehberiDetails?.blok || ''
      }
    }

    const current = statusByDosyaId.get(key)
    if (current) statusByDosyaId.set(key, { ...current, updatedCount: current.updatedCount + 1 })
  }

  if (
    mainApplicantAddress || mainApplicantAddressNo || mainApplicantNeighborhood ||
    mainApplicantAvenue || mainApplicantStreet || mainApplicantBuildingNo || mainApplicantApartmentNo ||
    mainApplicantSite || mainApplicantBlok
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
        -- Kullanici istegi: NVİ'den adres burada degisebildigi icin ESKI
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
      WHERE id = ${dosyaId};
    `, auditMeta).catch(() => { /* yoksay */ })

    regeocodeFileLocationInBackground(dosyaId, auditMeta)
  }
}

export type GeocodeResult = {
  lat: number
  lon: number
  displayName?: string
  source: 'google' | 'nominatim' | 'kentrehberi'
  score?: number
}

export type GeocodeOutcome =
  | { status: 'ok'; result: GeocodeResult }
  | { status: 'not_found' | 'outside_center' | 'rate_limited' | 'error'; error: string }

const SIVAS_CENTER_BOUNDS = {
  minLat: 39.68,
  maxLat: 39.82,
  minLon: 36.90,
  maxLon: 37.14,
}

const normalizeText = (value: string) => {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
}

export const isSivasMerkezAddressText = (value: string) => {
  const normalized = normalizeText(value)
  return normalized.includes('sivas') && normalized.includes('merkez')
}

type AddressParts = {
  adres?: string | null
  mahalleadi?: string | null
  cadde?: string | null
  sokak?: string | null
  binano?: string | null
  site?: string | null
  blok?: string | null
}

const cleanAddressPart = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || ''

// "MAH."/"SK."/"CAD." gibi bazi kayitlarda alanin KENDISINDE zaten var olan
// kisaltmalari temizler - aksi halde "YENİ MAH." + " Mahallesi" birlesince
// "YENİ MAH. Mahallesi" gibi anlamsiz/bozuk bir metin ortaya cikiyordu (bu,
// gecmis denemelerin isabetsiz sonuc vermesine katkida bulunan gizli bir
// hataydi).
const stripKnownSuffix = (value: string) => (
  value.replace(/\b(MAH|MAHALLESİ|SK|SOKAK|SOKAĞI|CAD|CADDESİ)\.?\s*$/i, '').trim()
)

// NOT: bu adres adaylari, GERCEK Sivas adresleriyle Nominatim'e (OpenStreetMap)
// karsi CANLI test edilerek belirlendi. Bulgular:
//   - "{Sokak}, {Mahalle} Mahallesi, Sivas" gibi KISA/SADE, VIRGULLE AYRILMIS
//     sorgular GUVENILIR sekilde sokak duzeyinde sonuc veriyor.
//   - Site/apartman adi ("Kalkan Apt. Sitesi" gibi) EKLENINCE Nominatim
//     COGUNLUKLA hicbir sonuc bulamiyor (bu adlar OSM verisinde
//     eslenmiyor) - bu yuzden site/blok bilgisi sorguya DAHIL EDILMIYOR.
//   - Alan siralamasi ONEMLI: "Mahalle, Sokak, Sivas" siralamasi (once
//     mahalle) SIK SIK basarisiz oluyor, "Sokak, Mahalle, Sivas" siralamasi
//     (once sokak) GUVENILIR sekilde calisiyor.
// Bu yuzden BIRDEN FAZLA aday, EN ISABETLI/DETAYLIYDAN EN GENELE dogru
// sirayla uretiliyor - geocode fonksiyonlari ilk basarili adayi kullanir.
export const buildGeocodeAddressCandidates = (row: AddressParts): string[] => {
  const mahalle = stripKnownSuffix(cleanAddressPart(row.mahalleadi))
  const cadde = stripKnownSuffix(cleanAddressPart(row.cadde))
  const sokak = stripKnownSuffix(cleanAddressPart(row.sokak))
  const binano = cleanAddressPart(row.binano)
  const adres = cleanAddressPart(row.adres)
  const yol = sokak || cadde // ayni alanda ikisi de doluysa (bazi kayitlarda oldugu gibi) tekrar etmesin

  const candidates: string[] = []

  if (yol && mahalle) {
    if (binano) candidates.push(`${yol} Sokak No:${binano}, ${mahalle} Mahallesi, Sivas Merkez, Türkiye`)
    candidates.push(`${yol} Sokak, ${mahalle} Mahallesi, Sivas Merkez, Türkiye`)
  } else if (yol) {
    candidates.push(`${yol} Sokak, Sivas Merkez, Türkiye`)
  }

  if (mahalle) {
    candidates.push(`${mahalle} Mahallesi, Sivas Merkez, Türkiye`)
  }

  // Son care: yapilandirilmis alanlarin hicbiri yoksa (veya hepsi
  // denendiyse), dosyadaki HAM/serbest metin adresi dene.
  if (adres) {
    candidates.push(`${adres}, Sivas Merkez, Türkiye`)
  }

  return Array.from(new Set(candidates))
}

// Geriye donuk uyumluluk / tek-string ihtiyaci olan yerler (ör. onbellek
// hash'i) icin EN DETAYLI adayi dondurur.
export const buildGeocodeAddress = (row: AddressParts) => {
  const candidates = buildGeocodeAddressCandidates(row)
  return candidates[0] || [cleanAddressPart(row.adres), 'Sivas Merkez', 'Turkiye'].filter(Boolean).join(', ')
}

const isInsideSivasCenter = (lat: number, lon: number) => {
  return (
    lat >= SIVAS_CENTER_BOUNDS.minLat &&
    lat <= SIVAS_CENTER_BOUNDS.maxLat &&
    lon >= SIVAS_CENTER_BOUNDS.minLon &&
    lon <= SIVAS_CENTER_BOUNDS.maxLon
  )
}

const geocodeOneWithGoogle = async (query: string): Promise<GeocodeOutcome> => {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_GEOCODING_API_KEY
  if (!apiKey) return { status: 'not_found', error: 'Google Geocoding API anahtarı yok' }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
  url.searchParams.set('address', query)
  url.searchParams.set('key', apiKey)
  url.searchParams.set('language', 'tr')
  url.searchParams.set('region', 'tr')
  url.searchParams.set('components', 'country:TR|administrative_area:Sivas')
  url.searchParams.set('bounds', `${SIVAS_CENTER_BOUNDS.minLat},${SIVAS_CENTER_BOUNDS.minLon}|${SIVAS_CENTER_BOUNDS.maxLat},${SIVAS_CENTER_BOUNDS.maxLon}`)

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return { status: 'error', error: `Google Geocoding ${response.status} döndü` }

  const payload = await response.json() as {
    status?: string
    error_message?: string
    results?: Array<{
      formatted_address?: string
      partial_match?: boolean
      geometry?: { location?: { lat?: number; lng?: number } }
    }>
  }

  if (payload.status === 'OVER_QUERY_LIMIT') {
    return { status: 'rate_limited', error: payload.error_message || 'Google kota limiti' }
  }

  const first = payload.results?.[0]
  const lat = first?.geometry?.location?.lat
  const lon = first?.geometry?.location?.lng
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { status: 'not_found', error: payload.error_message || 'Adres bulunamadı' }
  }

  if (!isInsideSivasCenter(lat, lon)) {
    return { status: 'outside_center', error: 'Koordinat Sivas il merkezi dışında' }
  }

  return {
    status: 'ok',
    result: {
      lat,
      lon,
      displayName: first?.formatted_address,
      source: 'google',
      score: first?.partial_match ? 0.7 : 1,
    },
  }
}

const geocodeOneWithNominatim = async (query: string): Promise<GeocodeOutcome> => {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'tr')
  url.searchParams.set('addressdetails', '0')
  url.searchParams.set('bounded', '1')
  url.searchParams.set('viewbox', `${SIVAS_CENTER_BOUNDS.minLon},${SIVAS_CENTER_BOUNDS.maxLat},${SIVAS_CENTER_BOUNDS.maxLon},${SIVAS_CENTER_BOUNDS.minLat}`)
  url.searchParams.set('q', query)

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'netsosyal-address-map/1.0',
    },
    cache: 'no-store',
  })

  if (response.status === 429) {
    return { status: 'rate_limited', error: 'Nominatim kota/yoğunluk limiti' }
  }

  if (!response.ok) return { status: 'error', error: `Nominatim ${response.status} döndü` }

  const results = await response.json() as Array<{ lat?: string; lon?: string; display_name?: string }>
  const first = results[0]
  if (!first?.lat || !first?.lon) return { status: 'not_found', error: 'Adres bulunamadı' }

  const lat = Number(first.lat)
  const lon = Number(first.lon)
  if (!isInsideSivasCenter(lat, lon)) {
    return { status: 'outside_center', error: 'Koordinat Sivas il merkezi dışında' }
  }

  return {
    status: 'ok',
    result: {
      lat,
      lon,
      displayName: first.display_name,
      source: 'nominatim',
      score: 0.8,
    },
  }
}

// Sivas Belediyesi'nin KENDI "Kent Rehberi" servisi (kentrehberi.sivas.bel.tr) -
// dosyadaki serbest metin adresi TAHMIN etmeye calisan Google/Nominatim'in
// AKSINE, NVİ'den (nüfus) zaten gelen NUMARIK UAVT adres numarasini (bkz.
// dosyalar.adresno - lib/services/addressAutoRefresh.service.ts tarafindan
// doldurulur) DOGRUDAN belediyenin KENDI adres/bina veritabaninda arar. Bu
// yuzden hem DAHA ISABETLI (binanin gercek merkez noktasi) hem de rate-limit/
// API anahtari GEREKTIRMEYEN bir kaynak - bu yuzden asagidaki
// geocodeSivasAddress fonksiyonunda EN ONCE bu denenir, sadece basarisiz
// olursa (adresno yok, UAVT'de yok, veya o binanin harita geometrisi henuz
// islenmemis - bkz. asagidaki not) metin tabanli Google/Nominatim'e dusulur.
//
// NOT: canli test edildi - bazi (ozellikle YENI/dis mahalle) binalarda adres
// KAYDI VAR ama harita geometrisi YOK, bu durumda "konum" alani null geliyor
// (200 ile - HTTP 404 degil); bu GERCEK bir "bulunamadi" degil, ozel olarak
// ele alinmasi gerekmiyor - asagida diger "not_found" durumlariyla AYNI
// sekilde ele alinip metin tabanli aramaya dusuluyor.
//
// "/api/layers/adres-karti/uavt/{uavtKodu}" ucu tercih edildi (geojson/
// bagimsiz-birim/{..}/merkez YERINE) - AYNI veriyi dondurur ama TEK istekte
// hem konumu (enlem/boylam DOGRUDAN, GeoJSON [lon,lat] sirasini elle
// cozmeye gerek kalmadan) hem de "bulunamadi mi yoksa konumu mu yok" ayrimini
// (404 vs 200+konum:null) daha net verir.
const KENT_REHBERI_BASE_URL = 'https://kentrehberi.sivas.bel.tr'

type KentRehberiAdresKartiResponse = {
  konum?: { enlem?: number; boylam?: number } | null
  adres?: {
    ilceAdi?: string | null
    mahalleAdi?: string | null
    csbm?: string | null
    csbmTuru?: string | null
    disKapiNo?: string | null
    icKapiNo?: string | null
    siteBlokNo?: string | null
    blokGiris?: string | null
    binaAdi?: string | null
    formattedCSBM?: string | null
  } | null
}

// Kent Rehberi'nin adres-karti ucunu (bkz. asagidaki gecodeByUavtAdresNo
// yorumu) BIRDEN FAZLA amacla (konum + adres detaylari) kullanan tum
// fonksiyonlarin PAYLASTIGI tek dusuk seviyeli sorgu - ayni UAVT adres
// numarasi icin GEREKSIZ TEKRAR HTTP istegi atilmasin.
async function fetchKentRehberiAdresKarti(adresNo: string | null | undefined): Promise<
  { status: 'ok'; payload: KentRehberiAdresKartiResponse } | { status: 'not_found' | 'error'; error: string }
> {
  const trimmed = (adresNo || '').trim()
  if (!/^\d+$/.test(trimmed)) {
    return { status: 'not_found', error: 'Gecerli bir UAVT adres numarasi yok' }
  }

  try {
    const response = await fetch(`${KENT_REHBERI_BASE_URL}/api/layers/adres-karti/uavt/${trimmed}`, {
      cache: 'no-store',
    })

    if (response.status === 404) {
      return { status: 'not_found', error: 'Kent Rehberi bu adres numarasini taniniyor degil' }
    }
    if (!response.ok) {
      return { status: 'error', error: `Kent Rehberi ${response.status} döndü` }
    }

    return { status: 'ok', payload: await response.json() as KentRehberiAdresKartiResponse }
  } catch {
    return { status: 'error', error: 'Kent Rehberi servisine erişilemedi' }
  }
}

export const geocodeByUavtAdresNo = async (adresNo: string | null | undefined): Promise<GeocodeOutcome> => {
  const fetched = await fetchKentRehberiAdresKarti(adresNo)
  if (fetched.status !== 'ok') return fetched

  const lat = fetched.payload.konum?.enlem
  const lon = fetched.payload.konum?.boylam

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { status: 'not_found', error: 'Kent Rehberi bu adres icin henuz konum islememis' }
  }

  if (!isInsideSivasCenter(lat, lon)) {
    return { status: 'outside_center', error: 'Koordinat Sivas il merkezi dışında' }
  }

  return { status: 'ok', result: { lat, lon, source: 'kentrehberi', score: 1 } }
}

export type KentRehberiAddressDetails = {
  mahalle: string
  cadde: string
  sokak: string
  binano: string
  daireno: string
  site: string
  blok: string
}

// Kullanici istegi: NVİ'nin adres alt alanlari (mahalle/cadde-sokak/dis-ic
// kapi no) GUVENILMEZ/EKSIK gelebiliyordu ("bazen tam olarak dosyaya
// islemiyor" sikayeti) - bunun yerine, dosyanin UAVT adres numarasi (NVİ'den
// zaten alinan "adresno") ile Sivas Belediyesi'nin KENDI, bu oturumda canli
// veriyle DOGRULANMIS (bkz. geocodeByUavtAdresNo/regeocodeFileLocation)
// "Kent Rehberi" adres kartina sorulur - "site"/"blok" bilgisi bile NVİ'de
// hic olmayabilirken Kent Rehberi'nin adres kartinda (siteBlokNo/blokGiris)
// GENELLIKLE mevcut. Bulunamazsa (adresno yok/UAVT'de kayitli degil) null
// doner - cagiran taraf bu durumda NVİ'nin kendi alanlarina duser.
export async function fetchKentRehberiAddressDetails(adresNo: string | null | undefined): Promise<KentRehberiAddressDetails | null> {
  const fetched = await fetchKentRehberiAdresKarti(adresNo)
  if (fetched.status !== 'ok') return null

  const adres = fetched.payload.adres
  if (!adres) return null

  const street = adres.csbm?.trim() || ''
  return {
    mahalle: adres.mahalleAdi?.trim() || '',
    cadde: street,
    sokak: street,
    binano: adres.disKapiNo?.trim() || '',
    daireno: adres.icKapiNo?.trim() || '',
    site: adres.binaAdi?.trim() || '',
    blok: adres.siteBlokNo?.trim() || adres.blokGiris?.trim() || '',
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Aday sorgu listesini SIRAYLA dener (en detayli/isabetliden en genele) -
// ilk basarili sonucu dondurur. "rate_limited" disinda BIR adayin
// basarisiz olmasi (not_found) bir sonraki (daha genel) adayin denenmesine
// engel degildir - amac, hicbir zaman "adres bulunamadi" ile bitirmemek,
// en azindan mahalle duzeyinde bir sonuc dondurmek.
// "delayMs" verilirse denemeler arasinda bekleniyor - Nominatim'in
// kullanim politikasi saniyede EN FAZLA 1 istek gerektiriyor; bir dosya
// icin birden fazla aday denenecekse (ilk aday basarisiz olursa) bu
// sinira uyulmasi ZORUNLU, aksi halde sunucunun IP'si engellenebilir.
async function geocodeCandidates(
  candidates: string[],
  geocodeOne: (query: string) => Promise<GeocodeOutcome>,
  delayMs = 0,
): Promise<GeocodeOutcome> {
  let lastOutcome: GeocodeOutcome = { status: 'not_found', error: 'Adres bulunamadı' }

  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0 && delayMs > 0) await sleep(delayMs)
    const outcome = await geocodeOne(candidates[index])
    if (outcome.status === 'ok' || outcome.status === 'rate_limited') return outcome
    lastOutcome = outcome
  }

  return lastOutcome
}

export const geocodeWithGoogle = (query: string) => geocodeOneWithGoogle(query)

export const geocodeSivasMerkezAddressCandidates = async (candidates: string[]): Promise<GeocodeOutcome> => {
  const validCandidates = candidates.filter(isSivasMerkezAddressText)
  if (validCandidates.length === 0) {
    return { status: 'outside_center', error: 'Adres Sivas il merkezi dışında' }
  }

  const googleResult = await geocodeCandidates(validCandidates, geocodeOneWithGoogle)
  if (googleResult.status === 'ok' || googleResult.status === 'rate_limited') return googleResult

  return geocodeCandidates(validCandidates, geocodeOneWithNominatim, 1100)
}

export const geocodeSivasMerkezAddress = async (query: string): Promise<GeocodeOutcome> => (
  geocodeSivasMerkezAddressCandidates([query])
)

// Bir dosyanin konumunu bulmak icin KULLANILACAK TEK GIRIS NOKTASI - once
// (varsa) Kent Rehberi'nden UAVT adres numarasiyla dener (en isabetli, harici
// kota/anahtar gerektirmez), o basarisiz olursa (adresno yok, UAVT'de yok ya
// da o binanin harita geometrisi henuz islenmemis) serbest metin adres
// adaylariyla Google/Nominatim'e duser - boylece HER ZAMAN en iyi bulunabilen
// sonuc denenmis olur.
export const geocodeSivasAddress = async (
  adresNo: string | null | undefined,
  candidates: string[],
): Promise<GeocodeOutcome> => {
  const kentRehberiOutcome = await geocodeByUavtAdresNo(adresNo)
  if (kentRehberiOutcome.status === 'ok') return kentRehberiOutcome

  return geocodeSivasMerkezAddressCandidates(candidates)
}

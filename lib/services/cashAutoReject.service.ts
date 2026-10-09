import { Pool } from 'pg'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'
import { prisma } from '@/lib/db/prisma'
import { withAuditedWrite } from '@/lib/db/auditContext'
import { predefinedValuesService } from '@/lib/services/predefinedValues.service'
import { normalizePredefinedText, type PredefinedValue } from '@/lib/constants/predefinedValues'
import {
  extractVehicleYear,
  findYardimKriteriValue,
  parseFreeFormAmount,
  parseKriterRowValue,
} from '@/lib/nakitCriteria'

// Kullanici istegi: Nakit Yardimi muracaat listesindeki (durumu=0) TUM
// bekleyen kayitlar, tek tek acilmadan, Ayarlar > Hazır Değerler > Yardım
// Kriterleri altinda tanimlanan "Aylık Gelir" ve "Araç Modeli" sinirlarina
// gore TOPLU kontrol edilip asilanlar otomatik reddedilebilsin. Kriter ve
// hesaplama mantigi, dosya duzenleme penceresindeki tekil kontrolle
// (app/(modules)/documents/page.tsx - cashAidAutoRejectCheck) AYNIDIR:
// "Genel Toplam" = diger kurumlardan alinan yardimlar + belgelerdeki gelir
// toplami; arac yili hem belgelerden hem de muracaatin kendi arac bilgisi
// alanindan (aracbilgisi) alinir, hangisi daha yeniyse o esas alinir.
export const OTOMATIK_RED_STAGE = 'Otomatik Red'
// Hazır Değerler > NAKİT ASAMA listesindeki mevcut secenegin adiyla BIREBIR
// ayni yazilmali (bkz. "İncelenecek" secenegi) - "Otomatik Red"den geri
// alinan kayitlar bu asamaya doner.
export const INCELENECEK_STAGE = 'İNCELENECEK'

// Kullanici istegi (2026-09-29): "otomatik red açıklaması aynı zamanda
// nakit yardımları tablosunda da görünsün" - onceden bu metinler SADECE
// preview ekraninda gosteriliyordu, "Otomatik Red" uygulandiginda
// yrd_ayninakti.durumuaciklama alanina HICBIR SEY yazilmiyordu (asama
// disinda hicbir iz kalmiyordu). Hem previewCashAutoReject hem de
// reevaluateCashAutoRejectForFile AYNI metinleri uretsin diye ortak
// fonksiyona alindi.
function buildAutoRejectReasonTexts(params: {
  totalGelir: number
  gelirLimit: number | null
  maxVehicleYear: number | null
  aracYearLimit: number | null
  vergiVar: boolean
  // Kullanici istegi: Ayarlar > Yardım Kriterleri'nde tanimlanmissa, bu
  // SABIT metinler asagidaki hesaplanan metinlerin YERINE kullanilir.
  gelirAciklama?: string | null
  aracAciklama?: string | null
}): string[] {
  const { totalGelir, gelirLimit, maxVehicleYear, aracYearLimit, vergiVar, gelirAciklama, aracAciklama } = params
  const reasons: string[] = []
  if (gelirLimit !== null && totalGelir > gelirLimit) {
    reasons.push(
      gelirAciklama?.trim()
        || `Toplam gelir (${totalGelir.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) tanımlı sınırın (${gelirLimit.toLocaleString('tr-TR')}) üzerinde`,
    )
  }
  if (aracYearLimit !== null && maxVehicleYear !== null && maxVehicleYear > aracYearLimit) {
    reasons.push(
      aracAciklama?.trim()
        || `Araç modeli (${maxVehicleYear}) tanımlı sınırın (${aracYearLimit}) üzerinde`,
    )
  }
  if (vergiVar) {
    reasons.push('Belgelerden alınan bilgilere göre vergi mükellefiyeti kaydı bulunuyor')
  }
  return reasons
}

const globalForCashAutoRejectDkmPool = globalThis as unknown as {
  cashAutoRejectDkmPool: Pool | undefined
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

function getDkmPool() {
  if (!globalForCashAutoRejectDkmPool.cashAutoRejectDkmPool) {
    globalForCashAutoRejectDkmPool.cashAutoRejectDkmPool = new Pool({ connectionString: getDkmConnectionString(), types: createUtcTypeOverrides() } as any)
  }

  return globalForCashAutoRejectDkmPool.cashAutoRejectDkmPool
}

// Kullanici istegi: Yardım Kriterleri artik DÖNEME GÖRE FARKLI
// tanimlanabiliyor (bkz. lib/nakitCriteria.ts - findYardimKriteriValue) -
// bu yuzden burada TEK bir global esik degeri DEGIL, ham kriter LISTESI
// dondurulur; her muracaat satiri KENDI dönemine gore ayri ayri
// degerlendirilir (bkz. previewCashAutoReject icindeki dongu).
async function getCriteriaList(): Promise<PredefinedValue[]> {
  const { values, titles } = await predefinedValuesService.getAll()

  const categoryKey = Object.keys(values).find((key) => {
    const normalizedKey = normalizePredefinedText(key)
    const normalizedTitle = normalizePredefinedText(titles[key] ?? key)
    const target = normalizePredefinedText('yardim kriterleri')
    return normalizedKey === target || normalizedTitle === target
  })

  return categoryKey ? values[categoryKey] ?? [] : []
}

export type CashAutoRejectMatch = {
  id: string
  dosyaid: string | null
  muracaateden: string | null
  tckimlikno: string | null
  donem: string | null
  totalGelir: number
  maxVehicleYear: number | null
  reasons: string[]
}

export async function previewCashAutoReject(): Promise<{
  checkedCount: number
  matches: CashAutoRejectMatch[]
  // Kullanici istegi (ters yon): daha once "Otomatik Red" yapilmis ama
  // guncelleme sonrasi artik kriterlerin ALTINDA kalan durumu=0 kayitlarin
  // id'leri - bunlar "İncelenecek"e geri alinmak uzere ayrica dondurulur.
  reverts: string[]
  // Kullanici istegi: kriterler dönem bazinda FARKLI olabildigi icin TEK bir
  // global esik degeri artik anlamli degil - bu alan geriye donuk uyumluluk
  // icin hep null doner, gercek karsilastirma her satirin KENDI dönemine
  // gore ayri ayri yapilir.
  thresholds: { gelirLimit: number | null; aracYearLimit: number | null }
  // Ayarlar > Hazır Değerler > Yardım Kriterleri altinda HERHANGI bir kayit
  // (herhangi bir dönem icin) tanimli mi - API rotasi bu bilgiyi "kriter
  // tanimli degil" hatasini gostermek icin kullanir.
  hasCriteria: boolean
}> {
  const criteriaList = await getCriteriaList()

  const rows = await prisma.$queryRaw<{
    id: bigint
    // Kullanici istegi/hata duzeltmesi: bazi (henuz dosyaya baglanmamis)
    // muracaatlarda dosyaid NULL olabiliyor (bkz. NakitApplicationsSyncButton
    // - "Müracaatları Güncelle" tam da bu kayitlari dosyaya baglamak icin
    // var). NULL dosyaid'li kayitlar diger kurum yardimi/belge sorgusuna
    // DAHIL EDILEMEZ ama kendi aylikgelir/aracbilgisi alanlariyla yine de
    // degerlendirilir - "Cannot read properties of null (reading 'toString')"
    // hatasi, bu NULL degerler uzerinde kosulsuzca .toString() cagrilmasindan
    // kaynaklaniyordu.
    dosyaid: bigint | null
    muracaateden: string | null
    tckimlikno: string | null
    donem: string | null
    aracbilgisi: string | null
    muracaattarihi: Date | null
    aylikgelir: string | null
    asama: string | null
  }[]>`
    SELECT id, dosyaid, muracaateden, tckimlikno, donem::text AS donem, aracbilgisi, muracaattarihi, aylikgelir::text AS aylikgelir, asama::text AS asama
    FROM yrd_ayninakti
    WHERE durumu = 0
      -- Kullanici istegi: "Otomatik Red İptal" tiki isaretli muracaatlar
      -- Otomatik Red kontrolune HIC dahil edilmez (bkz. documents/page.tsx -
      -- "Otomatik Red İptal" checkbox'i).
      AND otomatikrediptal IS NOT TRUE
  `

  const emptyThresholds = { gelirLimit: null, aracYearLimit: null }
  const hasCriteria = criteriaList.length > 0
  if (rows.length === 0 || !hasCriteria) {
    return { checkedCount: rows.length, matches: [], reverts: [], thresholds: emptyThresholds, hasCriteria }
  }

  const dosyaIdsBig = Array.from(new Set(
    rows.filter((row) => row.dosyaid !== null).map((row) => row.dosyaid!.toString()),
  )).map((id) => BigInt(id))

  // Diger kurumlardan alinan yardimlar toplami (ana veritabani, dosya bazinda).
  // Hata duzeltmesi: yrd_digerkrmalyrdm.dosyaid kolonu INTEGER (yrd_ayninakti.
  // dosyaid ise BIGINT) - Prisma.join() ile BigInt degerleri dogrudan bu
  // koluna karsi IN (...) icinde kullanmak, tip uyusmazligindan dolayi
  // "invalid input syntax for integer" hatasina yol aciyordu. Bu yuzden
  // burada AYRICA number[] (int) dizisine cevirilip = ANY(...)::int[] ile
  // sorgulaniyor.
  const dosyaIdsForIntColumn = dosyaIdsBig.map((id) => Number(id))
  const externalAidRows = dosyaIdsForIntColumn.length > 0
    ? await prisma.$queryRaw<{ dosyaid: number; total: string | null }[]>`
        SELECT dosyaid, SUM(miktar) AS total
        FROM yrd_digerkrmalyrdm
        WHERE dosyaid = ANY(${dosyaIdsForIntColumn}::int[])
        GROUP BY dosyaid
      `
    : []
  const externalAidByDosya = new Map<string, number>()
  for (const row of externalAidRows) {
    const value = row.total !== null ? Number(row.total) : 0
    externalAidByDosya.set(row.dosyaid.toString(), Number.isFinite(value) ? value : 0)
  }

  // Belgelerdeki Gelir/Araç Modeli bilgisi - AYRI veritabaninda (sosyalyardimdkm).
  // Ham kayitlar dosyaid bazinda gruplanip SAKLANIR (henuz ozetlenmez) -
  // cunku "muracaat tarihinden ONCEKI belgeler sayilmaz" kurali (asagida)
  // HER muracaat satiri icin KENDI muracaattarihi'ne gore AYRI ayri
  // uygulanmasi gerekiyor; bir dosyada FARKLI donemler icin birden fazla
  // bekleyen (durumu=0) kayit olabilir, her birinin tarihi farkli olabilir.
  type BelgeRow = {
    dosyaid: string
    baslik: string | null
    gelir: string | null
    arac_modeli: string | null
    // Kullanici istegi: belge eklenirken girilen "Vergi Mükellefiyeti"
    // (Var/Yok) bilgisi de - "Var" ise gelir/arac siniri ne olursa olsun
    // KOSULSUZ Otomatik Red sebebidir (bkz. asagidaki computeBelgeSummaryForRow).
    vergi_mukellefiyeti: string | null
    islemtarihi: string | null
    ilkislemtarihi: string | null
    id: string
  }
  const belgeRowsByDosya = new Map<string, BelgeRow[]>()
  if (dosyaIdsBig.length > 0) {
    const belgeResult = await getDkmPool().query<BelgeRow>(
      `SELECT dosyaid::text, baslik, gelir, arac_modeli, vergi_mukellefiyeti, islemtarihi, ilkislemtarihi, id::text
       FROM public.belge WHERE dosyaid = ANY($1::bigint[])`,
      [dosyaIdsBig.map((id) => id.toString())],
    )
    for (const row of belgeResult.rows) {
      const list = belgeRowsByDosya.get(row.dosyaid) ?? []
      list.push(row)
      belgeRowsByDosya.set(row.dosyaid, list)
    }
  }

  const belgeDateOf = (row: { islemtarihi: string | null; ilkislemtarihi: string | null }) => {
    const dateText = row.islemtarihi || row.ilkislemtarihi
    const time = dateText ? new Date(dateText).getTime() : NaN
    return Number.isFinite(time) ? time : null
  }
  const recencyOf = (row: { islemtarihi: string | null; ilkislemtarihi: string | null; id: string }) => (
    belgeDateOf(row) ?? (Number(row.id) || 0)
  )

  // Kullanici istegi: AYNI kisiye (belge sahibi/baslik) ait BIRDEN FAZLA
  // gelir/arac kaydi varsa bunlar TOPLANMAZ - sadece EN SON girilen (en
  // guncel islemtarihi/ilkislemtarihi, esitlikte en yuksek id) kayit esas
  // alinir. AYRICA, belgenin tarihi bu muracaatin muracaattarihi'nden
  // ONCEYSE o belge HIC DIKKATE ALINMAZ (eski/guncelligini yitirmis gelir-
  // arac bilgisi sorguyu etkilemesin diye) - sadece muracaat tarihiyle AYNI
  // gunde ya da SONRASINDA eklenen belgeler sayilir.
  const computeBelgeSummaryForRow = (dosyaKey: string, muracaatTarihi: Date | null) => {
    const belgeRows = belgeRowsByDosya.get(dosyaKey) ?? []
    const cutoff = muracaatTarihi ? muracaatTarihi.getTime() : null

    const latestGelirByOwner = new Map<string, { recency: number; value: number }>()
    const latestYearByOwner = new Map<string, { recency: number; value: number }>()
    const latestVergiByOwner = new Map<string, { recency: number; value: string }>()

    for (const belgeRow of belgeRows) {
      const belgeDate = belgeDateOf(belgeRow)
      if (cutoff !== null && belgeDate !== null && belgeDate < cutoff) continue

      const owner = (belgeRow.baslik || '').trim() || 'Belge'
      const recency = recencyOf(belgeRow)

      if (belgeRow.gelir?.trim()) {
        const value = parseFreeFormAmount(belgeRow.gelir)
        if (value !== null && value !== 0) {
          const current = latestGelirByOwner.get(owner)
          if (!current || recency >= current.recency) {
            latestGelirByOwner.set(owner, { recency, value })
          }
        }
      }
      if (belgeRow.arac_modeli?.trim()) {
        const year = extractVehicleYear(belgeRow.arac_modeli)
        if (year !== null) {
          const current = latestYearByOwner.get(owner)
          if (!current || recency >= current.recency) {
            latestYearByOwner.set(owner, { recency, value: year })
          }
        }
      }
      if (belgeRow.vergi_mukellefiyeti?.trim()) {
        const current = latestVergiByOwner.get(owner)
        if (!current || recency >= current.recency) {
          latestVergiByOwner.set(owner, { recency, value: belgeRow.vergi_mukellefiyeti.trim() })
        }
      }
    }

    const gelirTotal = Array.from(latestGelirByOwner.values()).reduce((sum, item) => sum + item.value, 0)
    const maxYear = Array.from(latestYearByOwner.values()).reduce<number | null>(
      (max, item) => (max === null || item.value > max ? item.value : max),
      null,
    )
    // Herhangi bir kisinin (belge sahibi) en guncel vergi mukellefiyeti
    // kaydi "Var" ise yeterli - tum kisilerin ayni olmasi gerekmez.
    const vergiVar = Array.from(latestVergiByOwner.values()).some((item) => item.value === 'Var')

    return { gelirTotal, maxYear, vergiVar }
  }

  const matches: CashAutoRejectMatch[] = []
  const reverts: string[] = []

  for (const row of rows) {
    const dosyaKey = row.dosyaid !== null ? row.dosyaid.toString() : null
    const belgeSummary = dosyaKey !== null
      ? computeBelgeSummaryForRow(dosyaKey, row.muracaattarihi)
      : { gelirTotal: 0, maxYear: null as number | null, vergiVar: false }
    // Kullanici istegi: muracaat eden kisinin basvuru sirasinda BEYAN
    // ETTIGI aylik gelir (yrd_ayninakti.aylikgelir) de degerlendirmeye
    // katilir - dosya duzenleme penceresindeki tekil kontrolle
    // (declaredHouseholdIncome) AYNI mantik. Kullanici istegi (mukerrer
    // gelir duzeltmesi): belge eklenirken (inceleme sonucu) BIR gelir
    // bilgisi girilmisse, muracaatcinin KENDI beyani AYRICA eklenmez -
    // belgedeki dogrulanmis deger onun yerine gecer (toplanmaz).
    const declaredIncome = parseFreeFormAmount(row.aylikgelir) ?? 0
    const gelirFromApplicantOrBelge = belgeSummary.gelirTotal > 0 ? belgeSummary.gelirTotal : declaredIncome
    const totalGelir = (dosyaKey !== null ? externalAidByDosya.get(dosyaKey) ?? 0 : 0) + gelirFromApplicantOrBelge
    const vehicleYears = [belgeSummary.maxYear, extractVehicleYear(row.aracbilgisi)]
      .filter((year): year is number => year !== null)
    const maxVehicleYear = vehicleYears.length > 0 ? Math.max(...vehicleYears) : null

    // Kullanici istegi: kriterler artik DÖNEME GÖRE FARKLI tanimlanabilir -
    // once bu satirin KENDI dönemine (row.donem) ozel bir deger aranir,
    // yoksa "Tüm Dönemler" (dönemsiz) genel degere dusulur.
    const gelirRow = findYardimKriteriValue(criteriaList, row.donem, ['aylik gelir', 'gelir'])
    const aracRow = findYardimKriteriValue(criteriaList, row.donem, ['arac modeli', 'arac'])
    const gelirParsed = parseKriterRowValue(gelirRow)
    const aracParsed = parseKriterRowValue(aracRow)
    const gelirLimit = gelirRow !== null ? parseFreeFormAmount(gelirParsed.limit) : null
    const aracYearLimit = aracRow !== null ? extractVehicleYear(aracParsed.limit) : null

    const reasons = buildAutoRejectReasonTexts({
      totalGelir,
      gelirLimit,
      maxVehicleYear,
      aracYearLimit,
      vergiVar: belgeSummary.vergiVar,
      gelirAciklama: gelirParsed.aciklama,
      aracAciklama: aracParsed.aciklama,
    })

    const isCurrentlyOtomatikRed = normalizePredefinedText(row.asama || '') === normalizePredefinedText(OTOMATIK_RED_STAGE)

    if (reasons.length > 0) {
      if (!isCurrentlyOtomatikRed) {
        matches.push({
          id: row.id.toString(),
          dosyaid: dosyaKey,
          muracaateden: row.muracaateden,
          tckimlikno: row.tckimlikno,
          donem: row.donem,
          totalGelir,
          maxVehicleYear,
          reasons,
        })
      }
    } else if (isCurrentlyOtomatikRed) {
      // Kullanici istegi: daha once "Otomatik Red" yapilmis ama guncelleme
      // sonrasi artik kriterlerin ALTINDA kalan kayit - "İncelenecek"e geri
      // alinmak uzere isaretlenir.
      reverts.push(row.id.toString())
    }
  }

  return { checkedCount: rows.length, matches, reverts, thresholds: emptyThresholds, hasCriteria }
}

// Kullanici istegi: eskiden Otomatik Red durumu SADECE (a) "Otomatik Red
// Kontrolü" toplu butonuna basildiginda ya da (b) müracaatin KENDI düzenleme
// penceresi açıldığında (bkz. documents/page.tsx - cashAidAutoRejectCheck'in
// sessiz auto-persist efekti) güncelleniyordu. Bu yuzden bir belge eklenip
// Gelir/Araç/Vergi Mükellefiyeti degistiginde, müracaatın kendisi hiç
// açılmadigi surece veritabanindaki asama ESKI kalıyordu - kullanici Dosya
// Yönetimi sayfasını yenilese bile "İncelenecek" görünmeye devam ediyordu
// (ancak müracaata çift tıklayıp içine girince değişiyordu). Bu fonksiyon,
// belge kaydedildiginde/silindiğinde (bkz. app/api/documents/belgeler/
// route.ts) O DOSYAYA ait TÜM durumu=0 Ayni/Nakdi müracaatları hemen,
// sessizce yeniden değerlendirip gerekirse Otomatik Red uygular/geri alır -
// böylece müracaat hiç açılmadan da doğru asama veritabanına yazılmış olur.
export async function reevaluateCashAutoRejectForFile(
  dosyaId: string,
  meta?: { ip?: string | null; path?: string | null },
): Promise<{ appliedCount: number; revertedCount: number }> {
  const cleanDosyaId = /^\d+$/.test(dosyaId) ? dosyaId : null
  if (!cleanDosyaId) return { appliedCount: 0, revertedCount: 0 }

  const criteriaList = await getCriteriaList()
  if (criteriaList.length === 0) return { appliedCount: 0, revertedCount: 0 }

  const rows = await prisma.$queryRaw<{
    id: bigint
    muracaattarihi: Date | null
    donem: string | null
    aracbilgisi: string | null
    aylikgelir: string | null
    asama: string | null
  }[]>`
    SELECT id, muracaattarihi, donem::text AS donem, aracbilgisi, aylikgelir::text AS aylikgelir, asama::text AS asama
    FROM yrd_ayninakti
    WHERE durumu = 0 AND dosyaid = ${BigInt(cleanDosyaId)}
      -- Kullanici istegi: "Otomatik Red İptal" tiki isaretli muracaatlar
      -- HIC degerlendirilmez.
      AND otomatikrediptal IS NOT TRUE
  `
  if (rows.length === 0) return { appliedCount: 0, revertedCount: 0 }

  const externalAidRows = await prisma.$queryRaw<{ total: string | null }[]>`
    SELECT SUM(miktar) AS total FROM yrd_digerkrmalyrdm WHERE dosyaid = ${Number(cleanDosyaId)}
  `
  const externalAidTotalRaw = externalAidRows[0]?.total !== null && externalAidRows[0]?.total !== undefined
    ? Number(externalAidRows[0].total)
    : 0
  const externalAidTotal = Number.isFinite(externalAidTotalRaw) ? externalAidTotalRaw : 0

  type BelgeRow = {
    baslik: string | null
    gelir: string | null
    arac_modeli: string | null
    vergi_mukellefiyeti: string | null
    islemtarihi: string | null
    ilkislemtarihi: string | null
    id: string
  }
  const belgeResult = await getDkmPool().query<BelgeRow>(
    `SELECT baslik, gelir, arac_modeli, vergi_mukellefiyeti, islemtarihi, ilkislemtarihi, id::text
     FROM public.belge WHERE dosyaid = $1::bigint`,
    [cleanDosyaId],
  )
  const belgeRows = belgeResult.rows

  const belgeDateOf = (row: { islemtarihi: string | null; ilkislemtarihi: string | null }) => {
    const dateText = row.islemtarihi || row.ilkislemtarihi
    const time = dateText ? new Date(dateText).getTime() : NaN
    return Number.isFinite(time) ? time : null
  }
  const recencyOf = (row: { islemtarihi: string | null; ilkislemtarihi: string | null; id: string }) => (
    belgeDateOf(row) ?? (Number(row.id) || 0)
  )

  // Bkz. previewCashAutoReject icindeki computeBelgeSummaryForRow - AYNI
  // mantik (en son giren kazanir, muracaat tarihinden onceki belgeler HIC
  // dikkate alinmaz), sadece tek bir dosyanin belgeleriyle sinirli.
  const computeBelgeSummaryForRow = (muracaatTarihi: Date | null) => {
    const cutoff = muracaatTarihi ? muracaatTarihi.getTime() : null
    const latestGelirByOwner = new Map<string, { recency: number; value: number }>()
    const latestYearByOwner = new Map<string, { recency: number; value: number }>()
    const latestVergiByOwner = new Map<string, { recency: number; value: string }>()

    for (const belgeRow of belgeRows) {
      const belgeDate = belgeDateOf(belgeRow)
      if (cutoff !== null && belgeDate !== null && belgeDate < cutoff) continue

      const owner = (belgeRow.baslik || '').trim() || 'Belge'
      const recency = recencyOf(belgeRow)

      if (belgeRow.gelir?.trim()) {
        const value = parseFreeFormAmount(belgeRow.gelir)
        if (value !== null && value !== 0) {
          const current = latestGelirByOwner.get(owner)
          if (!current || recency >= current.recency) {
            latestGelirByOwner.set(owner, { recency, value })
          }
        }
      }
      if (belgeRow.arac_modeli?.trim()) {
        const year = extractVehicleYear(belgeRow.arac_modeli)
        if (year !== null) {
          const current = latestYearByOwner.get(owner)
          if (!current || recency >= current.recency) {
            latestYearByOwner.set(owner, { recency, value: year })
          }
        }
      }
      if (belgeRow.vergi_mukellefiyeti?.trim()) {
        const current = latestVergiByOwner.get(owner)
        if (!current || recency >= current.recency) {
          latestVergiByOwner.set(owner, { recency, value: belgeRow.vergi_mukellefiyeti.trim() })
        }
      }
    }

    const gelirTotal = Array.from(latestGelirByOwner.values()).reduce((sum, item) => sum + item.value, 0)
    const maxYear = Array.from(latestYearByOwner.values()).reduce<number | null>(
      (max, item) => (max === null || item.value > max ? item.value : max),
      null,
    )
    const vergiVar = Array.from(latestVergiByOwner.values()).some((item) => item.value === 'Var')

    return { gelirTotal, maxYear, vergiVar }
  }

  const matches: { id: string; reason: string }[] = []
  const reverts: string[] = []

  for (const row of rows) {
    const belgeSummary = computeBelgeSummaryForRow(row.muracaattarihi)
    const declaredIncome = parseFreeFormAmount(row.aylikgelir) ?? 0
    const gelirFromApplicantOrBelge = belgeSummary.gelirTotal > 0 ? belgeSummary.gelirTotal : declaredIncome
    const totalGelir = externalAidTotal + gelirFromApplicantOrBelge
    const vehicleYears = [belgeSummary.maxYear, extractVehicleYear(row.aracbilgisi)]
      .filter((year): year is number => year !== null)
    const maxVehicleYear = vehicleYears.length > 0 ? Math.max(...vehicleYears) : null

    const gelirRow = findYardimKriteriValue(criteriaList, row.donem, ['aylik gelir', 'gelir'])
    const aracRow = findYardimKriteriValue(criteriaList, row.donem, ['arac modeli', 'arac'])
    const gelirParsed = parseKriterRowValue(gelirRow)
    const aracParsed = parseKriterRowValue(aracRow)
    const gelirLimit = gelirRow !== null ? parseFreeFormAmount(gelirParsed.limit) : null
    const aracYearLimit = aracRow !== null ? extractVehicleYear(aracParsed.limit) : null

    const reasons = buildAutoRejectReasonTexts({
      totalGelir,
      gelirLimit,
      maxVehicleYear,
      aracYearLimit,
      vergiVar: belgeSummary.vergiVar,
      gelirAciklama: gelirParsed.aciklama,
      aracAciklama: aracParsed.aciklama,
    })

    const isCurrentlyOtomatikRed = normalizePredefinedText(row.asama || '') === normalizePredefinedText(OTOMATIK_RED_STAGE)

    if (reasons.length > 0) {
      if (!isCurrentlyOtomatikRed) matches.push({ id: row.id.toString(), reason: reasons.join('; ').slice(0, 100) })
    } else if (isCurrentlyOtomatikRed) {
      reverts.push(row.id.toString())
    }
  }

  const appliedCount = matches.length > 0 ? await applyCashAutoReject(matches, meta) : 0
  const revertedCount = reverts.length > 0 ? await applyCashAutoRejectRevert(reverts, meta) : 0

  return { appliedCount, revertedCount }
}

export async function applyCashAutoReject(
  matches: { id: string; reason: string }[],
  meta?: { ip?: string | null; path?: string | null },
): Promise<number> {
  // Hata duzeltmesi: "id IN (${Prisma.join(cleanIds)})" derlenmis (bundled)
  // Next.js sunucusunda "invalid input syntax for integer" hatasina yol
  // aciyordu (Prisma.Sql nesnesi duzgun SQL parcasi olarak degil, JSON
  // metni olarak tek bir parametreye sizmis gibi davraniyordu) - standalone
  // script testlerinde AYNI Prisma.join deseni sorunsuz calissa da, bu
  // guvenilirlik sorunu yuzunden bu fonksiyon Prisma.join() KULLANMAZ.
  // Kullanici istegi (2026-09-29): "otomatik red açıklamasını ... nakit
  // yardımları tablosunda da görelim" - her kaydin KENDI aşılan kriter
  // metni FARKLI oldugundan (gelir/arac degerleri kisiye ozel) tek bir
  // toplu UPDATE yeterli degil; tek transaction icinde satir satir
  // guncellenir (tipik parti boyutu - onlarca/yuzlerce kayit - bu
  // yaklasimda sorun cikarmaz).
  const cleanMatches = matches
    .map((match) => ({ id: String(match.id).trim(), reason: String(match.reason || '').trim().slice(0, 100) }))
    .filter((match) => /^\d+$/.test(match.id))
  if (cleanMatches.length === 0) return 0

  return withAuditedWrite(async (tx) => {
    let updatedCount = 0
    for (const match of cleanMatches) {
      // Guvenlik: preview ile apply arasinda gecen surede baskasi tarafindan
      // islenmis (durumu artik 0 olmayan) bir kaydin uzerine yazilmaz -
      // kullanici istegi geregi SADECE durumu=0 kayitlarda uygulanir.
      const count = await tx.$executeRaw`
        UPDATE yrd_ayninakti
        SET asama = ${OTOMATIK_RED_STAGE},
            durumuaciklama = ${match.reason || null},
            islemtarihi = CURRENT_TIMESTAMP
        WHERE id = ${BigInt(match.id)}::bigint
          AND durumu = 0
          -- Guvenlik: preview'dan sonra kullanici "Otomatik Red İptal" tikini
          -- isaretlemis olabilir - o durumda bile bu kayit ASLA etkilenmez.
          AND otomatikrediptal IS NOT TRUE
      `
      updatedCount += Number(count)
    }
    return updatedCount
  }, meta)
}

// Kullanici istegi (ters yon): guncelleme sonrasi artik kriterlerin ALTINDA
// kalan, daha once "Otomatik Red" yapilmis durumu=0 kayitlari "İncelenecek"e
// geri alir. Guvenlik: sadece HALEN "Otomatik Red" olan (bkz. preview'daki
// isCurrentlyOtomatikRed kontrolu) VE durumu=0 kayitlar etkilenir - farkli
// bir asamaya (ör. kullanici elle "Uygun Değil" yapmis) MANUEL degistirilmis
// kayitlar bu fonksiyonla ASLA geri alinmaz.
export async function applyCashAutoRejectRevert(ids: string[], meta?: { ip?: string | null; path?: string | null }): Promise<number> {
  const cleanIds = Array.from(new Set(ids.filter((id) => /^\d+$/.test(id))))
  if (cleanIds.length === 0) return 0

  // Kullanici istegi (2026-09-29): asama "Otomatik Red"den geri alinirken,
  // bu asamayla birlikte yazilmis olan otomatik red aciklamasi da artik
  // GECERSIZ/ESKI (kriterler degisti) - durumuaciklama da temizlenir, aksi
  // halde İncelenecek'e donmus bir kayitta yaniltici bicimde eski red
  // sebebi gorunmeye devam eder.
  const updatedCount = await withAuditedWrite((tx) => tx.$executeRaw`
    UPDATE yrd_ayninakti
    SET asama = ${INCELENECEK_STAGE},
        durumuaciklama = NULL,
        islemtarihi = CURRENT_TIMESTAMP
    WHERE id = ANY(${cleanIds}::bigint[])
      AND durumu = 0
      AND asama ILIKE ${OTOMATIK_RED_STAGE}
      AND otomatikrediptal IS NOT TRUE
  `, meta)

  return Number(updatedCount)
}

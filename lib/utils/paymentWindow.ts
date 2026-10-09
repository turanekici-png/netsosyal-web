// Mahalle bazli odeme (yardim yazdirma) penceresi hesaplama - "Ayarlar >
// Mahalle Listesi"nde her mahalle icin tanimlanan "Ödeme Başlangıç Günü"
// (ayin gunu, 1-31) ve "Ödeme Bitiş Günü" (baslangica eklenecek GUN SAYISI/
// SURE, 1-31) burada gercek tarihlere cevrilir. Kullanildigi yerler:
// lib/services/assistancePeriod.service.ts, app/api/documents/
// convert-application/route.ts (JS tarafi) ve app/api/documents/fetch/
// route.ts (ayni mantik SQL CASE ifadesi olarak tekrarlaniyor - bu
// dosyadaki fonksiyon SADECE JS tarafinda kullanilanlar icin gecerli, SQL
// sorgusu kendi icinde ayni algoritmayi uygular).

export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function clampDay(day: number, year: number, month: number) {
  return Math.min(Math.max(day, 1), getDaysInMonth(year, month))
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export type PaymentWindow = { startDate: string; endDate: string }

// Verilen donem (year/month) icin mahallenin odeme baslangic/bitis
// TARIHLERINI hesaplar:
//  - startDay bos/gecersizse ayin 1'i baslangic kabul edilir.
//  - endDay, baslangic gununden SONRA kac gun icinde odemenin bitecegini
//    belirten bir SURE'dir (mutlak bir "ayin gunu" DEGIL) - ör. baslangic
//    3, endDay(sure) 7 ise bitis 3+7=10'dur. Bos/gecersizse eski davranis
//    korunur: 7 gun.
//  - Sonuc HICBIR ZAMAN bir sonraki aya SARKMAZ - baslangic + sure, o ayin
//    son gununu asarsa ayin son gunune SABITLENIR (ör. baslangic 25, sure
//    7 ise 25+7=32 Agustos'u astigi icin bitis Agustos'un son gunu 31'e
//    sabitlenir, Eylul'e TASMAZ).
export function computeNeighborhoodPaymentWindow(
  startDay: number | null | undefined,
  endDay: number | null | undefined,
  year: number,
  month: number,
): PaymentWindow {
  const resolvedStartDay = startDay && startDay >= 1 ? clampDay(startDay, year, month) : 1
  const startDate = formatDate(year, month, resolvedStartDay)

  const durationDays = endDay && endDay >= 1 ? endDay : 7
  const daysInMonth = getDaysInMonth(year, month)
  const resolvedEndDay = Math.min(resolvedStartDay + durationDays, daysInMonth)

  return { startDate, endDate: formatDate(year, month, resolvedEndDay) }
}

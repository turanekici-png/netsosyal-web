// Kullanici istegi (14 Eylul 2026): "yardim_sayac tablosundaki islem_tarihi
// ... gercek Turkiye saatinden 3 saat geride kaydediliyor". KOK NEDEN:
// PostgreSQL oturum saat dilimi UTC - "timestamp without time zone"
// kolonlara NOW()/CURRENT_TIMESTAMP UTC duvar-saatini yaziyor (Turkiye
// 09:43 iken kolona 06:43 yaziliyor). Uygulama bu degeri OKURKEN "aslinda
// UTC'dir" varsayip dogru gosteriyor (bkz. lib/db/pgTypeParsers.ts,
// Prisma/@prisma/adapter-pg zaten bu sekilde okuyor - DOGRULANDI) - yani
// KULLANICIYA gosterilen saat su an DOGRU. Ama HAM veritabani degeri
// (ornegin pgAdmin'de dogrudan bakildiginda) gercek Turkiye saatinden 3
// saat geride GORUNUYOR, bu da kafa karistiriyor.
//
// Bu dosya, SADECE yardim_sayac tablosu icin (kullanici istegi: "simdilik
// sadece yardim sayac alanini duzeltelim, diger alanlari sonra yapalim"),
// HAM saklanan degerin de gercek Istanbul duvar-saatini icermesini saglar:
// PostgreSQL oturum saat dilimini (butun uygulamayi etkileyecek sekilde)
// DEGISTIRMEDEN, sadece bu tablonun yazma/okuma noktalarinda Istanbul
// duvar-saatini aciqca hesaplayip "naive UTC" gibi paketleyerek yaziyor/
// okuyoruz - Prisma'nin paylasilan baglantisinin "naive=UTC" varsayimiyla
// TUTARLI kalacak sekilde (yani Prisma'nin round-trip davranisini BOZMUYOR,
// sadece ICINE yazdigimiz "UTC" digit'lerin GERCEKTE Istanbul duvar-saati
// digit'leri olmasini sagliyoruz).

// "Su an" gercek Istanbul duvar-saatini, PostgreSQL naive kolonuna
// YAZILACAK bir Date olarak dondurur - bu Date'in UTC bilesenleri (getUTC*)
// Istanbul'daki gercek saat/dakika/saniyeye esittir (Prisma bunu naive
// kolona yazarken UTC digit'leri oldugu gibi kullanir).
export function nowAsNaiveIstanbulDate(): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')

  return new Date(Date.UTC(
    get('year'), get('month') - 1, get('day') === 24 && get('hour') === 24 ? get('day') : get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  ))
}

// "YYYY-MM-DD" (ve istege bagli "HH:MM" / "HH:MM:SS") girdisini, YUKARIDAKI
// AYNI kuralla ("Istanbul duvar-saati digit'leri = naive UTC digit'leri")
// bir Date'e cevirir - tarih araligi filtrelerinde (gte/lte) saklanan
// degerlerle AYNI birimde karsilastirma yapabilmek icin.
export function istanbulWallClockToNaiveDate(dateStr: string, timeStr = '00:00:00'): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  const [hour, minute, second] = timeStr.split(':').map((v) => Number(v) || 0)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, hour || 0, minute || 0, second || 0))
}

// Prisma'dan donen (naive="UTC" kabul edilerek okunmus) bir Date'in UTC
// bilesenlerini DOGRUDAN okur - yani ekrana, saklanan HAM digit'leri
// (Istanbul duvar-saati) baska bir donusum uygulamadan yazdirir. `.toLocale*`
// KULLANILMAZ (o, UTC instant'i tekrar Istanbul'a cevirmeye calisir ve
// digit'leri BOZAR).
export function formatNaiveIstanbulDate(value: Date): string {
  const dd = String(value.getUTCDate()).padStart(2, '0')
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = value.getUTCFullYear()
  return `${dd}.${mm}.${yyyy}`
}

export function formatNaiveIstanbulTime(value: Date): string {
  const hh = String(value.getUTCHours()).padStart(2, '0')
  const mi = String(value.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mi}`
}

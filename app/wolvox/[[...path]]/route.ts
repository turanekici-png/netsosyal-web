// Hızlı Satış (Wolvox9 kiosk/kasa uygulaması) ters-proxy'si
// -----------------------------------------------------------
// Ayrı bir bilgisayarda geliştirilmiş, kendi başına çalışan bir Flask
// programı (bkz. C:\HizliSatisApp\app\HizliSatis.exe, varsayılan olarak
// 127.0.0.1:5870'de dinler). NetSosyal'in kod tabanına TAŞINMADI - KPSV2
// köprüsüyle (bkz. app/kaps/[[...path]]/route.ts) AYNI desen: kendi başına
// bağımsız bir servis olarak çalışır, bu route sadece NetSosyal origin'i
// üzerinden erişilebilir kılar (CSP frame-src 'self', tek oturum/izin
// sistemi). Programın KENDİ route'ları zaten "/wolvox/hizli-satis/..."
// altında tanımlı olduğu için (bkz. app.py) - KPSV2'nin aksine - hiçbir
// <base href>/yol yeniden yazma GEREKMEZ, path birebir aynı kalır. Ortak
// proxy mantığı lib/hizliSatisProxy.ts'te (bu dosya VE app/static/
// [[...path]]/route.ts tarafından paylaşılır - Flask'ın varsayılan
// static_folder rotası "/wolvox" altında DEĞİL, kök "/static" altındadır).
export const dynamic = 'force-dynamic'

import { createHizliSatisProxy } from '@/lib/hizliSatisProxy'

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHizliSatisProxy('/wolvox')

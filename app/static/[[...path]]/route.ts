// Hızlı Satış uygulamasının statik dosyaları (ikon/manifest/service-worker)
// - Flask'ın varsayılan static_folder rotası "/static/<dosya>" (ÖZEL bir
// static_url_path verilmediği için "/wolvox" ÖNEKİ ALMAZ, bkz. templates/
// base.html'deki url_for('static', ...) çağrıları). Bu yüzden ayrı, kök
// seviyesinde bir proxy rotası gerekiyor - mantık app/wolvox/[[...path]]/
// route.ts ile AYNI (bkz. lib/hizliSatisProxy.ts).
export const dynamic = 'force-dynamic'

import { createHizliSatisProxy } from '@/lib/hizliSatisProxy'

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createHizliSatisProxy('/static')

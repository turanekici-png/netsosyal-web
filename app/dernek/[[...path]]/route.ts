// Dernek İşlemleri (E-Arşiv Fatura/Cari/Kurban kampanyası uygulaması)
// ters-proxy'si - dogrudan "/dernek" altinda (ara yonlendirme YOK, kullanici
// istegi: adres cubugunda "/dernek-app" degil "/dernek" gorunsun). Backend
// (C:\Users\Administrator\Desktop\DERNEK iŞLEMLERİ\run_prefixed.py) kendi
// route'larini ("/login", "/kesilen-faturalar" vb., hicbir ortak onek
// TASIMAZ) Werkzeug DispatcherMiddleware ile SCRIPT_NAME="/dernek" altinda
// sunar - Flask'in url_for() ciktisi bu sayede otomatik "/dernek/..." olur,
// orijinal app.py/templates HIC degistirilmedi. Bkz. lib/hizliSatisProxy.ts
// (createDernekProxy) icin mimari notlar.
export const dynamic = 'force-dynamic'

import { createDernekProxy } from '@/lib/hizliSatisProxy'

export const { GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS } = createDernekProxy('/dernek')

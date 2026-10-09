// NetSosyal - GECICI bakim sunucusu.
//
// `gonder` (guncelle-yayinla.ps1) sirasinda NSSM "NetSosyal" servisi durunca
// port 3000 bosalir; derleme birkac dakika surer. Bu sure boyunca hem dogrudan
// http://<ip>:3000 hem de IIS ters proxy (netsosyal.sivas.bel.tr -> :3000)
// uzerinden gelen kullanicilar "baglanti reddedildi" / IIS 502 hatasi yerine
// "Guncelleme yapiliyor, lutfen bekleyiniz" bilgi sayfasi gorur. Sayfa her 8
// saniyede bir kendini yeniler -> derleme bitip gercek uygulama :3000'e
// baglanınca kullanici otomatik olarak uygulamaya duser.
//
// guncelle-yayinla.ps1: build ONCESI bunu baslatir, build SONRASI (nssm start
// oncesi) sonlandirir.

const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = Number(process.env.PORT || process.env.MAINT_PORT || 3000)
let html = '<h1>Guncelleme yapiliyor, lutfen bekleyiniz.</h1>'
try {
  html = fs.readFileSync(path.join(__dirname, 'maintenance.html'), 'utf8')
} catch {}

const server = http.createServer((req, res) => {
  res.writeHead(503, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, must-revalidate',
    'Retry-After': '20',
  })
  res.end(html)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[bakim] Bakim sunucusu :${PORT} - guncelleme bitene kadar aktif`)
})

// Temiz kapanis
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}

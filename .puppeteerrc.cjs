// GUVENLIK: puppeteer'in kurulum sirasinda kendi Chromium'unu indirmesini
// engeller. Uygulama zaten SISTEMDE KURULU Chrome/Edge'i kullaniyor
// (bkz. lib/services/whatsappWeb.service.ts -> resolveBrowserExecutable).
// Indirme yapilmayinca "@puppeteer/browsers -> extract-zip" (GHSA-jmr9-qjv8-65gv,
// zip symlink path traversal) kod yolu HIC calismaz - npm audit'te transitif
// olarak gorunse de calisma/kurulum yuzeyi kalmaz.
module.exports = {
  skipDownload: true,
}

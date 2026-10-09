// Sunucu-icinden sunucuya HTTP cagrilari (ör. /api/documents/refresh-nvi ->
// /api/nvi, veya nakit/create-file -> /api/documents/create) HER ZAMAN
// localhost'a gitmeli.
//
// KOK NEDEN: `request.nextUrl.origin`, uygulama IIS/ARR arkasinda INTERNET
// uzerinden (https://netsosyal.sivas.bel.tr) acildiginda PUBLIC adresi
// donuyor. Bu durumda ic fetch, sunucunun KENDINE public URL uzerinden
// (hairpin NAT + TLS + IIS ters-proxy dongusu) baglanmaya calismasina yol
// aciyor ve BASARISIZ oluyor -> kullaniciya "Hata: islem sirasinda hata
// olustu" donuyordu. `:3000`'e dogrudan baglaninca `origin` zaten
// `http://localhost:3000` oldugu icin sorun gorunmuyordu.
//
// Bu yardimci her zaman `http://127.0.0.1:<port>` dondurur.
export function internalOrigin(): string {
  const port = process.env.INTERNAL_API_PORT || process.env.PORT || '3000'
  return `http://127.0.0.1:${port}`
}

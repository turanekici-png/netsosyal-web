import { redirect } from 'next/navigation'

// Kasiyerler icin kisa, paylasilabilir giris adresi
// (https://netsosyal.sivas.bel.tr/satis). Buraya ulasan istek, zaten
// proxy.ts'in oturum + yetki kontrolunden gecmistir (bkz. pageAccess.ts
// getPermissionPath - "/satis" -> "/muhasebe" eslemesi) - yani bu bilesen
// calistiginda kullanici hem giris yapmis hem de Muhasebe erisimine
// sahiptir. Gercek uygulama app/wolvox/[[...path]]/route.ts proxy'sindedir,
// burada sadece oraya yonlendirilir. "/hizli-satis" ile AYNI isi yapar,
// sadece daha kisa/akilda kalici bir takma addir.
export default function SatisGirisPage() {
  redirect('/wolvox/hizli-satis')
}

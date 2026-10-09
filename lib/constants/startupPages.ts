// Kullanici istegi (Eylul 2026): "program ilk acildiginda su sayfa acilsin,
// isteyen baska bir sayfa secebilsin". Kisi kendi baslangic sayfasini
// header > "İşlemler" menusunden secer; hesaba ozel (sunucuda) saklanir
// (bkz. app/api/user-startup-page/route.ts). Uygulama koku ("/") acilista
// bu sayfaya yonlenir (bkz. app/page.tsx).

export const STARTUP_PAGE_OPTIONS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'Dosya Yönetimi', path: '/documents' },
  // Kullanici istegi (2026-10-07, 4. tur): "Hızlı Satış"/"Dernek İşlemleri"
  // listede Ana Sayfa'dan SONRA geliyordu - bu, "sadece Hizli Satis'a
  // yetkili" bir kullaniciya YANLISLIKLA (ör. Kullanici Yetkileri'nde
  // "Ana Sayfa" kutusu da acik birakilmissa) Ana Sayfa'ya dusurup, Hizli
  // Satis'a HIC ULASAMADAN "ortada" birakiyordu - kullanici "direkt Hizli
  // Satis acilsin, Ana Sayfa'dan GECIS YAPMASIN" istedi. Bu yuzden bu ikisi
  // Dosya Yönetimi'nden HEMEN SONRA, Ana Sayfa dahil her seyden ONCE
  // kontrol edilecek sekilde listenin EN BASINA tasindi - boylece hangi
  // BASKA kutular da acik olursa olsun, Hizli Satis/Dernek yetkisi varsa
  // HER ZAMAN once o kazanir (Dosya Yönetimi'nin kendisi haric - o zaten
  // ayri, ilk denenen varsayilan).
  { label: 'Hızlı Satış', path: '/satis' },
  { label: 'Dernek İşlemleri', path: '/dernek' },
  { label: 'Ana Sayfa', path: '/dashboard' },
  { label: 'Dosyalar', path: '/documents/all' },
  { label: 'Bireyler', path: '/beneficiary' },
  { label: 'Onay Bekleyenler', path: '/approval-queue' },
  { label: 'Kurum İçi Mesaj', path: '/communication' },
  { label: 'Nakit Yardımı Listesi', path: '/assistance/nakit/muracaatlar' },
  { label: 'Nakit Müracaatı', path: '/requests/nakit' },
  { label: 'Gıda Yardımı', path: '/assistance/gida' },
  { label: 'Ekmek Yardımı', path: '/assistance/ekmek' },
  { label: 'Genel Raporlar', path: '/reports/genel' },
  { label: 'Yardım Hareketleri Raporu', path: '/reports/yardim-hareketleri' },
  { label: 'Gülkart Liste', path: '/gulkart/liste' },
  { label: 'Online Başvurular', path: '/online' },
  { label: 'İş Akışı', path: '/workflow' },
]

export const DEFAULT_STARTUP_PAGE = '/documents'

export const STARTUP_PAGE_PATHS: ReadonlySet<string> = new Set(
  STARTUP_PAGE_OPTIONS.map((o) => o.path),
)

export function normalizeStartupPage(value: unknown): string {
  const path = String(value ?? '').trim()
  return STARTUP_PAGE_PATHS.has(path) ? path : DEFAULT_STARTUP_PAGE
}

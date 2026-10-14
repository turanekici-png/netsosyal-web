// Kullanici istegi (2026-09-30, 10. tur): "sol sidebardaki Yardımlar
// sekmesinde olan tüm yardım raporlarının tasarım ve şeklini birebir Nakit
// Yardımı ile aynı yapalım" - Nakit'te sekmeler (afterHeader ile) BASLIGIN
// ALTINDA, digerlerinde ise (layout.tsx ile disaridan sarmalandigi icin)
// BASLIGIN USTUNDE cikiyordu - ayni renk/font olsa bile SIRALAMA farkliydi.
// Bu merkezi harita, her modulun "basePath"ine gore hangi ekstra sekmeyi/
// etiketi kullanacagini tutar - AssistanceListPage/AssistanceRequestListPage
// (SUNUCU bilesenleri) artik BUNU okuyup NAKIT ILE AYNI YONTEMLE (afterHeader,
// basligin altinda) sekmeleri render eder; ayri layout.tsx sarmalayicilari
// KALDIRILDI.
//
// ONEMLI: bu dosyada "use client" YOK (kasitli) - AssistanceModeTabs.tsx
// "use client" oldugu icin, ordaki bir sabiti/fonksiyonu SUNUCU bilesenlerinden
// (AssistanceListPage.tsx, AssistanceRequestListPage.tsx) dogrudan cagirmak
// "Attempted to call X() from the server but X is on the client" hatasi
// veriyordu - saf veri/fonksiyon buraya, ayri bir sunucu-guvenli dosyaya
// tasindi.
export type AssistanceModeTab = {
  id: string
  label: string
  href: string
}

export const ASSISTANCE_MODE_TABS_CONFIG: Record<string, { yardimlarLabel?: string; extraTabs?: AssistanceModeTab[] }> = {
  '/assistance/ekmek': {
    yardimlarLabel: 'Yardım Alanlar',
    extraTabs: [{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/ekmek/yardim-almayanlar' }],
  },
  '/assistance/gida': {
    yardimlarLabel: 'Yardım Alanlar',
    extraTabs: [{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/gida/yardim-almayanlar' }],
  },
  '/assistance/hazir-yemek': {
    yardimlarLabel: 'Yardım Alanlar',
    extraTabs: [{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/hazir-yemek/yardim-almayanlar' }],
  },
  '/assistance/destek-paketi': {
    yardimlarLabel: 'Yardım Alanlar',
    extraTabs: [{ id: 'yardim-almayanlar', label: 'Yardım Almayanlar', href: '/assistance/destek-paketi/yardim-almayanlar' }],
  },
  '/assistance/giyim': {},
  '/assistance/donem-disi': {},
  '/assistance/nakit': {
    extraTabs: [{ id: 'iptal-edilenler', label: 'İptal Edilenler', href: '/assistance/nakit/iptal-edilenler' }],
  },
}

// routePath, sayfaya gore "/assistance/gida", ".../muracaatlar",
// ".../yardim-almayanlar" ya da ".../iptal-edilenler" olabilir - hepsinden
// ortak "basePath"i cikarir, boylece cagiran taraf tek bir yardimci
// fonksiyonla dogru sekme setine ulasir.
export function getAssistanceModeTabsBasePath(routePath: string) {
  return routePath.replace(/\/(muracaatlar|yardim-almayanlar|iptal-edilenler)$/, '')
}

// Kurumsal baslik (2026-10-14): "Yardım Yönetimi › <modül>" yol satiri icin
// her modulun duzgun Turkce adi - tek yerden.
export const ASSISTANCE_MODULE_LABELS: Record<string, string> = {
  '/assistance/ekmek': 'Ekmek Yardımı',
  '/assistance/gida': 'Gıda Yardımı',
  '/assistance/giyim': 'Giyim Yardımı',
  '/assistance/hazir-yemek': 'Hazır Yemek',
  '/assistance/nakit': 'Nakit Yardımı',
  '/assistance/donem-disi': 'Dönem Dışı Gıda',
  '/assistance/destek-paketi': 'Destek Paketi',
  '/assistance/aceze': 'Aceze Yardımı',
}

export function getAssistanceKicker(routePath: string) {
  const label = ASSISTANCE_MODULE_LABELS[getAssistanceModeTabsBasePath(routePath)]
  return label ? `Yardım Yönetimi  ›  ${label}` : 'Yardım Yönetimi'
}

export function formatAssistanceDateTime(value: Date | null) {
  if (!value || Number.isNaN(value.getTime())) return null
  // "date" tipli kolonlar (ör. yrd_destekpaketi.islemtarihi) gece yarisi
  // olarak gelir - "00:00" yazmak yaniltici, sadece tarih gosterilir.
  const timePart = value.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' })
  if (timePart === '00:00') {
    return value.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' })
  }
  return value.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

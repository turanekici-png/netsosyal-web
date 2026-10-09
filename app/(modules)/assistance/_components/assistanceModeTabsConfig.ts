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

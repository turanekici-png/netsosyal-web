'use client'

// Kullanici istegi: "Yardım Haritası" artik Ana Sayfa'da da bir widget olarak
// gorunuyor (bkz. app/(modules)/dashboard/page.tsx) - butun harita mantigi
// (veri cekme, Leaflet yukleme/isaretleme, filtre) tek bir yerde
// (components/shared/AssistanceDistributionMap.tsx) toplanip iki farkli
// kabukla (tam sayfa/widget) kullanildigi icin bu sayfa artik sadece o
// paylasimli bileseni "page" gorunumuyle render eder.
import { AssistanceDistributionMap } from '@/components/shared/AssistanceDistributionMap'

export default function AssistanceMapPage() {
  return <AssistanceDistributionMap variant="page" />
}

// `/api/predefined-values` icin PAYLASILAN (modul-seviyesinde tek seferlik
// istek) client - hem AdvancedTable hem de rapor sayfalari (Dosyalar/
// Bireyler "Rapor Oluştur") ayni veriyi kullanir. Ayni dosyada iki ayri
// kopyasi olursa (biri AdvancedTable icinde, digeri sayfa bilesenlerinde)
// istek ikiye katlanir VE ikisi ayni promise'i PAYLASMADIGI icin "tek
// seferlik istek" garantisi bozulur - bu yuzden tek, paylasilan bir modul.
import {
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'

export type PredefinedValuesPayload = {
  data?: {
    values?: PredefinedValuesMap
    titles?: PredefinedValueTitlesMap
  }
}

let predefinedValuesRequest: Promise<PredefinedValuesPayload> | null = null

export function fetchPredefinedValuesOnce() {
  if (!predefinedValuesRequest) {
    predefinedValuesRequest = fetch('/api/predefined-values')
      .then((response) => {
        if (!response.ok) throw new Error('Hazir degerler alinamadi.')
        return response.json() as Promise<PredefinedValuesPayload>
      })
      .catch((error) => {
        predefinedValuesRequest = null
        throw error
      })
  }

  return predefinedValuesRequest
}

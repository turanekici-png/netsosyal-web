'use client'

// KATMAN 0 - Kabuk olcekleme.
//
// ScaledArea'nin uyguladigi `zoom` katsayisini agac icine tasir. `zoom` altinda
// getBoundingClientRect() OLCEKLI piksel dondurur ama bazi hesaplar (RGL satir
// matematigi, body'ye portallanmis menu konumlari) OLCEKSIZ calisir - o
// noktalarda olculen degeri bu katsayiya BOLMEK gerekir.

import { createContext, useContext } from 'react'

export const ScaleContext = createContext(1)

export function useUiScale(): number {
  return useContext(ScaleContext)
}

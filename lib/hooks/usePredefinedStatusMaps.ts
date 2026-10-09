'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_PREDEFINED_VALUES, type PredefinedValue } from '@/lib/constants/predefinedValues'
import { fetchPredefinedValuesOnce } from '@/lib/hooks/predefinedValuesClient'

function toMap(values: PredefinedValue[] | undefined, fallback: PredefinedValue[] = []) {
  return Object.fromEntries((values?.length ? values : fallback).map((item) => [item.id, item.name])) as Record<string, string>
}

// AdvancedTable ekranda kodlari (0,1,2...) "Yardım Yapılabilir" gibi
// okunabilir etiketlere ceviriyor ama bu cevrimi SADECE kendi icinde yapiyor
// - disariya (ör. Excel/yazdirma raporu olusturan sayfaya) bu haritalari
// vermiyor. "Rapor Oluştur" (ColumnPickerReportModal) rapor icin veriyi
// AYRICA sunucudan cektigi icin, o da ayni haritalara erismeli - aksi
// halde raporda ham kod (4, 0, 2 gibi) gorunur. Bu hook, sayfa
// bilesenlerinin (documents/all, beneficiary) rapor icin ihtiyac duydugu
// haritalari saglar.
export function usePredefinedStatusMaps() {
  const [fileStatusMap, setFileStatusMap] = useState<Record<string, string>>({})
  const [maritalStatusMap, setMaritalStatusMap] = useState<Record<string, string>>({})
  const [relationshipMap, setRelationshipMap] = useState<Record<string, string>>({})
  const [genderMap, setGenderMap] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    fetchPredefinedValuesOnce()
      .then((payload) => {
        if (cancelled) return
        const values = payload?.data?.values ?? {}

        setFileStatusMap({ ...toMap(values.fileStatus), '5': 'Ön İnceleme Yapılmış' })
        setMaritalStatusMap(toMap(values.maritalStatus))
        setRelationshipMap(toMap(values.relationship))
        setGenderMap(toMap(values.gender, DEFAULT_PREDEFINED_VALUES.gender))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  return { fileStatusMap, maritalStatusMap, relationshipMap, genderMap }
}

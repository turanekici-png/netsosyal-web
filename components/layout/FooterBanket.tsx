'use client'

import { useEffect, useState } from 'react'

type GeneralSettings = {
  institutionName?: string
  departmentName?: string
  address?: string
  phone1?: string
  phone2?: string
}

const GENERAL_SETTINGS_KEY = 'general_settings'

const defaultGeneralSettings: Required<GeneralSettings> = {
  institutionName: 'Sivas Belediyesi',
  departmentName: 'Sosyal Hizmetler Müdürlüğü',
  address: 'Sivas Belediyesi Sosyal Hizmetler Müdürlüğü',
  phone1: '',
  phone2: '',
}

export function FooterBanket() {
  const [generalSettings, setGeneralSettings] = useState(defaultGeneralSettings)

  useEffect(() => {
    let isCancelled = false

    const loadGeneralSettings = async () => {
      try {
        const response = await fetch(`/api/settings/${GENERAL_SETTINGS_KEY}`)
        if (!response.ok) return

        const payload = await response.json()
        const value = payload?.data?.value as GeneralSettings | undefined

        if (!isCancelled && value) {
          setGeneralSettings({
            ...defaultGeneralSettings,
            ...value,
          })
        }
      } catch {
        if (!isCancelled) {
          setGeneralSettings(defaultGeneralSettings)
        }
      }
    }

    loadGeneralSettings()

    return () => {
      isCancelled = true
    }
  }, [])

  const title = [generalSettings.institutionName, generalSettings.departmentName].filter(Boolean).join(' ')
  const phone = [generalSettings.phone1, generalSettings.phone2].filter(Boolean).join(' / ')

  // 2026-10-14: "alttaki bandi daha kurumsal yap" - yesil-turkuaz degrade +
  // kalin tek satir yerine, ust seritlerle ayni lacivert degrade + altin ust
  // cizgi; kurum adi vurgulu, adres/telefon ince ayracla ayrilmis.
  return (
    <div className="z-[1000] flex min-h-[1cm] w-full shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-0.5 border-t-2 border-[#b8860b] bg-gradient-to-r from-[#0b1f3f] via-[#12305f] to-[#1a4580] px-4 py-1 text-center text-[13.5px] leading-tight text-white/85 shadow-[0_-2px_8px_rgba(15,23,42,0.18)]">
      <span className="font-semibold tracking-[0.02em] text-white">{title}</span>
      {generalSettings.address && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-px bg-white/30" />
          <span className="text-white/60">Adres:</span>
          <span className="font-medium">{generalSettings.address}</span>
        </span>
      )}
      {phone && (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-3.5 w-px bg-white/30" />
          <span className="text-white/60">Telefon:</span>
          <span className="font-medium tabular-nums">{phone}</span>
        </span>
      )}
    </div>
  )
}

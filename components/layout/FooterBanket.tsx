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
  const text = [
    title,
    generalSettings.address ? `Adres: ${generalSettings.address}` : '',
    phone ? `Telefon: ${phone}` : '',
  ].filter(Boolean).join(' - ')

  return (
    <div className="z-[1000] flex h-[1cm] w-full shrink-0 items-center justify-center bg-gradient-to-r from-[#2f93a1] to-[#70b94a] px-4 text-center text-[15px] font-extrabold leading-tight text-white shadow-[0_-2px_8px_rgba(15,23,42,0.18)]">
      {text}
    </div>
  )
}

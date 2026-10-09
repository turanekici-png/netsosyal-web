'use client'

import { useEffect, useRef, useState } from 'react'

// Kullanici istegi (14 Eylul 2026): "doğum tarihini manuel olarak elle
// girebilsin, 03101978 yazınca 03.10.1978 olsun" - tarayicinin yerlesik
// <input type="date"> takvim secicisi yerine, "yazarken otomatik
// bicimlendir" deseniyle GG.AA.YYYY metin girisi. Hem online basvuru
// formundaki (OnlineApplicationClient) kimlik alaninda, hem de basvuru
// sorgulama ekraninda (app/onlinebasvuru/ApplicationStatusLookup) ayni
// bilesen kullanilir - bu yuzden ortak bir dosyaya cikarildi.
export function formatBirthDateDigits(raw: string): { text: string; iso: string } {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  let text = digits.slice(0, 2)
  if (digits.length > 2) text += '.' + digits.slice(2, 4)
  if (digits.length > 4) text += '.' + digits.slice(4, 8)

  let iso = ''
  if (digits.length === 8) {
    const day = digits.slice(0, 2)
    const month = digits.slice(2, 4)
    const year = digits.slice(4, 8)
    if (Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12) {
      iso = `${year}-${month}-${day}`
    }
  }

  return { text, iso }
}

export function isoDateToDisplay(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return ''
  return `${match[3]}.${match[2]}.${match[1]}`
}

// Yerlesik tarih secici yerine, kullanicinin rakamlari peş peşe (ör.
// "03101978") yazmasina izin verip GG.AA.YYYY noktalarini kendiliginden
// ekleyen metin girisi. Tamamlanmamis (8 haneden az) girislerde ust bilesene
// bos ("") ISO deger bildirilir - form gonderiminde zorunlu alan kontrolu
// bunu zaten yakaliyor.
export function BirthDateTextInput({
  value,
  onChange,
  onEnterKey,
  ariaLabel,
  className,
}: {
  value: string
  onChange: (iso: string) => void
  onEnterKey?: () => void
  ariaLabel?: string
  className?: string
}) {
  const [text, setText] = useState(() => isoDateToDisplay(value))
  // Kendi onChange cagrimizdan gelen degeri izler; useEffect'in bunu
  // "disaridan" (ör. basvuru basariyla gonderilip formun sifirlanmasi)
  // gelen bir degisiklikten ayirt edebilmesi icin - aksi halde kullanici
  // tamamlanmis bir tarihi duzenlemek icin geri silince (onChange('')
  // KENDIMIZ cagiriyoruz) asagidaki effect bunu "disaridan sifirlama"
  // sanip az once yazilan dogru kismi metni siler.
  const lastEmittedIsoRef = useRef(value)

  useEffect(() => {
    if (value !== lastEmittedIsoRef.current) {
      setText(isoDateToDisplay(value))
      lastEmittedIsoRef.current = value
    }
  }, [value])

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="GG.AA.YYYY"
      maxLength={10}
      value={text}
      onChange={(event) => {
        const { text: formatted, iso } = formatBirthDateDigits(event.target.value)
        setText(formatted)
        lastEmittedIsoRef.current = iso
        onChange(iso)
      }}
      onKeyDown={onEnterKey ? (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onEnterKey()
        }
      } : undefined}
      aria-label={ariaLabel}
      className={className}
    />
  )
}

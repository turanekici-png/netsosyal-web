'use client'

import { useLayoutEffect, useRef, useState } from 'react'

// Metni bulundugu alana `satir` satirda (varsayilan 1) sigacak sekilde yazi boyutunu ayarlar
// (kullanici istegi 2026-10-14: Dosya Yönetimi'nde adres "alana sigacak
// puntoda"). En fazla `enFazla`, en az `enAz` piksel; en az boyutta da
// sigmazsa okunakliligi korumak icin alt satira kirilir. Alan genisligi
// degistikce (pencere/zoom) yeniden hesaplanir.

let olcumTuvali: HTMLCanvasElement | null = null

type Props = {
  metin: string
  enFazla: number
  enAz: number
  className?: string
  // Metnin sigdirilacagi satir sayisi (alan bu kadar satir yuksekliginde ayrilir).
  satir?: number
  // true: alan (position:absolute), relative kapsayicisinin YUKSEKLIGINI doldurur
  // (kendisi yukseklik dayatmaz), ve yazi o kutuya
  // (kelime kaydirmali) sigacak en buyuk boyutta gosterilir.
  kutuyaSigdir?: boolean
}

export default function SigdirilmisMetin({ metin, enFazla, enAz, className, satir = 1, kutuyaSigdir = false }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const [boyut, setBoyut] = useState(enFazla)
  const [kir, setKir] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const hesapla = () => {
      if (kutuyaSigdir) {
        const yukseklik = el.clientHeight
        if (!yukseklik || !metin) return
        let deneme = enFazla
        for (; deneme > enAz; deneme -= 0.5) {
          el.style.fontSize = `${deneme}px`
          if (el.scrollHeight <= yukseklik + 1) break
        }
        deneme = Math.max(enAz, deneme)
        el.style.fontSize = `${deneme}px`
        setBoyut(deneme)
        setKir(true)
        return
      }
      const genislik = el.clientWidth
      if (!genislik || !metin) {
        setBoyut(enFazla)
        setKir(false)
        return
      }
      olcumTuvali ??= document.createElement('canvas')
      const ctx = olcumTuvali.getContext('2d')
      if (!ctx) return
      const stil = getComputedStyle(el)
      ctx.font = `${stil.fontWeight} ${enFazla}px ${stil.fontFamily}`
      const metinGenisligi = ctx.measureText(metin).width + 2
      // Birden cok satirda kelime kaydirma bosluk biraktigi icin %10 pay.
      const kapasite = satir > 1 ? genislik * satir * 0.9 : genislik
      const uygun = metinGenisligi <= kapasite ? enFazla : Math.floor((enFazla * kapasite / metinGenisligi) * 10) / 10
      setBoyut(Math.max(enAz, Math.min(enFazla, uygun)))
      setKir(uygun < enAz)
    }
    hesapla()
    const gozlemci = new ResizeObserver(hesapla)
    gozlemci.observe(el)
    return () => gozlemci.disconnect()
  }, [metin, enFazla, enAz, satir, kutuyaSigdir])

  return (
    <span
      ref={ref}
      className={className}
      title={metin}
      style={{ display: 'block', width: '100%', ...(kutuyaSigdir ? { position: 'absolute', inset: 0, overflow: 'hidden' } : {}), fontSize: `${boyut}px`, lineHeight: 1.3, minHeight: !kutuyaSigdir && satir > 1 ? `${satir * 1.3 * boyut}px` : undefined, whiteSpace: kir || satir > 1 ? 'normal' : 'nowrap', overflowWrap: 'anywhere' }}
    >
      {metin}
    </span>
  )
}

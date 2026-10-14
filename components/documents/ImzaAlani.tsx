'use client'

import { useEffect, useRef, useState } from 'react'

// Dokunmatik imza alani (2026-10-13, kullanici istegi: "başvuru sahibinin ve
// personelin dijital olarak imzası alınabilmeli, kişiler kalemle tablet
// üzerinden imza atabilsin"). Kalem, parmak ve fare ile calisir (Pointer
// Events). Imza PNG (data URL) olarak disari verilir ve formun cevabi olarak
// saklanir - yazdirma ciktisinda <img> ile gosterilir.

// 2026-10-13 (4. tur): "imza alani tablette kucuk, alta 2 cm uzatalim" - tuval
// artik SABIT ORANLI degil, CSS'te sabit yukseklik (globals.css .sf-imza canvas)
// ve gercek piksel boyutu ekran/piksel yogunluguna gore ayarlanir (imza
// uzamaz/basik gorunmez, keskin cikar). Ilk cizim icin baslangic boyutu:
const BASLANGIC_GENISLIK = 640
const BASLANGIC_YUKSEKLIK = 230
const KALEM_KALINLIGI = 2.6

// Kayitli imzayi (data URL) oranini bozmadan tuvale ortalayarak cizer.
function resmiSigdir(c: CanvasRenderingContext2D, canvas: HTMLCanvasElement, img: HTMLImageElement) {
  c.clearRect(0, 0, canvas.width, canvas.height)
  const olcek = Math.min(canvas.width / img.width, canvas.height / img.height)
  const w = img.width * olcek
  const h = img.height * olcek
  c.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
}

type Props = {
  value: string | undefined
  onChange: (dataUrl: string) => void
  eksik?: boolean
}

export default function ImzaAlani({ value, onChange, eksik }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ciziyorRef = useRef(false)
  const sonNoktaRef = useRef<{ x: number; y: number } | null>(null)
  const ciziliRef = useRef(false)
  const yuklenenRef = useRef<string | null>(null)
  const [bos, setBos] = useState(!value)

  const ctx = () => {
    const canvas = canvasRef.current
    const c = canvas?.getContext('2d')
    if (!canvas || !c) return null
    // Kalem kalinligi ekranda her boyutta ayni gorunsun (tuval pikseli / ekran pikseli)
    const r = canvas.getBoundingClientRect()
    c.lineWidth = KALEM_KALINLIGI * (r.width ? canvas.width / r.width : 1)
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = '#0b1f44'
    return c
  }

  // Disaridan gelen kayitli imzayi (ör. form yeniden cizildiginde) tuvale yukle.
  useEffect(() => {
    const canvas = canvasRef.current
    const c = canvas?.getContext('2d')
    if (!canvas || !c) return
    if (!value) {
      if (yuklenenRef.current !== null || ciziliRef.current) {
        c.clearRect(0, 0, canvas.width, canvas.height)
        ciziliRef.current = false
      }
      yuklenenRef.current = null
      setBos(true)
      return
    }
    if (value === yuklenenRef.current) return
    const img = new Image()
    img.onload = () => {
      resmiSigdir(c, canvas, img)
      ciziliRef.current = true
      setBos(false)
    }
    img.src = value
    yuklenenRef.current = value
  }, [value])

  // Tuvalin gercek piksel boyutunu gorunen boyutuna (x piksel yogunlugu)
  // esitle; boyut degisirse (ekran dondurme, pencere) mevcut imzayi koru.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ayarla = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(canvas.clientWidth * dpr)
      const h = Math.round(canvas.clientHeight * dpr)
      if (!w || !h || (w === canvas.width && h === canvas.height)) return
      canvas.width = w
      canvas.height = h
      const kayitli = yuklenenRef.current
      if (kayitli) {
        const img = new Image()
        img.onload = () => { const c = canvas.getContext('2d'); if (c) resmiSigdir(c, canvas, img) }
        img.src = kayitli
      }
    }
    ayarla()
    const ro = new ResizeObserver(ayarla)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const nokta = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height }
  }

  const basla = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    ciziyorRef.current = true
    const p = nokta(e)
    sonNoktaRef.current = p
    const c = ctx()
    if (c) {
      c.beginPath()
      c.arc(p.x, p.y, 1.2, 0, Math.PI * 2)
      c.fillStyle = '#0b1f44'
      c.fill()
    }
    ciziliRef.current = true
    setBos(false)
  }

  const ciz = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ciziyorRef.current) return
    e.preventDefault()
    const c = ctx()
    const onceki = sonNoktaRef.current
    if (!c || !onceki) return
    const p = nokta(e)
    // Yumusak cizgi: iki nokta arasinin ortasina kuadratik egri
    const orta = { x: (onceki.x + p.x) / 2, y: (onceki.y + p.y) / 2 }
    c.beginPath()
    c.moveTo(onceki.x, onceki.y)
    c.quadraticCurveTo(onceki.x, onceki.y, orta.x, orta.y)
    c.lineTo(p.x, p.y)
    c.stroke()
    sonNoktaRef.current = p
  }

  const bitir = () => {
    if (!ciziyorRef.current) return
    ciziyorRef.current = false
    sonNoktaRef.current = null
    const canvas = canvasRef.current
    if (!canvas || !ciziliRef.current) return
    const dataUrl = canvas.toDataURL('image/png')
    yuklenenRef.current = dataUrl
    onChange(dataUrl)
  }

  const temizle = () => {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    ciziliRef.current = false
    yuklenenRef.current = null
    setBos(true)
    onChange('')
  }

  return (
    <div className={`sf-imza${eksik ? ' eksik' : ''}`}>
      <div className="sf-imza-kutu">
        <canvas
          ref={canvasRef}
          width={BASLANGIC_GENISLIK}
          height={BASLANGIC_YUKSEKLIK}
          onPointerDown={basla}
          onPointerMove={ciz}
          onPointerUp={bitir}
          onPointerLeave={bitir}
          onPointerCancel={bitir}
          aria-label="İmza alanı - kalem, parmak veya fare ile imzalayın"
        />
        {bos && <span className="sf-imza-ipucu">Kalem, parmak veya fare ile buraya imzalayın</span>}
        <span className="sf-imza-cizgi" aria-hidden />
      </div>
      <div className="sf-imza-alt">
        <span>{bos ? 'İmza bekleniyor' : '✓ İmza alındı'}</span>
        <button type="button" onClick={temizle} className="sf-btn kucuk" disabled={bos}>Temizle</button>
      </div>
    </div>
  )
}

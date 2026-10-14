'use client'

import { useEffect, useRef, useState } from 'react'

// Konusarak yazma (2026-10-14). Tarayicinin SpeechRecognition'i (tr-TR) ile
// soylenenler, butonun AIT OLDUGU alanin sonuna eklenir.
//
// 2. surum (kullanici: "mikrofon aciliyor ama konusulanlari alana yazmiyor"):
//  - Dinleme DOKUNUSUN ICINDE baslatilir (oncesinde await yok): iPhone/iPad
//    Safari dokunus disinda baslatilani reddediyor; Android'de once
//    getUserMedia acip kapatmak mikrofonu mesgul birakip dinlemeyi
//    dusuruyordu. Izin penceresini tarayici start() ile kendisi acar.
//  - Ara sonuc (interim) acik: konusurken soylenen anlik onizlemede gorunur.
//  - Metin duzenlenir: cumle basi buyuk harf (Turkce), sonda nokta, sesli
//    noktalama komutlari ("virgül", "nokta", "soru işareti", "yeni satır").
//  - Android'de ayni sonucun iki kez gelmesi engellenir.

type SonucListesi = ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>

type SpeechRecognitionInstance = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: { resultIndex?: number; results: SonucListesi }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

type SpeechWindow = typeof window & {
  SpeechRecognition?: new () => SpeechRecognitionInstance
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance
}

const ust = (s: string) => s.toLocaleUpperCase('tr-TR')

// Sesli noktalama komutlari - TAM KELIME olarak eslesir ("noktada" eslesmez).
// Not: JS'te \b Turkce harflerde (ü, ı, ş...) calismaz - bosluk sinirlari kullanilir.
const komut = (kelimeler: string) => new RegExp(`(^|\\s)(?:${kelimeler})(?=\\s|$)`, 'giu')
const KOMUTLAR: Array<[RegExp, string]> = [
  [komut('yeni paragraf'), '\n\n '],
  [komut('yeni satır|alt satır'), '\n '],
  [komut('soru işareti'), '? '],
  [komut('ünlem işareti'), '! '],
  [komut('iki nokta üst üste|iki nokta'), ': '],
  [komut('noktalı virgül'), '; '],
  [komut('virgül'), ', '],
  [komut('nokta'), '. '],
]

// Bir parcayi (son eklenen konusma) duzgun yazima cevirir. `onceki`, alanda
// zaten yazili olan metin - cumle basi olup olmadigi ondan anlasilir.
export function konusmayiDuzenle(ham: string, onceki: string): string {
  let metin = ` ${ham.trim()} `
  for (const [desen, isaret] of KOMUTLAR) metin = metin.replace(desen, isaret)
  metin = metin
    .replace(/[ \t]+([,.;:!?])/g, '$1') // isaretten once bosluk olmaz
    .replace(/([,.;:!?])(?=[^\s\d,.;:!?])/g, '$1 ') // isaretten sonra bosluk
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim()
    .replace(/^[,.;:!?]+\s*/, '') // parca isaretle baslamaz
  if (!metin) return ''

  // Cumle basi buyuk harf: metnin basi (onceki bos ya da cumle bitmisse) ve . ! ? / satir sonrasi
  const oncekiTemiz = onceki.replace(/\s+$/, '')
  const cumleBasi = !oncekiTemiz || /[.!?:\n]$/.test(oncekiTemiz)
  if (cumleBasi) metin = metin.replace(/^(\s*)(\p{L})/u, (_, b: string, h: string) => b + ust(h))
  metin = metin.replace(/([.!?]\s+|\n\s*)(\p{L})/gu, (_, a: string, h: string) => a + ust(h))

  // Her konusma parcasi bir cumle: isaretle bitmiyorsa nokta konur
  if (!/[.!?:;,\n]$/.test(metin)) metin += '.'
  return metin
}

function metneEkle(mevcut: string, parca: string): string {
  if (!parca) return mevcut
  const sol = mevcut.replace(/[ \t]+$/, '')
  if (!sol) return parca.replace(/^\n+/, '')
  if (parca.startsWith('\n') || sol.endsWith('\n')) return sol + parca
  return `${sol} ${parca}`
}

const mobilMi = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

export default function MikrofonButonu({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [aktif, setAktif] = useState(false)
  const [mesaj, setMesaj] = useState('')
  const [onizleme, setOnizleme] = useState('')
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const calismaliRef = useRef(false)
  const sonEklenenRef = useRef<{ metin: string; zaman: number }>({ metin: '', zaman: 0 })
  const yenidenDenemeRef = useRef(0)
  // Dinleme sirasinda en guncel metne eklensin (eski kapanis degil)
  const degerRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    degerRef.current = value
    onChangeRef.current = onChange
  })

  const durdur = () => {
    calismaliRef.current = false
    try { recognitionRef.current?.stop() } catch { /* zaten durmus */ }
    recognitionRef.current = null
    setAktif(false)
    setOnizleme('')
  }

  useEffect(() => () => {
    calismaliRef.current = false
    try { recognitionRef.current?.abort?.() } catch { /* yok say */ }
  }, [])

  const yaz = (hamMetin: string) => {
    const temiz = hamMetin.trim()
    if (!temiz) return
    // Android Chrome ayni son sonucu bazen iki kez gonderir
    const simdi = Date.now()
    if (sonEklenenRef.current.metin === temiz && simdi - sonEklenenRef.current.zaman < 4000) return
    sonEklenenRef.current = { metin: temiz, zaman: simdi }
    const yeni = metneEkle(degerRef.current, konusmayiDuzenle(temiz, degerRef.current))
    degerRef.current = yeni
    onChangeRef.current(yeni)
  }

  const dinle = (Ctor: new () => SpeechRecognitionInstance) => {
    const recognition = new Ctor()
    recognition.lang = 'tr-TR'
    // Masaustunde surekli dinleme; mobilde (surekli mod hatali/cift sonuc
    // verdigi icin) her cumleden sonra otomatik yeniden baslar.
    recognition.continuous = !mobilMi()
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    // Android Chrome / iOS Safari cogu zaman sonucu HIC "isFinal" isaretlemez
    // (yalniz ara sonuc gelir, dinleme surer, alana bir sey yazilmaz). Bu
    // yuzden: konusmada ~1.6 sn duraklama olunca o ana kadar duyulan yazilir
    // ve bu oturum kapatilip (abort - gec gelen kopyalari atar) yenisi acilir;
    // oturum kendiliginden biterse bekleyen ara metin de yazilir.
    let ara = ''
    let kapandi = false
    let sessizlik: number | undefined
    const araMetniYaz = () => {
      if (kapandi || !ara.trim()) return
      kapandi = true
      yaz(ara)
      ara = ''
      setOnizleme('')
      try { (recognition.abort ?? recognition.stop).call(recognition) } catch { /* zaten bitti */ }
    }

    recognition.onstart = () => {
      yenidenDenemeRef.current = 0
      setMesaj('Dinleniyor — konuşun; kısa bir duraklamada söyledikleriniz bu alana yazılır.')
    }
    recognition.onresult = (event) => {
      if (kapandi) return
      let yeniAra = ''
      for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
        const sonuc = event.results[i]
        const metin = sonuc[0]?.transcript ?? ''
        if (sonuc.isFinal) yaz(metin)
        else yeniAra += metin
      }
      ara = yeniAra
      setOnizleme(ara.trim())
      window.clearTimeout(sessizlik)
      if (ara.trim()) sessizlik = window.setTimeout(araMetniYaz, 1600)
    }
    recognition.onerror = (event) => {
      const hata = event.error || ''
      if (hata === 'no-speech' || hata === 'aborted') return
      if (hata === 'audio-capture' && yenidenDenemeRef.current < 2) {
        yenidenDenemeRef.current += 1 // mikrofon bir an mesgul - onend'de tekrar denenir
        return
      }
      setMesaj(
        hata === 'not-allowed' || hata === 'service-not-allowed'
          ? 'Mikrofon izni verilmedi. Adres çubuğundaki kilit simgesi → İzinler/Site ayarları → Mikrofon → İzin ver; sonra sayfayı yenileyin. (iPhone: Ayarlar → Safari → Mikrofon; ayrıca Siri ve Dikte açık olmalı.)'
          : hata === 'network'
            ? 'Konuşma tanıma servisine ulaşılamadı. İnternet bağlantısını kontrol edin.'
            : hata === 'audio-capture'
              ? 'Mikrofon kullanılamıyor. Başka bir uygulama mikrofonu kullanıyor olabilir.'
              : `Konuşma tanıma durdu (${hata}).`,
      )
      durdur()
    }
    recognition.onend = () => {
      window.clearTimeout(sessizlik)
      araMetniYaz() // oturum bittiyse bekleyen ara metin kaybolmasin
      setOnizleme('')
      if (!calismaliRef.current) {
        recognitionRef.current = null
        setAktif(false)
        return
      }
      // Durdur'a basilana kadar dinlemeye devam
      window.setTimeout(() => { if (calismaliRef.current) dinle(Ctor) }, 250)
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
    } catch {
      setMesaj('Mikrofon başlatılamadı. Sayfayı yenileyip tekrar deneyin.')
      durdur()
    }
  }

  const baslat = () => {
    const w = window as SpeechWindow
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!Ctor) {
      setMesaj('Bu tarayıcı konuşarak yazmayı desteklemiyor. Android’de Chrome, iPhone/iPad’de Safari kullanın.')
      return
    }
    const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
    if (!window.isSecureContext && !isLocalhost) {
      setMesaj('Mikrofon için sayfayı HTTPS (netsosyal.sivas.bel.tr) üzerinden açın.')
      return
    }
    calismaliRef.current = true
    sonEklenenRef.current = { metin: '', zaman: 0 }
    setAktif(true)
    setMesaj('Mikrofon açılıyor... İzin sorulursa “İzin ver”e dokunun.')
    // ONEMLI: await yok - dokunusun icinde baslar (iOS Safari sarti)
    dinle(Ctor)
  }

  return (
    <div className="sf-mikrofon">
      <button
        type="button"
        onClick={() => { if (aktif) { durdur(); setMesaj('') } else { baslat() } }}
        className={`sf-btn kucuk sf-mikrofon-btn${aktif ? ' dinliyor' : ''}`}
        title={aktif ? 'Dinlemeyi durdur' : 'Konuşarak yaz (bu alana)'}
        aria-pressed={aktif}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </svg>
        {aktif ? 'Durdur' : 'Mikrofon'}
      </button>
      {aktif && onizleme && <span className="sf-mikrofon-onizleme">“{onizleme}”</span>}
      {mesaj && <span className="sf-mikrofon-mesaj">{mesaj}</span>}
    </div>
  )
}

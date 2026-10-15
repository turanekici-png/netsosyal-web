'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  bilgiTabaniTalimati,
  HAZIR_SORU_KATEGORI_ETIKETLERI,
  KURAL_KATEGORI_ETIKETLERI,
  VARSAYILAN_BILGI_TABANI,
  yeniKimlik,
  type AsistanBilgiTabani,
  type AsistanHazirSoruKategori,
  type AsistanKuralKategori,
} from '@/lib/asistan/bilgiTabani'

// Kullanici istegi (14-15 Eylul 2026, 23.-24. tur): Sosyal Asistan icin coklu
// saglayici destegi (bkz. lib/services/aiAssistant.service.ts). Kendi API ucu:
// /api/asistan/settings - ham anahtar istemciye HICBIR ZAMAN donmez.
//
// 2026-10-15 kullanici istegi: "icindeki kriterlere dokunmadan yeni kriterler,
// yeni soru ve cevaplar ekle, profesyonel sekilde yeniden tasarla" - panel
// sekmelere ayrildi. Mevcut serbest metin "Özel Talimatlar" AYNEN korunur
// (ayri sekme, ayri kayit); yanina yapilandirilmis bilgi tabani eklendi
// (bkz. lib/asistan/bilgiTabani.ts): terim sozlugu, kurallar, ornek
// soru-cevaplar, sohbet ekranindaki hazir sorular.
type AssistantProvider = 'gemini' | 'openai' | 'deepseek' | 'anthropic'

const PROVIDER_OPTIONS: { id: AssistantProvider; label: string; keyHint: string; helpUrl: string; helpLabel: string }[] = [
  { id: 'gemini', label: 'Google Gemini', keyHint: 'AIza...', helpUrl: 'https://aistudio.google.com/apikey', helpLabel: 'Google AI Studio' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keyHint: 'sk-...', helpUrl: 'https://platform.openai.com/api-keys', helpLabel: 'OpenAI Platform' },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'sk-...', helpUrl: 'https://platform.deepseek.com/api_keys', helpLabel: 'DeepSeek Platform' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys', helpLabel: 'Anthropic Console' },
]

type Sekme = 'genel' | 'terimler' | 'kurallar' | 'ornekler' | 'hazir' | 'serbest' | 'baglanti'

const SEKMELER: { id: Sekme; etiket: string; aciklama: string }[] = [
  { id: 'genel', etiket: 'Genel Bakış', aciklama: 'Durum ve asistana giden talimat' },
  { id: 'terimler', etiket: 'Terim Sözlüğü', aciklama: '"Şunu dediğimde bunu anla"' },
  { id: 'kurallar', etiket: 'Kurallar', aciklama: 'Rapor biçimi, veri yorumu, gizlilik' },
  { id: 'ornekler', etiket: 'Örnek Soru-Cevap', aciklama: 'Doğru yaklaşımı öğretin' },
  { id: 'hazir', etiket: 'Hazır Sorular', aciklama: 'Sohbet ekranındaki kısayollar' },
  { id: 'serbest', etiket: 'Serbest Talimatlar', aciklama: 'Mevcut talimat metni' },
  { id: 'baglanti', etiket: 'Bağlantı (API)', aciklama: 'Yapay zeka sağlayıcısı' },
]

const KART = 'overflow-hidden rounded-xl border border-[#D5DDE2] bg-white shadow-[0_1px_2px_rgba(16,30,43,0.05)]'
const KART_BASLIK = 'flex flex-wrap items-center justify-between gap-3 border-b border-[#D5DDE2] bg-[#F7F8FA] px-5 py-4'
const UST_ETIKET = 'text-ayar-aciklama font-bold uppercase tracking-[0.12em] text-[#8A6D2B]'
const GIRDI = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-ayar-aciklama font-semibold text-[#1E2A38] outline-none transition focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/10'
const ANA_DUGME = 'inline-flex items-center justify-center gap-2 rounded-lg border-b-2 border-b-[#D4B26A] bg-[#1E2A38] px-5 py-2.5 text-ayar-aciklama font-bold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:opacity-45'
const IKINCIL_DUGME = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-ayar-aciklama font-bold text-[#1E2A38] transition hover:bg-[#F6F3EA] disabled:opacity-45'

function AktifAnahtar({ aktif, onChange, etiket }: { aktif: boolean; onChange: (deger: boolean) => void; etiket: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={aktif}
      aria-label={etiket}
      title={aktif ? 'Etkin - asistan kullanır' : 'Kapalı - asistan kullanmaz'}
      onClick={() => onChange(!aktif)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${aktif ? 'bg-[#1E2A38]' : 'bg-slate-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${aktif ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

function SilDugmesi({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Sil" aria-label="Sil" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
    </button>
  )
}

const turkceKatla = (deger: string) => deger.toLocaleLowerCase('tr-TR').replace(/[çğıöşüâîû]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' } as Record<string, string>)[c] ?? c)
const eslesir = (arama: string, ...alanlar: string[]) => !arama.trim() || alanlar.some((alan) => turkceKatla(alan).includes(turkceKatla(arama.trim())))

export function SosyalAsistanPanel() {
  const [sekme, setSekme] = useState<Sekme>('genel')
  const [arama, setArama] = useState('')

  // --- Baglanti (API anahtarlari) ---
  const [activeProvider, setActiveProviderState] = useState<AssistantProvider>('gemini')
  const [hasApiKey, setHasApiKey] = useState<Record<AssistantProvider, boolean> | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AssistantProvider>('gemini')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [message, setMessage] = useState('')

  // --- Serbest talimatlar (mevcut metin, AYNEN korunur) ---
  const [customInstructions, setCustomInstructions] = useState('')
  const [savedInstructions, setSavedInstructions] = useState('')
  const [instructionsStatus, setInstructionsStatus] = useState<'idle' | 'saving'>('idle')
  const [instructionsMessage, setInstructionsMessage] = useState('')

  // --- Bilgi tabani ---
  const [tabani, setTabani] = useState<AsistanBilgiTabani>(VARSAYILAN_BILGI_TABANI)
  const [kayitliTabani, setKayitliTabani] = useState<string>(JSON.stringify(VARSAYILAN_BILGI_TABANI))
  const [tabaniDurum, setTabaniDurum] = useState<'idle' | 'saving'>('idle')
  const [tabaniMesaj, setTabaniMesaj] = useState('')
  const tabaniDegisti = JSON.stringify(tabani) !== kayitliTabani

  const uygula = (data: { activeProvider: AssistantProvider; hasApiKey: Record<AssistantProvider, boolean>; customInstructions?: string; bilgiTabani?: AsistanBilgiTabani }, tamami = true) => {
    setActiveProviderState(data.activeProvider)
    setSelectedProvider(data.activeProvider)
    setHasApiKey(data.hasApiKey)
    if (tamami) {
      setCustomInstructions(data.customInstructions ?? '')
      setSavedInstructions(data.customInstructions ?? '')
      if (data.bilgiTabani) {
        setTabani(data.bilgiTabani)
        setKayitliTabani(JSON.stringify(data.bilgiTabani))
      }
    }
  }

  const loadStatuses = (tamami = true) => {
    fetch('/api/asistan/settings')
      .then((response) => response.json())
      .then((payload) => { if (payload?.success) uygula(payload.data, tamami) })
      .catch(() => setHasApiKey({ gemini: false, openai: false, deepseek: false, anthropic: false }))
  }

  useEffect(() => {
    loadStatuses()
  }, [])

  const saveCustomInstructions = async () => {
    setInstructionsStatus('saving')
    setInstructionsMessage('')
    try {
      const response = await fetch('/api/asistan/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customInstructions }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Kaydedilemedi.')
      setSavedInstructions(customInstructions.trim())
      setInstructionsMessage('Talimatlar kaydedildi. Bir sonraki sorudan itibaren geçerli.')
    } catch (error) {
      setInstructionsMessage(error instanceof Error ? error.message : 'Kaydedilemedi.')
    } finally {
      setInstructionsStatus('idle')
    }
  }

  const tabaniKaydet = async () => {
    setTabaniDurum('saving')
    setTabaniMesaj('')
    try {
      const response = await fetch('/api/asistan/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bilgiTabani: tabani }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Kaydedilemedi.')
      setTabani(payload.data.bilgiTabani)
      setKayitliTabani(JSON.stringify(payload.data.bilgiTabani))
      setTabaniMesaj('Bilgi tabanı kaydedildi. Bir sonraki sorudan itibaren geçerli.')
    } catch (error) {
      setTabaniMesaj(error instanceof Error ? error.message : 'Kaydedilemedi.')
    } finally {
      setTabaniDurum('idle')
    }
  }

  // Varsayilan icerikten, listede OLMAYANLARI ekler - mevcutlara dokunmaz.
  const eksikVarsayilanlariEkle = (alan: keyof AsistanBilgiTabani) => {
    setTabani((onceki) => {
      const mevcut = new Set(onceki[alan].map((x) => x.id))
      const eklenecek = (VARSAYILAN_BILGI_TABANI[alan] as { id: string }[]).filter((x) => !mevcut.has(x.id))
      return { ...onceki, [alan]: [...onceki[alan], ...eklenecek] }
    })
  }
  const eksikSayisi = (alan: keyof AsistanBilgiTabani) => {
    const mevcut = new Set(tabani[alan].map((x) => x.id))
    return (VARSAYILAN_BILGI_TABANI[alan] as { id: string }[]).filter((x) => !mevcut.has(x.id)).length
  }

  const guncelle = <A extends keyof AsistanBilgiTabani>(alan: A, id: string, degisiklik: Partial<AsistanBilgiTabani[A][number]>) => {
    setTabani((onceki) => ({ ...onceki, [alan]: (onceki[alan] as { id: string }[]).map((x) => (x.id === id ? { ...x, ...degisiklik } : x)) }))
  }
  const sil = (alan: keyof AsistanBilgiTabani, id: string) => {
    setTabani((onceki) => ({ ...onceki, [alan]: (onceki[alan] as { id: string }[]).filter((x) => x.id !== id) }))
  }
  const basaEkle = <A extends keyof AsistanBilgiTabani>(alan: A, oge: AsistanBilgiTabani[A][number]) => {
    setArama('')
    setTabani((onceki) => ({ ...onceki, [alan]: [oge, ...(onceki[alan] as AsistanBilgiTabani[A][number][])] }))
  }

  const talimatOnizleme = useMemo(() => bilgiTabaniTalimati(tabani), [tabani])
  const aktifSay = (liste: { aktif: boolean }[]) => liste.filter((x) => x.aktif).length

  const selectedOption = PROVIDER_OPTIONS.find((option) => option.id === selectedProvider)!
  const activeOption = PROVIDER_OPTIONS.find((option) => option.id === activeProvider)

  const saveApiKey = async () => {
    const trimmed = apiKeyInput.trim()
    if (!trimmed) {
      setMessage('API anahtarı boş olamaz.')
      return
    }
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/asistan/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selectedProvider, apiKey: trimmed, makeActive: true }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Kaydedilemedi.')
      setApiKeyInput('')
      setMessage(`${selectedOption.label} anahtarı kaydedildi ve aktif sağlayıcı yapıldı.`)
      loadStatuses(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Kaydedilemedi.')
    } finally {
      setStatus('idle')
    }
  }

  const makeActiveOnly = async (provider: AssistantProvider) => {
    setStatus('saving')
    setMessage('')
    try {
      const response = await fetch('/api/asistan/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, makeActive: true }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Değiştirilemedi.')
      setMessage(`Aktif sağlayıcı ${PROVIDER_OPTIONS.find((o) => o.id === provider)?.label} olarak ayarlandı.`)
      loadStatuses(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Değiştirilemedi.')
    } finally {
      setStatus('idle')
    }
  }

  const sekmeSayisi: Partial<Record<Sekme, string>> = {
    terimler: `${aktifSay(tabani.terimler)}/${tabani.terimler.length}`,
    kurallar: `${aktifSay(tabani.kurallar)}/${tabani.kurallar.length}`,
    ornekler: `${aktifSay(tabani.ornekler)}/${tabani.ornekler.length}`,
    hazir: `${aktifSay(tabani.hazirSorular)}/${tabani.hazirSorular.length}`,
  }
  const listeSekmesi = sekme === 'terimler' || sekme === 'kurallar' || sekme === 'ornekler' || sekme === 'hazir'

  // Liste sekmeleri icin ortak ust cubuk: arama + yeni ekle + varsayilanlari ekle
  const listeAracCubugu = (alan: keyof AsistanBilgiTabani, yeniEkle: () => void, yeniEtiket: string) => (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#D5DDE2] bg-white px-5 py-3">
      <div className="relative min-w-[16rem] flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-[18px] w-[18px]"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        </span>
        <input value={arama} onChange={(event) => setArama(event.target.value)} placeholder="Bu listede ara..." className={`${GIRDI} pl-10`} />
      </div>
      <button type="button" onClick={yeniEkle} className={ANA_DUGME}>+ {yeniEtiket}</button>
      {eksikSayisi(alan) > 0 && (
        <button type="button" onClick={() => eksikVarsayilanlariEkle(alan)} className={IKINCIL_DUGME} title="Önerilen başlangıç içeriğinden listede olmayanları ekler; mevcut satırlara dokunmaz">
          Önerilenleri ekle ({eksikSayisi(alan)})
        </button>
      )}
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Ust ozet seridi */}
      <div className="overflow-hidden rounded-xl border border-[#1E2A38]/20 bg-[#1E2A38] text-white shadow-[0_8px_24px_rgba(16,30,43,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-[3px] border-b-[#D4B26A] px-6 py-4">
          <div>
            <p className="text-ayar-aciklama font-bold uppercase tracking-[0.16em] text-[#D4B26A]">Yapay Zeka Asistanı</p>
            <h2 className="text-ayar-bolum font-bold">Sosyal Asistan Yapılandırması</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-ayar-aciklama font-semibold ${hasApiKey?.[activeProvider] ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100' : 'border-amber-300/40 bg-amber-400/10 text-amber-100'}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${hasApiKey?.[activeProvider] ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {activeOption?.label ?? '-'} · {hasApiKey === null ? 'kontrol ediliyor' : hasApiKey[activeProvider] ? 'bağlı' : 'anahtar eksik'}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-white/10 sm:grid-cols-4">
          {([
            ['Terim', tabani.terimler],
            ['Kural', tabani.kurallar],
            ['Örnek', tabani.ornekler],
            ['Hazır Soru', tabani.hazirSorular],
          ] as const).map(([etiket, liste]) => (
            <div key={etiket} className="px-6 py-3">
              <p className="text-ayar-aciklama font-semibold text-white/60">{etiket}</p>
              <p className="text-ayar-bolum font-bold">{aktifSay(liste)} <span className="text-ayar-aciklama font-semibold text-white/50">/ {liste.length} etkin</span></p>
            </div>
          ))}
        </div>
      </div>

      {/* Sekmeler */}
      <nav className="flex flex-wrap gap-1.5 rounded-xl border border-[#D5DDE2] bg-white p-1.5" aria-label="Sosyal Asistan bölümleri">
        {SEKMELER.map((oge) => (
          <button
            key={oge.id}
            type="button"
            onClick={() => { setSekme(oge.id); setArama('') }}
            title={oge.aciklama}
            className={`inline-flex items-center gap-2 rounded-lg border-b-[3px] px-4 py-2 text-ayar-aciklama font-bold transition ${
              sekme === oge.id ? 'border-b-[#D4B26A] bg-[#1E2A38] text-white shadow-sm' : 'border-b-transparent text-[#2A3B4D] hover:bg-[#F6F3EA]'
            }`}
          >
            {oge.etiket}
            {sekmeSayisi[oge.id] && <span className={`rounded-full px-2 py-0.5 text-[13px] ${sekme === oge.id ? 'bg-white/15 text-white' : 'bg-[#EEF2F6] text-[#1E2A38]'}`}>{sekmeSayisi[oge.id]}</span>}
          </button>
        ))}
      </nav>

      {/* Bilgi tabani kaydet cubugu (liste sekmeleri + genel bakis) */}
      {(listeSekmesi || sekme === 'genel') && (tabaniDegisti || tabaniMesaj) && (
        <div className={`sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-3 shadow-sm ${tabaniDegisti ? 'border-[#D4B26A] bg-[#FBF6E9]' : 'border-emerald-200 bg-emerald-50'}`}>
          <p className={`text-ayar-aciklama font-semibold ${tabaniDegisti ? 'text-[#6B5420]' : 'text-emerald-800'}`}>
            {tabaniDegisti ? 'Kaydedilmemiş değişiklikler var.' : tabaniMesaj}
          </p>
          {tabaniDegisti && (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setTabani(JSON.parse(kayitliTabani)); setTabaniMesaj('') }} className={IKINCIL_DUGME}>Vazgeç</button>
              <button type="button" onClick={() => void tabaniKaydet()} disabled={tabaniDurum === 'saving'} className={ANA_DUGME}>
                {tabaniDurum === 'saving' ? 'Kaydediliyor...' : 'Bilgi Tabanını Kaydet'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* --- GENEL BAKIS --- */}
      {sekme === 'genel' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section className={KART}>
            <div className={KART_BASLIK}>
              <div><p className={UST_ETIKET}>Nasıl Çalışır</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Asistanı Eğitme Adımları</h3></div>
            </div>
            <ol className="space-y-4 p-5">
              {[
                ['Terim Sözlüğü', 'Personelin kullandığı ifadeleri ("aktif dosya", "kış yardımı"...) sistemdeki karşılıklarıyla eşleştirin.', 'terimler'],
                ['Kurallar', 'Raporların biçimini (Türkçe başlık, tarih/para biçimi, toplam satırı), veri yorumunu ve gizlilik kurallarını belirleyin.', 'kurallar'],
                ['Örnek Soru-Cevap', 'Sık sorulan sorular için asistanın izlemesi gereken doğru yaklaşımı yazın; asistan benzer sorularda bunu örnek alır.', 'ornekler'],
                ['Hazır Sorular', 'Personelin sohbet ekranında tek tıkla sorabileceği kısayol düğmelerini düzenleyin.', 'hazir'],
              ].map(([baslik, aciklama, hedef], index) => (
                <li key={baslik} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E2A38] text-ayar-aciklama font-bold text-[#D4B26A]">{index + 1}</span>
                  <div className="min-w-0">
                    <button type="button" onClick={() => setSekme(hedef as Sekme)} className="text-ayar-govde font-bold text-[#1E2A38] hover:text-[#8A6D2B] hover:underline">{baslik}</button>
                    <p className="text-ayar-aciklama font-medium leading-snug text-slate-600">{aciklama}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="border-t border-[#D5DDE2] bg-[#F7F8FA] px-5 py-4 text-ayar-aciklama font-medium leading-snug text-slate-600">
              <b className="text-[#1E2A38]">Öncelik sırası:</b> sistemin temel kuralları → <b>Serbest Talimatlar</b> (mevcut metniniz) → bilgi tabanı. Kapalı (pasif) satırlar asistana gönderilmez. Kodlu alanlar (dosya/yardım durumu vb.) her zaman <b>Hazır Değerler</b>&apos;den okunur.
            </div>
          </section>

          <section className={KART}>
            <div className={KART_BASLIK}>
              <div><p className={UST_ETIKET}>Önizleme</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Asistana Giden Bilgi Tabanı Talimatı</h3></div>
              <span className="text-ayar-aciklama font-semibold text-slate-500">{talimatOnizleme.length.toLocaleString('tr-TR')} karakter</span>
            </div>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words bg-[#FBFCFD] p-5 font-mono text-[14px] leading-relaxed text-slate-700">
              {talimatOnizleme || 'Etkin bilgi tabanı öğesi yok - asistana ek bilgi gönderilmiyor.'}
            </pre>
          </section>
        </div>
      )}

      {/* --- TERIM SOZLUGU --- */}
      {sekme === 'terimler' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Terim Sözlüğü</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">&quot;Şunu dediğimde bunu anla&quot;</h3></div>
            <p className="max-w-2xl text-ayar-aciklama font-medium text-slate-500">Soldaki ifade sorularda geçtiğinde asistan sağdaki anlamı esas alır. Kod yazmayın; &quot;Dosya Durumu kategorisinde X karşılığı&quot; gibi tarif edin.</p>
          </div>
          {listeAracCubugu('terimler', () => basaEkle('terimler', { id: yeniKimlik('t'), terim: '', anlam: '', aktif: true }), 'Yeni Terim')}
          <div className="hidden grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_auto] gap-3 border-b border-[#D5DDE2] bg-[#EEF2F6] px-5 py-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#1E2A38] lg:grid">
            <span>İfade / Terim</span><span>Anlamı (sistemdeki karşılığı)</span><span className="w-[5.5rem] text-right">Durum</span>
          </div>
          <div className="divide-y divide-slate-100">
            {tabani.terimler.filter((x) => eslesir(arama, x.terim, x.anlam)).map((x) => (
              <div key={x.id} className={`grid gap-3 px-5 py-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.6fr)_auto] ${x.aktif ? '' : 'bg-slate-50 opacity-70'}`}>
                <input value={x.terim} onChange={(event) => guncelle('terimler', x.id, { terim: event.target.value })} placeholder="ör. aktif dosya" className={`${GIRDI} font-bold`} />
                <textarea value={x.anlam} onChange={(event) => guncelle('terimler', x.id, { anlam: event.target.value })} rows={2} placeholder="ör. dosyalar.durumu = Dosya Durumu kategorisinde 'Yardım Yapılabilir' karşılığı" className={`${GIRDI} resize-y leading-snug`} />
                <div className="flex items-center justify-end gap-2"><AktifAnahtar aktif={x.aktif} onChange={(aktif) => guncelle('terimler', x.id, { aktif })} etiket="Terimi etkinleştir" /><SilDugmesi onClick={() => sil('terimler', x.id)} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- KURALLAR --- */}
      {sekme === 'kurallar' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Kurallar</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Rapor ve Yanıt Kuralları</h3></div>
            <p className="max-w-2xl text-ayar-aciklama font-medium text-slate-500">Asistan her soruda bu kurallara uyar. Bir kuralı geçici olarak kapatmak için anahtarı kullanın.</p>
          </div>
          {listeAracCubugu('kurallar', () => basaEkle('kurallar', { id: yeniKimlik('k'), kategori: 'rapor', metin: '', aktif: true }), 'Yeni Kural')}
          {(Object.keys(KURAL_KATEGORI_ETIKETLERI) as AsistanKuralKategori[]).map((kategori) => {
            const satirlar = tabani.kurallar.filter((x) => x.kategori === kategori && eslesir(arama, x.metin))
            if (!satirlar.length) return null
            return (
              <div key={kategori}>
                <div className="border-y border-[#D5DDE2] bg-[#EEF2F6] px-5 py-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#1E2A38]">{KURAL_KATEGORI_ETIKETLERI[kategori]} · {satirlar.length}</div>
                <div className="divide-y divide-slate-100">
                  {satirlar.map((x) => (
                    <div key={x.id} className={`grid gap-3 px-5 py-3 lg:grid-cols-[12rem_minmax(0,1fr)_auto] ${x.aktif ? '' : 'bg-slate-50 opacity-70'}`}>
                      <select value={x.kategori} onChange={(event) => guncelle('kurallar', x.id, { kategori: event.target.value as AsistanKuralKategori })} className={GIRDI}>
                        {(Object.keys(KURAL_KATEGORI_ETIKETLERI) as AsistanKuralKategori[]).map((secenek) => <option key={secenek} value={secenek}>{KURAL_KATEGORI_ETIKETLERI[secenek]}</option>)}
                      </select>
                      <textarea value={x.metin} onChange={(event) => guncelle('kurallar', x.id, { metin: event.target.value })} rows={2} placeholder="Kural metni" className={`${GIRDI} resize-y leading-snug`} />
                      <div className="flex items-center justify-end gap-2"><AktifAnahtar aktif={x.aktif} onChange={(aktif) => guncelle('kurallar', x.id, { aktif })} etiket="Kuralı etkinleştir" /><SilDugmesi onClick={() => sil('kurallar', x.id)} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {/* --- ORNEK SORU-CEVAP --- */}
      {sekme === 'ornekler' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Örnek Soru-Cevap</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Doğru Yaklaşım Örnekleri</h3></div>
            <p className="max-w-2xl text-ayar-aciklama font-medium text-slate-500">Bir soru ve asistanın onu nasıl yanıtlaması gerektiği: hangi tablo, hangi filtre, hangi sütunlar. Asistan benzer sorularda bu yaklaşımı izler.</p>
          </div>
          {listeAracCubugu('ornekler', () => basaEkle('ornekler', { id: yeniKimlik('o'), soru: '', yaklasim: '', aktif: true }), 'Yeni Örnek')}
          <div className="divide-y divide-slate-100">
            {tabani.ornekler.filter((x) => eslesir(arama, x.soru, x.yaklasim)).map((x, index) => (
              <div key={x.id} className={`flex gap-4 px-5 py-4 ${x.aktif ? '' : 'bg-slate-50 opacity-70'}`}>
                <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EEF2F6] text-[14px] font-bold text-[#1E2A38]">{index + 1}</span>
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-bold uppercase tracking-[0.1em] text-[#8A6D2B]">Soru</span>
                    <input value={x.soru} onChange={(event) => guncelle('ornekler', x.id, { soru: event.target.value })} placeholder="ör. Bu ay kaç nakit yardımı ödendi?" className={`${GIRDI} font-bold`} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] font-bold uppercase tracking-[0.1em] text-slate-500">Doğru yaklaşım / beklenen cevap</span>
                    <textarea value={x.yaklasim} onChange={(event) => guncelle('ornekler', x.id, { yaklasim: event.target.value })} rows={3} placeholder="Hangi tablodan, hangi filtreyle, hangi sütunlarla ve nasıl bir özetle yanıtlanmalı?" className={`${GIRDI} resize-y leading-snug`} />
                  </label>
                </div>
                <div className="flex flex-col items-end gap-2"><AktifAnahtar aktif={x.aktif} onChange={(aktif) => guncelle('ornekler', x.id, { aktif })} etiket="Örneği etkinleştir" /><SilDugmesi onClick={() => sil('ornekler', x.id)} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- HAZIR SORULAR --- */}
      {sekme === 'hazir' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Hazır Sorular</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Sohbet Ekranı Kısayolları</h3></div>
            <p className="max-w-2xl text-ayar-aciklama font-medium text-slate-500">Personel, Sosyal Asistan ekranında bu düğmelere tıklayarak soruyu tek seferde sorar. Soru metni boşlukla bitiyorsa (ör. &quot;Şu numaralı dosyayı aç: &quot;) yalnız yazma alanına yerleştirilir, kullanıcı tamamlar.</p>
          </div>
          {listeAracCubugu('hazirSorular', () => basaEkle('hazirSorular', { id: yeniKimlik('h'), kategori: 'rapor', etiket: '', soru: '', aktif: true }), 'Yeni Hazır Soru')}
          <div className="hidden grid-cols-[11rem_minmax(0,0.7fr)_minmax(0,1.3fr)_auto] gap-3 border-b border-[#D5DDE2] bg-[#EEF2F6] px-5 py-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#1E2A38] lg:grid">
            <span>Grup</span><span>Düğme yazısı</span><span>Sorulacak soru</span><span className="w-[5.5rem] text-right">Durum</span>
          </div>
          <div className="divide-y divide-slate-100">
            {tabani.hazirSorular.filter((x) => eslesir(arama, x.etiket, x.soru)).map((x) => (
              <div key={x.id} className={`grid gap-3 px-5 py-3 lg:grid-cols-[11rem_minmax(0,0.7fr)_minmax(0,1.3fr)_auto] ${x.aktif ? '' : 'bg-slate-50 opacity-70'}`}>
                <select value={x.kategori} onChange={(event) => guncelle('hazirSorular', x.id, { kategori: event.target.value as AsistanHazirSoruKategori })} className={GIRDI}>
                  {(Object.keys(HAZIR_SORU_KATEGORI_ETIKETLERI) as AsistanHazirSoruKategori[]).map((secenek) => <option key={secenek} value={secenek}>{HAZIR_SORU_KATEGORI_ETIKETLERI[secenek]}</option>)}
                </select>
                <input value={x.etiket} onChange={(event) => guncelle('hazirSorular', x.id, { etiket: event.target.value })} placeholder="ör. Bu ayın yardım özeti" className={`${GIRDI} font-bold`} />
                <textarea value={x.soru} onChange={(event) => guncelle('hazirSorular', x.id, { soru: event.target.value })} rows={2} placeholder="Asistana gönderilecek tam soru" className={`${GIRDI} resize-y leading-snug`} />
                <div className="flex items-center justify-end gap-2"><AktifAnahtar aktif={x.aktif} onChange={(aktif) => guncelle('hazirSorular', x.id, { aktif })} etiket="Hazır soruyu göster" /><SilDugmesi onClick={() => sil('hazirSorular', x.id)} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- SERBEST TALIMATLAR (mevcut metin, AYNEN) --- */}
      {sekme === 'serbest' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Serbest Talimatlar</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Özel Talimatlar / Terim Tanımları</h3></div>
            <span className="text-ayar-aciklama font-semibold text-slate-500">{customInstructions.length.toLocaleString('tr-TR')} karakter</span>
          </div>
          <div className="space-y-3 p-5">
            <p className="text-ayar-aciklama font-medium text-slate-600">
              Mevcut talimat metniniz olduğu gibi korunur ve bilgi tabanından önce asistana gönderilir. Uzun açıklamalar, tablo eşleştirmeleri ve özel durumlar için kullanın.
            </p>
            <textarea
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              rows={22}
              placeholder={'Örnek:\n- "yardım alanlar" dediğimde, aktif bir yardım kaydı (yrd_* tablolarından herhangi birinde kaydı) olan dosyaları kastediyorum.\n- Rapor isteklerinde her zaman mahalle adını da ekle.'}
              className="min-h-[58vh] w-full resize-y rounded-lg border border-slate-300 px-4 py-3 font-mono text-[15px] font-medium leading-relaxed text-slate-900 outline-none focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/10"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void saveCustomInstructions()} disabled={instructionsStatus === 'saving' || customInstructions.trim() === savedInstructions} className={ANA_DUGME}>
                {instructionsStatus === 'saving' ? 'Kaydediliyor...' : 'Talimatları Kaydet'}
              </button>
              {customInstructions.trim() !== savedInstructions && <span className="text-ayar-aciklama font-semibold text-[#8A6D2B]">Kaydedilmemiş değişiklik var.</span>}
              {instructionsMessage && <p className="text-ayar-aciklama font-semibold text-slate-600">{instructionsMessage}</p>}
            </div>
          </div>
        </section>
      )}

      {/* --- BAGLANTI (API) --- */}
      {sekme === 'baglanti' && (
        <section className={KART}>
          <div className={KART_BASLIK}>
            <div><p className={UST_ETIKET}>Bağlantı</p><h3 className="text-ayar-govde font-bold text-[#1E2A38]">Yapay Zeka Sağlayıcısı ve API Anahtarları</h3></div>
          </div>
          <div className="space-y-5 p-5">
            <p className="text-ayar-aciklama font-medium text-slate-600">
              Anahtarlar yalnız sunucuda saklanır, tarayıcıya hiçbir zaman geri gönderilmez. Birden fazla sağlayıcı için anahtar girip aralarında geçiş yapabilirsiniz.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PROVIDER_OPTIONS.map((option) => {
                const configured = hasApiKey?.[option.id]
                const isActive = activeProvider === option.id
                const isSelected = selectedProvider === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => { setSelectedProvider(option.id); setApiKeyInput(''); setMessage('') }}
                    className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition ${isSelected ? 'border-[#1E2A38] bg-[#EEF2F6] ring-2 ring-[#1E2A38]/10' : 'border-slate-300 bg-white hover:border-[#1E2A38]/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ayar-aciklama font-bold text-[#1E2A38]">{option.label}</span>
                      {isActive && <span className="rounded-full bg-[#1E2A38] px-2.5 py-0.5 text-[12px] font-bold uppercase text-[#D4B26A]">Aktif</span>}
                    </div>
                    <span className={`w-fit rounded-full px-2.5 py-0.5 text-[13px] font-bold ${configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      {hasApiKey === null ? 'Kontrol ediliyor...' : configured ? 'Anahtar girildi' : 'Anahtar eksik'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div>
              <label className="mb-2 block text-ayar-aciklama font-bold text-slate-600">{selectedOption.label} API Anahtarı</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder={hasApiKey?.[selectedProvider] ? '•••••••••••••• (değiştirmek için yeni anahtar girin)' : selectedOption.keyHint}
                  className={`${GIRDI} min-w-0 flex-1 py-2.5`}
                />
                <button type="button" onClick={() => void saveApiKey()} disabled={status === 'saving' || !apiKeyInput.trim()} className={ANA_DUGME}>
                  {status === 'saving' ? 'Kaydediliyor...' : 'Kaydet ve Aktif Yap'}
                </button>
                {hasApiKey?.[selectedProvider] && activeProvider !== selectedProvider && (
                  <button type="button" onClick={() => void makeActiveOnly(selectedProvider)} disabled={status === 'saving'} className={IKINCIL_DUGME}>
                    Sadece Aktif Yap
                  </button>
                )}
              </div>
              <p className="mt-2 text-ayar-aciklama font-medium text-slate-500">
                API anahtarını{' '}
                <a href={selectedOption.helpUrl} target="_blank" rel="noreferrer" className="font-bold text-[#1E2A38] underline hover:text-[#8A6D2B]">{selectedOption.helpLabel}</a>{' '}
                üzerinden alabilirsiniz.
              </p>
            </div>

            {message && <p className="rounded-lg border-l-4 border-l-[#1E2A38] bg-[#EEF2F6] px-4 py-2.5 text-ayar-aciklama font-semibold text-[#1E2A38]">{message}</p>}

            <p className="rounded-lg border border-[#D5DDE2] bg-[#F7F8FA] px-4 py-3 text-ayar-aciklama font-medium leading-snug text-slate-600">
              Asistan, kullanıcının mevcut sayfa/işlem yetkisini aşan hiçbir veriye erişemez; her sorgu soran kişinin yetkisine göre ayrıca denetlenir. Hangi sağlayıcı seçilirse seçilsin bu kural aynıdır.
            </p>
          </div>
        </section>
      )}
    </div>
  )
}

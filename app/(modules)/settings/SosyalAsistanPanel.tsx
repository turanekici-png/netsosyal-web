'use client'

import { useEffect, useState } from 'react'

// Kullanici istegi (14-15 Eylul 2026, 23.-24. tur): Sosyal Asistan icin
// baslangicta sadece Gemini destekleniyordu, sonra "ChatGPT/DeepSeek/Claude
// gibi farkli yapay zeka apilerini de girebilelim" istegiyle COKLU
// saglayici destegi eklendi (bkz. lib/services/aiAssistant.service.ts).
// BILINCLI olarak diger ayarlardan AYRI, kendi kendine yeten bir panel
// (kendi API ucu: /api/asistan/settings). Genel /api/settings/[key] GET'i
// hicbir yetki kontrolu yapmadigi icin (bkz. plan arastirmasi) bu anahtarlar
// ORAYA asla yazilmiyor/okunmuyor - ozel uc nokta ham degeri istemciye
// HICBIR ZAMAN geri dondurmez, sadece "hangi saglayicida tanimli/aktif"
// bilgisini verir.
type AssistantProvider = 'gemini' | 'openai' | 'deepseek' | 'anthropic'

const PROVIDER_OPTIONS: { id: AssistantProvider; label: string; keyHint: string; helpUrl: string; helpLabel: string }[] = [
  { id: 'gemini', label: 'Google Gemini', keyHint: 'AIza...', helpUrl: 'https://aistudio.google.com/apikey', helpLabel: 'Google AI Studio' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keyHint: 'sk-...', helpUrl: 'https://platform.openai.com/api-keys', helpLabel: 'OpenAI Platform' },
  { id: 'deepseek', label: 'DeepSeek', keyHint: 'sk-...', helpUrl: 'https://platform.deepseek.com/api_keys', helpLabel: 'DeepSeek Platform' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyHint: 'sk-ant-...', helpUrl: 'https://console.anthropic.com/settings/keys', helpLabel: 'Anthropic Console' },
]

export function SosyalAsistanPanel() {
  // Kullanici istegi (15 Eylul 2026, 38. tur): "api anahtari girdigimiz yer
  // bir butona baglansin, o sayfada direk gorunmesin" - saglayici/API anahtari
  // karti artik varsayilan olarak KAPALI, bir butona tiklayinca aciliyor -
  // boylece sayfa acilir acilmaz butun alani "Ozel Talimatlar" kutusuna
  // birakiyoruz (asil istenen buyuk/genis yazma alani icin).
  const [showApiKeyPanel, setShowApiKeyPanel] = useState(false)
  const [activeProvider, setActiveProviderState] = useState<AssistantProvider>('gemini')
  const [hasApiKey, setHasApiKey] = useState<Record<AssistantProvider, boolean> | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AssistantProvider>('gemini')
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving'>('idle')
  const [message, setMessage] = useState('')

  // Kullanici istegi (15 Eylul 2026, 33. tur): "ben soyle dedigimde sen
  // boyle anla" - kod degisikligi gerektirmeyen, serbest metin ozel
  // talimat/terim tanimi alani. Her sohbette otomatik olarak sistem
  // talimatinin sonuna eklenir (bkz. lib/services/aiAssistant.service.ts
  // runAssistantChat).
  const [customInstructions, setCustomInstructions] = useState('')
  const [instructionsStatus, setInstructionsStatus] = useState<'idle' | 'saving'>('idle')
  const [instructionsMessage, setInstructionsMessage] = useState('')

  const loadStatuses = () => {
    fetch('/api/asistan/settings')
      .then((response) => response.json())
      .then((payload) => {
        if (!payload?.success) return
        setActiveProviderState(payload.data.activeProvider)
        setSelectedProvider(payload.data.activeProvider)
        setHasApiKey(payload.data.hasApiKey)
        setCustomInstructions(payload.data.customInstructions ?? '')
      })
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
      setInstructionsMessage('Talimatlar kaydedildi. Bir sonraki sorudan itibaren geçerli.')
    } catch (error) {
      setInstructionsMessage(error instanceof Error ? error.message : 'Kaydedilemedi.')
    } finally {
      setInstructionsStatus('idle')
    }
  }

  const selectedOption = PROVIDER_OPTIONS.find((option) => option.id === selectedProvider)!

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
      loadStatuses()
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
      loadStatuses()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Değiştirilemedi.')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,30,43,0.10)]">
        <button
          type="button"
          onClick={() => setShowApiKeyPanel((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left hover:bg-slate-50"
        >
          <div>
            <h2 className="text-xl font-black uppercase text-[#1E2A38]">Sosyal Asistan (Yapay Zeka) API Anahtarları</h2>
            <p className="mt-1.5 text-xl font-semibold text-slate-600">
              Aktif sağlayıcı: <span className="font-black text-[#1E2A38]">{PROVIDER_OPTIONS.find((o) => o.id === activeProvider)?.label ?? '-'}</span> — anahtarları görmek/değiştirmek için tıklayın.
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xl font-black text-[#1E2A38]">
            {showApiKeyPanel ? 'Gizle ▲' : 'Yönet ▼'}
          </span>
        </button>

        {showApiKeyPanel && (
          <div className="space-y-5 border-t border-slate-200 p-6">
            <p className="text-xl font-semibold text-slate-600">
              Anahtarlar sadece sunucu tarafında saklanır, hiçbir zaman tarayıcıya geri gönderilmez. Birden fazla sağlayıcı için anahtar girebilir, aralarında istediğiniz zaman geçiş yapabilirsiniz.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PROVIDER_OPTIONS.map((option) => {
                const configured = hasApiKey?.[option.id]
                const isActive = activeProvider === option.id
                const isSelected = selectedProvider === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => { setSelectedProvider(option.id); setApiKeyInput(''); setMessage('') }}
                    className={`flex flex-col gap-2 rounded-xl border-2 p-4 text-left transition ${
                      isSelected ? 'border-[#1E2A38] bg-slate-50' : 'border-slate-300 bg-white hover:border-slate-400'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-black text-slate-800">{option.label}</span>
                      {isActive && <span className="rounded-full bg-[#1E2A38] px-3 py-1 text-base font-black uppercase text-white">Aktif</span>}
                    </div>
                    <span className={`w-fit rounded-full px-3 py-1 text-base font-black uppercase ${
                      configured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {hasApiKey === null ? 'Kontrol ediliyor...' : configured ? 'Girildi' : 'Eksik'}
                    </span>
                  </button>
                )
              })}
            </div>

            <div>
              <label className="mb-2 block text-xl font-bold text-slate-600">{selectedOption.label} API Anahtarı</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiKeyInput}
                  onChange={(event) => setApiKeyInput(event.target.value)}
                  placeholder={hasApiKey?.[selectedProvider] ? '•••••••••••••• (değiştirmek için yeni anahtar girin)' : selectedOption.keyHint}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-4 py-3 text-xl font-semibold outline-none focus:border-[#1E2A38]"
                />
                <button
                  type="button"
                  onClick={() => void saveApiKey()}
                  disabled={status === 'saving' || !apiKeyInput.trim()}
                  className="rounded-lg bg-[#1E2A38] px-5 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:opacity-50"
                >
                  {status === 'saving' ? 'Kaydediliyor...' : 'Kaydet ve Aktif Yap'}
                </button>
                {hasApiKey?.[selectedProvider] && activeProvider !== selectedProvider && (
                  <button
                    type="button"
                    onClick={() => void makeActiveOnly(selectedProvider)}
                    disabled={status === 'saving'}
                    className="rounded-lg border border-slate-300 bg-slate-50 px-5 py-3 text-xl font-black text-[#1E2A38] shadow-sm hover:bg-slate-100 disabled:opacity-50"
                  >
                    Sadece Aktif Yap
                  </button>
                )}
              </div>
              <p className="mt-2 text-xl font-semibold text-slate-400">
                API anahtarını{' '}
                <a href={selectedOption.helpUrl} target="_blank" rel="noreferrer" className="underline hover:text-[#1E2A38]">
                  {selectedOption.helpLabel}
                </a>{' '}
                üzerinden alabilirsiniz.
              </p>
            </div>

            {message && <p className="text-xl font-bold text-slate-600">{message}</p>}

            <p className="text-xl font-semibold leading-relaxed text-slate-400">
              Asistan, kullanıcının mevcut sayfa/işlem yetkisini aşan hiçbir veriye erişemez - her sorgu, soran kişinin yetkisine göre ayrıca denetlenir (hangi sağlayıcı seçilirse seçilsin bu kural aynıdır).
            </p>
          </div>
        )}
      </div>

      {/* Kullanici istegi (15 Eylul 2026, 38. tur): "talimatlari genis tam
          ekrana yazalim alan icinde, yazi boyutunu biraz buyutelim" - API
          karti artik varsayilan kapali oldugu icin bu kutu sayfa acilir
          acilmaz asil gorunen/on planda olan alan; satir sayisi ve yazi
          boyutu belirgin sekilde artirildi. */}
      <div className="overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_18px_45px_rgba(15,30,43,0.10)]">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
          <h2 className="text-xl font-black uppercase text-[#1E2A38]">Özel Talimatlar / Terim Tanımları</h2>
          <p className="mt-1.5 text-xl font-semibold text-slate-600">
            Asistanın sizin ifade biçiminizi anlamasını istediğiniz kuralları buraya yazın - ör. &quot;yardım alanlar dediğimde aktif yardım kaydı olan dosyaları anla&quot; veya &quot;liste isteğinde her zaman TC kimlik no&apos;yu da ekle&quot;. Buraya yazdığınız her satır, bir sonraki sorudan itibaren asistana otomatik hatırlatılır - kod değişikliği gerekmez.
          </p>
        </div>
        <div className="space-y-3 p-6">
          <textarea
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.target.value)}
            rows={22}
            placeholder={'Örnek:\n- "yardım alanlar" dediğimde, aktif bir yardım kaydı (yrd_* tablolarından herhangi birinde kaydı) olan dosyaları kastediyorum.\n- Rapor isteklerinde her zaman mahalle adını da ekle.\n- "kısıtlı" dediğimde dosya durumu = 2 (Pasif) anlamına gelir.'}
            className="min-h-[60vh] w-full resize-y rounded-lg border border-slate-300 px-4 py-3 text-xl font-semibold leading-relaxed text-slate-900 outline-none focus:border-[#1E2A38]"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveCustomInstructions()}
              disabled={instructionsStatus === 'saving'}
              className="rounded-lg bg-[#1E2A38] px-6 py-3 text-xl font-black text-white shadow-sm hover:bg-[#2A3B4D] disabled:opacity-50"
            >
              {instructionsStatus === 'saving' ? 'Kaydediliyor...' : 'Talimatları Kaydet'}
            </button>
            {instructionsMessage && <p className="text-xl font-bold text-slate-600">{instructionsMessage}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

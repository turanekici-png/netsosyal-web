'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTabs } from '@/lib/context/TabContext'
import { formatCellValue, saveAsistanReport, downloadResultAsXlsx } from '@/lib/asistanReport'

type ChatTable = { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean } | null

type ChatMessage = {
  role: 'user' | 'model'
  text: string
  table?: ChatTable
  isError?: boolean
  question?: string
}

// Kullanici istegi (2026-09-21): "sohbetler sayfayi degistirdigimizde
// kaybolmasin ama kullanici sohbeti temizle dedigi zaman yeni bir sohbete
// baslasin" - sohbet gecmisi artik bellekteki useState'e ek olarak
// sessionStorage'a da yazilir. sessionStorage bilerek secildi:
// localStorage'in aksine sadece BU sekmenin omru boyunca yasar (yeni bir
// sekme/pencere her zaman temiz baslar), ama React state'in aksine hem
// SPA ici (router.push) hem TAM sayfa yenileme/gecislerde de hayatta
// kalir - bu uygulamada her ikisi de kullanildigi icin (bkz. asagida
// actionSucceeded -> window.location.reload()) en saglam secim bu.
// Baloncuk (AsistanBubble) VE tam sayfa (/asistan) AYNI anahtari
// paylasir - ikisi de "tek bir sohbet" gibi davranir (zaten ayni anda
// ikisi birden gorunmuyor, bkz. AsistanBubble.tsx /asistan istisnasi).
const CHAT_HISTORY_STORAGE_KEY = 'netsosyal:asistan:chat-history'
// Cok uzun sohbetlerde (ozellikle buyuk sonuc tablolari birikince)
// sessionStorage kotasini asmamak icin sadece en son mesajlar saklanir -
// daha eskisi bellekte (ekranda) kalmaya devam eder, sadece bir SONRAKI
// sayfa gecisinde/yenilemede artik geri gelmez.
const MAX_STORED_MESSAGES = 40

function loadStoredMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(CHAT_HISTORY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStoredMessages(messages: ChatMessage[]) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    // sessionStorage dolu/erisilemez olabilir - sohbet o an icin sadece bellekte kalir
  }
}


// Kullanici istegi (2026-09-21, 2. tur): "listeyi yeni sayfada açmasın
// işaretli alanda yeni sekme olarak açsın" - onceden window.open() ile
// AYRI bir tarayici sekmesi/penceresi aciliyordu; artik uygulamanin KENDI
// ust sekme cubugunda ("Ana Sayfa"/"Dosya Yönetimi" ile ayni satirda) yeni
// bir sekme olarak aciliyor. Buyuk olabilecek tablo verisi URL'e sigmadigi
// icin sessionStorage'daki TEK "guncel rapor" slotuna yazilip /asistan/rapor
// sayfasina TabContext.addTab ile gecis yapiliyor (bkz. lib/asistanReport.ts).
function openReportTab(addTab: (tab: { title: string; path: string }) => void, table: NonNullable<ChatTable>, question: string): boolean {
  const saved = saveAsistanReport({ table, question, generatedAt: new Date().toISOString() })
  if (!saved) return false
  // "t" parametresi SADECE ayni path'e tekrar gecis yapildiginda (WorkspaceTabs
  // zaten bu sekmeyi TEK sekmeye indirgiyor) hedef sayfanin useSearchParams
  // bagimli efektinin yeniden calisip sessionStorage'daki GUNCEL veriyi
  // okumasini saglamak icin - rapor verisinin kendisi URL'de TASINMIYOR.
  addTab({ title: 'Sosyal Asistan Raporu', path: `/asistan/rapor?t=${Date.now()}` })
  return true
}


function ResultTable({ table, question }: { table: NonNullable<ChatTable>; question: string }) {
  const { addTab } = useTabs()
  const [tabOpenFailed, setTabOpenFailed] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  if (table.rows.length === 0) {
    return <p className="mt-3 text-xl font-bold text-slate-500">Sonuç bulunamadı.</p>
  }

  const handleExport = async () => {
    setIsExporting(true)
    setExportError('')
    const error = await downloadResultAsXlsx(table)
    if (error) setExportError(error)
    setIsExporting(false)
  }

  // Kullanici istegi (2026-09-21, 5. tur): "buradaki butonlar listenin
  // altında çıksın çünkü listeyi açmak için başka kadar kaydırmamız
  // gerekiyor" - araç çubuğu (satır sayısı + Excel/Yeni Sekmede Aç
  // butonları) eskiden tablonun USTUNDE sabitti; uzun bir listede
  // asagi kaydirinca gorunmez oluyordu ve butona basmak icin tekrar
  // yukari kaydirmak gerekiyordu. Artik tablonun ALTINA tasindi.
  // Kullanici istegi (2026-09-30): "sosyal asistan sayfasının yazı boyutunu
  // 20px yapalım" - bu tablonun sutunlari ASISTANIN CEVABINA GORE DEGISIR
  // (SQL sorgusu ne donerse - 2 sutun da olabilir 15 sutun da), bu yuzden
  // diger sabit sayfa alanlarindan farkli olarak BILINCLI olarak orta
  // duzeyde buyutuldu (10-12px -> 14-16px) - tam 20px, cok sutunlu bir
  // sonucta (ör. "tum dosyalari listele") yatay kullanilabilirligi bozardi.
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-300">
      <table className="min-w-full divide-y divide-slate-200 text-base">
        <thead className="bg-slate-50">
          <tr>
            {table.columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-4 py-2.5 text-left font-black uppercase tracking-wide text-slate-600">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {table.rows.map((row, index) => (
            <tr key={index}>
              {table.columns.map((column) => (
                <td key={column} className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-700">
                  {formatCellValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="text-sm font-bold text-slate-400">
          {table.rows.length} satır
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isExporting}
            className="rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-black uppercase text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {isExporting ? 'Hazırlanıyor…' : 'Excel (.xlsx) İndir'}
          </button>
          <button
            type="button"
            onClick={() => setTabOpenFailed(!openReportTab(addTab, table, question))}
            className="rounded-md bg-[#1E2A38] px-3.5 py-2 text-sm font-black uppercase text-white hover:bg-[#2A3B4D]"
          >
            Yeni Sekmede Aç
          </button>
        </div>
      </div>
      {tabOpenFailed && (
        <p className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-700">
          Rapor sekmesi açılamadı (tarayıcı depolama alanı dolu olabilir). Lütfen tekrar deneyin.
        </p>
      )}
      {exportError && (
        <p className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700">
          {exportError}
        </p>
      )}
    </div>
  )
}

export function AsistanChat({ compact = false }: { compact?: boolean } = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  // Ilk render'da (hem sunucuda hem istemcinin ilk boyanmasinda) sessionStorage
  // OKUNMAZ - "use client" bilesenleri de sunucuda render edildigi icin
  // (window yok) orada her zaman bos donerdi; istemci taraftaki ilk render bunu
  // hemen dolu donse HYDRATION UYUSMAZLIGI olurdu. Bunun yerine mount SONRASI
  // bir efektte yuklenir (asagida), bu ref de "ilk kaydetme efektinin gecmisi
  // BOS olarak geri sessionStorage'a yazip UZERINE YAZMASINI" onler.
  const isFirstSaveRef = useRef(true)

  useEffect(() => {
    setMessages(loadStoredMessages())
  }, [])

  useEffect(() => {
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false
      return
    }
    saveStoredMessages(messages)
  }, [messages])

  // "setMessages([])" tek basina yeterli - hemen ardindan calisacak [messages]
  // kaydetme efekti sessionStorage'i zaten bos diziyle gunceller (bkz. yukarida).
  const clearChat = () => {
    setMessages([])
  }

  const scrollToBottom = () => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }))
  }

  const sendMessage = async () => {
    const trimmed = input.trim()
    if (!trimmed || isSending) return

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmed }]
    setMessages(nextMessages)
    setInput('')
    setIsSending(true)
    scrollToBottom()

    try {
      const response = await fetch('/api/asistan/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          history: nextMessages.map((m) => ({ role: m.role, text: m.text })),
        }),
      })

      // Kullanici istegi (15 Eylul 2026, 25. tur): "Failed to execute 'json'
      // on 'Response': Unexpected end of JSON input" - kok neden, yavas
      // yanit veren saglayicilarda (ör. yuksek "reasoning_effort" ile
      // NVIDIA/DeepSeek) IIS ters proxy'nin varsayilan 30 sn zaman asimiyla
      // baglantiyi YARIDA KESMESI (bkz. sosyal-asistan-timeout.md) - govde
      // yariminda `response.json()` boyle bir teknik hata firlatiyordu.
      // Ham hatayi (parse hatasi) DOGRUDAN kullaniciya gostermek yerine,
      // ayri yakalayip anlasilir bir mesaja ceviriyoruz.
      let payload: { success?: boolean; error?: string; data?: { text: string; table: ChatTable; openFile?: { fileId: string; fileNo: string } | null; actionSucceeded?: boolean } }
      try {
        payload = await response.json()
      } catch {
        throw new Error('Yanıt tamamlanamadan bağlantı kesildi (isteğiniz çok uzun sürmüş olabilir). Lütfen tekrar deneyin veya soruyu kısaltın.')
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Asistan yanıt veremedi.')
      }

      const resultTable = payload.data?.table ?? null
      setMessages((current) => [
        ...current,
        { role: 'model', text: payload.data?.text ?? 'Bir yanıt oluşturulamadı.', table: resultTable, question: trimmed },
      ])
      // Kullanici istegi (15 Eylul 2026, 30. tur): otomatik pencere acma
      // KALDIRILDI - sonuc HER ZAMAN once sohbet icinde (inline) gosterilir,
      // yeni pencerede acmak isteyip istemedigine kullanici kendisi karar
      // verir (tablonun ustundeki "Yeni Pencerede Ac" butonu, bkz. ResultTable).

      // Kullanici istegi (15 Eylul 2026, 40. tur): "bir dosyayi ac dedigimde
      // o dosyayi dosya yonetim sayfasinda acsin" - open_dosya araci
      // cagrildiysa GERCEKTEN Dosya Yonetimi'ne (o dosya secili halde)
      // gecis yap. Ayni dosyanin/baska sayfanin ZATEN uyguladigi standart
      // yontem (bkz. router.push('/documents?fileId=...') - documents/page.tsx
      // bunu useSearchParams ile okuyup dosyayi kendiliginden acar).
      if (payload.data?.openFile) {
        router.push(`/documents?fileId=${encodeURIComponent(payload.data.openFile.fileId)}`)
      }

      // Kullanici istegi (15 Eylul 2026, 41. tur): "islemi yapinca sayfayi
      // yenilesin istiyorum, baska alani bozmadan" - bir yazma islemi
      // GERCEKTEN basariyla tamamlandiysa, kullanicinin onay/basari mesajini
      // OKUYABILMESI icin kisa bir gecikmeyle TAM SAYFA yenilenir - boylece
      // az once degisen veri (dosya listesi, dashboard sayaclari vb.) tum
      // sayfada guncel gorunur; baska hicbir bilesene dokunulmaz.
      if (payload.data?.actionSucceeded) {
        setTimeout(() => window.location.reload(), 1200)
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: 'model', text: error instanceof Error ? error.message : 'Asistan yanıt veremedi.', isError: true },
      ])
    } finally {
      setIsSending(false)
      scrollToBottom()
    }
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col bg-white ${compact ? '' : 'rounded-2xl border border-slate-200 shadow-sm'}`}>
      {/* "min-h-0" burada KRITIK: flex-basis:0 olsa bile bir flex ogesinin
          varsayilan "min-height: auto" davranisi, icerigi (uzun bir sohbet/
          genis rapor tablosu) buyudukce bu kutuyu KENDI icerigi kadar
          buyumeye zorlar - disaridaki sabit yukseklikli baloncuk paneli
          tasar, basligin gorunmez olmasina ("kayboluyor" sikayeti) yol acar.
          min-h-0 bu davranisi kapatip GERCEKTEN sadece bu kutunun kendi
          overflow-y-auto'su ile kaydirilmasini saglar. */}
      {messages.length > 0 && (
        <div className={`flex shrink-0 items-center justify-end border-b border-slate-200 ${compact ? 'px-3 py-1.5' : 'px-4 py-3 sm:px-6'}`}>
          <button
            type="button"
            onClick={clearChat}
            className={`rounded-md px-3 py-1.5 font-black uppercase tracking-wide text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 ${compact ? 'text-[11px]' : 'text-lg'}`}
          >
            🗑 Sohbeti Temizle
          </button>
        </div>
      )}
      <div className={`app-visible-scroll min-h-0 flex-1 space-y-3 overflow-y-auto ${compact ? 'p-3' : 'p-4 sm:p-6'}`}>
        {messages.length === 0 && (
          <div className={`rounded-lg border border-dashed border-slate-300 bg-slate-50 font-semibold text-slate-500 ${compact ? 'p-3 text-base' : 'p-5 text-xl'}`}>
            Örnek sorular: &quot;Bu ay kaç nakit yardımı ödendi?&quot;, &quot;Filizli mahallesinde kaç aktif dosya var?&quot;, &quot;Son 30 günde incelenecek aşamasında kaç başvuru var?&quot;
          </div>
        )}
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-xl font-semibold leading-relaxed shadow-sm ${compact ? 'px-3.5 py-2.5 text-base' : 'px-5 py-4 text-xl'} ${
                msg.role === 'user'
                  ? 'bg-[#1E2A38] text-white'
                  : msg.isError
                    ? 'border border-rose-200 bg-rose-50 text-rose-700'
                    : 'border border-slate-300 bg-slate-50 text-slate-800'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.text}</p>
              {msg.table && <ResultTable table={msg.table} question={msg.question ?? ''} />}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className={`rounded-xl border border-slate-300 bg-slate-50 font-bold text-slate-400 ${compact ? 'px-3.5 py-2.5 text-base' : 'px-5 py-4 text-xl'}`}>
              Düşünüyor...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className={`flex shrink-0 items-end gap-2 border-t border-slate-200 ${compact ? 'p-3' : 'p-4'}`}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
          rows={compact ? 3 : 2}
          placeholder="Bir soru yazın..."
          className={`min-h-0 min-w-0 flex-1 resize-none rounded-lg border border-slate-300 font-semibold text-slate-900 outline-none focus:border-[#1E2A38] ${compact ? 'px-3.5 py-2.5 text-base' : 'px-4 py-3 text-xl'}`}
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={isSending || !input.trim()}
          className={`shrink-0 rounded-lg bg-[#1E2A38] font-black text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:opacity-50 ${compact ? 'px-4 py-2.5 text-base' : 'px-5 py-3 text-xl'}`}
        >
          Gönder
        </button>
      </div>
    </div>
  )
}

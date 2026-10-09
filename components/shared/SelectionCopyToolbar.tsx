'use client'

import { useEffect, useRef, useState } from 'react'

// Sag tik butonu artik BASKA islere ayrildigi icin (ozel "Kayit Islemleri"
// menuleri) bircok sayfada tarayicinin kendi sag-tik Kopyala/Yapistir
// komutlarina ulasilamiyor. (Yatay kaydirma ARTIK sag tikta degil, ORTA
// fare tusunda - bkz. DragScroll.tsx - bu yuzden sag tik ile hicbir
// cakismasi yok.) Bu bilesen, uygulamanin HER YERINDE (tek bir yerden -
// components/providers.tsx - monte edilir) sol tusla KOPYALA/YAPISTIR
// erisimi saglar - AMA kullanici istegi uzerine SADECE sol tusla BASILI
// TUTULDUGUNDA (uzun basma, ~550ms) tetiklenir:
//  - Bir giris alaninda (input/textarea/duzenlenebilir alan) basili
//    tutulursa -> "Yapıştır" (alanda zaten bir metin seciliyse "Kopyala" da
//    yaninda cikar),
//  - Sıradan sayfa metninde basili tutulursa -> basili tutulan noktadaki
//    KELIME otomatik secilip "Kopyala" gosterilir,
// SADE bir tikta (basip HEMEN birakma) HICBIR SEY gorunmez - onceki
// surumde her tikta (odaklanma aninda) hemen cikan Yapıştır butonu, "her
// zaman cikiyor" seklinde rahatsiz edici bulundugu icin kaldirildi.
//
// Bunun DISINDA, kullanici FARE ILE SURUKLEYEREK bir metin secip
// biraktiginda (klasik "select to copy" - zaten uzun/bilincli bir hareket
// gerektirir, "tek tik" degildir) Kopyala butonu YINE gosterilir - bu akis
// DEGISMEDEN korunur (bkz. handleMouseUp).
type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement
type Feedback = 'copied' | 'pasted' | 'error' | null
type ToolbarState = { x: number; y: number; showCopy: boolean; showPaste: boolean } | null

const VIEWPORT_MARGIN = 8
const TOOLBAR_GAP = 8
const ESTIMATED_WIDTH = 220
const ESTIMATED_HEIGHT = 44
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'submit', 'button', 'reset', 'image', 'hidden'])
const LONG_PRESS_MS = 550
const LONG_PRESS_MOVE_TOLERANCE = 6

function isEditableElement(element: Element | null): element is EditableTarget {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !NON_TEXT_INPUT_TYPES.has(element.type)
  if (element instanceof HTMLElement && element.isContentEditable) return true
  return false
}

function computePosition(rect: { left: number; right: number; top: number; bottom: number }) {
  const y = rect.top > ESTIMATED_HEIGHT + VIEWPORT_MARGIN + TOOLBAR_GAP
    ? rect.top - ESTIMATED_HEIGHT - TOOLBAR_GAP
    : rect.bottom + TOOLBAR_GAP
  const x = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), window.innerWidth - ESTIMATED_WIDTH - VIEWPORT_MARGIN)
  return {
    x: Math.max(x, VIEWPORT_MARGIN),
    y: Math.min(Math.max(y, VIEWPORT_MARGIN), window.innerHeight - ESTIMATED_HEIGHT - VIEWPORT_MARGIN),
  }
}

function copyWithFallback(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    const succeeded = document.execCommand('copy')
    document.body.removeChild(textarea)
    return succeeded
  } catch {
    return false
  }
}

// React KONTROLLU input/textarea alanlarinda deger dogrudan ".value = ..."
// ile degistirilirse React bunu FARK ETMEZ (kendi onChange'i tetiklenmez) -
// bu, React'in native "value" setter'ini INPUT olay dispatch'inden ONCE
// devreye sokan, yaygin/bilinen bir yontemdir (Testing Library / Cypress
// gibi araclarin da kullandigi teknik).
function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
}

// Duzenlenebilir OLMAYAN siradan sayfa metninde uzun basildiginda, basili
// tutulan NOKTADAKI kelimeyi bulup secer (dokunmatik cihazlardaki "uzun
// basip secme" davranisina benzer) - boylece kullanicinin ONCEDEN fare ile
// suruklemesine gerek kalmadan, tek bir noktada basili tutarak da o
// kelimeyi kopyalayabilmesi saglanir. document.caretRangeFromPoint (Chrome)
// / caretPositionFromPoint (daha yeni standart) kullanilir.
function selectWordAtPoint(x: number, y: number): { text: string; rect: DOMRect } | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  let range: Range | null = null
  if (doc.caretRangeFromPoint) {
    range = doc.caretRangeFromPoint(x, y)
  } else if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y)
    if (position) {
      range = document.createRange()
      range.setStart(position.offsetNode, position.offset)
      range.collapse(true)
    }
  }
  if (!range) return null

  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE || !node.textContent) return null

  const text = node.textContent
  const offset = Math.min(range.startOffset, text.length)
  const isWordChar = (ch: string) => /[\p{L}\p{N}_]/u.test(ch)

  let start = offset
  let end = offset
  while (start > 0 && isWordChar(text[start - 1])) start -= 1
  while (end < text.length && isWordChar(text[end])) end += 1
  if (start === end) return null

  const wordRange = document.createRange()
  wordRange.setStart(node, start)
  wordRange.setEnd(node, end)

  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(wordRange)
  }

  return { text: text.slice(start, end), rect: wordRange.getBoundingClientRect() }
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </svg>
  )
}

export function SelectionCopyToolbar() {
  const [toolbar, setToolbar] = useState<ToolbarState>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeTargetRef = useRef<EditableTarget | null>(null)
  const selectionTextRef = useRef('')
  const toolbarVisibleRef = useRef(false)

  useEffect(() => {
    const clearHideTimeout = () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
    }

    const hideToolbar = () => {
      clearHideTimeout()
      toolbarVisibleRef.current = false
      setToolbar(null)
      setFeedback(null)
    }

    // --- Uzun basma (long press) algılama ---
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let longPressStartX = 0
    let longPressStartY = 0
    let longPressTarget: Element | null = null

    const clearLongPressTimer = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const triggerLongPress = () => {
      longPressTimer = null
      const target = longPressTarget
      if (!target) return

      if (isEditableElement(target)) {
        activeTargetRef.current = target
        let showCopy = false
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          const start = target.selectionStart
          const end = target.selectionEnd
          if (start !== null && end !== null && start !== end) {
            selectionTextRef.current = target.value.slice(start, end)
            showCopy = true
          } else {
            selectionTextRef.current = ''
          }
        }
        const { x, y } = computePosition(target.getBoundingClientRect())
        toolbarVisibleRef.current = true
        setToolbar({ x, y, showCopy, showPaste: true })
        setFeedback(null)
        return
      }

      const wordSelection = selectWordAtPoint(longPressStartX, longPressStartY)
      if (!wordSelection) return

      selectionTextRef.current = wordSelection.text
      activeTargetRef.current = null
      const { x, y } = computePosition(wordSelection.rect)
      toolbarVisibleRef.current = true
      setToolbar({ x, y, showCopy: true, showPaste: false })
      setFeedback(null)
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      const target = event.target as Element | null
      if (target?.closest('[data-clipboard-toolbar]')) return

      // Araç açıkken baska bir yere tıklanırsa (yeni bir basılı-tutma
      // denemesi başlamadan önce) önce kapatılır.
      if (toolbarVisibleRef.current) hideToolbar()

      clearLongPressTimer()
      longPressStartX = event.clientX
      longPressStartY = event.clientY
      longPressTarget = target
      longPressTimer = setTimeout(triggerLongPress, LONG_PRESS_MS)
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!longPressTimer) return
      const dx = event.clientX - longPressStartX
      const dy = event.clientY - longPressStartY
      if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_TOLERANCE) clearLongPressTimer()
    }

    const handleMouseUpForLongPress = () => {
      clearLongPressTimer()
    }

    // --- Fare ile SÜRÜKLEYEREK metin seçip bırakma (mevcut, değişmeyen akış) ---
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button !== 0) return
      const target = event.target as Element | null
      if (target?.closest('[data-clipboard-toolbar]')) return

      // mouseup ANINDA secim bazi tarayicilarda henuz TAM guncellenmemis
      // olabiliyor - bir sonraki "tick"e birakilir.
      window.setTimeout(() => {
        const active = document.activeElement

        // input/textarea ICINDEKI secimler window.getSelection() ile HIC
        // GORUNMEZ (tarayicilarin bilinen bir kisiti) - bu yuzden bu
        // alanlarda secim, elemanin KENDI selectionStart/End degerinden
        // okunur.
        if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && isEditableElement(active)) {
          const start = active.selectionStart
          const end = active.selectionEnd
          if (start !== null && end !== null && start !== end) {
            selectionTextRef.current = active.value.slice(start, end)
            activeTargetRef.current = active
            const { x, y } = computePosition(active.getBoundingClientRect())
            toolbarVisibleRef.current = true
            setToolbar({ x, y, showCopy: true, showPaste: true })
            setFeedback(null)
          }
          return
        }

        // Normal sayfa metni / duzenlenebilir (contenteditable) alan secimi.
        const selection = window.getSelection()
        const text = selection?.toString() ?? ''
        if (!text.trim() || !selection || selection.rangeCount === 0) return

        selectionTextRef.current = text
        const isContentEditableSelection = active instanceof HTMLElement && active.isContentEditable
        activeTargetRef.current = isContentEditableSelection ? active : null

        const range = selection.getRangeAt(0)
        const rawRect = range.getBoundingClientRect()
        const rect = rawRect.width || rawRect.height
          ? rawRect
          : { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY }
        const { x, y } = computePosition(rect)
        toolbarVisibleRef.current = true
        setToolbar({ x, y, showCopy: true, showPaste: isContentEditableSelection })
        setFeedback(null)
      }, 0)
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (selection && selection.toString().trim()) return
      // Sayfa-metni secimi bosaldi - eger odaklanmis bir alan da yoksa
      // (yani araci sadece bir secim icin acmistik) gizle.
      if (!activeTargetRef.current) hideToolbar()
    }

    const handleScroll = () => hideToolbar()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideToolbar()
    }

    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUpForLongPress, true)
    window.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('selectionchange', handleSelectionChange)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUpForLongPress, true)
      window.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('selectionchange', handleSelectionChange)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('keydown', handleKeyDown)
      clearHideTimeout()
      clearLongPressTimer()
    }
  }, [])

  const handleCopy = async () => {
    const text = selectionTextRef.current || window.getSelection()?.toString() || ''
    if (!text.trim()) return

    let succeeded = false
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        succeeded = true
      }
    } catch {
      // asagida eski yonteme (execCommand) dusulur
    }
    if (!succeeded) succeeded = copyWithFallback(text)

    if (succeeded) {
      setFeedback('copied')
      hideTimeoutRef.current = setTimeout(() => {
        toolbarVisibleRef.current = false
        setToolbar(null)
        setFeedback(null)
      }, 900)
    } else {
      setFeedback('error')
    }
  }

  const handlePaste = async () => {
    const target = activeTargetRef.current
    if (!target) return

    try {
      // NOT: navigator.clipboard.readText() GUVENLI BAGLAM (https ya da
      // localhost) gerektirir - bazi bilgisayarlarda uygulama
      // http://IP:3000 gibi acildiginda bu API kullanilamayabilir (kamera
      // erisiminde daha once yasanan "guvenli olmayan kaynak" kisitiyla
      // AYNI neden). Boyle durumda kullaniciya Ctrl+V onerilir - yapistirma
      // icin (kopyalamanin aksine) tarayicilarda guvenilir bir yedek yontem
      // yoktur.
      const text = await navigator.clipboard.readText()
      if (!text) return

      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const start = target.selectionStart ?? target.value.length
        const end = target.selectionEnd ?? target.value.length
        const nextValue = target.value.slice(0, start) + text + target.value.slice(end)
        setNativeInputValue(target, nextValue)
        target.dispatchEvent(new Event('input', { bubbles: true }))
        const cursor = start + text.length
        requestAnimationFrame(() => target.setSelectionRange(cursor, cursor))
      } else if (target.isContentEditable) {
        target.focus()
        document.execCommand('insertText', false, text)
      }

      setFeedback('pasted')
      hideTimeoutRef.current = setTimeout(() => setFeedback(null), 900)
    } catch {
      setFeedback('error')
      hideTimeoutRef.current = setTimeout(() => setFeedback(null), 2200)
    }
  }

  if (!toolbar) return null

  return (
    <div
      data-clipboard-toolbar
      // Kullanici istegi (Ekim 2026): "daha profesyonel/kurumsal olsun" -
      // eskiden mavi/camgobegi ve zumrut/turkuaz GRADYANLI, yari saydam
      // "cam" (backdrop-blur) gorunumdeydi; artik uygulamanin geri kalaninda
      // kullandigimiz AYNI lacivert/duz-renk kurumsal dil ile tutarli.
      className="fixed z-[2147483647] flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-[0_12px_32px_rgba(15,23,42,0.22)] ring-1 ring-slate-950/5 print:hidden"
      style={{ left: toolbar.x, top: toolbar.y }}
    >
      {toolbar.showCopy && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void handleCopy()}
          className="flex items-center gap-1.5 rounded-md bg-[#1E2A38] px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-white transition hover:bg-[#2A3B4D] active:scale-95"
        >
          <CopyIcon />
          {feedback === 'copied' ? 'Kopyalandı ✓' : 'Kopyala'}
        </button>
      )}
      {toolbar.showPaste && (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void handlePaste()}
          className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-white transition hover:bg-emerald-800 active:scale-95"
        >
          <PasteIcon />
          {feedback === 'pasted' ? 'Yapıştırıldı ✓' : 'Yapıştır'}
        </button>
      )}
      {feedback === 'error' && (
        <span className="px-2 text-[10px] font-black text-rose-600">Panoya erişilemedi - Ctrl+V deneyin</span>
      )}
    </div>
  )
}

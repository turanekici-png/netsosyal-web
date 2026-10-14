'use client'

import { useEffect, useRef, useState } from 'react'

// Uygulama geneli Kes / Kopyala / Yapıştır / Tümünü Seç menusu
// (components/providers.tsx'te tek yerden monte edilir).
//
// Neden ozel bir menu: sag tik bircok sayfada ozel "Kayıt İşlemleri"
// menulerine ayrildigi icin tarayicinin kendi Kopyala/Yapistir komutlarina
// ulasilamiyor. Menu su durumlarda acilir:
//  - Sol tusla ~0,5 sn BASILI TUTMA (uzun basma): giris alaninda tum
//    komutlar; sayfa metninde basili tutulan kelime secilip Kopyala.
//  - Fare ile SURUKLEYEREK metin secip birakma.
// Sade bir tikta hicbir sey gorunmez.
//
// Kullanici istegi (2026-10-14): "kopyala/yapistir tam olmuyor, kes de
// olsun, daha profesyonel olsun" - KOK NEDEN: uygulama cogunlukla
// http://IP:3000 gibi GUVENLI OLMAYAN adresten acildigi icin tarayici
// navigator.clipboard.readText()'e izin vermiyor, "Yapıştır" hep hata
// veriyordu. Cozum: uygulama ICINDE kopyalanan/kesilen her metin (bu
// menuden VEYA klavyeden Ctrl+C / Ctrl+X ile) "uygulama panosu"nda
// tutulur; panoya erisim yoksa Yapistir bu metni kullanir. Disaridan
// (Word, Excel...) kopyalanan metin icin guvenli olmayan adreste tek yol
// Ctrl+V'dir (tarayici kisiti) - menu bunu acikca belirtir.

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement
type MenuState = {
  x: number
  y: number
  target: EditableTarget | null
  selectedText: string
  // input/textarea icin acildigi andaki secim (menuye tiklarken kaybolmasin)
  selStart: number | null
  selEnd: number | null
} | null
type Notice = { text: string; tone: 'ok' | 'warn' } | null

const MENU_WIDTH = 236
const MENU_HEIGHT_EST = 210
const VIEWPORT_MARGIN = 8
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'range', 'color', 'submit', 'button', 'reset', 'image', 'hidden'])
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_TOLERANCE = 6

// Uygulama ici pano (sekme omru boyunca).
let appClipboard = ''

function isTextInput(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true
  return element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type)
}

function clampPosition(x: number, y: number) {
  const left = Math.min(Math.max(x, VIEWPORT_MARGIN), window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN)
  const top = y + MENU_HEIGHT_EST > window.innerHeight - VIEWPORT_MARGIN
    ? Math.max(VIEWPORT_MARGIN, y - MENU_HEIGHT_EST)
    : y
  return { x: Math.max(left, VIEWPORT_MARGIN), y: top }
}

async function writeClipboard(text: string): Promise<boolean> {
  appClipboard = text
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // asagidaki eski yonteme dusulur
  }
  // Eski yontem: gecici textarea + execCommand('copy'). Odak ve secim
  // sonradan GERI yuklenir (eskiden kopyalayinca alanin odagi kayboluyordu).
  const previouslyFocused = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const savedRanges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : []
  const savedInputSel = isTextInput(previouslyFocused) ? [previouslyFocused.selectionStart, previouslyFocused.selectionEnd] as const : null
  let ok = false
  try {
    const helper = document.createElement('textarea')
    helper.value = text
    helper.setAttribute('readonly', '')
    helper.style.position = 'fixed'
    helper.style.top = '0'
    helper.style.left = '-9999px'
    helper.style.opacity = '0'
    document.body.appendChild(helper)
    helper.select()
    ok = document.execCommand('copy')
    document.body.removeChild(helper)
  } catch {
    ok = false
  }
  previouslyFocused?.focus?.({ preventScroll: true })
  if (savedInputSel && isTextInput(previouslyFocused) && savedInputSel[0] !== null && savedInputSel[1] !== null) {
    previouslyFocused.setSelectionRange(savedInputSel[0], savedInputSel[1])
  } else if (selection && savedRanges.length) {
    selection.removeAllRanges()
    savedRanges.forEach((r) => selection.addRange(r))
  }
  // execCommand basarisiz olsa bile uygulama ici panoda metin var -
  // uygulama icinde yapistirma calisir.
  return ok
}

async function readClipboard(): Promise<{ text: string; fromSystem: boolean }> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      const text = await navigator.clipboard.readText()
      return { text, fromSystem: true }
    }
  } catch {
    // izin verilmedi - uygulama ici panoya dusulur
  }
  return { text: appClipboard, fromSystem: false }
}

// React kontrollu alanlar icin: once tarayicinin "insertText" komutu
// (Ctrl+Z geri al gecmisini KORUR ve React'in onChange'ini tetikler);
// desteklenmezse native value setter + input olayi.
function insertIntoField(field: HTMLInputElement | HTMLTextAreaElement, text: string, start: number, end: number) {
  field.focus({ preventScroll: true })
  field.setSelectionRange(start, end)
  let done = false
  try {
    done = document.execCommand('insertText', false, text)
  } catch {
    done = false
  }
  if (!done || field.value.slice(start, start + text.length) !== text) {
    const proto = field instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const nextValue = field.value.slice(0, start) + text + field.value.slice(end)
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, nextValue)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    const caret = start + text.length
    requestAnimationFrame(() => field.setSelectionRange(caret, caret))
  }
}

function selectWordAtPoint(x: number, y: number): string {
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
  if (!range) return ''
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE || !node.textContent) return ''
  const text = node.textContent
  const offset = Math.min(range.startOffset, text.length)
  const isWordChar = (ch: string) => /[\p{L}\p{N}_.@/-]/u.test(ch)
  let start = offset
  let end = offset
  while (start > 0 && isWordChar(text[start - 1])) start -= 1
  while (end < text.length && isWordChar(text[end])) end += 1
  if (start === end) return ''
  const wordRange = document.createRange()
  wordRange.setStart(node, start)
  wordRange.setEnd(node, end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(wordRange)
  return text.slice(start, end)
}

const Icon = ({ d }: { d: string[] }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
)
const ICONS = {
  cut: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M20 4 8.12 15.88', 'M14.47 14.48 20 20', 'M8.12 8.12 12 12'],
  copy: ['M9 9h11v11H9z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  paste: ['M9 2h6v4H9z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 13h6', 'M9 17h4'],
  all: ['M4 4h4', 'M16 4h4v4', 'M20 16v4h-4', 'M8 20H4v-4', 'M4 8V4', 'M9 9h6v6H9z'],
}

export function SelectionCopyToolbar() {
  const [menu, setMenu] = useState<MenuState>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const menuRef = useRef<MenuState>(null)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { menuRef.current = menu }, [menu])

  const close = () => setMenu(null)

  const flash = (text: string, tone: 'ok' | 'warn' = 'ok', ms = 1400) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setNotice({ text, tone })
    noticeTimerRef.current = setTimeout(() => setNotice(null), ms)
  }

  useEffect(() => {
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let startX = 0
    let startY = 0
    let pressTarget: Element | null = null
    let longPressFired = false

    const clearTimer = () => {
      if (longPressTimer) clearTimeout(longPressTimer)
      longPressTimer = null
    }

    const openFor = (target: Element | null, x: number, y: number, allowWordPick: boolean) => {
      const pos = clampPosition(x, y)
      if (isTextInput(target)) {
        const editable = !target.readOnly && !target.disabled
        const s = target.selectionStart
        const e = target.selectionEnd
        const selectedText = s !== null && e !== null && s !== e ? target.value.slice(s, e) : ''
        if (!editable && !selectedText && !allowWordPick) return
        setMenu({ ...pos, target: editable ? target : null, selectedText: selectedText || (!editable ? target.value : ''), selStart: s, selEnd: e })
        return
      }
      const editableHost = target instanceof HTMLElement && target.isContentEditable ? target : null
      let selectedText = window.getSelection()?.toString() ?? ''
      if (!selectedText.trim() && allowWordPick && !editableHost) selectedText = selectWordAtPoint(startX, startY)
      if (!selectedText.trim() && !editableHost) return
      setMenu({ ...pos, target: editableHost, selectedText, selStart: null, selEnd: null })
    }

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest('[data-clipboard-toolbar]')) return
      if (menuRef.current) close()
      if (event.button !== 0) return
      clearTimer()
      longPressFired = false
      startX = event.clientX
      startY = event.clientY
      pressTarget = target
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        longPressFired = true
        openFor(pressTarget, startX, startY, true)
      }, LONG_PRESS_MS)
    }

    const onMouseMove = (event: MouseEvent) => {
      if (!longPressTimer) return
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) clearTimer()
    }

    const onMouseUp = (event: MouseEvent) => {
      clearTimer()
      if (event.button !== 0 || longPressFired) return
      const target = event.target as Element | null
      if (target?.closest('[data-clipboard-toolbar]')) return
      // Surukleyerek secim: ancak fare GERCEKTEN hareket ettiyse (sade
      // tikta menu acilmaz). Secim bir sonraki tick'te kesinlesir.
      if (Math.hypot(event.clientX - startX, event.clientY - startY) <= LONG_PRESS_MOVE_TOLERANCE) return
      window.setTimeout(() => {
        const active = document.activeElement
        if (isTextInput(active)) {
          if (active.selectionStart !== active.selectionEnd) openFor(active, event.clientX, event.clientY + 12, false)
          return
        }
        if ((window.getSelection()?.toString() ?? '').trim()) {
          openFor(active instanceof HTMLElement && active.isContentEditable ? active : target, event.clientX, event.clientY + 12, false)
        }
      }, 0)
    }

    // Klavyeyle (Ctrl+C / Ctrl+X) uygulamanin herhangi bir yerinde yapilan
    // kopyalamalar da uygulama panosuna yazilir - boylece menudeki
    // "Yapıştır" http adresinde de calisir.
    const onCopyOrCut = () => {
      const active = document.activeElement
      const text = isTextInput(active) && active.selectionStart !== null && active.selectionEnd !== null
        ? active.value.slice(active.selectionStart, active.selectionEnd)
        : window.getSelection()?.toString() ?? ''
      if (text) appClipboard = text
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuRef.current) close()
    }
    const onScrollOrResize = () => { if (menuRef.current) close() }

    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('copy', onCopyOrCut, true)
    document.addEventListener('cut', onCopyOrCut, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    window.addEventListener('blur', onScrollOrResize)
    return () => {
      clearTimer()
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('copy', onCopyOrCut, true)
      document.removeEventListener('cut', onCopyOrCut, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      window.removeEventListener('blur', onScrollOrResize)
    }
  }, [])

  const handleCopy = async () => {
    if (!menu?.selectedText) return
    await writeClipboard(menu.selectedText)
    close()
    flash('Kopyalandı')
  }

  const handleCut = async () => {
    if (!menu?.target || !menu.selectedText) return
    await writeClipboard(menu.selectedText)
    const target = menu.target
    if (isTextInput(target) && menu.selStart !== null && menu.selEnd !== null) {
      insertIntoField(target, '', menu.selStart, menu.selEnd)
    } else if (target.isContentEditable) {
      target.focus()
      document.execCommand('delete')
    }
    close()
    flash('Kesildi')
  }

  const handlePaste = async () => {
    const target = menu?.target
    if (!target) return
    const { text, fromSystem } = await readClipboard()
    if (!text) {
      close()
      flash('Pano boş ya da tarayıcı erişime izin vermiyor — Ctrl+V kullanın', 'warn', 3200)
      return
    }
    if (isTextInput(target)) {
      const start = menu.selStart ?? target.value.length
      const end = menu.selEnd ?? target.value.length
      insertIntoField(target, text, start, end)
    } else if (target.isContentEditable) {
      target.focus()
      document.execCommand('insertText', false, text)
    }
    close()
    flash(fromSystem ? 'Yapıştırıldı' : 'Yapıştırıldı (uygulama içi kopya)')
  }

  const handleSelectAll = () => {
    const target = menu?.target
    if (target && isTextInput(target)) {
      target.focus()
      target.select()
      setMenu((prev) => (prev ? { ...prev, selectedText: target.value, selStart: 0, selEnd: target.value.length } : prev))
      return
    }
    if (target?.isContentEditable) {
      target.focus()
      document.execCommand('selectAll')
      setMenu((prev) => (prev ? { ...prev, selectedText: window.getSelection()?.toString() ?? '' } : prev))
    }
  }

  const runAction = (key: string) => {
    if (key === 'cut') void handleCut()
    else if (key === 'copy') void handleCopy()
    else if (key === 'paste') void handlePaste()
    else handleSelectAll()
  }

  const items = menu ? [
    { key: 'cut', label: 'Kes', shortcut: 'Ctrl+X', icon: ICONS.cut, enabled: Boolean(menu.target && menu.selectedText) },
    { key: 'copy', label: 'Kopyala', shortcut: 'Ctrl+C', icon: ICONS.copy, enabled: Boolean(menu.selectedText) },
    { key: 'paste', label: 'Yapıştır', shortcut: 'Ctrl+V', icon: ICONS.paste, enabled: Boolean(menu.target) },
    { key: 'all', label: 'Tümünü Seç', shortcut: 'Ctrl+A', icon: ICONS.all, enabled: Boolean(menu.target && (!isTextInput(menu.target) || menu.target.value)) },
  ] : []

  return (
    <>
      {menu && (
        <div
          data-clipboard-toolbar
          role="menu"
          aria-label="Düzen"
          className="fixed z-[2147483647] w-[236px] overflow-hidden rounded-lg border border-[#D5DDE2] bg-white py-1 text-[13.5px] shadow-[0_12px_32px_rgba(15,23,42,0.22)] print:hidden dark:border-slate-700 dark:bg-slate-900"
          style={{ left: menu.x, top: menu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu.selectedText && (
            <div className="mx-1 mb-1 truncate rounded-md bg-[#F1F4F6] px-2.5 py-1 text-[11.5px] font-medium text-[#64748B] dark:bg-slate-800 dark:text-slate-400" title={menu.selectedText}>
              “{menu.selectedText.length > 40 ? `${menu.selectedText.slice(0, 40)}…` : menu.selectedText}”
            </div>
          )}
          {items.map((item, index) => (
            <div key={item.key}>
              {index === 3 && <div className="my-1 h-px bg-[#E6EBEF] dark:bg-slate-700" />}
              <button
                type="button"
                role="menuitem"
                disabled={!item.enabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runAction(item.key)}
                className="group flex w-full items-center gap-3 px-3 py-1.5 text-left font-medium text-[#1E2A38] transition hover:bg-[#E6F3F3] hover:text-[#0A5F67] disabled:cursor-default disabled:text-[#A3AEB5] disabled:hover:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800 dark:disabled:text-slate-600"
              >
                <span className="text-[#0E7C86] group-disabled:text-[#C3CCD2] dark:text-teal-300">
                  <Icon d={item.icon} />
                </span>
                <span className="flex-1">{item.label}</span>
                <span className="text-[11.5px] font-normal text-[#94A3B8]">{item.shortcut}</span>
              </button>
            </div>
          ))}
        </div>
      )}
      {notice && (
        <div
          data-clipboard-toolbar
          role="status"
          className={`pointer-events-none fixed bottom-16 left-1/2 z-[2147483647] -translate-x-1/2 rounded-md px-3.5 py-2 text-[13px] font-semibold text-white shadow-lg print:hidden ${notice.tone === 'ok' ? 'bg-[#0b1f3f]' : 'bg-amber-700'}`}
        >
          {notice.tone === 'ok' ? '✓ ' : ''}{notice.text}
        </div>
      )}
    </>
  )
}

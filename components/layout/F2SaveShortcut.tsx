'use client'

import { useEffect } from 'react'

// F2 = KAYDET (genel kısayol)
// -----------------------------
// Kullanıcı isteği (Eylül 2026): "tüm alanlarda F2 tuşuna basınca kaydetsin".
// Uygulamada onlarca form/modal var ve neredeyse hiçbiri gerçek bir <form>
// elemanı değil (hepsi <button onClick={...}> ile kaydediyor). Bu yüzden
// merkezi bir <form> submit'i yerine şu yaklaşımı kullanıyoruz:
//
//   F2'ye basılınca -> o an AÇIK olan form/modal bağlamındaki GÖRÜNÜR ve
//   ETKİN "Kaydet" (veya "Güncelle" / "Dosyayı Kaydet" / "Değişiklikleri
//   Kaydet" ...) butonunu bulup TIKLAR.
//
// Bağlam seçimi:
//   1. En üstteki açık modal (`.fixed.inset-0`, en yüksek z-index) varsa onun içi.
//   2. Yoksa, odaktaki alandan yukarı doğru en yakın kapsayıcı.
//   3. Hâlâ birden çok aday varsa odağa EN YAKIN olan.
//
// Bir butona açıkça `data-f2-save` konursa metne bakılmadan o tercih edilir.

const KAYDEDILIYOR = 'kaydediliyor'

// Türkçe'ye duyarlı küçük harf (İ -> i, I -> ı)
function trLower(value: string): string {
  return value.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()
}

function normalizeLabel(value: string | null | undefined): string {
  return trLower(value || '').replace(/\s+/g, ' ').trim()
}

// Buton metni bir "kaydet" eylemi mi?
function looksLikeSaveLabel(label: string): boolean {
  if (!label) return false
  if (label.includes(KAYDEDILIYOR)) return false // zaten kaydediyor
  if (/\bkaydet\b/.test(label)) return true // "Kaydet", "Dosyayı Kaydet", "Kaydet ve Durumu Güncelle", "Değişiklikleri Kaydet"...
  if (label === 'güncelle' || label === 'guncelle') return true // İnceleme formu düzenleme
  return false
}

function isElementVisible(el: Element): boolean {
  const htmlEl = el as HTMLElement
  if (htmlEl.hidden) return false
  if (el.getClientRects().length === 0) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  if (Number(style.opacity) === 0) return false
  return true
}

function isButtonEnabled(el: Element): boolean {
  const btn = el as HTMLButtonElement
  if (btn.disabled) return false
  if (el.getAttribute('aria-disabled') === 'true') return false
  return true
}

function buttonLabel(el: Element): string {
  const value = el instanceof HTMLInputElement ? el.value : ''
  return normalizeLabel(`${el.textContent || ''} ${value} ${el.getAttribute('aria-label') || ''}`)
}

function zIndexOf(el: Element): number {
  const z = Number(window.getComputedStyle(el).zIndex)
  return Number.isFinite(z) ? z : 0
}

// Verilen kapsam içinde tıklanabilir "kaydet" butonlarını bulur.
function collectSaveButtons(scope: ParentNode): HTMLElement[] {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]'))
  const explicit = nodes.filter((el) => el.hasAttribute('data-f2-save') && isElementVisible(el) && isButtonEnabled(el))
  if (explicit.length) return explicit
  return nodes.filter((el) => isElementVisible(el) && isButtonEnabled(el) && looksLikeSaveLabel(buttonLabel(el)))
}

// Birden çok aday varsa: odaktaki alandan yukarı çıkarak EN YAKIN kapsayıcıda
// bulunan adayı seç.
function pickClosest(candidates: HTMLElement[], active: Element | null): HTMLElement {
  if (candidates.length === 1 || !active) return candidates[0]
  let node: Element | null = active
  while (node && node !== document.body) {
    const inside = candidates.filter((btn) => node!.contains(btn))
    if (inside.length) return inside[inside.length - 1]
    node = node.parentElement
  }
  return candidates[candidates.length - 1]
}

// İçinde "kaydet" butonu bulunan, GÖRÜNÜR modal katmanlarından en üsttekini
// (odak bir modalın içindeyse onu) döndürür.
function topmostSaveOverlay(active: Element | null): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0, [data-modal-overlay]'))
    .filter((el) => isElementVisible(el) && collectSaveButtons(el).length > 0)
  if (overlays.length === 0) return null
  if (active) {
    const own = overlays.find((el) => el.contains(active))
    if (own) return own
  }
  return overlays.sort((a, b) => zIndexOf(a) - zIndexOf(b))[overlays.length - 1]
}

function triggerSave(): boolean {
  const active = document.activeElement
  const scope = topmostSaveOverlay(active)
  const candidates = collectSaveButtons(scope ?? document)
  if (candidates.length === 0) return false

  const button = pickClosest(candidates, active)

  // Odaktaki alanın onBlur normalleştiricileri (telefon biçimi, TC sorgusu vb.)
  // çalışsın diye önce blur, sonra bir sonraki karede tıkla.
  if (active && active instanceof HTMLElement && typeof active.blur === 'function') {
    active.blur()
  }
  window.setTimeout(() => button.click(), 0)
  return true
}

export function F2SaveShortcut() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || event.repeat) return
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (event.defaultPrevented) return
      const handled = triggerSave()
      if (handled) event.preventDefault()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  return null
}

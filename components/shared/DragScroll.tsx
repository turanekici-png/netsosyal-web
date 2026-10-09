'use client'

// Kullanici istegi: ekrana sigmayan / kaydirma cubugu cikan TUM alanlarda
// (sadece yatay degil, dikey de; sadece raporlarda degil, HER YERDE), fare
// imleci uzerindeyken SOL TUSA basili tutup surukleyerek sola/saga/yukari/
// asagi kaydirma.
//
// SOL tus ayni zamanda metin secip kopyalamak icin de kullaniliyor (bkz.
// SelectionCopyToolbar.tsx - "surukleyerek metin secme" akisi) - bu yuzden
// ikisi CAKISMASIN diye surukleme baslar baslamaz HEMEN kaydirmaya
// GECILMEZ: once kucuk bir esik kadar hareket beklenir, o an tarayicinin
// KENDISI bir metin secimi OLUSTURMUS mu diye bakilir (window.getSelection()).
// - Secim OLUSMUSSA (kullanici gercekten metin uzerinde suruklemis) ->
//   BU BILESEN GERI CEKILIR, hicbir seye karismaz, SelectionCopyToolbar
//   normal akisina devam eder (Kopyala butonu cikar).
// - Secim OLUSMAMISSA (bos alanda / secilemeyen bir yerde suruklenmis) ->
//   kaydirma devreye girer.
// Boylece ayni sol-tus-surukleme jesti, NEREDE baslatildigina gore dogal
// olarak "metin sec" ya da "sayfayi kaydir" olarak ayrisir.
import { useEffect, useRef } from 'react'

type DragState = {
  active: boolean
  resolved: 'pending' | 'scrolling' | 'selecting'
  startX: number
  startY: number
  scrollLeft: number
  scrollTop: number
  container: HTMLElement | null
  canScrollX: boolean
  canScrollY: boolean
}

// Butonlar, girdi alanlari, linkler vb. - bunlarin UZERINDE surukleme
// BASLATILMAZ, aksi halde normal tiklama/yaziya odaklanma gibi temel
// etkilesimler bozulurdu.
//
// Kullanici istegi/hata raporu: "tasarım modundayken bazı alanları
// boyutlarını ayarlarken sayfa kayıyor ve ayarlayamıyorum" - kok neden:
// LocalDesignGrid.tsx/DashboardGrid.tsx'teki panel SURUKLEME tutamaclari
// (".local-design-drag-handle", ".dashboard-drag-handle") ve react-grid-
// layout'un panel BOYUTLANDIRMA tutamaci (".react-resizable-handle",
// react-resizable paketinden - duz bir <span>, yukaridaki listede YOK) bu
// bileşenin PENCERE SEVIYESINDE, YAKALAMA (capture) fazinda calisan
// mousedown dinleyicisini de AYNI ANDA tetikliyordu - boylece kullanici
// bir paneli surukleyip boyutlandirmaya calisirken, BU bilesen de
// PARALEL olarak sayfayi kaydirmaya calisiyor, iki sistem ayni fare
// hareketine birbirinden BAGIMSIZ tepki verince panel duzgun
// boyutlanamiyor / sayfa beklenmedik sekilde kayiyordu. Capture fazinda
// calistigimiz icin bu tutamaclarin KENDI event.stopPropagation()'i
// bunu ONLEYEMIYOR (bizim dinleyicimiz onlardan ONCE calisir) - tek
// cozum, bu tutamaclari da BURADA acikca haric tutmak.
const INTERACTIVE_SELECTOR = 'button,input,select,textarea,a,[role="button"],[contenteditable="true"],.react-resizable-handle,.local-design-drag-handle,.dashboard-drag-handle'

// Bu esik asilmadan "kaydirma m1 yoksa metin secme mi" karari VERILMEZ -
// tarayiciya once kendi secimini olusturmasi icin biraz pay birakilir.
const DECISION_THRESHOLD_PX = 6

function isScrollable(element: HTMLElement, axis: 'x' | 'y'): boolean {
  const style = window.getComputedStyle(element)
  if (axis === 'x') {
    return (style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth
  }
  return (style.overflowY === 'auto' || style.overflowY === 'scroll') && element.scrollHeight > element.clientHeight
}

// Ekrana sigmayip kaydirma cubugu cikan EN YAKIN atayi bulur - belirli bir
// class adina (ör. eskiden "overflow-x-auto") BAGLI DEGILDIR, TUM
// alanlarda (yatay/dikey, herhangi bir kaydirma konteyneri) calisir.
function findScrollableAncestor(start: Element): { el: HTMLElement; canScrollX: boolean; canScrollY: boolean } | null {
  let el: Element | null = start
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const canScrollX = isScrollable(el, 'x')
      const canScrollY = isScrollable(el, 'y')
      if (canScrollX || canScrollY) return { el, canScrollX, canScrollY }
    }
    el = el.parentElement
  }
  return null
}

export function DragScroll() {
  const dragRef = useRef<DragState>({
    active: false,
    resolved: 'pending',
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    container: null,
    canScrollX: false,
    canScrollY: false,
  })

  useEffect(() => {
    const resetDrag = () => {
      const drag = dragRef.current
      if (!drag.active) return

      drag.active = false
      drag.container = null
      if (drag.resolved === 'scrolling') {
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
      }
      drag.resolved = 'pending'
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return

      const target = event.target instanceof Element ? event.target : null
      if (!target || target.closest(INTERACTIVE_SELECTOR)) return

      const found = findScrollableAncestor(target)
      if (!found) return

      dragRef.current = {
        active: true,
        resolved: 'pending',
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: found.el.scrollLeft,
        scrollTop: found.el.scrollTop,
        container: found.el,
        canScrollX: found.canScrollX,
        canScrollY: found.canScrollY,
      }
      // BILEREK preventDefault() YOK burada - tarayicinin kendi metin secme
      // mekanizmasi normal calismaya devam etsin diye (asagida karar anina
      // kadar). Karar verildikten SONRA, "scrolling" ise mudahale edilir.
    }

    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag.active || !drag.container) return

      const deltaX = event.clientX - drag.startX
      const deltaY = event.clientY - drag.startY

      if (drag.resolved === 'pending') {
        if (Math.abs(deltaX) <= DECISION_THRESHOLD_PX && Math.abs(deltaY) <= DECISION_THRESHOLD_PX) return

        const hasTextSelection = Boolean(window.getSelection()?.toString())
        if (hasTextSelection) {
          // Tarayici zaten bir metin secimi olusturmus - geri cekil,
          // SelectionCopyToolbar'in kendi akisina karisma.
          drag.resolved = 'selecting'
          return
        }

        drag.resolved = 'scrolling'
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'move'
      }

      if (drag.resolved !== 'scrolling') return

      if (drag.canScrollX) drag.container.scrollLeft = drag.scrollLeft - deltaX
      if (drag.canScrollY) drag.container.scrollTop = drag.scrollTop - deltaY
      event.preventDefault()
    }

    // Gercek bir kaydirma-surukleme SONRASI, imlecin altindaki satir/butonun
    // "click" olayi YANLISLIKLA tetiklenmesin diye bastirilir - metin secme
    // akisinda (resolved==='selecting') BUNA DOKUNULMAZ, SelectionCopyToolbar
    // kendi "click"/"mouseup" mantigini normal sekilde yurutur.
    const handleClickCapture = (event: MouseEvent) => {
      if (dragRef.current.resolved !== 'scrolling') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    window.addEventListener('mousedown', handleMouseDown, true)
    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', resetDrag, true)
    window.addEventListener('blur', resetDrag)
    window.addEventListener('click', handleClickCapture, true)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', resetDrag, true)
      window.removeEventListener('blur', resetDrag)
      window.removeEventListener('click', handleClickCapture, true)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  return null
}

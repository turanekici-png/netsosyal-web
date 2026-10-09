import type { RefObject } from 'react'
import type { PositionStrategy } from 'react-grid-layout/core'

// Hata raporu (2026-09-12): "Tasarım Modu'nda bir alanın başlığına
// tıkladığımda alan fare imlecinden en az 4 cm sağa/sola ya da farklı yöne
// kalıyor" - kok neden react-grid-layout@2.2.4 kutuphanesinin KENDI
// "createScaledStrategy" (bkz. react-grid-layout/core) uygulamasindaki bir
// hata: surukleme BASLADIGI anda kutunun yeni "left/top" konumu
//   left = (clientX - offsetX) / scale
// olarak hesaplaniyor - burada "clientX - offsetX" aslinda surunun
// GERCEK ekran konumudur (clientRect.left), ama bu deger IZGARA
// KONTEYNERININ (parent/offsetParent) ekrandaki konumu HIC CIKARILMADAN
// dogrudan kullaniliyor. Konteyner sayfada (0,0) noktasinda DEGILSE (ki
// sol menu/ust bar yuzunden HICBIR ZAMAN degildir) kutu, tam da bu
// eksik/atlanmis "parent offset" kadar (uiZoomScale ile olceklenmis
// haliyle - genelde birkac santimetre) yanlis bir yere ATLAR. Kutuphanenin
// KENDI "olceksiz" (scale=1, positionStrategy verilmedigi) varsayilan
// davranisi bu farki dogru cikariyor (bkz. kutuphane kaynagindaki
// "cLeft - pLeft + offsetParent.scrollLeft" satiri) - ama ozel bir
// "calcDragPosition" saglandiginda (bizim yaptigimiz gibi, olcek
// duzeltmesi icin) kutuphane bu cikarmayi ATLIYOR (parametre olarak
// parent bilgisini calcDragPosition'a HIC GECMIYOR).
//
// Bu dosya, ayni duzeltmeyi (parent'in ekrandaki konumunu cikarma +
// scrollLeft/scrollTop ekleme) BIZIM tarafimizda tamamlayan bir
// "createScaledStrategy" varyantidir - node_modules yamalanmadan
// (npm install'da kaybolmaz) kutuphanenin eksik birakti$i tek parcayi
// (parent konteynerin - ".react-grid-layout" - kendi ekran konumu)
// containerRef uzerinden canli olcup ekliyoruz.
export function createParentAwareScaledStrategy(
  scale: number,
  containerRef: RefObject<HTMLElement | null>,
): PositionStrategy {
  const translate = (left: number, top: number, width: number, height: number) => {
    const value = `translate(${left}px,${top}px)`
    return {
      transform: value,
      WebkitTransform: value,
      MozTransform: value,
      msTransform: value,
      OTransform: value,
      width: `${width}px`,
      height: `${height}px`,
      position: 'absolute' as const,
    }
  }

  return {
    type: 'transform',
    scale,
    calcStyle(pos) {
      return translate(pos.left, pos.top, pos.width, pos.height)
    },
    calcDragPosition(clientX, clientY, offsetX, offsetY) {
      const clientLeft = clientX - offsetX
      const clientTop = clientY - offsetY
      // ".react-grid-layout" - kutuphanenin kendi ic kok konteyneri (bkz.
      // yukaridaki not) - surukelenen kutunun GERCEK offsetParent'i budur.
      const root = containerRef.current?.querySelector<HTMLElement>('.react-grid-layout')
      if (!root) {
        // Yedek: konteyner henuz bulunamadiysa, en azindan kutuphanenin
        // eski (eksik) davranisiyla AYNI sonucu ver - hicbir zaman daha
        // kotu bir durum yaratmaz.
        return { left: clientLeft / scale, top: clientTop / scale }
      }
      const parentRect = root.getBoundingClientRect()
      return {
        left: (clientLeft - parentRect.left) / scale + root.scrollLeft,
        top: (clientTop - parentRect.top) / scale + root.scrollTop,
      }
    },
  }
}

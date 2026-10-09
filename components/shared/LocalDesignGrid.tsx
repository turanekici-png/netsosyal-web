'use client'

import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { Responsive, useContainerWidth, getCompactor, verticalCompactor, type Layout } from 'react-grid-layout'
import { useUiScale } from '@/components/layout/ScaleContext'
import { createParentAwareScaledStrategy } from '@/components/shared/rglParentAwareScaledStrategy'

// Kullanici istegi: bir kutuyu surukleyip baska bir kutunun UZERINE
// goturunce, react-grid-layout'un VARSAYILAN davranisi o kutuyu (ve
// zincirleme olarak carptigi digerlerini) OTOMATIK OLARAK ITIP baska bir
// bosluga tasiyordu - kullanici "diger tum alanlarin yerini kaydırıyor ve
// nereye kaydırdığını bulamıyorum" diye bildirdi (surukledigi kutu bile
// beklenmedik bir yere savrulabiliyordu). "noCompactor" bunu TEK BASINA
// cozmuyordu - o sadece sikistirmayi (compaction) kapatiyor, "cakisirsa
// digerini it" (preventCollision=false, allowOverlap=false varsayilani)
// davranisina dokunmuyordu. Bu yuzden ozel bir "hicbir sey itilmesin/
// tasinmasin, sadece BOS yere birakilabilsin" compactor'u (preventCollision:
// true) olusturuldu - kullanici baska bir kutunun UZERINE birakmaya
// calisirsa kutu son GECERLI (bos) konumuna geri doner, ama ETRAFTAKI
// HICBIR kutu ASLA kendiliginden yer degistirmez.
const noCollisionCompactor = getCompactor(null, false, true)

// Kullanici istegi (2. tur): yukaridaki "hicbir kutu itilmesin" kurali
// SURUKLEME (tasima) icin dogruydu, ama BOYUTLANDIRMA (kosesinden tutup
// buyutme) icin YANLIS cikti - kullanici bir kutuyu (ör. "Hane Bilgileri")
// asagi dogru uzattiginda, ALTINDAKI kutularin (Muracaatlar, Yardimlar,
// Raporlar) da o kadar asagi KAYMASINI istedi ("büyütülen alan kadar
// altındaki tüm alanları aşağı doğru kaydırsın").
//
// ONEMLI (react-grid-layout kaynagi incelenerek dogrulandi): "se"
// (sag-alt) tutamaciyla yapilan bir boyutlandirmada kutuphane HICBIR
// zaman "moveElement" (cakisan kutuyu itme) fonksiyonunu cagirmiyor -
// sadece kutunun kendi w/h'sini degistirip, en sonda compactor.compact()'i
// calistiriyor. "type:null" olan (compact() sadece diziyi KOPYALAYIP
// hicbir sey yapmayan) bir compactor ile bu yuzden ALTTAKI kutu ASLA
// itilmiyordu (denenmisti, calismadi). Gercek "asagi itme" etkisi icin
// BOYUTLANDIRMA sirasinda GERCEK sikistirma yapan verticalCompactor
// kullanilmasi gerekiyor - bu, cakisan alt kutuyu doganal olarak asagi
// (buyuyen kutunun hemen altina) yerlestirir. Surukleme (drag) icin hala
// noCollisionCompactor kullanilmaya devam eder - bkz. asagidaki
// interactionKind ayrimi.

// Kullanici istegi: Dosya Yonetimi sayfasindaki ana panelleri (Kisi
// Bilgileri, Kisayollar, Hane Bilgileri vb.) kullanici bir "Tasarim Modu"
// acarak surukleyip yerini degistirebilsin, kosesinden tutup
// buyutup/kucultebilsin; modu kapattiginda son duzenledigi hali kullanmaya
// devam etsin. Bu bilesen, components/shared/DashboardGrid.tsx'teki
// (Ana Sayfa'da halihazirda calisan, kanitlanmis) AYNI react-grid-layout
// deseninin bir varyanti.
//
// documents/page.tsx'teki mevcut panellerin HICBIRINE, ICERIGINE
// DOKUNULMADI - sadece bu panelleri saran DIS grid yapisi degisti (bkz.
// ilgili dosyadaki "Tasarim Modu" yorumlari).
//
// ONEMLI (kullanici istegi): duzen bir ARA donemde tarayici localStorage'ina
// (bilgisayara ozel) saklaniyordu - kullanici bunun YANLIS oldugunu,
// AYNI bilgisayardan FARKLI hesaplarla giren personelin hesap FARKLI olsa
// bile AYNI (o bilgisayara ait) duzeni gordugunu, istediginin "HANGI
// HESAPLA girilirse o hesabin KENDI duzeni" oldugunu bildirdi. Bu yuzden
// kayit, DashboardGrid.tsx ile AYNI mekanizmaya (sunucu tarafinda,
// kullaniciId bazinda - bkz. app/api/dashboard-layout/route.ts, "grid"
// parametresiyle paylasilarak kullaniliyor) tasindi. "storageKey" prop'u
// artik bir localStorage anahtari degil, bu sunucu API'sindeki "grid"
// kimligidir (ayni isim korunmustur, cagiran taraf degismesin diye).
//
// Kullanici istegi (2. tur): kutularin altinda/kenarinda bos alan
// KALMASIN - "verinin bittigi yerde alan bitsin". Bu yuzden HENUZ
// kullanici tarafindan elle boyutlandirilmamis (customize edilmemis) her
// kutu, kendi ICERIGININ GERCEK/DOGAL yuksekligini surekli (ResizeObserver
// ile canli) OLCUP kutunun yuksekligini buna esitler - kutu HER ZAMAN tam
// icerigi kadar olur, ne fazla ne eksik.
//
// Kullanici istegi (3. tur): "alanların içindeki veriler çoğaldıkça veri
// ile birlikte alanda genişlesin" - kullanici bir kutuyu ELLE
// boyutlandirdiktan SONRA bile, o kutunun icindeki veri (ör. hane bireyi,
// muracaat, yardim satiri) zamanla ARTARSA kutu icerikle birlikte
// BUYUSUN, sadece ic kaydirma cubugu cikip kucuk kalmasin. Bu yuzden
// ResizeObserver artik SADECE auto-fit (customize edilmemis) kutularda
// degil, customize edilmis kutularda da CALISIR - TEK FARKLA: customize
// edilmis bir kutu icin olculen icerik boyutu MEVCUT (kullanicinin
// sectigi) yukseklikten KUCUKSE hicbir sey degismez (kullanicinin sectigi
// boyut bir TABAN/minimum sayilir, KUCULTULMEZ); SADECE icerik bu
// yukseklikten DAHA FAZLA yer istiyorsa kutu buyutulur. Boylece
// kullanicinin bilerek kucuk biraktigi bir kutu kucuk kalirken (icerik
// zaten sigdigi surece), veri arttikca dogal olarak genisler.
const ROW_HEIGHT = 3
const ROW_MARGIN = 3

export type LocalDesignWidget = {
  id: string
  title: string
  node: ReactNode
}

const BREAKPOINTS = { lg: 1100, sm: 0 }
const COLS = { lg: 48, sm: 1 }
const DRAG_HANDLE_SELECTOR = '.local-design-drag-handle'
const DRAG_CLICK_SUPPRESS_DISTANCE = 5

function buildSingleColumnLayout(lgLayout: Layout): Layout {
  return lgLayout
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((item, index) => ({ ...item, x: 0, y: index, w: 1 }))
}

// Kullanici istegi (28 Agustos 2026): dar ekranda (mobil/tablet) da "Tasarim
// Modu" calissin - masaustundeki serbest izgara yerine, DashboardGrid'deki
// mobil mantigin AYNISI: kutular tek sutun alt alta, kullanici SADECE SIRAYI
// (yukari/asagi) degistirebilir ve gizleyip gosterebilir. Sira, kayitli "sm"
// duzeninin y sirasindan turetilir.
function orderIdsFromLayout(layout: Layout | undefined): string[] {
  if (!Array.isArray(layout)) return []
  return layout
    .slice()
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((item) => item.i)
}

// Kullanici istegi: yon tuslariyla secili kutuyu hassas tasima - taniti bir
// kutu, BASKA bir kutuyle CAKISIRSA (dikdortgen kesisimi) tasima
// uygulanmaz (surukleme icin yukarida ayarlanan "preventCollision"
// davranisiyla AYNI kural, klavye icin de gecerli).
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// Kullanici istegi/hata raporu: "müracaatlar, yardımlar ve raporlar ve
// tahkikat alanlarını aşağı kaydıramadığı için bir kısmı müracaatlar
// alanının arkasında kalıyor" (buyume) + "birey sayısı az ise bu alan 5 cm
// olsun ve tüm alanları yukarı kaydırsın... sayı çok ise alan genişlesin
// ve diğer alanları aşağı kaydırsın" (kuculme) - ONCEKI deneme (SADECE
// cakisirsa asagi iten bir fonksiyon) BUYUME yonunu cozuyordu ama KUCULME
// yonunu HIC cozmuyordu: bir kutu kucülunce ALTINDA biraktigi BOSLUGU
// hicbir zaman YUKARI CEKMIYORDU (fonksiyon sadece "y hic AZALMASIN"
// garantisi veriyordu). Tam sikistirma (verticalCompactor) burada
// KULLANILAMAZ cunku o TUM izgarayi yeniden paketler - Kişi Bilgileri/
// Kısayollar/vb. gibi kullanicinin BASKA yerlerde BILEREK biraktigi
// bosluklari da KAPATIR (bu daha once ACIKCA istenmeyen bir davranis
// olarak belgelenmisti).
//
// Cozum: "stackedGroups" - ONCEDEN BILINEN, HER ZAMAN bosluksuz/bitisik
// KALMASI gereken widget id DIZILERI (ör. [hane-bilgileri, muracaatlar,
// yardimlar, raporlar-tahkikatlar] - bkz. documents/page.tsx). Her grup
// icin DIZIDEKI ILK kutunun konumuna DOKUNULMAZ (grubun "capasi"), ama
// SONRAKI HER kutu, kendinden ONCEKI kutunun (o anki, GUNCEL) alt
// sinirina TAM olarak yerlestirilir - boylece grup HER DEGISIKLIKTE
// (buyume YA DA kuculme) yeniden bitisik hale gelir: bir kutu buyurse
// ALTINDAKILER asagi KAYAR, kuculurse ALTINDAKILER yukari CEKILIR. Bu
// gruplarin DISINDAKI (ör. Kişi Bilgileri, Kısayollar) kutulara HIC
// dokunulmaz - kullanicinin BILEREK biraktigi bosluklar boylece korunur.
function restackSequentialGroups(items: Layout, groups: string[][]): Layout {
  const updates = new Map<string, number>()

  for (const group of groups) {
    let cursorY: number | null = null

    for (const id of group) {
      const item = items.find((candidate) => candidate.i === id)
      if (!item) continue

      if (cursorY === null) {
        cursorY = item.y + item.h
        continue
      }

      if (item.y !== cursorY) updates.set(id, cursorY)
      cursorY += item.h
    }
  }

  if (updates.size === 0) return items
  return items.map((item) => (updates.has(item.i) ? { ...item, y: updates.get(item.i) as number } : item))
}

export type LocalDesignGridHandle = {
  // Kullanici istegi: bir paneli, Tasarim Modu'na hic girmeden, sayfanin
  // baska bir yerindeki (ör. arac cubugundaki) SIRADAN bir dugmeden
  // ac/kapa (goster/gizle) yapabilme - bkz. documents/page.tsx'teki
  // "Dosya Analizi" dugmesi.
  toggleWidget: (id: string) => void
}

interface LocalDesignGridProps {
  // Sunucudaki kayit anahtari ("grid" kimligi - bkz. yukaridaki not).
  // AYNI sayfada birden fazla LocalDesignGrid kullanilacaksa (ileride)
  // birbirine karismamasi icin benzersiz olmali VE
  // app/api/dashboard-layout/route.ts'teki ALLOWED_GRID_IDS listesine
  // eklenmis olmalidir.
  storageKey: string
  widgets: LocalDesignWidget[]
  defaultLayout: Layout
  // Tasarim Modu dugmesinin yaninda gosterilecek kisa aciklama (ör.
  // "Kişi Bilgileri Paneli Düzeni").
  title?: string
  // Kullanici istegi: sayfada birden fazla LocalDesignGrid varsa (ör.
  // Dosya Yonetimi'ndeki ana paneller + Raporlar ve Tahkikatlar) AYRI AYRI
  // "Tasarim Modu" dugmeleri yerine TEK/ORTAK bir dugme tum gridleri
  // birlikte ac/kapasin istendi. Bu iki prop verilirse (ust bilesende
  // ORTAK bir state tutulup BURAYA aktarilirsa) bu bilesen KENDI ic
  // durumunu degil, DISARIDAN gelen durumu kullanir - verilmezse eskisi
  // gibi kendi ic anahtar/dugmesini kullanmaya devam eder (geriye donuk
  // uyumlu).
  designMode?: boolean
  onDesignModeChange?: (next: boolean) => void
  // Ortak/paylasilan bir Tasarim Modu dugmesi disaridan (baska bir
  // LocalDesignGrid'in ust cubugunda) zaten gosteriliyorsa, bu grid
  // ornegi KENDI dugmesini/ust cubugunu TEKRAR gostermesin diye.
  showToggleButton?: boolean
  // Kullanici istegi (Ekim 2026): Dosya Yonetimi'nde bu bilesenin ustundeki
  // bilgi/durum cubugu ("... duzeni kilitli" / "... duzenini
  // degistiriyorsunuz") tamamen kaldirildi - ac/kapa dugmesi ust menuye
  // tasindi (bkz. DesignModeContext). false verilirse: tasarim modu KAPALI
  // iken HICBIR sey render edilmez; ACIK iken sadece ipucu + "Sıfırla" +
  // kayit durumu iceren ince bir serit gosterilir (ac/kapa dugmesi YOK).
  showInfoBar?: boolean
  // Kullanici istegi: bazi paneller (ör. "Dosya Analizi") herkese her
  // zaman acik degil, SADECE istendiginde goruntulensin - bu widget
  // id'leri, bu hesap icin DAHA ONCE HIC gizleme tercihi yapilmamissa
  // (yani kullanici henuz bilerek goster/gizle yapmamissa) BASLANGICTA
  // gizli sayilir. Kullanici bir kere gosterip/gizleyince, o andan
  // itibaren HER ZAMAN kullanicinin son tercihi gecerli olur.
  defaultHiddenIds?: string[]
  // Kullanici istegi: bazi panellerin (ör. Dosya Yonetimi'ndeki Hane
  // Bilgileri/Muracaatlar/Yardimlar/Notlar/Kurum Ici Mesaj) yuksekligi HER
  // ZAMAN "defaultLayout'taki TABAN (ör. '5cm') ile o anki GERCEK icerik
  // ihtiyacinin BUYUGU" olur - kutu bu TABANIN ALTINA asla inmez (az
  // kayitla 5cm'de kalir), ama icerik fazlaysa BUYUR, AZALINCA da tekrar
  // (en az bu tabana kadar) KUCULUR. Boylece varsayilan duzende
  // ongorulebilir/sabit bir baslangic yuksekligi garanti edilirken, veri
  // miktari degistikce kutu HER ZAMAN gercek ihtiyaca gore ayarlanir.
  fixedHeightIds?: string[]
  // Kullanici istegi: bazi paneller (ör. Dosya Yonetimi'ndeki "Raporlar ve
  // Tahkikatlar") icerik miktarindan TAMAMEN BAGIMSIZ, SADECE kullanicinin
  // Tasarim Modu'nda elle ayarladigi (ya da varsayilan/sifirlanmis)
  // yukseklikte KALSIN istendi - "fixedHeightIds"in aksine bu paneller
  // veri artsa bile ASLA otomatik buyumez/kucultmez, tasan icerik SADECE
  // kendi ic kaydirma cubuguyla gorulur. Bu id'ler ResizeObserver
  // olcumunden TAMAMEN MUAF tutulur - yukseklikleri YALNIZCA gercek bir
  // surukleme/boyutlandirma hareketiyle (ya da sifirlamayla) degisir.
  // (Kullanici istegi/hata raporu: "fixedHeightIds" - buyume-serbest
  // taban modeli - bu panel icin YETERSIZ CIKTI: "boyutunu
  // degistiremiyorum, veri uzayinca sayfada asagi uzuyor" - kok neden,
  // buyume kuralinin yine de icerige gore bir olcum yapip kutuyu geri
  // buyutebilmesiydi. Bu yeni mod, olcumu TAMAMEN devre disi biraktigi
  // icin bu belirsizlik ortadan kalkar.)
  manualOnlyIds?: string[]
  // Kullanici istegi/hata raporu: "birey sayısı az ise bu alan 5 cm olsun
  // ve tüm alanları yukarı kaydırsın... sayı çok ise alan genişlesin ve
  // diğer alanları aşağı kaydırsın" - siralanmis widget id GRUPLARI (ör.
  // [['hane-bilgileri','muracaatlar','yardimlar','raporlar-tahkikatlar']])
  // - her grup, boyut degistikce (buyume YA DA kuculme) HER ZAMAN
  // bosluksuz/bitisik bir dizi olarak yeniden hizalanir (bkz.
  // restackSequentialGroups). Gruplarin DISINDAKI kutulara (ör. Kişi
  // Bilgileri, Kısayollar) HIC dokunulmaz.
  stackedGroups?: string[][]
  // Kullanici istegi/hata raporu: "işaretli alanların boyutlarını
  // tasarım modunda değiştiremiyorum" (Notlar/Eksik Evrak, Kurum İçi
  // Mesaj gibi fixedHeightIds kutulari icin) - kok neden: fixedHeightIds
  // kutulari HER ResizeObserver tetiklenmesinde (ki bu, sayfadaki HERHANGI
  // bir olculen kutunun boyutu degisince, sadece o kutu icin degil TUM
  // kutular icin yeniden calisir) yuksekligini KOSULSUZ olarak
  // "max(taban, icerik ihtiyaci)"na SIFIRLIYORDU - kullanicinin AZ ONCE
  // elle yaptigi bir surukleme/boyutlandirma bile, hemen ardindan (ör.
  // BASKA bir kutunun dogal reflow'u yuzunden) bu deger tarafindan GERI
  // ALINIYORDU (kullaniciya "hic resize edemiyorum" gibi gorunuyordu).
  // Cozum: kullanicinin GERCEK bir surukleme/boyutlandirma HAREKETIYLE
  // sectigi yukseklik artik "manuel taban" olarak hatirlanir (bkz.
  // asagidaki manualFixedHeightOverrides) - fixedHeightIds kutusu bu
  // TABANIN altina inmez (icerik daha az yer istese bile), sadece icerik
  // daha FAZLA yer isterse buyur. Bu "manuel taban", FARKLI bir dosya
  // acildiginda (yani bu prop degerinin DEGISTIGINDE) sifirlanir - boylece
  // "az bireyli bir dosyaya gecince 5cm'e kucul" davranisi dosyalar
  // ARASINDA hala calisir, ama AYNI dosyadayken yapilan manuel
  // boyutlandirma ARTIK geri alinmaz.
  resetManualHeightsKey?: string | number
  // Kullanici istegi (Eylul 2026): "yazi boyutunu da Tasarim Modu'na
  // ekleyelim, kullanici hangi boyutu sececegine karar versin" - cagiran
  // sayfa (ör. Dosya Yonetimi) kendi kontrolunu (yuzde kaydirici vb.)
  // buraya verir; SADECE Tasarim Modu ACIKKEN, ust bilgi cubugunun sag
  // tarafinda ("Sıfırla" dugmesinin yaninda) gosterilir.
  extraDesignControls?: ReactNode
}

export const LocalDesignGrid = forwardRef<LocalDesignGridHandle, LocalDesignGridProps>(function LocalDesignGrid({
  storageKey,
  widgets,
  defaultLayout,
  title,
  designMode: externalDesignMode,
  onDesignModeChange,
  showToggleButton = true,
  showInfoBar = true,
  defaultHiddenIds,
  fixedHeightIds,
  manualOnlyIds,
  stackedGroups,
  resetManualHeightsKey,
  extraDesignControls,
}, ref) {
  const fixedHeightIdSet = new Set(fixedHeightIds ?? [])
  const manualOnlyIdSet = new Set(manualOnlyIds ?? [])
  // Kullanici istegi/hata raporu: "sayı azaltıkça alan 5 cm'ye kadar
  // küçülsün" - fixedHeightIds kutulari icin TABAN, kutunun O ANKI
  // yuksekligi DEGIL, HER ZAMAN kendi VARSAYILAN (defaultLayout'taki, ör.
  // "5cm") yuksekligidir - bkz. asagidaki ResizeObserver notu.
  const defaultHeightByIdRef = useRef(new Map(defaultLayout.map((item) => [item.i, item.h])))
  const stackedGroupsRef = useRef(stackedGroups ?? [])
  stackedGroupsRef.current = stackedGroups ?? []
  // Kullanici istegi/hata raporu: "işaretli alanların boyutlarını tasarım
  // modunda değiştiremiyorum" - bkz. yukaridaki "resetManualHeightsKey"
  // prop notu. Kullanicinin fixedHeightIds bir kutuyu GERCEKTEN elle
  // boyutlandirdigi anda (bkz. commitCurrentLayout) buraya YENI TABAN
  // olarak yazilir; "resetManualHeightsKey" (ör. dosya kimligi)
  // DEGISTIGINDE tamamen temizlenir.
  const manualFixedHeightsRef = useRef(new Map<string, number>())
  useEffect(() => {
    manualFixedHeightsRef.current = new Map()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetManualHeightsKey])
  const { width, containerRef, mounted } = useContainerWidth()
  // Kullanici istegi/hata raporu: "mouseyi kaydırıyorum ama alan mouse ile
  // aynı oranda değişmiyor" (Tasarim Modu'nda surukleme/boyutlandirma) -
  // kok neden: kabuk, ana icerik alanini CSS `zoom` ile olcekliyor (bkz.
  // ScaledArea.tsx - autoScale * manualZoom * uiScale). Bu bilesen o
  // katsayidan HABERSIZDI, react-grid-layout'un ic piksel<->izgara-birimi
  // matematigi (surukleme/boyutlandirma sirasinda) bu yuzden GERCEK fare
  // hareketiyle ORANTISIZ hesaplaniyordu (zoom 1'den ne kadar uzaklasirsa
  // sapma o kadar buyuyordu - ör. dar/kucuk pencerede otomatik olcek
  // ~0.9'a dusunce fark belirginlesiyordu). ScaleContext.ts'teki yorum
  // bunu ONCEDEN tarif etmisti ("RGL satir matematigi... olculen degeri bu
  // katsayiya bolmek gerekir") ama hicbir yerde UYGULANMAMISTI - react-
  // grid-layout'un tam bunun icin sagladigi createScaledStrategy(scale) ile
  // duzeltiliyor (bkz. asagidaki positionStrategy).
  //
  // Hata raporu (2026-09-12, IKINCI/AYRI bir hata): "başlığa tıkladığımda
  // alan fare imlecinden en az 4 cm sağa/sola kalıyor" - react-grid-
  // layout'un KENDI createScaledStrategy'si, surukleme BASLARKEN kutunun
  // yeni konumunu hesaplarken izgara KONTEYNERININ ekrandaki konumunu (sol
  // menu/ust bar yuzunden hicbir zaman (0,0) olmayan parent offset)
  // CIKARMAYI UNUTUYOR - bkz. rglParentAwareScaledStrategy.ts (bu eksik
  // cikarmayi tamamlayan yerel bir varyant, node_modules yamalanmadan).
  const uiZoomScale = useUiScale()
  // Kullanici istegi (Ekim 2026 - mobil): dar ekranlarda react-grid-layout
  // (mutlak konumlu, sabit piksel yukseklikli) kararsiz/tasan bir gorunum
  // uretiyordu. Bu genislikte grid tamamen devre disi - kutular DOGAL
  // yukseklikte, DIKEY olarak alt alta dizilir; Tasarim Modu da anlamsiz
  // oldugu icin kapali sayilir.
  // Hata (Eylul 2026): bu esik SABIT 900 idi ama asagidaki gercek
  // <Responsive> izgarasinin KENDI ic "BREAKPOINTS.lg" esigi 1100 -
  // ikisi arasinda (900-1100px OLCULEN/zoom SONRASI genislik) bir "bosluk"
  // vardi: isNarrowViewport BURADA "genis" (false) diyip <Responsive>
  // dalina geciyordu, ama <Responsive> KENDI ICINDE bu genislikte "sm"
  // (cols=1, TEK sutun) breakpoint'ine dusuyordu - sonuc: normal masaustu
  // genisliginde bile TUM kutular tek sutunda alt alta yigiliyordu (ozellikle
  // ust katmanin zoom kucultmesiyle birlesince). Iki esik ARTIK AYNI deger
  // (BREAKPOINTS.lg) kullanir - bu bosluk tamamen ortadan kalkar.
  const isNarrowViewport = mounted && width > 0 && width < BREAKPOINTS.lg
  const pointerDownRef = useRef<{ x: number; y: number; onHandle: boolean } | null>(null)
  // Kullanici istegi: sikistirma (compaction), sadece kullanici GERCEKTEN
  // bir kutuyu tutup surukluyor/boyutlandiriyorken kapali olmali - ONCEDEN
  // "Tasarim Modu ACIK MI" (designMode) sorusuna bagliydi, bu YANLISTI:
  // "Sıfırla" da Tasarim Modu acikken calistigi icin, sifirlama sirasinda
  // henuz customize edilmemis (auto-fit) panellerin GERCEK icerige gore
  // KUCULEN yukseklikleri, sikistirma kapali oldugundan alttaki panelleri
  // yukari CEKMIYOR, kocaman bosluklar birakiyordu (canli ekran
  // goruntusuyle dogrulandi). Artik sikistirma, sadece "su an aktif bir
  // surukleme/boyutlandirma hareketi VAR MI" (isInteracting) sorusuna
  // bagli - Tasarim Modu acik ama kimse hicbir seyi tutmuyorsa (ör. sayfa
  // yeni acildi, ya da "Sıfırla" tiklandi) sikistirma NORMAL calisir ve
  // bosluklari kapatir; kullanici bir kutuyu tutar tutmaz (onDragStart/
  // onResizeStart) aninda kapanir, boylece bilerek birakilan bosluklu
  // yerlesim yine bozulmadan surdurulebilir.
  const [isInteracting, setIsInteracting] = useState(false)
  // Kullanici istegi: surukleme (drag) sirasinda hicbir kutu itilmesin,
  // ama BOYUTLANDIRMA (resize) sirasinda altindaki kutular asagi kaysin -
  // bu iki davranis FARKLI compactor gerektirdiginden, "hangi hareket
  // turu suruyor" ayri tutuluyor (bkz. asagidaki compactor secimi).
  const [interactionKind, setInteractionKind] = useState<'drag' | 'resize' | null>(null)
  // Kullanici istegi: bir kutuyu tutamacindan (surukleme cubugu) fareyle
  // GERCEKTEN tiklayarak (surukleme DEGIL) SECEBILSIN - secili kutu belirgin
  // bir cerceveyle isaretlenir ve yon tuslariyla 1 birim (Shift ile 5 birim)
  // hassas olarak tasinabilir - "hangi kutuyu nereye tasidigimi
  // bulamiyorum" sikayetine karsi, farenin aksine ASLA baska bir kutuya
  // CARPMAZ/onu itmez (bkz. moveSelectedWidget - rectsOverlap ile ayni
  // "cakisirsa hareket etme" kurali).
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null)
  const [internalDesignMode, setInternalDesignMode] = useState(false)
  // "Tasarim Modu ACIK MI" (ekran genisliginden BAGIMSIZ istek).
  const designModeRequested = externalDesignMode ?? internalDesignMode
  const designMode = designModeRequested && !isNarrowViewport
  // Dar ekranda Tasarim Modu istegi -> mobil "sira degistir + gizle/goster" modu.
  const mobileDesignActive = designModeRequested && isNarrowViewport
  const setDesignMode = (updater: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof updater === 'function' ? (updater as (prev: boolean) => boolean)(designMode) : updater
    if (onDesignModeChange) onDesignModeChange(next)
    else setInternalDesignMode(next)
  }
  const [layouts, setLayouts] = useState<Partial<Record<string, Layout>>>({
    lg: defaultLayout,
    sm: buildSingleColumnLayout(defaultLayout),
  })
  const [isLoaded, setIsLoaded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextSaveRef = useRef(true)
  // Kullanici istegi: "Varsayılan Düzene Sıfırla" bazen TEMIZ varsayilan
  // duzeni degil, her kutunun BIRBIRINDEN FARKLI/BOZUK yerlere sicradigi bir
  // sonuc veriyordu (bkz. DashboardGrid.tsx'teki AYNI/ikiz duzeltme, orada
  // detaylandirildi) - kok neden, react-grid-layout'un "layouts" prop'u
  // programatik olarak degistirildiginde (surukleme DEGIL) bile kendi ic
  // durumunu tam sifirlamamasi. Kesin cozum: sifirlamada <Responsive>'i
  // (asagida key={gridInstanceKey} ile) TAMAMEN YENIDEN MONTE ETMEK.
  const [gridInstanceKey, setGridInstanceKey] = useState(0)
  // Kullanici HENUZ elle boyutlandirmadigi/tasimadigi kutular - bunlarin
  // yuksekligi asagidaki ResizeObserver tarafindan CANLI olarak icerige
  // esitlenir (hem buyume hem kuculme). Bir widget buraya (Set) eklenince
  // o kutu icin bu tam esitleme durur - SADECE "icerik daha fazla yer
  // istiyorsa buyusun" kurali gecerli olmaya devam eder (bkz. asagidaki
  // ResizeObserver notu).
  const [customizedIds, setCustomizedIds] = useState<Set<string>>(new Set())
  // Kullanici istegi: Tasarim Modu'ndayken istedigi kutuyu gizleyip
  // istedigini gosterebilsin. Gizli kutular NORMAL goruntulemede hic
  // render edilmez (yer kaplamaz), Tasarim Modu'ndayken ise ("tekrar
  // bulup acabilsin" diye) soluk/kesikli cerceveyle ayirt edilerek
  // gosterilmeye devam eder.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const contentRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Kayitli (bu HESABA ozel, sunucudaki) duzeni yukle - eger daha once bu
  // widget id'si KAYITLI DUZENDE yoksa (ileride yeni bir panel eklenirse)
  // o widget'in varsayilan konumu korunur, kaybolmaz VE otomatik
  // yukseklik-olcumune tabi olmaya devam eder.
  useEffect(() => {
    let isCancelled = false

    fetch(`/api/dashboard-layout?grid=${encodeURIComponent(storageKey)}`)
      .then((res) => res.json())
      .then((payload) => {
        if (isCancelled) return
        // data === null: bu hesap icin sunucuda HENUZ HICBIR kayit yok
        // (ilk kez aciliyor) - defaultHiddenIds burada uygulanir. data
        // dolu (hiddenIds bos bir dizi olsa bile): kullanici DAHA ONCE
        // bilerek kaydetmis demektir - defaultHiddenIds ARTIK uygulanmaz.
        const hasSavedRecord = payload?.success && payload.data !== null
        const savedLg: Layout | undefined = hasSavedRecord ? payload.data?.layouts?.lg : undefined
        const savedHiddenIds: string[] = hasSavedRecord && Array.isArray(payload.data?.hiddenIds) ? payload.data.hiddenIds : []

        if (Array.isArray(savedLg) && savedLg.length > 0) {
          const savedIds = new Set(savedLg.map((item) => item.i))
          setCustomizedIds(savedIds)
          const missingDefaults = defaultLayout.filter((item) => !savedIds.has(item.i))
          const mergedLg = [...savedLg, ...missingDefaults]

          // Kullanici istegi (28 Agu 2026): mobil Tasarim Modu'nda SIRA + BOY
          // (h) + EN (w: 1=tam / 2=... aslinda burada 1 sutunlu grid, "en"
          // CSS col-span ile) ayarlanabilir - bu yuzden kayitli "sm"in
          // sirasi/h/w'si ARTIK KORUNUR (eskiden lg'den yeniden turetilip
          // siliniyordu, mobil duzenlemeler sayfa yenilenince kayboluyordu).
          const savedSm: Layout | undefined = hasSavedRecord ? payload.data?.layouts?.sm : undefined
          const savedSmById = new Map((Array.isArray(savedSm) ? savedSm : []).map((it) => [it.i, it]))
          const savedSmOrder = orderIdsFromLayout(savedSm).filter((id) => mergedLg.some((it) => it.i === id))
          let mergedSm: Layout
          if (savedSmOrder.length > 0) {
            for (const it of mergedLg) if (!savedSmOrder.includes(it.i)) savedSmOrder.push(it.i)
            const byId = new Map(mergedLg.map((it) => [it.i, it]))
            mergedSm = savedSmOrder.map((id, index) => {
              const base = byId.get(id)
              const s = savedSmById.get(id)
              return { i: id, x: 0, y: index, w: s?.w === 2 ? 2 : 1, h: s?.h ?? base?.h ?? 20, minW: base?.minW, minH: base?.minH }
            })
          } else {
            mergedSm = buildSingleColumnLayout(mergedLg)
          }

          skipNextSaveRef.current = true
          setLayouts({ lg: mergedLg, sm: mergedSm })
        }

        setHiddenIds(new Set(hasSavedRecord ? savedHiddenIds : (defaultHiddenIds ?? [])))
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setIsLoaded(true)
      })

    return () => {
      isCancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Kullanici HESABINA ozel duzeni sunucuya kaydeder (bkz.
  // app/api/dashboard-layout/route.ts). "layouts" verilmezse sadece
  // hiddenIds guncellenmis olur (mevcut layouts state'i taze halinden
  // gonderilir).
  const persistState = (nextLayouts: Partial<Record<string, Layout>>, nextHiddenIds: Set<string>) => {
    setSaveStatus('saving')
    fetch('/api/dashboard-layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grid: storageKey, layouts: nextLayouts, hiddenIds: Array.from(nextHiddenIds) }),
    })
      .then((res) => res.json())
      .then((payload) => {
        setSaveStatus(payload?.success ? 'saved' : 'idle')
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
        statusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
      })
      .catch(() => setSaveStatus('idle'))
  }

  const toggleHidden = (id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistState(layouts, next)
      return next
    })
  }

  // --- Mobil Tasarim Modu: sira degistirme (DashboardGrid ile ayni mantik) ---
  // Kutu SIRASI kayitli "sm" duzeninden; eksik/yeni kutular sona eklenir.
  const mobileOrderedWidgetIds = (() => {
    const ordered = orderIdsFromLayout(layouts.sm).filter((id) => widgets.some((w) => w.id === id))
    const seen = new Set(ordered)
    for (const w of widgets) if (!seen.has(w.id)) ordered.push(w.id)
    return ordered
  })()

  // Verilen id sirasina gore gecerli bir "sm" duzeni uretir - kullanicinin
  // mobilde ayarladigi BOY (h) ve EN (w: 2=yarim / 1=tam) KORUNUR, sadece
  // y sirasi degisir.
  const buildMobileSm = (orderedIds: string[]): Layout => {
    const source = (layouts.lg && layouts.lg.length ? layouts.lg : defaultLayout)
    const byId = new Map(source.map((item) => [item.i, item]))
    const curById = new Map((Array.isArray(layouts.sm) ? layouts.sm : []).map((item) => [item.i, item]))
    return orderedIds.map((wid, index) => {
      const base = byId.get(wid)
      const cur = curById.get(wid)
      return { i: wid, x: 0, y: index, w: cur?.w === 2 ? 2 : 1, h: cur?.h ?? base?.h ?? 20, minW: base?.minW, minH: base?.minH }
    })
  }

  const moveMobileWidget = (id: string, dir: -1 | 1) => {
    const ids = mobileOrderedWidgetIds.slice()
    const index = ids.indexOf(id)
    const target = index + dir
    if (index < 0 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const nextLayouts = { ...layouts, sm: buildMobileSm(ids) }
    setLayouts(nextLayouts)
    persistState(nextLayouts, hiddenIds)
  }

  // Mobil BOY: sm.h (1 birim = ROW_HEIGHT+ROW_MARGIN = 6px) degistir.
  const MOBILE_H_UNIT_PX = ROW_HEIGHT + ROW_MARGIN
  const MOBILE_H_STEP = 10
  const MOBILE_H_MIN = 20
  const MOBILE_H_MAX = 260
  const mobileSmById = new Map((Array.isArray(layouts.sm) ? layouts.sm : []).map((item) => [item.i, item]))
  const resizeMobileWidgetHeight = (id: string, deltaUnits: number) => {
    const currentSm = Array.isArray(layouts.sm) && layouts.sm.length ? layouts.sm : buildMobileSm(mobileOrderedWidgetIds)
    const nextSm = currentSm.map((item) => item.i === id
      ? { ...item, h: Math.max(MOBILE_H_MIN, Math.min(MOBILE_H_MAX, (item.h ?? 40) + deltaUnits)) }
      : item)
    const nextLayouts = { ...layouts, sm: nextSm }
    setLayouts(nextLayouts)
    persistState(nextLayouts, hiddenIds)
  }
  // Mobil EN: w=1 (tam / col-span-2) <-> w=2 (yarim / col-span-1).
  const resizeMobileWidgetWidth = (id: string, dir: -1 | 1) => {
    const currentSm = Array.isArray(layouts.sm) && layouts.sm.length ? layouts.sm : buildMobileSm(mobileOrderedWidgetIds)
    const nextSm = currentSm.map((item) => {
      if (item.i !== id) return item
      // dir=-1 -> yarim (w:2), dir=+1 -> tam (w:1)
      return { ...item, w: dir === -1 ? 2 : 1 }
    })
    const nextLayouts = { ...layouts, sm: nextSm }
    setLayouts(nextLayouts)
    persistState(nextLayouts, hiddenIds)
  }

  const resetMobileOrder = () => {
    const baseLg = layouts.lg && layouts.lg.length ? layouts.lg : defaultLayout
    const nextLayouts = { ...layouts, sm: buildSingleColumnLayout(baseLg) }
    setLayouts(nextLayouts)
    persistState(nextLayouts, hiddenIds)
  }

  useImperativeHandle(ref, () => ({ toggleWidget: toggleHidden }))

  // Kullanici istegi: "alan altinda/kenarinda bosluk olmasin, verinin
  // bittigi yerde alan bitsin" (customize edilmemis kutular) + "veri
  // arttikca customize edilmis kutular da genislesin" (bkz. dosya basindaki
  // uzun not). Bu yuzden ARTIK TUM kutularin icerik sarmalayicisi izlenir:
  // - customize EDILMEMIS bir kutu icin olculen yukseklik NE OLURSA OLSUN
  //   (buyusun/kuculsun) dogrudan uygulanir (eskisi gibi).
  // - customize EDILMIS bir kutu icin olculen yukseklik SADECE mevcut
  //   (kullanicinin sectigi) yukseklikten BUYUKSE uygulanir - kullanicinin
  //   sectigi boyut asla KUCULTULMEZ, sadece gerekirse BUYUTULUR.
  //
  // Kullanici istegi/hata raporu (fixedHeightIds icin AYRI kural): "sayı
  // çoğaltıkça alan büyüyor sorun yok ama sayı azaltıkça alan 5 cm'ye
  // kadar küçülsün" - kok neden: fixedHeightIds kutulari da yukaridaki
  // "customizedIds" ile AYNI kurala (mevcut h'den KUCULMEZ) tabiydi - bu
  // TABAN, kutunun O ANKI (bir ONCEKI dosyada belki cok daha fazla satir
  // oldugu icin BUYUMUS olabilecek) yuksekligiydi, boylece az kayitli bir
  // dosyaya gecilince kutu KUCULMUYOR, altinda BOS ALAN kaliyordu (ekran
  // goruntusuyle dogrulandi). fixedHeightIds icin TABAN artik HER ZAMAN o
  // kutunun kendi VARSAYILAN (defaultLayout'taki, ör. "5cm") yuksekligi -
  // kutu bu TABANIN altina asla inmez, ama gerektiginde bu tabana kadar
  // (ve icerik fazlaysa daha da fazla) hem BUYUYEBILIR hem KUCULEBILIR.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      setLayouts((prev) => {
        const lg = prev.lg
        if (!lg) return prev
        let changed = false
        const nextLg = lg.map((item) => {
          // "manualOnlyIds" - bu kutunun yuksekligi ICERIK OLCUMUNDEN
          // TAMAMEN MUAF: ne buyur ne kucultulur, SADECE gercek bir
          // surukleme/boyutlandirma (ya da sifirlama) degistirir.
          if (manualOnlyIdSet.has(item.i)) return item
          const el = contentRefs.current.get(item.i)
          if (!el) return item
          const measuredHeightPx = el.getBoundingClientRect().height
          if (measuredHeightPx <= 0) return item
          const neededH = Math.max(4, Math.ceil((measuredHeightPx + ROW_MARGIN) / (ROW_HEIGHT + ROW_MARGIN)))

          if (fixedHeightIdSet.has(item.i)) {
            // Kullanici GERCEKTEN elle bu kutuyu boyutlandirdiysa (bkz.
            // commitCurrentLayout), o secim varsayilan tabanin YERINE
            // gecer - boylece manuel bir surukleme, hemen ardindan (baska
            // bir kutunun reflow'u yuzunden) geri ALINMAZ.
            const manualH = manualFixedHeightsRef.current.get(item.i)
            const baselineH = manualH ?? defaultHeightByIdRef.current.get(item.i) ?? item.h
            const targetH = Math.max(baselineH, neededH)
            if (targetH !== item.h) {
              changed = true
              return { ...item, h: targetH }
            }
            return item
          }

          if (customizedIds.has(item.i)) {
            if (neededH > item.h) {
              changed = true
              return { ...item, h: neededH }
            }
            return item
          }

          if (neededH !== item.h) {
            changed = true
            return { ...item, h: neededH }
          }
          return item
        })
        if (!changed) return prev

        // Kullanici istegi/hata raporu: "birey sayısı az ise bu alan 5 cm
        // olsun ve tüm alanları yukarı kaydırsın... sayı çok ise alan
        // genişlesin ve diğer alanları aşağı kaydırsın" - bkz. yukaridaki
        // restackSequentialGroups yorumu: buyume/kuculme sonrasi stackedGroups
        // ile tanimlanmis diziler (ör. Hane Bilgileri -> Müracaatlar ->
        // Yardımlar -> Raporlar ve Tahkikatlar) HER ZAMAN bosluksuz/bitisik
        // hale getirilir - bir kutu buyurse altindakiler asagi kayar,
        // kuculurse altindakiler yukari cekilir.
        const finalLg = restackSequentialGroups(nextLg, stackedGroupsRef.current)
        return { ...prev, lg: finalLg, sm: buildSingleColumnLayout(finalLg) }
      })
    })

    contentRefs.current.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
    // hiddenIds: bir alan tekrar GOSTERILDIGINDE (yeniden DOM'a eklendiginde)
    // yeni elemanin da izlenmeye baslamasi icin gozlemci yeniden kurulmali -
    // aksi halde yeniden gosterilen kutu, baska bir sey degisene kadar
    // otomatik icerik-boyutu olcumune tabi olmazdi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizedIds, widgets, layouts.lg, fixedHeightIds, manualOnlyIds, hiddenIds])

  useEffect(() => {
    if (!designMode) return
    const container = containerRef.current
    if (!container) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      pointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
        onHandle: Boolean(target?.closest(DRAG_HANDLE_SELECTOR)),
      }
    }

    const handleClickCapture = (event: MouseEvent) => {
      const start = pointerDownRef.current
      pointerDownRef.current = null
      if (!start) return

      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      const wasDrag = distance > DRAG_CLICK_SUPPRESS_DISTANCE

      if (!start.onHandle) {
        // Tutamacin DISINDA bir yere tiklandi - varsa secim kaldirilir.
        setSelectedWidgetId(null)
        return
      }

      if (wasDrag) {
        // Gercek bir surukleme oldu, tutamacin kendi "tiklama" davranisini
        // (ör. baska bir sayfaya gitme) tetiklemesin.
        event.preventDefault()
        event.stopPropagation()
        return
      }

      // Tutamaca GERCEK bir tiklama (surukleme degil) - o kutuyu SEC, boylece
      // yon tuslariyla hassas tasinabilsin.
      const target = event.target as HTMLElement | null
      const widgetId = target?.closest<HTMLElement>('[data-widget-id]')?.dataset.widgetId
      setSelectedWidgetId(widgetId ?? null)
    }

    container.addEventListener('mousedown', handlePointerDown, true)
    container.addEventListener('click', handleClickCapture, true)
    return () => {
      container.removeEventListener('mousedown', handlePointerDown, true)
      container.removeEventListener('click', handleClickCapture, true)
    }
  }, [containerRef, designMode])

  const handleLayoutChange = (_current: Layout, allLayouts: Partial<Record<string, Layout>>) => {
    if (!designMode) {
      // Tasarim modu kapaliyken surukleme/boyutlandirma zaten devre disi -
      // bu, sadece ilk yerlesim/sikistirma hesaplamasi olabilir, kullanici
      // degisikligi DEGILDIR - sunucuya YAZILMAZ.
      setLayouts(allLayouts)
      return
    }

    if (skipNextSaveRef.current) {
      // Sayfa ilk yuklenirken / kayitli duzen uygulanirken tetiklenen ilk
      // onLayoutChange, kullanicinin YAPTIGI bir degisiklik degildir.
      skipNextSaveRef.current = false
      setLayouts(allLayouts)
      return
    }

    setLayouts(allLayouts)

    // ONEMLI DUZELTME (kok neden bulundu): react-grid-layout "onLayoutChange"
    // callback'i SADECE kullanicinin GERCEK bir surukleme/boyutlandirma
    // hareketinden DEGIL, TAMAMEN PROGRAMATIK nedenlerden de (ör. bizim
    // ResizeObserver'imizin otomatik yukseklik guncellemesi, kutuphanenin
    // KENDI ic sikistirma/senkronizasyon geri bildirimi) tetiklenebiliyor.
    // Onceden BURADA (hangi sebepten geldigine bakmadan) "artik TUM panel
    // seti kullanici kontrolunde" denip customizedIds TUMU ile
    // dolduruluyordu - bu YANLISTI: "Sıfırla" sonrasi kullanici HENUZ
    // hicbir seye dokunmadan (sadece ResizeObserver icerige gore yukseklik
    // ayarlarken) bu callback tetikleniyor, TUM kutular sessizce "customize
    // edildi" sayiliyor, boylece otomatik sikistirma (verticalCompactor)
    // KALICI OLARAK devre disi kaliyor (compactor customizedIds.size>0 iken
    // noCollisionCompactor'a geciyor) - bu da "Muracaatlar, Hane
    // Bilgileri'nin UZERINE biniyor" sikayetinin GERCEK kok nedeniydi
    // (react-grid-layout kaynagi incelenerek dogrulandi). Cozum: SADECE
    // GERCEK bir surukleme/boyutlandirma hareketi SUREGELIYORKEN
    // (isInteracting - onDragStart/onResizeStart ile baslar,
    // onDragStop/onResizeStop ile biter) bu degisiklik "kullanici yapti"
    // sayilir; jest bitince zaten commitCurrentLayout NIHAI/KESIN olarak
    // ayni isi bir kez daha yapar (bkz. asagisi) - programatik/otomatik
    // kaynakli cagrilar artik SADECE goruntuyu (layouts state) gunceller,
    // customizedIds'e veya kayda DOKUNMAZ.
    if (!isInteracting) return

    const lg = allLayouts.lg
    if (lg) {
      setCustomizedIds(new Set(widgets.map((widget) => widget.id)))
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => persistState({ lg, sm: allLayouts.sm }, hiddenIds), 600)
    }
  }

  // Kullanici bir kutuyu tutup surukleme/boyutlandirmaya BASLADIGI an
  // (fare hareket etmeye baslamadan, ilk temas anda) tetiklenir - sikistirma
  // (compactor prop'u, asagida) buradan itibaren kapanir, jest bitene kadar
  // (commitCurrentLayout) boylece kalir.
  const handleDragStart = () => {
    setIsInteracting(true)
    setInteractionKind('drag')
  }
  const handleResizeStart = () => {
    setIsInteracting(true)
    setInteractionKind('resize')
  }

  // Kullanici istegi/hata raporu: "hala aynı, üstündeki müracaatlar
  // alanında neden olmuyor" - DB'de dogrudan incelenince, Yardımlar'in
  // kayitli yuksekliginin (kullanici HICBIR SEY yapmadan, sadece sayfayi
  // izlerken) zamanla KENDILIGINDEN artmaya devam ettigi goruldu. Olasi kok
  // neden: eger bir surukleme/boyutlandirma jesti, fare pencere DISINDA
  // birakilmasi/sekme degistirilmesi gibi NADIR bir durumda
  // onDragStop/onResizeStop'u HIC tetiklemeden yarim kalirsa, isInteracting
  // SONSUZA KADAR "true" TAKILI KALIR - bu da o andan itibaren SADECE
  // ICERIK olcumunden kaynaklanan (kullanicinin YAPMADIGI) HER otomatik
  // yukseklik guncellemesinin de "gercek kullanici degisikligi" sanilip
  // SUNUCUYA KAYDEDILMESINE yol acar (buyume kucuk de olsa HER seferinde
  // kalici hale gelip zamanla birikir). Bu guvenlik agi, boyle bir jest
  // YARIM kalirsa (fare/dokunma herhangi bir yerde birakilinca ya da
  // sekme/pencere odaktan cikinca) interaksiyonu HER ZAMAN duzgunce
  // sonlandirir - RGL'in kendi onDragStop/onResizeStop'u zaten NORMAL
  // calisiyorsa bu sadece ZARARSIZ bir tekrar olur.
  useEffect(() => {
    if (!isInteracting) return

    const endInteraction = () => commitCurrentLayout()
    window.addEventListener('mouseup', endInteraction, true)
    window.addEventListener('touchend', endInteraction, true)
    window.addEventListener('blur', endInteraction)

    return () => {
      window.removeEventListener('mouseup', endInteraction, true)
      window.removeEventListener('touchend', endInteraction, true)
      window.removeEventListener('blur', endInteraction)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInteracting])

  // Kullanici istegi: bir kutuyu boyutlandirip sayfayi yeniledigimde eski
  // haline donuyordu - "onLayoutChange" surukleme/boyutlandirma SIRASINDA
  // (fare hareket ettikce) COK KEZ tetiklenebiliyor; guvenlik icin, jest
  // TAMAMEN BITTIGINDE (fare birakildiginda) da AYRICA, o anki KESIN/NIHAI
  // durumu garantiye alarak kaydediyoruz - boylece ara adimlardan herhangi
  // birinin atlanmasi/yarisa girmesi ihtimaline karsi ekstra bir guvence var.
  const commitCurrentLayout = () => {
    // Kullanici istegi/hata raporu (tekrar): "boyutunu degistiriyorum,
    // yenileyince eski haline donuyor". Kok neden: bu jest BITERKEN
    // "designMode" (artik ust menude, global context'ten geliyor) bir an
    // icin "false" olabiliyor (sayfanin gecici yeniden-montaji / context
    // guncellemesi yarisi) - o an bu fonksiyon "if (!designMode) return"
    // ile KAYIT YAPMADAN cikiyordu. Gercek bir surukleme/boyutlandirma
    // jesti (interactionKind dolu) SADECE tasarim modu ACIKKEN
    // baslayabildigi icin, jest bittiginde tasarim modu gorunurde kapali
    // olsa bile SONUCU KAYDEDERIZ.
    const hadGesture = interactionKind !== null
    // Kullanici istegi/hata raporu: "işaretli alanların boyutlarını
    // tasarım modunda değiştiremiyorum" - GERCEK bir boyutlandirma
    // (kosesinden surukleme, "resize") hareketi BURADA BITTIGINDE,
    // fixedHeightIds kutulari icin bu YENI yukseklik "manuel taban"
    // olarak hatirlanir - boylece bundan sonraki ResizeObserver
    // tetiklenmeleri bu secimi GERI ALMAZ (bkz. manualFixedHeightsRef,
    // yukaridaki ResizeObserver notu). Sadece TASIMA (drag) icin
    // BUNU YAPMAYIZ - konum degisir, yukseklik degismez.
    if (interactionKind === 'resize') {
      setLayouts((current) => {
        current.lg?.forEach((item) => {
          if (fixedHeightIdSet.has(item.i)) manualFixedHeightsRef.current.set(item.i, item.h)
        })
        return current
      })
    }
    setIsInteracting(false)
    setInteractionKind(null)
    if (!designMode && !hadGesture) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setLayouts((current) => {
      const lg = current.lg
      if (lg && lg.length > 0) {
        setCustomizedIds(new Set(widgets.map((widget) => widget.id)))
        persistState(current, hiddenIds)
      }
      return current
    })
  }

  // Kullanici istegi: secili kutuyu yon tuslariyla (Shift ile 5'er birim,
  // normalde 1'er birim) hassas tasima - fareyle suruklemenin aksine ASLA
  // baska bir kutuya CARPMAZ: hedef konumda BASKA bir kutuyla cakisma
  // varsa (rectsOverlap) hareket sessizce YOKSAYILIR (kutu oldugu yerde
  // kalir), boylece "hangi kutuyu nereye tasidigimi bulamiyorum"
  // sikayetine yol acan zincirleme itme hic yasanmaz.
  const moveSelectedWidget = (dx: number, dy: number) => {
    if (!selectedWidgetId) return
    setLayouts((prev) => {
      const lg = prev.lg
      if (!lg) return prev
      const current = lg.find((item) => item.i === selectedWidgetId)
      if (!current) return prev

      const nextX = Math.min(Math.max(0, current.x + dx), Math.max(0, COLS.lg - current.w))
      const nextY = Math.max(0, current.y + dy)
      if (nextX === current.x && nextY === current.y) return prev

      const candidate = { ...current, x: nextX, y: nextY }
      const collides = lg.some((item) => item.i !== selectedWidgetId && rectsOverlap(candidate, item))
      if (collides) return prev

      const nextLg = lg.map((item) => (item.i === selectedWidgetId ? candidate : item))
      const nextLayouts = { lg: nextLg, sm: buildSingleColumnLayout(nextLg) }

      setCustomizedIds(new Set(widgets.map((widget) => widget.id)))
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => persistState(nextLayouts, hiddenIds), 600)

      return nextLayouts
    })
  }

  // Kullanici istegi (2026-09-11): secili kutuyu Ctrl+yon tuslariyla
  // (Shift ile 5'er birim, normalde 1'er birim) hassas BOYUTLANDIRMA -
  // moveSelectedWidget ile AYNI "cakisirsa uygulanmaz" kurali (rectsOverlap):
  // fareyle boyutlandirmanin aksine ASLA baska bir kutuya CARPMAZ/onu itmez.
  // Sol/yukari ok genisligi/yuksekligi AZALTIR, sag/asagi ok ARTIRIR.
  const resizeSelectedWidget = (dw: number, dh: number) => {
    if (!selectedWidgetId) return
    setLayouts((prev) => {
      const lg = prev.lg
      if (!lg) return prev
      const current = lg.find((item) => item.i === selectedWidgetId)
      if (!current) return prev

      const minW = current.minW ?? 1
      const minH = current.minH ?? 1
      const maxW = Math.max(minW, COLS.lg - current.x)
      const nextW = Math.min(Math.max(minW, current.w + dw), maxW)
      const nextH = Math.max(minH, current.h + dh)
      if (nextW === current.w && nextH === current.h) return prev

      const candidate = { ...current, w: nextW, h: nextH }
      const collides = lg.some((item) => item.i !== selectedWidgetId && rectsOverlap(candidate, item))
      if (collides) return prev

      const nextLg = lg.map((item) => (item.i === selectedWidgetId ? candidate : item))
      const nextLayouts = { lg: nextLg, sm: buildSingleColumnLayout(nextLg) }

      setCustomizedIds(new Set(widgets.map((widget) => widget.id)))
      // Bu kutu fixedHeightIds ise, klavyeyle yapilan bu GERCEK boyutlandirma
      // da (fareyle yapilan commitCurrentLayout ile AYNI mantikla) yeni
      // "manuel taban" olarak hatirlanir - sonraki ResizeObserver
      // tetiklenmeleri bu secimi geri almasin diye.
      if (fixedHeightIdSet.has(selectedWidgetId)) manualFixedHeightsRef.current.set(selectedWidgetId, nextH)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => persistState(nextLayouts, hiddenIds), 600)

      return nextLayouts
    })
  }

  useEffect(() => {
    if (!designMode || !selectedWidgetId) return

    const ARROW_DELTAS: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const delta = ARROW_DELTAS[event.key]
      if (!delta) return

      // Bir yazi alaninda (ör. Notlar kutusundaki bir metin girisi) yon
      // tuslarina MUDAHALE ETME - sadece secili bir PANEL varken ve odak
      // bir form elemaninda DEGILKEN yon tuslari tasima olarak yorumlanir.
      const activeTag = (document.activeElement?.tagName || '').toLowerCase()
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return

      event.preventDefault()
      const step = event.shiftKey ? 5 : 1
      // Kullanici istegi (2026-09-11): "tasarim modunda alanların yerlerini
      // değiştirmekte zorlanıyorum ... yön tuşları ile yer değiştireyim ve
      // ctrl+yön tuşları ile boyutunu ayarlayalım" - tasima zaten yon
      // tuslariyla vardi (moveSelectedWidget), Ctrl (Mac'te Cmd de kabul
      // edilir) BASILIYKEN ayni tuslar artik BOYUTLANDIRMA yapar - fare ile
      // kosesinden tutup surukleme zorlugu olmadan da secili kutu klavyeyle
      // buyutulup kucultulebilsin diye.
      if (event.ctrlKey || event.metaKey) {
        resizeSelectedWidget(delta[0] * step, delta[1] * step)
      } else {
        moveSelectedWidget(delta[0] * step, delta[1] * step)
      }
    }

    const handleKeyDownEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedWidgetId(null)
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('keydown', handleKeyDownEscape)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('keydown', handleKeyDownEscape)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMode, selectedWidgetId, layouts.lg, hiddenIds])

  // Tasarim Modu kapatilinca (ör. disaridan ortak dugmeyle) secim de
  // anlamsizlasir - temizlenir.
  useEffect(() => {
    if (!designMode) setSelectedWidgetId(null)
  }, [designMode])

  // Kullanici istegi (Eylul 2026): "Tasarim Modu'nda yaptigim TUM
  // degisiklikleri, Tasarim Modu'ndan CIKINCA kaydetsin". Degisiklikler
  // zaten jest bitince (commitCurrentLayout) ve 600ms geciken timer ile
  // yaziliyor - ama kullanici son hareketten hemen sonra (600ms dolmadan)
  // moddan cikarsa bekleyen kayit kaybolabilirdi. Bu efekt, Tasarim Modu
  // ACIK -> KAPALI gecisinde bekleyen kaydi ANINDA flush eder ve
  // (ozellestirme varsa) son durumu KESIN olarak bir kez daha yazar.
  const prevDesignModeRef = useRef(designMode)
  useEffect(() => {
    const wasOn = prevDesignModeRef.current
    prevDesignModeRef.current = designMode
    if (wasOn && !designMode) {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      if (customizedIds.size > 0) {
        persistState({ lg: layouts.lg, sm: layouts.sm }, hiddenIds)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designMode, customizedIds, layouts, hiddenIds])

  const resetToDefault = () => {
    setSelectedWidgetId(null)
    // Kullanici istegi/hata raporu: "hala aynı boyutta duruyor bir
    // değişiklik yok" - kok neden: bir fixedHeightIds kutusu (ör.
    // Yardımlar) daha ONCE (BU DOSYA acikken) GERCEKTEN elle
    // boyutlandirilmissa (bkz. commitCurrentLayout), bu "manuel taban"
    // olarak SAPLANIP KALIYORDU - sadece FARKLI bir dosya acilinca
    // (resetManualHeightsKey degisince) temizleniyordu, "Varsayılan
    // Düzene Sıfırla" ise bunu HIC TEMIZLEMIYORDU. Artik sifirlama da bu
    // manuel tabanlari temizler.
    manualFixedHeightsRef.current = new Map()
    const next = { lg: defaultLayout, sm: buildSingleColumnLayout(defaultLayout) }
    // skipNextSaveRef=true: <Responsive> yeniden monte olurken ilk kez
    // ateslenecek onLayoutChange, sayfa ilk yuklenirkenkiyle AYNI mantikla,
    // kullanici degisikligi SAYILMAZ - customizedIds'i tekrar doldurup
    // sunucuya yazmaya calismaz (zaten hemen asagida biz customizedIds'i
    // ve kaydi acikca temizliyoruz).
    skipNextSaveRef.current = true
    setLayouts(next)
    setCustomizedIds(new Set())
    setHiddenIds(new Set())
    // NOT: defaultLayout icin lg:[] gonderilir (varsayilan DEGIL, BOS) -
    // aksi halde bir sonraki acilista bu id'ler "kullanici tarafindan
    // customize edilmis" sanilir ve otomatik icerik-boyutu olcumu bir
    // daha calismaz (bkz. yukaridaki mount effect - savedLg.length===0
    // "hic kayit yok" ile ayni sekilde ele alinir).
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    persistState({ lg: [], sm: [] }, new Set())
    setGridInstanceKey((prev) => prev + 1)
  }

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  // showInfoBar=false: bilgi cubugu KAPALI iken hic gosterilmez; ACIK iken
  // sadece ipucu + Sıfırla + kayit durumu gosterilir (ac/kapa dugmesi ust
  // menude - bkz. header.tsx / DesignModeContext).
  // Mobil tasarim modunda kendi (amber) bilgi cubugu izgaranin icinde
  // gosterildigi icin ustteki masaustu cubugu gizlenir.
  const infoBarVisible = (showInfoBar || designMode) && !mobileDesignActive

  return (
    <div className="print:contents">
      {infoBarVisible && (
      <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] font-bold shadow-sm print:hidden ${designMode ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-500'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <ActionIconInline name={designMode ? 'unlock' : 'lock'} />
          <span className="truncate">
            {designMode
              ? `${title || 'Panel'} düzenini değiştiriyorsunuz - kutuların başlığından tutup sürükleyin, sağ-alt köşeden boyutlandırın. Başlığa tıklayıp seçtiğiniz kutuyu yön tuşlarıyla (Shift ile daha hızlı) taşıyabilir, Ctrl+yön tuşlarıyla boyutlandırabilirsiniz. Bu düzen hesabınıza kaydedilir.`
              : `${title || 'Panel'} düzeni kilitli. Yerleşimi değiştirmek için "Tasarım Modu"nu açın.`}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className={`transition-opacity ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
            {saveStatus === 'saving' ? 'Düzen kaydediliyor...' : 'Düzen kaydedildi ✓'}
          </span>
          {designMode && extraDesignControls}
          {designMode && (
            <button
              type="button"
              onClick={resetToDefault}
              disabled={!isLoaded}
              title="Kutuların boyut/konumunu varsayılana (içeriğe göre otomatik) döndürür"
              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-black text-amber-700 shadow-sm hover:bg-amber-100 disabled:opacity-50"
            >
              Varsayılan Düzene Sıfırla
            </button>
          )}
          {showToggleButton && (
            <button
              type="button"
              onClick={() => setDesignMode((prev) => !prev)}
              className={`rounded-lg border px-3 py-1 font-black uppercase tracking-wide shadow-sm transition-colors ${
                designMode
                  ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {designMode ? 'Tasarım Modunu Kapat' : 'Tasarım Modu'}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Kullanici istegi: gizlenen bir alan Tasarim Modu'ndayken ARTIK
          ekranda (soluk/kesikli cerceveyle de olsa) KALMASIN - tasarim
          yapmayi zorlastiriyordu. Gizli alanlar izgaradan tamamen
          kaldirilir (asagidaki widgets filtresi), bunun yerine BURADA -
          ust tasarim banketinde - basliklariyla listelenir, istenirse
          tek tikla tekrar eklenebilir/gosterilebilir. */}
      {designMode && hiddenIds.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 shadow-sm print:hidden">
          <span className="shrink-0">Gizli alanlar:</span>
          {widgets
            .filter((widget) => hiddenIds.has(widget.id))
            .map((widget) => (
              <button
                key={widget.id}
                type="button"
                onClick={() => toggleHidden(widget.id)}
                title={`"${widget.title}" alanını tekrar göster`}
                className="rounded border border-amber-300 bg-white px-2 py-0.5 font-black text-amber-700 shadow-sm hover:bg-amber-100"
              >
                + {widget.title}
              </button>
            ))}
        </div>
      )}

      <div ref={containerRef}>
        {isNarrowViewport ? (
          // Mobil / dar ekran: serbest izgara/surukleme YOK - ama Tasarim
          // Modu acikken kullanici SIRAYI degistirebilir ve alanlari
          // gizleyip gosterebilir (DashboardGrid'deki mobil mod ile ayni).
          <div className="grid grid-cols-2 items-start gap-2">
            {mobileDesignActive && (
              <div className="col-span-2 mb-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-800 shadow-sm print:hidden">
                <span className="min-w-0 flex-1 truncate">Sıra ▲▼ · Boy − + · En ◄ ► · Gizle. Bu düzen hesabınıza kaydedilir.</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`transition-opacity ${saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}`}>
                    {saveStatus === 'saving' ? 'Kaydediliyor...' : 'Kaydedildi ✓'}
                  </span>
                  <button
                    type="button"
                    onClick={resetMobileOrder}
                    disabled={!isLoaded}
                    className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-black text-amber-700 shadow-sm hover:bg-amber-100 disabled:opacity-50"
                  >
                    Sıfırla
                  </button>
                </div>
              </div>
            )}
            {(mobileDesignActive
              ? mobileOrderedWidgetIds
              : mobileOrderedWidgetIds.filter((id) => !hiddenIds.has(id))
            ).map((id, index, arr) => {
              const widget = widgets.find((w) => w.id === id)
              if (!widget) return null
              const isHidden = hiddenIds.has(id)
              const smItem = mobileSmById.get(id)
              const half = !mobileDesignActive && smItem?.w === 2
              // BOY sadece kullanici ELLE degistirdiyse (lg tabanindan farkli
              // ise) uygulanir - aksi halde panel DOGAL yuksekliginde akar
              // (bu panellerin bazilari icerik-yogun, zorla sabit yukseklik
              // vermek istemiyoruz).
              const lgBaseH = (Array.isArray(layouts.lg) ? layouts.lg : defaultLayout).find((l) => l.i === id)?.h
              const heightCustomized = typeof smItem?.h === 'number' && smItem.h !== lgBaseH
              const hUnits = heightCustomized ? Math.max(MOBILE_H_MIN, Math.min(MOBILE_H_MAX, smItem!.h as number)) : undefined
              const explicitHeightPx = typeof hUnits === 'number' ? Math.round(hUnits * MOBILE_H_UNIT_PX) : undefined
              const mBtn = 'rounded border border-amber-300 bg-white px-1.5 py-0.5 text-[12px] font-black leading-none text-amber-700 disabled:opacity-40'
              // Kullanici istegi (29 Agu 2026): mobilde "Dosya Arama" alani
              // gorunmuyordu - kok neden: sarmalayici "flex flex-col
              // overflow-hidden" idi ve icteki panel "h-full" oldugundan,
              // acik yukseklik VERILMEMIS kutularda flex-item 0'a cokuyor,
              // "overflow-hidden" da kirpiyordu. Artik SADECE kullanici
              // BOY ayarladiginda (explicitHeightPx) flex/overflow yapisi
              // kurulur; aksi halde DUZ blok - panel dogal yuksekliginde akar.
              const fixedH = typeof explicitHeightPx === 'number'
              return (
                <div
                  key={id}
                  className={`${half ? 'col-span-1' : 'col-span-2'} w-full min-w-0 rounded-xl ${fixedH ? 'flex flex-col overflow-hidden' : ''} ${
                    mobileDesignActive
                      ? isHidden
                        ? 'opacity-50 ring-2 ring-dashed ring-slate-300'
                        : 'ring-2 ring-amber-300'
                      : ''
                  }`}
                >
                  {mobileDesignActive && (
                    <div className="flex flex-col gap-1 border-b border-amber-200 bg-amber-50 px-2 py-1.5">
                      <span className="min-w-0 truncate text-[11px] font-black text-amber-800">{widget.title}</span>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="flex items-center gap-1">
                          <span className="text-[9px] font-black uppercase text-amber-600">Sıra</span>
                          <button type="button" onClick={() => moveMobileWidget(id, -1)} disabled={index === 0} className={mBtn}>▲</button>
                          <button type="button" onClick={() => moveMobileWidget(id, 1)} disabled={index === arr.length - 1} className={mBtn}>▼</button>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-[9px] font-black uppercase text-amber-600">Boy</span>
                          <button type="button" onClick={() => resizeMobileWidgetHeight(id, -MOBILE_H_STEP)} title="Kısalt" className={mBtn}>−</button>
                          <button type="button" onClick={() => resizeMobileWidgetHeight(id, MOBILE_H_STEP)} title="Uzat" className={mBtn}>+</button>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="text-[9px] font-black uppercase text-amber-600">En</span>
                          <button type="button" onClick={() => resizeMobileWidgetWidth(id, -1)} disabled={smItem?.w === 2} title="Yarım genişlik" className={mBtn}>◄</button>
                          <button type="button" onClick={() => resizeMobileWidgetWidth(id, 1)} disabled={smItem?.w !== 2} title="Tam genişlik" className={mBtn}>►</button>
                        </span>
                        <button type="button" onClick={() => toggleHidden(id)}
                          className={`rounded border px-2 py-0.5 text-[10px] font-black uppercase leading-none ${isHidden ? 'border-slate-300 bg-white text-slate-600' : 'border-amber-400 bg-amber-500 text-white'}`}>
                          {isHidden ? 'Göster' : 'Gizle'}
                        </button>
                      </div>
                    </div>
                  )}
                  <div
                    className={fixedH ? 'min-h-0 w-full flex-1 overflow-hidden' : 'w-full'}
                    style={fixedH ? { height: `${explicitHeightPx}px` } : undefined}
                  >
                    {widget.node}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (<>
        {mounted && !isLoaded && (
          // Kullanici istegi: sekme kapatilip yeniden acildiginda / Ana
          // Sayfa'ya gecip geri donuldugunde tasarim "bozuluyordu" - kok
          // neden, bu bilesenin kayitli duzeni HENUZ OKUNMADAN kutulari
          // hemen (yanlis/varsayilan siniflandirmayla) cizmesiydi. Artik
          // kayitli duzen (ve hangi kutularin customize edildigi) TAM
          // olarak okunup state'e yansiyana kadar grid HIC cizilmiyor.
          <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white p-10 text-xs font-bold text-slate-400">
            Düzen yükleniyor...
          </div>
        )}
        {mounted && isLoaded && (
          <Responsive
            key={gridInstanceKey}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            width={width}
            margin={[ROW_MARGIN, ROW_MARGIN]}
            containerPadding={[0, 0]}
            rowHeight={ROW_HEIGHT}
            positionStrategy={uiZoomScale !== 1 ? createParentAwareScaledStrategy(uiZoomScale, containerRef) : undefined}
            // Kullanici istegi: Notlar/Kurum Ici Mesaj gibi kutulari
            // istedigi (ustunde bosluk birakarak) bir yere tasiyamiyordu -
            // kutu birakilir birakilmaz react-grid-layout'un VARSAYILAN
            // "vertical" sikistirma davranisi onu hemen yukari (ustundeki
            // ilk bos olmayan noktaya) itiyordu. Sikistirma sadece "su an
            // GERCEKTEN bir surukleme/boyutlandirma hareketi VAR MI"
            // (isInteracting) sorusuna bagli - boylece Tasarim Modu acik
            // ama kimse hicbir seyi TUTMUYORSA (sayfa yeni acildi,
            // sifirlandi, ya da bir onceki surukleme bitti) sikistirma
            // NORMAL calisip bosluklari kapatir; kullanici bir kutuyu
            // tutar tutmaz aninda kapanir, boylece bilerek birakilan
            // bosluklu yerlesim bozulmadan surdurulebilir.
            //
            // Kullanici istegi (2. tur): SURUKLEME sirasinda hicbir kutu
            // itilmesin (noCollisionCompactor - eskisi gibi), ama
            // BOYUTLANDIRMA sirasinda (ör. Hane Bilgileri'ni asagi dogru
            // uzatmak) ALTINDAKI kutular asagi kaysin - bkz. dosya basindaki
            // "se tutamaci moveElement'i hic cagirmiyor" notu: bunun icin
            // GERCEK sikistirma yapan verticalCompactor gerekiyor.
            compactor={
              interactionKind === 'drag'
                ? noCollisionCompactor
                : interactionKind === 'resize'
                  ? verticalCompactor
                  : customizedIds.size > 0
                    ? noCollisionCompactor
                    : verticalCompactor
            }
            dragConfig={{ enabled: designMode, handle: DRAG_HANDLE_SELECTOR }}
            resizeConfig={{ enabled: designMode, handles: ['se'] }}
            onLayoutChange={handleLayoutChange}
            onDragStart={handleDragStart}
            onResizeStart={handleResizeStart}
            onDragStop={commitCurrentLayout}
            onResizeStop={commitCurrentLayout}
          >
            {widgets
              // Kullanici istegi: gizli alanlar Tasarim Modu'nda da
              // izgaradan TAMAMEN kaldirilir (bkz. yukaridaki "Gizli
              // alanlar" listesi - oradan tek tikla geri eklenir).
              .filter((widget) => !hiddenIds.has(widget.id))
              .map((widget) => {
              // Kullanici istegi/hata raporu: "listesi uzun bir dosya
              // açtığımda ardından listesi kısa bir dosya açıyorum alan
              // küçülmüyor ve kaydırma çubuğu kısa listelerde alanın
              // ortasında görünüyor" - kok neden: fixedHeightIds kutulari
              // asagidaki "isCustomized" (flex-1 ile kutuyu DOLDURAN) dala
              // giriyordu - flex-grow, icerik ne kadar KISA olursa olsun
              // kutuyu HER ZAMAN o anki (onceki dosyadan kalma, BUYUK)
              // grid yuksekligine kadar GERIYORDU. Bu da HEM olculen
              // yuksekligi hep "kutu kadar buyuk" gosterip
              // ResizeObserver'in gercek (kucuk) icerik ihtiyacini asla
              // GORMEMESINE (kısır dongu - kutu hic kuculemiyordu) HEM DE
              // bos alanin ORTASINDA (icerigin bittigi ama kutunun
              // doldugu yerde) anlamsiz bir kaydirma cubugu izlenimine yol
              // aciyordu. Cozum: fixedHeightIds kutulari ARTIK "customize
              // edilmemis" (auto-fit, DOGAL/TAM icerik yuksekligi, flex-
              // fill YOK) dali kullanir - boylece olculen yukseklik HER
              // ZAMAN gercek icerigi yansitir, ResizeObserver'daki "taban
              // 5cm, gerekirse buyu/kucul" mantigi (yukarida) artik dogru
              // calisir. "customizedIds" (bkz. dosya ici not - bir kez
              // kaydedilince TUM widget id'lerini icerir) bu yuzden
              // fixedHeightIds icin BILEREK yoksayilir.
              const isCustomized = !fixedHeightIdSet.has(widget.id) && (customizedIds.has(widget.id) || manualOnlyIdSet.has(widget.id))
              const isSelected = selectedWidgetId === widget.id
              return (
                <div
                  key={widget.id}
                  aria-label={widget.title}
                  // Kullanici istegi: tutamaca TIKLANAN (surukleme degil)
                  // kutuyu tanimlayabilmek icin (bkz. yukaridaki
                  // handleClickCapture) - yon tuslariyla hassas tasima bu
                  // kimlige gore calisir.
                  data-widget-id={widget.id}
                  // Kullanici istegi: kutu boyutlandirilinca cikan kaydirma
                  // cubugu, kutunun GERCEK alt sinirinda gorunsun. Onceden
                  // bu dis sarmalayici "block" akisindaydi - tasarim
                  // modundaki tutamac cubugu (h-6) kutunun toplam
                  // yuksekliginden DUSULMUYORDU, bu yuzden icerik alani
                  // kutudan tasip GORUNMEDEN kirpiliyordu (kaydirma cubugu
                  // yanlis/gercek olmayan bir sinirda hesaplaniyordu).
                  // flex flex-col + alt satirin flex-1/min-h-0 olmasi, tutamac
                  // cubugunu DUSEREK geri kalan alani DOGRU hesaplatir.
                  className={`local-design-grid-item group flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${designMode ? (isSelected ? 'ring-2 ring-sky-500 ring-offset-2' : 'ring-2 ring-amber-300 ring-offset-2') : ''}`}
                >
                  {/* Kullanici istegi (15 Eylul 2026, 26. tur): "cursor-move" onceden
                      ustteki parent'ta bir Tailwind "[&_.local-design-drag-handle]"
                      turev-secici (arbitrary descendant selector) sinifiyla
                      veriliyordu - bu, Turbopack/Lightning CSS derlemesinde
                      (nedeni tam netlesmedi) bozuk baytli bir CSS secici uretip
                      "3 uyari"ya (her build'de gorulen, ZARARSIZ ama "next dev"de
                      FATAL hataya donen) yol aciyordu. Tutamac zaten SADECE
                      designMode'da render edildigi icin (asagidaki kosul) dolayli
                      turev-seciciye hic gerek yok - dogrudan kendi sinifina
                      tasindi, AYNI gorsel sonucu verir. */}
                  {designMode && (
                    <div className={`local-design-drag-handle flex h-6 shrink-0 cursor-move items-center justify-between gap-1 rounded-t-lg border border-b-0 px-1.5 text-[10px] font-black uppercase tracking-wide text-white shadow-sm ${isSelected ? 'border-sky-500 bg-sky-600' : 'border-amber-300 bg-amber-400'}`}>
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <ActionIconInline name="move" />
                        <span className="truncate">{widget.title}</span>
                      </span>
                      <button
                        type="button"
                        // Surukleme tutamaci butonu bu cubugun ICINDE oldugu
                        // icin, tiklamanin "surukleme" olarak algilanmamasi
                        // adina mousedown'un yukari (tutamaca) yayilmasi
                        // durduruluyor - aksi halde gizle butonuna basmak
                        // yanlislikla kutuyu surukleyebilirdi.
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          toggleHidden(widget.id)
                        }}
                        title="Bu alanı gizle"
                        className="shrink-0 cursor-pointer rounded border border-white/40 bg-white/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-white hover:bg-white/35"
                      >
                        Gizle
                      </button>
                    </div>
                  )}
                  {isCustomized ? (
                    // Kullanici bu kutuyu elle boyutlandirdi/tasidi - GORSEL
                    // olarak SEcTIGI boyutu (tutamac cubugu dusulmus GERCEK
                    // kalan alani) doldurur; icerik bu boyuttan FAZLA yer
                    // KAPLARSA (kullanici istegi: "veri artinca genislesin")
                    // yukaridaki ResizeObserver kutuyu icerige gore BUYUTUR.
                    //
                    // ONEMLI DUZELTME (kullanici istegi, 2. deneme): ILK
                    // denemede ic sarmalayiciya "min-h-full" (yuzde tabanli
                    // min-height) verilmisti - bu YETERSIZ CIKTI: widget.node
                    // (ör. "Hane Bilgileri" panelindeki <section
                    // className="h-full">) kendi "h-full"i (height:100%) ile
                    // dis kapsayicisinin yuksekligine BAKMAK zorunda, ama dis
                    // kapsayicinin (bu ic sarmalayicinin) yuksekligi de KENDI
                    // ICERIGINE (yani widget.node'a) bagliydi - bu DONGUSEL
                    // bagimlilik, tarayicida "height:100%" ifadesinin ETKISIZ
                    // (auto'ya) dusmesine yol aciyordu (canli testte
                    // dogrulandi: kaydirma cubugu kutunun ORTASINDA kalip
                    // buyuyen alanin altini BOS birakiyordu).
                    //
                    // Kesin cozum: yuzde-yukseklik hesabina GUVENMEK yerine
                    // FLEXBOX'IN KENDI buyutme mekanizmasi kullanilir. Dis
                    // sarmalayici (asagida) "flex flex-col" ile bir flex
                    // KAPSAYICISI yapildi; ic (ref'li) sarmalayici ise SADECE
                    // "flex-1" (buyume orani 1, taban 0%) alir, HICBIR
                    // min-height sifirlamasi (min-h-0) YOK - boylece
                    // tarayicinin flex ogeleri icin varsayilan otomatik
                    // taban-boyutu (icerigin GERCEK/dogal minimum yuksekligi)
                    // KORUNUR: icerik kutudan KUCUKSE flex-grow onu kutunun
                    // TAMAMINI dolduracak sekilde GERÇEKTEN gerer (artik
                    // dongusel/yuzde bagimliligi yok, flex algoritmasi kesin
                    // bir piksel yuksekligi hesaplar, widget.node'un kendi
                    // "h-full"i BU KESIN deger uzerinden dogru calisir);
                    // icerik kutudan BUYUKSE flex-shrink otomatik minimum
                    // boyutun ALTINA inemedigi icin icerik dogal yuksekliginde
                    // KALIR (tasar, dis kapsayicinin overflow-y-auto'su
                    // kaydirma cubugunu GERCEK alt sinirda gosterir) VE
                    // ResizeObserver bu tasmayi olcup kutuyu buyutmeye devam eder.
                    <div className={`flex min-h-0 w-full flex-1 flex-col overflow-y-auto ${designMode ? 'rounded-b-lg border border-t-0 border-amber-300' : ''}`}>
                      <div
                        ref={(el) => {
                          if (el) contentRefs.current.set(widget.id, el)
                          else contentRefs.current.delete(widget.id)
                        }}
                        className="flex-1"
                      >
                        {widget.node}
                      </div>
                    </div>
                  ) : (
                    // Henuz customize edilmemis - kutu, ICERIGIN DOGAL
                    // yuksekligini alir (flex-1/h-full ZORLANMAZ) - boylece
                    // yukaridaki ResizeObserver dogru/gercek yuksekligi
                    // olcebilir ve kutu HER ZAMAN tam icerik kadar olur,
                    // altinda/kenarinda bosluk KALMAZ.
                    <div
                      ref={(el) => {
                        if (el) contentRefs.current.set(widget.id, el)
                        else contentRefs.current.delete(widget.id)
                      }}
                      className={`w-full shrink-0 ${designMode ? 'rounded-b-lg border border-t-0 border-amber-300' : ''}`}
                    >
                      {widget.node}
                    </div>
                  )}
                </div>
              )
            })}
          </Responsive>
        )}
        </>)}
      </div>
    </div>
  )
})

// Bagimsiz/kucuk ikon - bu paylasilan bilesen, sayfaya ozel ActionIcon
// bileseninden BAGIMSIZ olsun diye (baska sayfalarda da kullanilabilsin)
// kendi minimal SVG ikonlarini icerir.
function ActionIconInline({ name }: { name: 'lock' | 'unlock' | 'move' }) {
  if (name === 'lock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    )
  }
  if (name === 'unlock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 7.5-2" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3 shrink-0">
      <path d="M12 3v18M3 12h18M7 7l-4 5 4 5M17 7l4 5-4 5M7 17l5 4 5-4M7 7l5-4 5 4" />
    </svg>
  )
}

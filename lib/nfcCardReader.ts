// NFC kart okuyucu ajanı (bkz. [[print-agent-workstation-setup]] belleği),
// kart okuyucudan okunan UID'yi odaktaki metin kutusuna klavye taklidi
// yaparak yazıyor. Kart okuyucuya yakın tutulduğu sürece (donanım
// periyodik olarak yeniden okuduğu için) AYNI UID'yi, alanı hiç
// temizlemeden, PEŞ PEŞE birden fazla kez yazabiliyor.
//
// Kullanıcı isteği: bir kart okutulduktan sonra en az 3 SANİYE aynı kart
// tekrar kabul edilmesin (peş peşe gelen tekrarlar bir "yeni okuma"
// sayılmasın), ama 3 saniye geçtikten sonra AYNI kart tekrar okutulursa
// ya da FARKLI bir kart okutulursa bu YENİ bir okuma olarak kabul
// edilsin - her okumanın arasında en az 3 saniye olsun.
//
// NOT (2026-08-18): İlk sürüm, "kart okuyucu mu insan mı" ayrımını
// ardışık tuş vuruşları arasındaki SÜREYE (60ms'den hızlıysa "patlama")
// bakarak yapıyordu - bu YANLIŞ çıktı ve canlıda "A5D344EEA5D344EEA5D344EE"
// gibi büyümeye devam eden değerlerle sonuçlandı. Sebebi: her yeni
// "patlama"nın İLK karakteri (kart okuyucunun periyodik olarak yeniden
// okumaya başladığı an, önceki okumadan >60ms sonra geldiği için) HİÇ
// İŞLENMEDEN olduğu gibi kabul ediliyordu - bu tek karakter, alanın
// içindeki toplam uzunluğu kalıcı olarak "tekrar tespiti" için asla temiz
// katlanamayacak (2'ye tam bölünemeyen) bir uzunluğa kaydırıyor, bu da
// desenin BİR DAHA HİÇ kendi kendine düzelmemesine yol açıyordu. Çözüm:
// yazım hızı ayrımı TAMAMEN KALDIRILDI - aşağıdaki mantık artık HER
// tuş vuruşunda, kaynağı ne olursa olsun, aynı şekilde çalışır. Bu, elle
// yazım için de güvenlidir (bkz. altındaki testler) çünkü normal, tekrarsız
// yazılan bir metin hiçbir zaman "kendi içinde X+X+... tekrarı" veya
// "önceki kabul edilen değerle birebir aynı" kalıplarına rastgele denk
// gelmez.
const SAME_VALUE_COOLDOWN_MS = 3000

// ÖNEMLİ: kart UID'leri (hex) çoğu zaman ardışık aynı karaktere sahip
// olabilir (ör. "A5D344EE" içindeki "44", ya da düz "11112222" gibi bir
// deger) - saf bir "X+X+..." regex'i (`/^(.+?)\1+$/`), TEK bir kartın
// kendi içindeki bu kısa tesadüfi tekrarları da (ör. yazılırken "11"
// anına gelindiğinde) YANLIŞLIKLA "aynı kart 2. kez okundu" sanıp veri
// KAYBEDİYORDU (canlıda "11112222" -> "12222" olarak bozuldu, tespit
// edildi). Çözüm: tekrar-birimi en az MIN_REPEAT_UNIT_LENGTH karakter
// olmadıkça KESİNLİKLE tekrar sayılmaz - gerçek kart UID'leri (4/7/10
// bayt = 8/14/20 hex karakter) bu eşiğin üzerinde olduğu için, tek bir
// okumanın TAMAMI hiçbir zaman yanlışlıkla "tekrar" sanılmaz; sadece
// AYNI TAM UID gerçekten iki+ kez üst üste yazıldığında yakalanır.
const MIN_REPEAT_UNIT_LENGTH = 6

// `value`, en az MIN_REPEAT_UNIT_LENGTH uzunluğunda bir biriminin ardışık
// tekrarından (X+X+...) oluşuyorsa o birimi (X), degilse `value`'nun
// kendisini döner.
function collapseRepeatingUnit(value: string): string {
  const length = value.length
  if (length < MIN_REPEAT_UNIT_LENGTH * 2) return value

  for (let tileLength = MIN_REPEAT_UNIT_LENGTH; tileLength <= Math.floor(length / 2); tileLength += 1) {
    if (length % tileLength !== 0) continue

    const tile = value.slice(0, tileLength)
    let tilesMatch = true
    for (let offset = tileLength; offset < length; offset += tileLength) {
      if (value.slice(offset, offset + tileLength) !== tile) {
        tilesMatch = false
        break
      }
    }
    if (tilesMatch) return tile
  }

  return value
}

export interface CardScanTracker {
  lastAcceptedValue: string
  lastAcceptedAt: number
}

export function createCardScanTracker(): CardScanTracker {
  return { lastAcceptedValue: '', lastAcceptedAt: 0 }
}

// Bir alan programatik olarak (ör. modal açılırken mevcut kaydın kart
// no'suyla, ya da "Temizle" butonuyla) değiştirildiğinde bu çağrılmalı -
// aksi halde takipçi, artık DOM'da olmayan eski bir "son kabul edilen
// değer" ile kıyaslama yapmaya devam eder.
export function resetCardScanTracker(tracker: CardScanTracker, value = '') {
  tracker.lastAcceptedValue = value
  tracker.lastAcceptedAt = 0
}

// Her onChange'de çağrılır - alana YAZILMASI gereken NİHAİ değeri
// döndürür (çoğu zaman ham değerle aynıdır, kart okuyucunun aynı kartı 3
// saniye içinde tekrar yazdığı durumlarda ise "geri alınmış" olabilir).
// `tracker`, çağıran taraf tarafından bir ref içinde saklanıp HER
// çağrıdan sonra (bu fonksiyon içinde) güncellenerek taşınmalıdır.
export function processScannedCardInput(rawValue: string, tracker: CardScanTracker): string {
  const now = Date.now()

  // Değerin kendi içinde bir tekrar kalıbı (X, X'in ardışık tekrarı) olup
  // olmadığına bak - aynı kart, tek bir okuma "patlamasında" birden fazla
  // kez yazılmışsa (donanım hızlıca üst üste okuyorsa) bunu tek kopyaya
  // indirir.
  const collapsed = collapseRepeatingUnit(rawValue)

  if (collapsed === tracker.lastAcceptedValue && now - tracker.lastAcceptedAt < SAME_VALUE_COOLDOWN_MS) {
    // Aynı kart, bekleme süresi (3sn) içinde tekrar okundu - büyümeyi geri
    // al, alan son kabul edilen değerde sabit kalsın. lastAcceptedAt
    // BİLEREK güncellenmiyor - bekleme süresi İLK kabulden itibaren sayılır.
    return tracker.lastAcceptedValue
  }

  // Farklı bir değer, YA DA aynı değer ama bekleme süresi geçmiş - yeni
  // bir okuma olarak kabul et.
  tracker.lastAcceptedValue = collapsed
  tracker.lastAcceptedAt = now
  return collapsed
}

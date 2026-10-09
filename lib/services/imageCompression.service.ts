import 'server-only'

// 'sharp' NATIVE bir modul (libvips .node). Dis-yuz IKINCIL sunucuda
// (10.20.1.100) VC++ Redist olmadigi icin paketten KASITLI cikariliyor
// (bkz. scripts/guncelle-yayinla.ps1 - "node_modules\sharp" / "@img").
// STATIK "import sharp from 'sharp'" o sunucuda MODUL YUKLENIRKEN patlar
// (yakalanamaz) -> /api/documents/photo, /api/users/[id]/photo,
// /api/documents/belgeler uc noktalari 500 doner (profil resmi / belge
// eklenemez). Cozum: sharp ILK CAGRIDA DINAMIK yuklenir; yoksa
// compressImageBuffer sessizce orijinal veriyi dondurur (sikistirma
// "olursa iyi" bir iyilestirme - zorunlu degil).
type SharpFn = typeof import('sharp')['default']
let cachedSharp: SharpFn | null | undefined

async function loadSharp(): Promise<SharpFn | null> {
  if (cachedSharp !== undefined) return cachedSharp
  try {
    const mod = await import('sharp')
    cachedSharp = ((mod as { default?: SharpFn }).default ?? (mod as unknown as SharpFn))
  } catch {
    cachedSharp = null
  }
  return cachedSharp
}

// Kullanici istegi: C: suruculundeki sosyalyardimdkm veritabani (belge/
// bireyresim/kullanicifoto tablolari - dosyalara eklenen belgeler, kişi
// fotograflari ve kullanici profil fotograflari HAM/sikistirilmamis bytea
// olarak saklaniyordu) surekli buyuyup diski doldurdugu icin - bundan
// sonra eklenen TUM fotograflar/taranan belgeler, veritabanina yazilmadan
// once makul bir boyuta kucultulup JPEG olarak yeniden kodlanir. Amac,
// goz ile okunabilirligi (metin/yuz tanima) bozmadan dosya boyutunu agir
// sekilde (genelde %80-90) azaltmak.
const MAX_DIMENSION_PX = 1920
const JPEG_QUALITY = 80

// sharp/libvips'in NATIVE bir BMP kod cozucusu yok (prebuilt sharp
// binary'leri ImageMagick delegate'i icermiyor) - bireyresim tablosunda
// bulunan (kullanici istegi uzerine incelenen) 10.000+ BMP kaydin
// sharp'a dogrudan verildiginde "Input buffer contains unsupported image
// format" hatasiyla sessizce ORIJINAL (sikistirilmamis) haliyle
// kaydedildigi tespit edildi. Bu yuzden standart, sikistirilmamis
// (BI_RGB) BMP'ler burada KENDIMIZ ham piksel verisine ayristirilip
// sharp'a "raw" girdi olarak veriliyor - boylece hem GECMISTEKI hem
// BUNDAN SONRA yuklenecek BMP'ler duzgun sikistirilabiliyor.
// Sadece compression=0 (BI_RGB), 24 veya 32 bit/piksel destekleniyor -
// bu, gercek veride test edilen TUM BMP kayitlarinin formatidir; farkli
// bir varyantla karsilasilirsa (ör. RLE sikistirmali BMP) fonksiyon
// null doner ve orijinal veri OLDUGU GIBI korunur (bkz. compressImageBuffer).
function decodeBmpToRawRgb(buffer: Buffer): { raw: Buffer; width: number; height: number; channels: 3 } | null {
  if (buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') return null

  try {
    const pixelDataOffset = buffer.readUInt32LE(10)
    const dibHeaderSize = buffer.readUInt32LE(14)
    const width = buffer.readInt32LE(18)
    const heightRaw = buffer.readInt32LE(22)
    const bitCount = buffer.readUInt16LE(28)
    const compression = buffer.readUInt32LE(30)

    if (dibHeaderSize < 40) return null // sadece standart BITMAPINFOHEADER+
    if (compression !== 0) return null // sadece sikistirilmamis (BI_RGB)
    if (bitCount !== 24 && bitCount !== 32) return null
    if (width <= 0 || heightRaw === 0) return null

    const height = Math.abs(heightRaw)
    const topDown = heightRaw < 0
    const bytesPerPixel = bitCount / 8
    const rowSize = Math.floor((bitCount * width + 31) / 32) * 4 // her satir 4 bayta yuvarlanir

    if (pixelDataOffset + rowSize * height > buffer.length) return null // bozuk/eksik veri

    const out = Buffer.alloc(width * height * 3) // RGB (alpha atiliyor - bkz. asagi not)

    for (let y = 0; y < height; y++) {
      // BMP piksel verisi genelde ALTTAN YUKARI saklanir (topDown=false) -
      // sharp'in "raw" girdisi USTTEN ASAGI beklendigi icin satir sirasi
      // burada duzeltiliyor.
      const srcRow = topDown ? y : (height - 1 - y)
      const srcRowStart = pixelDataOffset + srcRow * rowSize
      const dstRowStart = y * width * 3
      for (let x = 0; x < width; x++) {
        const srcIdx = srcRowStart + x * bytesPerPixel
        const dstIdx = dstRowStart + x * 3
        // BMP piksel bayt sirasi: B, G, R[, A] - 4. bayt (alpha) bu eski
        // BMP'lerde gercek saydamlik tasimiyor (genelde 0/rezerve) - bu
        // yuzden KASITLI olarak atlaniyor, sadece B/G/R okunup R/G/B'ye
        // ceviriliyor.
        out[dstIdx] = buffer[srcIdx + 2]     // R
        out[dstIdx + 1] = buffer[srcIdx + 1] // G
        out[dstIdx + 2] = buffer[srcIdx]     // B
      }
    }

    return { raw: out, width, height, channels: 3 }
  } catch {
    return null
  }
}

export interface CompressImageOptions {
  // Kullanici istegi: bundan sonra eklenecek (ozellikle kameradan cekilen)
  // resimlerde, kucultme/sikistirma sirasinda olusabilecek hafif
  // bulanikligi telafi etmek icin hafif bir netlestirme (unsharp mask)
  // uygulanir. GECMISTEKI (retroaktif) toplu donusumde ise, kullaniciya
  // GORSEL OLARAK ONAYLATILAN sonucu birebir korumak icin bu KAPALI
  // tutulur (bkz. scripts/compress-bireyresim-legacy.mjs).
  sharpen?: boolean
}

// Sadece GERCEK resimler (image/*, BMP dahil) icin kullanilir - PDF gibi
// diger belge turleri bu fonksiyona hic gonderilmemeli (bkz. cagiran kod).
export async function compressImageBuffer(buffer: Buffer, options: CompressImageOptions = {}): Promise<Buffer> {
  const { sharpen = true } = options

  const sharp = await loadSharp()
  if (!sharp) {
    // sharp yok (ikincil sunucu) - sikistirma atlanir, orijinal korunur.
    return buffer
  }

  try {
    const bmp = decodeBmpToRawRgb(buffer)
    let pipeline = bmp
      ? sharp(bmp.raw, { raw: { width: bmp.width, height: bmp.height, channels: bmp.channels } })
      // EXIF yonelim bilgisine gore otomatik dondur (telefon kameralarinda
      // yaygin), sonra EXIF meta verisi disari atilir (kucuk ek kazanc).
      // BMP/ham piksel girdisinde EXIF olmadigi icin rotate() zararsiz no-op.
      : sharp(buffer).rotate()

    pipeline = pipeline.resize({
      width: MAX_DIMENSION_PX,
      height: MAX_DIMENSION_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })

    if (sharpen) {
      // Hafif/varsayilan parametrelerle unsharp mask - kucultme ve JPEG
      // sikistirmasinin dogal olarak yumusattigi kenarlari telafi eder,
      // asiri/yapay bir "keskinlik" etkisi yaratmaz.
      pipeline = pipeline.sharpen()
    }

    const compressed = await pipeline
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer()

    // Savunma: sikistirma beklenmedik sekilde ORIJINALDEN BUYUK bir dosya
    // uretirse (ör. zaten kucuk/optimize edilmis bir resimse) orijinal
    // korunur - hicbir zaman veri BUYUTULMEZ.
    return compressed.length > 0 && compressed.length < buffer.length ? compressed : buffer
  } catch (error) {
    // sharp resmi cozemezse (bozuk dosya, desteklenmeyen/beklenmedik format
    // vb.) orijinal veri OLDUGU GIBI kaydedilir - kullanicinin yuklemesi
    // ASLA sessizce basarisiz olmamali, sikistirma sadece "olursa iyi olur"
    // bir iyilestirmedir.
    console.warn('[imageCompression] Resim sıkıştırılamadı, orijinal veri kullanılıyor:', error)
    return buffer
  }
}

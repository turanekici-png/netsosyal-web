// Basit, tek sayfali .xlsx dosyalarini (formul/stil/birlestirilmis hucre
// gibi gelismis ozellikler HEDEFLENMEZ - sadece metin/sayi hucreli, tek
// satirlik basligi olan tablolar icin) tarayici icinde OKUR - projede
// harici bir xlsx-okuma paketi (ör. npm "xlsx"/SheetJS) BİLEREK
// kullanılmıyor: o paketin npm'e yayinlanan surumlerinde DUZELTILMEMIS
// (yalnizca SheetJS'in kendi CDN'inde yamali surumu var, npm'de yok) YUKSEK
// SEVERITY prototype-pollution/ReDoS acikleri var (bkz. GHSA-4r6h-8v6p-xvw6,
// GHSA-5pgg-2g8v-p4x9). Bu yuzden, uygulamanin KENDI xlsx YAZICISI
// (xlsxExport.ts - elle ZIP+OOXML üreten) ile AYNI ruhta, bagimliliksiz bir
// OKUYUCU yazildi. Tarayicinin yerlesik DecompressionStream('deflate-raw')
// API'siyle (modern Chrome/Edge/Firefox/Safari - ayrica bir kutuphane
// gerektirmez) ZIP icindeki sikistirilmis parçalari acar.
type XlsxRow = Record<string, string>

function readUInt16(view: DataView, offset: number) {
  return view.getUint16(offset, true)
}

function readUInt32(view: DataView, offset: number) {
  return view.getUint32(offset, true)
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Tarayıcınız .xlsx dosyalarını doğrudan okumayı desteklemiyor. Lütfen dosyayı CSV olarak kaydedip yükleyin.')
  }

  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const buffer = await new Response(stream).arrayBuffer()
  return new Uint8Array(buffer)
}

// ZIP'in "End Of Central Directory" kaydini (imza: PK\x05\x06) buffer'in
// SONUNDAN arar - central directory'nin nerede basladigini bulmak icin
// gereken ilk adim. ZIP yorum alani en fazla 65535 bayt olabildiginden son
// ~66KB icinde aramak yeterlidir.
function findEndOfCentralDirectory(view: DataView) {
  const searchStart = Math.max(0, view.byteLength - 65557)
  for (let offset = view.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) return offset
  }
  throw new Error('Geçersiz .xlsx dosyası (ZIP yapısı okunamadı).')
}

type ZipEntry = {
  name: string
  compressedSize: number
  method: number
  localHeaderOffset: number
}

function readCentralDirectory(bytes: Uint8Array, view: DataView): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(view)
  const totalEntries = readUInt16(view, eocdOffset + 10)
  let offset = readUInt32(view, eocdOffset + 16)
  const decoder = new TextDecoder('utf-8')

  const entries: ZipEntry[] = []
  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32(view, offset) !== 0x02014b50) break

    const method = readUInt16(view, offset + 10)
    const compressedSize = readUInt32(view, offset + 20)
    const nameLength = readUInt16(view, offset + 28)
    const extraLength = readUInt16(view, offset + 30)
    const commentLength = readUInt16(view, offset + 32)
    const localHeaderOffset = readUInt32(view, offset + 42)
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))

    entries.push({ name, compressedSize, method, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

async function extractEntry(bytes: Uint8Array, view: DataView, entry: ZipEntry): Promise<string> {
  if (readUInt32(view, entry.localHeaderOffset) !== 0x04034b50) {
    throw new Error('Geçersiz .xlsx dosyası (ZIP kaydı bozuk).')
  }

  const nameLength = readUInt16(view, entry.localHeaderOffset + 26)
  const extraLength = readUInt16(view, entry.localHeaderOffset + 28)
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength
  const compressedData = bytes.subarray(dataStart, dataStart + entry.compressedSize)
  const decoder = new TextDecoder('utf-8')

  if (entry.method === 0) return decoder.decode(compressedData)
  if (entry.method === 8) return decoder.decode(await inflateRaw(compressedData))
  throw new Error('Desteklenmeyen ZIP sıkıştırma yöntemi - lütfen dosyayı Excel ile yeniden kaydedin.')
}

function decodeXmlEntities(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const siRegex = /<si>([\s\S]*?)<\/si>/g
  let match: RegExpExecArray | null

  while ((match = siRegex.exec(xml))) {
    const textParts = Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((piece) => decodeXmlEntities(piece[1]))
    strings.push(textParts.join(''))
  }

  return strings
}

function columnLettersToIndex(letters: string) {
  let index = 0
  for (const ch of letters) {
    index = index * 26 + (ch.charCodeAt(0) - 64)
  }
  return index - 1
}

function parseSheetRows(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = []
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null

  while ((rowMatch = rowRegex.exec(xml))) {
    const cells: string[] = []
    const cellRegex = /<c([^>]*?)\/>|<c([^>]*?)>([\s\S]*?)<\/c>/g
    let cellMatch: RegExpExecArray | null

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? ''
      const body = cellMatch[3] ?? ''
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/)
      const typeMatch = attrs.match(/t="([^"]+)"/)
      const columnIndex = refMatch ? columnLettersToIndex(refMatch[1]) : cells.length
      const type = typeMatch?.[1]

      let value = ''
      if (type === 's') {
        const vMatch = body.match(/<v>([\s\S]*?)<\/v>/)
        const stringIndex = vMatch ? Number(vMatch[1]) : NaN
        value = Number.isInteger(stringIndex) ? (sharedStrings[stringIndex] ?? '') : ''
      } else if (type === 'inlineStr') {
        const tMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        value = tMatch ? decodeXmlEntities(tMatch[1]) : ''
      } else {
        const vMatch = body.match(/<v>([\s\S]*?)<\/v>/)
        value = vMatch ? decodeXmlEntities(vMatch[1]) : ''
      }

      if (columnIndex >= 0) {
        while (cells.length < columnIndex) cells.push('')
        cells[columnIndex] = value
      }
    }

    rows.push(cells)
  }

  return rows
}

// Bir .xlsx dosyasini (tarayicidan secilen File) CSV'ye benzer bir satir
// listesine cevirir - ilk satir baslik kabul edilir, geri kalan satirlar
// {baslik: deger} nesnelerine donusturulur (bkz. parseCsv - ayni cikti
// bicimi, boylece cagiran kodlar ikisini birbirinin yerine kullanabilir).
export async function parseXlsxFile(file: File): Promise<XlsxRow[]> {
  const arrayBuffer = await file.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  const view = new DataView(arrayBuffer)

  const entries = readCentralDirectory(bytes, view)
  const sheetEntry = entries.find((entry) => /^xl\/worksheets\/sheet1\.xml$/i.test(entry.name))
    ?? entries.find((entry) => /^xl\/worksheets\/.+\.xml$/i.test(entry.name))

  if (!sheetEntry) {
    throw new Error('Excel dosyasında okunacak bir çalışma sayfası bulunamadı.')
  }

  const sharedStringsEntry = entries.find((entry) => entry.name === 'xl/sharedStrings.xml')
  const sharedStrings = sharedStringsEntry
    ? parseSharedStrings(await extractEntry(bytes, view, sharedStringsEntry))
    : []

  const sheetXml = await extractEntry(bytes, view, sheetEntry)
  const rows = parseSheetRows(sheetXml, sharedStrings)

  if (rows.length < 2) return []

  const headers = rows[0].map((header) => header.trim())

  return rows.slice(1)
    .map((cells) => {
      const row: XlsxRow = {}
      headers.forEach((header, index) => {
        if (header) row[header] = (cells[index] ?? '').trim()
      })
      return row
    })
    .filter((row) => Object.values(row).some((value) => value.trim()))
}

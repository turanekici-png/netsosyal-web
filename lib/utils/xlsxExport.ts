type XlsxCellValue = string | number | boolean | Date | null | undefined

type XlsxRow = Record<string, XlsxCellValue>

const encoder = new TextEncoder()

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnName(index: number) {
  let name = ''
  let current = index + 1

  while (current > 0) {
    const remainder = (current - 1) % 26
    name = String.fromCharCode(65 + remainder) + name
    current = Math.floor((current - 1) / 26)
  }

  return name
}

function cellXml(value: XlsxCellValue, rowIndex: number, columnIndex: number) {
  const reference = `${columnName(columnIndex)}${rowIndex}`

  if (value === null || value === undefined) {
    return `<c r="${reference}"/>`
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`
  }

  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`
  }

  const text = value instanceof Date ? value.toLocaleDateString('tr-TR') : String(value)
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(text)}</t></is></c>`
}

function worksheetXml(rows: XlsxRow[], headers: string[]) {
  const headerCells = headers.map((header, index) => cellXml(header, 1, index)).join('')
  const dataRows = rows.map((row, rowIndex) => {
    const excelRowIndex = rowIndex + 2
    const cells = headers.map((header, columnIndex) => cellXml(row[header], excelRowIndex, columnIndex)).join('')
    return `<row r="${excelRowIndex}">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">${headerCells}</row>
    ${dataRows}
  </sheetData>
</worksheet>`
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff

  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

function writeUInt16(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >>> 8) & 0xff
}

function writeUInt32(buffer: Uint8Array, offset: number, value: number) {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >>> 8) & 0xff
  buffer[offset + 2] = (value >>> 16) & 0xff
  buffer[offset + 3] = (value >>> 24) & 0xff
}

function concatArrays(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

function createZip(files: Array<{ name: string; content: string }>) {
  const localFileChunks: Uint8Array[] = []
  const centralDirectoryChunks: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const contentBytes = encoder.encode(file.content)
    const checksum = crc32(contentBytes)

    const localHeader = new Uint8Array(30 + nameBytes.length)
    writeUInt32(localHeader, 0, 0x04034b50)
    writeUInt16(localHeader, 4, 20)
    writeUInt16(localHeader, 6, 0)
    writeUInt16(localHeader, 8, 0)
    writeUInt16(localHeader, 10, 0)
    writeUInt16(localHeader, 12, 0)
    writeUInt32(localHeader, 14, checksum)
    writeUInt32(localHeader, 18, contentBytes.length)
    writeUInt32(localHeader, 22, contentBytes.length)
    writeUInt16(localHeader, 26, nameBytes.length)
    writeUInt16(localHeader, 28, 0)
    localHeader.set(nameBytes, 30)

    localFileChunks.push(localHeader, contentBytes)

    const centralHeader = new Uint8Array(46 + nameBytes.length)
    writeUInt32(centralHeader, 0, 0x02014b50)
    writeUInt16(centralHeader, 4, 20)
    writeUInt16(centralHeader, 6, 20)
    writeUInt16(centralHeader, 8, 0)
    writeUInt16(centralHeader, 10, 0)
    writeUInt16(centralHeader, 12, 0)
    writeUInt16(centralHeader, 14, 0)
    writeUInt32(centralHeader, 16, checksum)
    writeUInt32(centralHeader, 20, contentBytes.length)
    writeUInt32(centralHeader, 24, contentBytes.length)
    writeUInt16(centralHeader, 28, nameBytes.length)
    writeUInt16(centralHeader, 30, 0)
    writeUInt16(centralHeader, 32, 0)
    writeUInt16(centralHeader, 34, 0)
    writeUInt16(centralHeader, 36, 0)
    writeUInt32(centralHeader, 38, 0)
    writeUInt32(centralHeader, 42, offset)
    centralHeader.set(nameBytes, 46)

    centralDirectoryChunks.push(centralHeader)
    offset += localHeader.length + contentBytes.length
  }

  const centralDirectory = concatArrays(centralDirectoryChunks)
  const endRecord = new Uint8Array(22)
  writeUInt32(endRecord, 0, 0x06054b50)
  writeUInt16(endRecord, 8, files.length)
  writeUInt16(endRecord, 10, files.length)
  writeUInt32(endRecord, 12, centralDirectory.length)
  writeUInt32(endRecord, 16, offset)

  return concatArrays([...localFileChunks, centralDirectory, endRecord])
}

function buildXlsxBlob(rows: XlsxRow[], headers: string[], sheetName: string) {
  const safeSheetName = escapeXml(sheetName.slice(0, 31) || 'Sayfa1')
  const files = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: worksheetXml(rows, headers),
    },
  ]
  const zip = createZip(files)
  return new Blob([zip.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function downloadXlsx(rows: XlsxRow[], filename: string, sheetName = 'Sayfa1') {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  triggerBlobDownload(buildXlsxBlob(rows, headers, sheetName), filename)
}

// Sadece baslik satirini iceren, doldurulmak uzere indirilen bos bir sablon
// (Excel'den Veri Al ozelligindeki "Şablonu İndir" butonu icin) - veri
// satiri olmadan SADECE kolon basliklarini yazar.
export function downloadXlsxTemplate(headers: string[], filename: string, sheetName = 'Sayfa1') {
  triggerBlobDownload(buildXlsxBlob([], headers, sheetName), filename)
}

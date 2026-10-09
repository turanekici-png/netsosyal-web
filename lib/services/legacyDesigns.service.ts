import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { ISetting } from '@/lib/types'

type LegacyDesignRow = {
  id: bigint
  tipi: number | null
  adi: string | null
  dizayn: Buffer | Uint8Array | string | null
  varsayilan: number | null
}

type ReportBand = {
  id: string
  type: 'ReportTitle' | 'PageHeader' | 'MasterData' | 'PageFooter'
  name: string
  height: number
}

type DesignBlock = {
  id: string
  bandId?: string
  type: 'text' | 'variable' | 'barcode' | 'qrcode' | 'line'
  x: number
  y: number
  width?: number
  height?: number
  value: string
  fontSize?: number
  fontWeight?: string
  textColor?: string
  backgroundColor?: string
  borderColor?: string
  borderWidth?: number
}

type FormDesignTemplate = {
  id: string
  name: string
  type: 'barcode' | 'a4' | 'label'
  linkedAssistance: string
  width?: string
  height?: string
  printOffsetX?: string
  printOffsetY?: string
  printOffsetRight?: string
  printOffsetBottom?: string
  content: string
  bands?: ReportBand[]
  blocks?: DesignBlock[]
}

export const formDesignTemplatesKey = 'form_design_templates'

const legacyTypeMap: Record<string, string> = {
  '1': 'Dosya',
  '2': 'Ekmek',
  '3': 'Gıda Bankası',
  '5': 'Ayni/Nakdi',
  '6': 'Destek Paketi',
  '7': 'Giyim',
  '10': 'Dönem Dışı Gıda',
  '12': 'Aceze',
}

const globalForDkmPrisma = globalThis as unknown as {
  dkmSettingsPrisma: PrismaClient | undefined
}

function getDkmConnectionString() {
  if (process.env.SOSYALYARDIMDKM_DATABASE_URL) {
    return process.env.SOSYALYARDIMDKM_DATABASE_URL
  }

  const connectionString = process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error('DATABASE_URL tanımlı değil.')
  }

  const url = new URL(connectionString)
  url.pathname = '/sosyalyardimdkm'
  return url.toString()
}

function getDkmPrisma() {
  if (!globalForDkmPrisma.dkmSettingsPrisma) {
    globalForDkmPrisma.dkmSettingsPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getDkmConnectionString() }),
    })
  }

  return globalForDkmPrisma.dkmSettingsPrisma
}

function decodeLegacyDesign(value: LegacyDesignRow['dizayn']) {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmedValue = value.trim()
    if (trimmedValue.startsWith('\\x')) {
      return Buffer.from(trimmedValue.slice(2), 'hex').toString('utf8')
    }
    return trimmedValue
  }

  return Buffer.from(value).toString('utf8')
}

function parseAttributes(elementString: string) {
  const attrs: Record<string, string> = {}
  const attrRegex = /([a-zA-Z0-9_.]+)=["']([^"']*)["']/g
  let match: RegExpExecArray | null

  while ((match = attrRegex.exec(elementString)) !== null) {
    attrs[match[1]] = match[2]
  }

  return attrs
}

function parseFloatComma(value?: string) {
  if (!value) return 0
  const parsed = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function decodeFastReportText(value: string) {
  return value
    .replace(/&#34;/g, '"')
    .replace(/&#13;&#10;/g, '\n')
    .replace(/&#13;/g, '\n')
    .replace(/&#10;/g, '\n')
}

function replaceLegacyVariables(text: string) {
  let result = decodeFastReportText(text)

  result = result.replace(/\[DS_Dosya\."?dosyano"?\]/gi, '{{dosya.dosyano}}')
  result = result.replace(/\[DS_Dosya\."?adres"?\]/gi, '{{dosya.adres}}')
  result = result.replace(/\[DS_Dosya\."?mahalle"?\]/gi, '{{dosya.mahalle}}')
  result = result.replace(/\[DS_Dosya\."?telefon"?\]/gi, '{{dosya.telefon}}')
  result = result.replace(/\[DS_Dosya\."?tc"?\]/gi, '{{kisi.tc}}')
  result = result.replace(/\[DS_Muracaatci\."?adisoyadi"?\]/gi, '{{kisi.ad_soyad}}')
  result = result.replace(/\[DS_Muracaatci\."?tckimlikno"?\]/gi, '{{kisi.tc}}')
  result = result.replace(/\[DS_Yardim\."?tckimlikno"?\]/gi, '{{kisi.tc}}')
  result = result.replace(/\[DS_Yardim\."?kullaniciadi"?\]/gi, '{{kisi.ad_soyad}}')
  result = result.replace(/\[DS_Yardim\."?aciklama"?\]/gi, '{{yardim.aciklama}}')
  result = result.replace(/\[DS_Yardim\."?miktar"?\]/gi, '{{yardim.miktar}}')
  result = result.replace(/\[DS_Yardim\."?bastarih"?\]/gi, '{{yardim.bas_tarih}}')
  result = result.replace(/\[DS_Yardim\."?bittarih"?\]/gi, '{{yardim.bit_tarih}}')
  result = result.replace(/\[Date\]/gi, '{{cikti.tarih}}')
  result = result.replace(/\[Time\]/gi, '{{cikti.saat}}')

  if (result.startsWith('[') && result.endsWith(']') && !result.includes('{{')) {
    result = result.slice(1, -1)
  }

  return result
}

function convertLegacyDesign(row: LegacyDesignRow): FormDesignTemplate | null {
  const designXml = decodeLegacyDesign(row.dizayn)
  if (!designXml) return null

  const bands: ReportBand[] = []
  const blocks: DesignBlock[] = []
  const pageSizes: Array<{ width: number; height: number }> = []
  const pages = designXml.split(/<TfrxReportPage/i).slice(1)

  pages.forEach((pageContent, pageIndex) => {
    const pageAttrs = parseAttributes(`<TfrxReportPage ${pageContent.split('>')[0]}>`)
    const bandId = `legacy_${row.id}_page_${pageIndex}`
    const paperWidth = parseFloatComma(pageAttrs.PaperWidth)
    const paperHeight = parseFloatComma(pageAttrs.PaperHeight)
    if (paperWidth > 0 && paperHeight > 0) {
      pageSizes.push({ width: paperWidth, height: paperHeight })
    }

    bands.push({
      id: bandId,
      type: 'MasterData',
      name: `Sayfa ${pageIndex + 1} (${pageAttrs.Name || 'Adsız'})`,
      height: paperHeight > 0 ? Math.round(paperHeight * 3.78) : 1123,
    })

    const elementRegex = /<Tfrx(MemoView|BarCodeView)[^>]*>/gi
    let match: RegExpExecArray | null
    let blockIndex = 0

    while ((match = elementRegex.exec(pageContent)) !== null) {
      const attrs = parseAttributes(match[0])
      const isBarcode = match[1] === 'BarCodeView'
      const parsedText = replaceLegacyVariables(attrs.Text || attrs.Expression || '')

      if (!parsedText.trim() && !isBarcode) continue

      blocks.push({
        id: `legacy_${row.id}_page_${pageIndex}_block_${blockIndex}`,
        bandId,
        type: isBarcode ? 'barcode' : parsedText.includes('{{') ? 'variable' : 'text',
        x: Math.round(parseFloatComma(attrs.Left)),
        y: Math.round(parseFloatComma(attrs.Top)),
        width: attrs.Width ? Math.round(parseFloatComma(attrs.Width)) : undefined,
        height: attrs.Height ? Math.round(parseFloatComma(attrs.Height)) : undefined,
        value: parsedText || '{{dosya.dosyano}}',
        fontSize: attrs['Font.Height'] ? Math.abs(Number.parseInt(attrs['Font.Height'], 10)) : 12,
        fontWeight: attrs['Font.Style'] === '1' ? 'bold' : 'normal',
        textColor: '#000000',
        backgroundColor: 'transparent',
        borderColor: '#000000',
        borderWidth: 0,
      })
      blockIndex += 1
    }
  })

  if (bands.length === 0) {
    bands.push({
      id: `legacy_${row.id}_page_0`,
      type: 'MasterData',
      name: 'Ana Veri',
      height: 151,
    })
  }

  const firstPageSize = pageSizes[0]
  const isLabelSize = Boolean(firstPageSize && firstPageSize.width <= 120 && firstPageSize.height <= 120)

  return {
    id: `legacy_dizayn_${row.id}`,
    name: row.adi?.trim() || `Dizayn ${row.id}`,
    type: isLabelSize ? 'label' : 'a4',
    linkedAssistance: row.tipi == null ? 'Tümü' : legacyTypeMap[String(row.tipi)] || 'Tümü',
    width: firstPageSize ? String(Math.round(firstPageSize.width)) : '210',
    height: firstPageSize ? String(Math.round(firstPageSize.height)) : '297',
    printOffsetX: isLabelSize ? '5' : '0',
    printOffsetY: '0',
    printOffsetRight: '0',
    printOffsetBottom: '0',
    content: '',
    bands,
    blocks,
  }
}

// Eski (legacy) "dizayn" tablosu birkaç MB'lık FastReport XML verisi tasiyor ve
// bu veriyi regex ile ayristirmak (convertLegacyDesign) pahalidir. Bu fonksiyon
// form_design_templates ayari her okundugunda (yani her yazdirma/barkod
// isleminde) tekrar tekrar calisiyordu - bu da yazdirma islemlerini yavaslatan
// asil nedendi. Legacy tasarimlar bu uygulamadan hic yazilmadigi (salt-okunur,
// eski sistemden kalma) icin sonucu bir sure bellekte tutmak guvenlidir; disari
// bir yerden degistirilirse de en gec TTL suresi kadar sonra yansir.
const legacyDesignsCacheTtlMs = 10 * 60 * 1000
const globalForLegacyDesigns = globalThis as unknown as {
  legacyDesignsCache?: {
    expiresAt: number
    templates: FormDesignTemplate[]
  }
}

async function getLegacyFormDesignTemplates() {
  const cached = globalForLegacyDesigns.legacyDesignsCache
  if (cached && cached.expiresAt > Date.now()) {
    return cached.templates
  }

  try {
    const rows = await getDkmPrisma().$queryRaw<LegacyDesignRow[]>`
      SELECT id, tipi, adi, dizayn, varsayilan
      FROM dizayn
      WHERE dizayn IS NOT NULL
      ORDER BY COALESCE(varsayilan, 0) DESC, id ASC
    `

    const templates = rows
      .map(convertLegacyDesign)
      .filter((design): design is FormDesignTemplate => Boolean(design))

    globalForLegacyDesigns.legacyDesignsCache = {
      expiresAt: Date.now() + legacyDesignsCacheTtlMs,
      templates,
    }

    return templates
  } catch {
    return []
  }
}

export async function mergeSettingWithLegacyDesignTemplates(setting: ISetting | null) {
  const legacyDesigns = await getLegacyFormDesignTemplates()
  const existingValue = Array.isArray(setting?.value) ? (setting.value as FormDesignTemplate[]) : []

  if (legacyDesigns.length === 0) {
    return setting
  }

  const existingIds = new Set(existingValue.map((design) => design.id))
  const mergedValue = [
    ...existingValue,
    ...legacyDesigns.filter((design) => !existingIds.has(design.id)),
  ]

  return {
    key: formDesignTemplatesKey,
    value: mergedValue,
    type: setting?.type || 'json',
    updatedAt: setting?.updatedAt,
  } as ISetting
}

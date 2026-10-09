import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { prisma } from '@/lib/db/prisma'

export const dynamic = 'force-dynamic'

type NviService = {
  id: 'tcKimlik' | 'adres' | 'maviKart' | 'nufusKayit' | 'localDb'
  name: string
  description: string
  url: string
  serviceName?: string
  enabled: boolean
}

const defaultServices: NviService[] = [
  {
    id: 'localDb',
    name: 'Sistem Entegre Alanı (Bireyler Tablosu)',
    description: 'Kişi bilgilerini sistemin kendi veritabanındaki bireyler tablosundan sorgular (Çevrimdışı/Hızlı).',
    url: 'LOCAL_DB',
    serviceName: 'LocalSearch',
    enabled: true,
  },
  {
    id: 'tcKimlik',
    name: 'TC Kimlik No ile Kişi Bilgileri',
    description: 'Kişinin temel kimlik bilgilerini sorgular.',
    url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
    serviceName: 'TCKimlikNoIleKisiBilgisiSorgula',
    enabled: false,
  },
  {
    id: 'adres',
    name: 'Adres Bilgileri Sorgulama',
    description: 'Kişinin MERNİS adres bilgilerini sorgular.',
    url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
    serviceName: 'KimlikNoIleAdresSorgula',
    enabled: false,
  },
  {
    id: 'maviKart',
    name: 'Mavi Kartlı Kişi Bilgileri',
    description: 'Mavi Kart sahibi kişinin temel kimlik bilgilerini sorgular.',
    url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
    serviceName: 'MaviKartSorgulaTCKimlikNoServis',
    enabled: false,
  },
  {
    id: 'nufusKayit',
    name: 'Aile Nüfus Kayıt Örneği',
    description: 'Kişinin vukuatlı nüfus kayıt örneğini sorgular.',
    url: 'https://kps.nvi.gov.tr/Services/KpsServices.svc',
    serviceName: 'TCKimlikNoIleKisiBilgisiSorgula',
    enabled: false,
  },
]

function parseSettingValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

function normalizeServices(services: Partial<NviService>[] = []) {
  return defaultServices.map((defaultService) => {
    const savedService = services.find((service) => service.id === defaultService.id)
    return {
      ...defaultService,
      ...savedService,
      url: savedService?.url?.trim() || defaultService.url,
      serviceName: savedService?.serviceName?.trim() || defaultService.serviceName,
      enabled: Boolean(savedService?.enabled ?? defaultService.enabled),
    }
  })
}

type NviCreds = {
  user?: unknown
  pass?: unknown
  useBridge?: unknown
  bridgeUrl?: unknown
  bridgeToken?: unknown
}

type NviSettingsRow = {
  key: string
  value: unknown
}

// KPSV2 koprusu uygulama sunucusunda IIS Express ile localhost:3500'de
// calisir (bkz. app/api/nvi/route.ts). Eski/bos degerler bu adrese
// normalize edilir; NVI_BRIDGE_URL env varsa o kullanilir.
const DEFAULT_BRIDGE_URL = process.env.NVI_BRIDGE_URL?.trim() || 'http://localhost:3500/master.asmx'

function normalizeCreds(creds: NviCreds = {}) {
  const rawBridgeUrl = typeof creds.bridgeUrl === 'string' ? creds.bridgeUrl.trim() : ''
  const isLegacyDefault = /^http:\/\/(?:(?:localhost|127\.0\.0\.1):51331\/master\.asmx|(?:localhost|127\.0\.0\.1):3500(?:\/master\.asmx)?|10\.0\.0\.183:3500(?:\/master\.asmx)?)\/?$/i.test(rawBridgeUrl)
  const bridgeUrl = (!rawBridgeUrl || isLegacyDefault) ? DEFAULT_BRIDGE_URL : rawBridgeUrl

  return {
    user: typeof creds.user === 'string' ? creds.user : '',
    pass: typeof creds.pass === 'string' ? creds.pass : '',
    useBridge: typeof creds.useBridge === 'boolean' ? creds.useBridge : true,
    bridgeUrl,
    bridgeToken: typeof creds.bridgeToken === 'string' ? creds.bridgeToken : '',
  }
}

async function ensureNviSettingsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sistem_ayarlar (
      key text PRIMARY KEY,
      value text,
      updated_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
    )
  `
}

export async function GET() {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    await ensureNviSettingsTable()

    const settings = await prisma.$queryRaw<NviSettingsRow[]>`SELECT key, value FROM sistem_ayarlar WHERE key IN ('nvi_services', 'nvi_creds')`
    const nviServices = settings.find(s => s.key === 'nvi_services')
    const nviCreds = settings.find(s => s.key === 'nvi_creds')
    const services = normalizeServices(parseSettingValue<Partial<NviService>[]>(nviServices?.value, []))
    const creds = normalizeCreds(parseSettingValue(nviCreds?.value, { user: '', pass: '' }))
    
    return NextResponse.json({
      success: true,
      data: services,
      creds,
    })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const { services, creds } = body
    
    const servicesValue = JSON.stringify(normalizeServices(services))
    const credsValue = JSON.stringify(normalizeCreds(creds))

    await ensureNviSettingsTable()
    
    // Save services
    const existingServices = await prisma.$queryRaw<NviSettingsRow[]>`SELECT key FROM sistem_ayarlar WHERE key = 'nvi_services'`
    if (existingServices.length > 0) {
      await prisma.$executeRaw`UPDATE sistem_ayarlar SET value = ${servicesValue}, updated_at = CURRENT_TIMESTAMP WHERE key = 'nvi_services'`
    } else {
      await prisma.$executeRaw`INSERT INTO sistem_ayarlar (key, value) VALUES ('nvi_services', ${servicesValue})`
    }

    // Save creds
    const existingCreds = await prisma.$queryRaw<NviSettingsRow[]>`SELECT key FROM sistem_ayarlar WHERE key = 'nvi_creds'`
    if (existingCreds.length > 0) {
      await prisma.$executeRaw`UPDATE sistem_ayarlar SET value = ${credsValue}, updated_at = CURRENT_TIMESTAMP WHERE key = 'nvi_creds'`
    } else {
      await prisma.$executeRaw`INSERT INTO sistem_ayarlar (key, value) VALUES ('nvi_creds', ${credsValue})`
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}

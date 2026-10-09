import Firebird from 'node-firebird'
import { prisma } from '@/lib/db/prisma'

// Wolvox (AKINSOFT) muhasebe/stok programinin Firebird veritabanina disaridan
// (statik IP + acik port uzerinden) baglanmak icin kullanilan servis.
// Baglanti bilgileri (host/port/dosya yolu/kullanici/sifre) sistem_ayarlar
// tablosunda (NVI kimlik bilgileriyle AYNI tablo/desen, bkz.
// app/api/settings/nvi/route.ts) tek bir JSON satiri olarak saklanir.

const SETTINGS_KEY = 'wolvox_connection'
const DEFAULT_PORT = 3050
const CONNECT_TIMEOUT_MS = 8000

export type WolvoxConnectionConfig = {
  host: string
  port: number
  database: string
  user: string
  password: string
}

type SettingsRow = {
  key: string
  value: unknown
}

async function ensureSettingsTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sistem_ayarlar (
      key text PRIMARY KEY,
      value text,
      updated_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
    )
  `
}

function parseConfig(rawValue: unknown): WolvoxConnectionConfig | null {
  if (!rawValue) return null

  let parsed: Record<string, unknown>
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : (rawValue as Record<string, unknown>)
  } catch {
    return null
  }

  const host = typeof parsed.host === 'string' ? parsed.host.trim() : ''
  const database = typeof parsed.database === 'string' ? parsed.database.trim() : ''
  if (!host || !database) return null

  return {
    host,
    port: Number(parsed.port) || DEFAULT_PORT,
    database,
    user: typeof parsed.user === 'string' && parsed.user.trim() ? parsed.user.trim() : 'SYSDBA',
    password: typeof parsed.password === 'string' ? parsed.password : '',
  }
}

export async function getWolvoxConnectionConfig(): Promise<WolvoxConnectionConfig | null> {
  await ensureSettingsTable()
  const rows = await prisma.$queryRaw<SettingsRow[]>`SELECT key, value FROM sistem_ayarlar WHERE key = ${SETTINGS_KEY}`
  return parseConfig(rows[0]?.value)
}

export async function saveWolvoxConnectionConfig(config: WolvoxConnectionConfig) {
  await ensureSettingsTable()
  const value = JSON.stringify(config)

  const existing = await prisma.$queryRaw<SettingsRow[]>`SELECT key FROM sistem_ayarlar WHERE key = ${SETTINGS_KEY}`
  if (existing.length > 0) {
    await prisma.$executeRaw`UPDATE sistem_ayarlar SET value = ${value}, updated_at = CURRENT_TIMESTAMP WHERE key = ${SETTINGS_KEY}`
  } else {
    await prisma.$executeRaw`INSERT INTO sistem_ayarlar (key, value) VALUES (${SETTINGS_KEY}, ${value})`
  }
}

export type WolvoxTestResult =
  | { success: true; tableCount: number }
  | { success: false; error: string }

export async function testWolvoxConnection(config: WolvoxConnectionConfig): Promise<WolvoxTestResult> {
  try {
    const db = await Promise.race([
      Firebird.attachAsync({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        lowercase_keys: false,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Bağlantı zaman aşımına uğradı (${CONNECT_TIMEOUT_MS / 1000} sn).`)), CONNECT_TIMEOUT_MS)
      }),
    ])

    try {
      const rows = await db.queryAsync<{ CNT: number }>(
        "SELECT COUNT(*) AS CNT FROM RDB$RELATIONS WHERE RDB$SYSTEM_FLAG = 0 AND RDB$VIEW_BLR IS NULL"
      )
      return { success: true, tableCount: Number(rows[0]?.CNT ?? 0) }
    } finally {
      await db.detachAsync().catch(() => {})
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

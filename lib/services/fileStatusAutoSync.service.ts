import { getSqlMonitorPool } from './sqlMonitor.service'

// Kullanici istegi (2026-10-14): dosya durumu "Yardım Yapılabilir" (3) olan
// ama hicbir AKTIF (durumu=2 "DEVAM EDİYOR") Gıda Bankası / Destek Paketi /
// Ekmek / Hazır Yemek yardimi kalmamis dosyalar otomatik olarak "Yardım
// Yapılamaz" (4) durumuna alinir ve bu kontrol surekli tekrarlanir.
// BILINCLI OLARAK sadece durumu=3 olan dosyalara dokunulur - Yeni Müracaat,
// Ön İnceleme, Tahkikat, Sonuç Bekliyor vb. diger durumlar degistirilmez.
// dosyalar tablosundaki audit tetikleyicisi (trg_audit_dosyalar) her
// degisikligi zaten kayda aldigi icin ayrica log tutulmaz.

const SYNC_INTERVAL_MS = 5 * 60 * 1000
export const FILE_STATUS_AUTO_SYNC_NOTE = 'Aktif gıda/dönem dışı gıda/destek paketi/ekmek/hazır yemek yardımı yok (otomatik)'

// "Aktif yardim" = durumu=2 (DEVAM EDİYOR) Gıda Bankası / Dönem Dışı Gıda /
// Destek Paketi / Ekmek / Hazır Yemek kaydi. Sonuc Bekleyen > Kaydet de
// (api/documents/file-status, autoByActiveAssistance) ayni kurali kullanir.
export const ACTIVE_ASSISTANCE_TABLES = [
  'yrd_gidabankasi',
  'yrd_ddgidadosyali',
  'yrd_destekpaketi',
  'yrd_ekmek',
  'yrd_haziryemek',
] as const

// Beklemedeki (durumu=0 müracaat / 5 "Bekliyor" yardım) "Kış Dönemi" kaydi da aktif sayilir: 01 Kasim'da
// winterSeasonalAid.service.ts onu otomatik yardima donusturur - o gune kadar
// dosya "Yardım Yapılamaz"a dusurulmemeli.
const KIS_DONEMI_TABLES = new Set(['yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_ekmek', 'yrd_haziryemek'])

export function activeAssistanceExistsSql(fileIdExpr: string) {
  return `(${ACTIVE_ASSISTANCE_TABLES.map((table) => {
    const kisDonemi = KIS_DONEMI_TABLES.has(table)
      ? ` OR (x.durumu IN (0, 5) AND x.donem = 'Kış Dönemi' AND x.bittarih >= CURRENT_DATE)`
      : ''
    return `EXISTS (SELECT 1 FROM ${table} x WHERE x.dosyaid = ${fileIdExpr} AND (x.durumu = 2${kisDonemi}))`
  }).join(' OR ')})`
}

const CANDIDATE_CONDITION = `
  d.durumu = 3
  AND NOT ${activeAssistanceExistsSql('d.id')}
`

const globalForFileStatusSync = globalThis as unknown as {
  fileStatusAutoSyncTimer?: ReturnType<typeof setInterval>
  fileStatusAutoSyncRunning?: boolean
}

export async function previewFileStatusAutoSync() {
  const result = await getSqlMonitorPool().query<{ id: string; dosyano: string | null }>(
    `SELECT d.id::text AS id, d.dosyano FROM dosyalar d WHERE ${CANDIDATE_CONDITION} ORDER BY d.id`,
  )
  return result.rows
}

export async function runFileStatusAutoSync() {
  const result = await getSqlMonitorPool().query<{ id: string; dosyano: string | null }>(
    `
      UPDATE dosyalar d
      SET durumu = 4, durumutarih = CURRENT_DATE, durumuaciklama = $1
      WHERE ${CANDIDATE_CONDITION}
      RETURNING d.id::text AS id, d.dosyano
    `,
    [FILE_STATUS_AUTO_SYNC_NOTE],
  )
  return result.rows
}

async function tick() {
  if (globalForFileStatusSync.fileStatusAutoSyncRunning) return
  globalForFileStatusSync.fileStatusAutoSyncRunning = true
  try {
    const changed = await runFileStatusAutoSync()
    if (changed.length) {
      console.log(
        `[Dosya durumu otomatik] ${changed.length} dosya "Yardım Yapılamaz" yapildi: ${changed.map((row) => row.dosyano || row.id).join(', ')}`,
      )
    }
  } catch (error) {
    console.error('[Dosya durumu otomatik] Kontrol basarisiz:', error)
  } finally {
    globalForFileStatusSync.fileStatusAutoSyncRunning = false
  }
}

export function startFileStatusAutoSyncScheduler() {
  if (globalForFileStatusSync.fileStatusAutoSyncTimer) return
  void tick()
  globalForFileStatusSync.fileStatusAutoSyncTimer = setInterval(() => void tick(), SYNC_INTERVAL_MS)
}

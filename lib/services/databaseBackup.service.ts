import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { Pool } from 'pg'
import { createUtcTypeOverrides } from '@/lib/db/pgTypeParsers'

const execFileAsync = promisify(execFile)

export type DatabaseBackupScheduleType = 'daily' | 'weekly'

export interface DatabaseBackupSchedule {
  id: string
  name: string
  enabled: boolean
  databaseNames: string[]
  scheduleType: DatabaseBackupScheduleType
  dayOfWeek: number | null
  timeOfDay: string
  lastRunAt: string | null
  lastStatus: 'idle' | 'success' | 'error'
  lastMessage: string | null
}

export interface DatabaseBackupSettings {
  backupDirectory: string
  postgresBinDirectory: string
  databaseName: string
  databaseNames: string[]
  scheduleEnabled: boolean
  scheduleType: DatabaseBackupScheduleType
  dayOfWeek: number | null
  timeOfDay: string
  schedules: DatabaseBackupSchedule[]
  lastRunAt: string | null
  lastStatus: 'idle' | 'success' | 'error'
  lastMessage: string | null
}

export interface DatabaseBackupFile {
  fileName: string
  fullPath: string
  databaseName: string
  size: number
  createdAt: string
}

export interface DatabaseBackupOption {
  name: string
  label: string
  isCurrent: boolean
}

const SETTINGS_FILE = path.join(process.cwd(), 'backups', 'database-backup-settings.json')
const DEFAULT_BACKUP_DIR = path.join(process.cwd(), 'backups', 'database')

// Kullanici istegi: "sosyalyardimdkm" veritabani, digerlerinden (Efatura_db,
// postgres, sosyalyardim, sosyalyardimlog) FARKLI bir stratejiyle
// yedeklenir - cunku bu veritabaninin "belge" tablosu (54.000+ kayit,
// 16+ GB) TEK PARCA pg_dump denendiginde sunucu tarafinda "yetersiz
// bellek" (OOM) hatasi verdigi GERCEK ortamda GOZLEMLENDI. Bu yuzden:
//   - bireyresim/dizayn/kullanicifoto/kurum_msj: tablo tablo, HER
//     CALISTIGINDA YENIDEN yazilir (uzerine).
//   - belge: YIL BAZLI ayri dosyalara bolunur - GECMIS (kapanmis) yillar
//     SADECE BIR KEZ yedeklenir (bir daha degismeyecekleri icin), sadece
//     GUNCEL yilin belgeleri HER CALISTIGINDA yeniden yedeklenir. Boylece
//     her yedeklemede 16+ GB'in TAMAMI degil, sadece o yilin (cok daha
//     kucuk) kismi tekrar islenir.
const DKM_DATABASE_NAME = 'sosyalyardimdkm'
const DKM_SIMPLE_TABLES = ['bireyresim', 'dizayn', 'kullanicifoto', 'kurum_msj']

const defaultSettings: DatabaseBackupSettings = {
  backupDirectory: DEFAULT_BACKUP_DIR,
  postgresBinDirectory: '',
  databaseName: '',
  databaseNames: [],
  scheduleEnabled: false,
  scheduleType: 'daily',
  dayOfWeek: null,
  timeOfDay: '02:00',
  schedules: [],
  lastRunAt: null,
  lastStatus: 'idle',
  lastMessage: null,
}

const globalForDatabaseBackup = globalThis as unknown as {
  databaseBackupTimer?: ReturnType<typeof setInterval>
  databaseBackupRunning?: boolean
}

const ensureParentDirectory = async (filePath: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

// turbopackIgnore: bu servisteki yedekleme dizini KULLANICI TANIMLI (ayarlardan
// herhangi bir surucu/klasor secilebilir) - statik bir alt klasore
// sabitlenemez. Bu dosyadaki TUM dinamik fs/path cagrilarina ayni nedenle
// turbopackIgnore eklendi: Turbopack build sirasinda bunlari izlemeye
// calisip TUM PROJEYI (public/ dahil) build ciktisina dahil ediyor, derlemeyi
// ciddi sekilde yavaslatiyordu. Bu, salt build-zamani izlemeyi kapatir -
// calisma zamaninda islev AYNEN devam eder.
const resolveBackupDirectory = (directory: string) => {
  const trimmedDirectory = directory.trim()
  if (!trimmedDirectory) return DEFAULT_BACKUP_DIR
  return path.isAbsolute(trimmedDirectory) ? trimmedDirectory : path.join(/* turbopackIgnore: true */ process.cwd(), trimmedDirectory)
}

const getDatabaseUrl = () => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL tanimli degil.')
  return databaseUrl
}

const getDatabaseName = () => {
  const databaseUrl = new URL(getDatabaseUrl())
  return decodeURIComponent(databaseUrl.pathname.replace(/^\//, '')) || 'database'
}

const getSafeDatabaseName = (databaseName: string) => {
  return (databaseName || getDatabaseName()).replace(/[^a-zA-Z0-9_-]/g, '_') || 'database'
}

// Kullanici istegi: her veritabaninin yedegi KENDI (veritabani adiyla
// adlandirilmis) alt klasorune alinsin - boylece Z:\SUNUCU_YEDEK gibi bir
// hedefte butun veritabanlarinin yedekleri birbirine karismadan, duzenli
// klasorlerde durur.
const getDatabaseFolder = (backupDirectory: string, databaseName: string) => (
  path.join(/* turbopackIgnore: true */ backupDirectory, getSafeDatabaseName(databaseName))
)

const getDirectorySize = async (directory: string): Promise<number> => {
  let total = 0
  const entries = await fs.readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true }).catch(() => null)
  if (!entries) return 0
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      total += await getDirectorySize(entryPath)
    } else if (entry.isFile()) {
      const stats = await fs.stat(entryPath).catch(() => null)
      if (stats) total += stats.size
    }
  }
  return total
}

const inferDatabaseNameFromFileName = (fileName: string) => {
  const match = fileName.match(/^(.+)-\d{4}-\d{2}-\d{2}T/)
  return match?.[1] || ''
}

const getCommandPath = (commandName: string, postgresBinDirectory: string) => {
  const trimmedDirectory = postgresBinDirectory.trim()
  return trimmedDirectory ? path.join(trimmedDirectory, commandName) : commandName
}

const normalizeTimeOfDay = (value: string) => (/^\d{2}:\d{2}$/.test(value) ? value : '02:00')

const uniqueDatabaseNames = (values: unknown, fallback: string[] = []) => {
  const rawValues = Array.isArray(values) ? values : []
  const names = rawValues
    .map((value) => String(value || '').trim())
    .filter(Boolean)

  return Array.from(new Set(names.length > 0 ? names : fallback.filter(Boolean)))
}

const createScheduleId = () => `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const normalizeSchedule = (
  input: Partial<DatabaseBackupSchedule>,
  fallbackDatabaseNames: string[],
  index: number,
): DatabaseBackupSchedule => {
  const scheduleType = input.scheduleType === 'weekly' ? 'weekly' : 'daily'

  return {
    id: String(input.id || createScheduleId()),
    name: String(input.name || `Program ${index + 1}`),
    enabled: Boolean(input.enabled ?? true),
    databaseNames: uniqueDatabaseNames(input.databaseNames, fallbackDatabaseNames),
    scheduleType,
    dayOfWeek: scheduleType === 'weekly' ? input.dayOfWeek ?? 1 : null,
    timeOfDay: normalizeTimeOfDay(input.timeOfDay || defaultSettings.timeOfDay),
    lastRunAt: input.lastRunAt || null,
    lastStatus: input.lastStatus === 'success' || input.lastStatus === 'error' ? input.lastStatus : 'idle',
    lastMessage: input.lastMessage || null,
  }
}

const runPostgresCommand = async (
  commandName: string,
  args: string[],
  postgresBinDirectory: string,
) => {
  const databaseUrl = new URL(getDatabaseUrl())
  const env = {
    ...process.env,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port || '5432',
    PGUSER: decodeURIComponent(databaseUrl.username || ''),
    PGPASSWORD: decodeURIComponent(databaseUrl.password || ''),
  }

  try {
    return await execFileAsync(getCommandPath(commandName, postgresBinDirectory), args, {
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 20,
    })
  } catch (error) {
    const errorCode = typeof error === 'object' && error && 'code' in error
      ? String(error.code || '')
      : ''
    const detail = errorCode ? ` Hata kodu: ${errorCode}.` : ''
    throw new Error(`${commandName} calistirilamadi. PostgreSQL bin klasorunu ve baglanti ayarlarini kontrol edin.${detail}`)
  }
}

const updateRunStatus = async (
  status: DatabaseBackupSettings['lastStatus'],
  message: string,
  scheduleId?: string,
) => {
  const settings = await databaseBackupService.getSettings()
  const lastRunAt = new Date().toISOString()
  await databaseBackupService.saveSettings({
    ...settings,
    schedules: settings.schedules.map((schedule) => (
      schedule.id === scheduleId
        ? { ...schedule, lastRunAt, lastStatus: status, lastMessage: message }
        : schedule
    )),
    lastRunAt,
    lastStatus: status,
    lastMessage: message,
  })
}

// Kullanici istegi: "belge" tablosu YIL BAZLI yedeklenir - RESTORE_TALIMATI.txt
// bu klasore otomatik yazilir, restore sirasi adim adim anlatilir (once
// sema, sonra yil dosyalari SIRAYLA - hangi sirayla olursa olsun sonuc
// aynidir cunku her yil dosyasi BIRBIRINDEN BAGIMSIZ/CAKISMAYAN satirlar
// icerir).
const buildRestoreInstructions = () => (
  `belge tablosunu geri yuklemek icin (PowerShell'de, sirayla):\n\n` +
  `1) Once tablo yapisini olustur:\n` +
  `   psql -U postgres -h localhost -d ${DKM_DATABASE_NAME} -f "belge_yillik/belge_schema.sql"\n\n` +
  `2) Her yil dosyasini SIRAYLA (hangi sirayla olursa olsun fark etmez) veriyle doldur:\n` +
  `   psql -U postgres -h localhost -d ${DKM_DATABASE_NAME} -c "\\copy public.belge FROM 'belge_yillik/belge_2022.copy' WITH (FORMAT binary)"\n` +
  `   ... (bu klasordeki TUM belge_YIL.copy dosyalari icin tekrarla, ayrica varsa belge_tarihsiz.copy)\n\n` +
  `3) Diger tablolari pg_restore ile geri yukle:\n` +
  `   pg_restore -U postgres -h localhost -d ${DKM_DATABASE_NAME} --clean --if-exists --no-owner --no-privileges "bireyresim.dump"\n` +
  `   (dizayn.dump, kullanicifoto.dump, kurum_msj.dump icin de ayni sekilde tekrarla)\n\n` +
  `Her yil dosyasi SADECE KENDI yiline ait, birbiriyle CAKISMAYAN satirlari icerir -\n` +
  `bu yuzden hangi sirayla yuklenirse yuklensin sonuc ayni ve eksiksiz olur.\n` +
  `NOT: Bu klasordeki "Yedek Al" butonuyla otomatik restore icin Ayarlar > Sistem\n` +
  `Ayarlari > Veritabani Islemleri > Restore ozelligini de kullanabilirsiniz.\n`
)

// sosyalyardimdkm.belge disindaki tablolar + belge'nin kendisi icin YIL
// BAZLI yedekleme - bkz. dosya basindaki aciklama.
const createDkmBackup = async (dkmFolder: string, postgresBinDirectory: string) => {
  await fs.mkdir(dkmFolder, { recursive: true })

  for (const tbl of DKM_SIMPLE_TABLES) {
    const outFile = path.join(dkmFolder, `${tbl}.dump`)
    await runPostgresCommand('pg_dump', [
      '--dbname', DKM_DATABASE_NAME, '-Fc', '-t', `public.${tbl}`, '-f', outFile,
    ], postgresBinDirectory)
  }

  const belgeDir = path.join(dkmFolder, 'belge_yillik')
  await fs.mkdir(belgeDir, { recursive: true })

  const schemaFile = path.join(belgeDir, 'belge_schema.sql')
  await runPostgresCommand('pg_dump', [
    '--dbname', DKM_DATABASE_NAME, '--schema-only', '--clean', '--if-exists', '-t', 'public.belge', '-f', schemaFile,
  ], postgresBinDirectory)

  const yearsResult = await runPostgresCommand('psql', [
    '--dbname', DKM_DATABASE_NAME, '-t', '-A', '-c',
    'SELECT DISTINCT EXTRACT(YEAR FROM COALESCE(ilkislemtarihi, islemtarihi))::int FROM public.belge WHERE COALESCE(ilkislemtarihi, islemtarihi) IS NOT NULL ORDER BY 1;',
  ], postgresBinDirectory)
  const years = String(yearsResult.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .map((line) => Number(line))
  const currentYear = new Date().getFullYear()

  // Tarihi hic olmayan (NULL) kayitlar - hangi yila ait oldugu belli
  // olmadigi icin "gecmis" sayilip SADECE BIR KEZ yedeklenir.
  const nullDateFile = path.join(belgeDir, 'belge_tarihsiz.copy')
  const nullFileExists = await fs.access(nullDateFile).then(() => true).catch(() => false)
  if (!nullFileExists) {
    const nullCountResult = await runPostgresCommand('psql', [
      '--dbname', DKM_DATABASE_NAME, '-t', '-A', '-c',
      'SELECT COUNT(*) FROM public.belge WHERE ilkislemtarihi IS NULL AND islemtarihi IS NULL;',
    ], postgresBinDirectory)
    if (Number(String(nullCountResult.stdout).trim()) > 0) {
      await runPostgresCommand('psql', [
        '--dbname', DKM_DATABASE_NAME, '-c',
        `\\copy (SELECT * FROM public.belge WHERE ilkislemtarihi IS NULL AND islemtarihi IS NULL) TO '${nullDateFile}' WITH (FORMAT binary)`,
      ], postgresBinDirectory)
    }
  }

  for (const year of years) {
    const yearFile = path.join(belgeDir, `belge_${year}.copy`)
    if (year !== currentYear) {
      const alreadyBackedUp = await fs.access(yearFile).then(() => true).catch(() => false)
      if (alreadyBackedUp) continue // gecmis yil, degismez, tekrar yedeklenmez
    }
    await runPostgresCommand('psql', [
      '--dbname', DKM_DATABASE_NAME, '-c',
      `\\copy (SELECT * FROM public.belge WHERE EXTRACT(YEAR FROM COALESCE(ilkislemtarihi, islemtarihi))::int = ${year}) TO '${yearFile}' WITH (FORMAT binary)`,
    ], postgresBinDirectory)
  }

  await fs.writeFile(path.join(dkmFolder, 'RESTORE_TALIMATI.txt'), buildRestoreInstructions(), 'utf-8')
  await fs.writeFile(path.join(dkmFolder, '.last-updated'), new Date().toISOString(), 'utf-8')

  return { fileName: DKM_DATABASE_NAME, fullPath: dkmFolder, databaseName: DKM_DATABASE_NAME }
}

const restoreDkmBackup = async (dkmFolder: string, postgresBinDirectory: string) => {
  await fs.access(dkmFolder)

  const belgeDir = path.join(dkmFolder, 'belge_yillik')
  const schemaFile = path.join(belgeDir, 'belge_schema.sql')
  const schemaExists = await fs.access(schemaFile).then(() => true).catch(() => false)
  if (schemaExists) {
    await runPostgresCommand('psql', [
      '--dbname', DKM_DATABASE_NAME, '-v', 'ON_ERROR_STOP=1', '-f', schemaFile,
    ], postgresBinDirectory)

    const belgeEntries = await fs.readdir(belgeDir, { withFileTypes: true }).catch(() => [])
    const yearFiles = belgeEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.copy'))
      .map((entry) => entry.name)
    for (const yearFileName of yearFiles) {
      const fullPath = path.join(belgeDir, yearFileName)
      await runPostgresCommand('psql', [
        '--dbname', DKM_DATABASE_NAME, '-c', `\\copy public.belge FROM '${fullPath}' WITH (FORMAT binary)`,
      ], postgresBinDirectory)
    }
  }

  for (const tbl of DKM_SIMPLE_TABLES) {
    const dumpFile = path.join(dkmFolder, `${tbl}.dump`)
    const dumpExists = await fs.access(dumpFile).then(() => true).catch(() => false)
    if (!dumpExists) continue
    await runPostgresCommand('pg_restore', [
      '--dbname', DKM_DATABASE_NAME, '--clean', '--if-exists', '--no-owner', '--no-privileges', dumpFile,
    ], postgresBinDirectory)
  }

  await updateRunStatus('success', `${DKM_DATABASE_NAME} veritabanı (tablo tablo + belge yıl bazlı) geri yüklendi.`)
  return { fileName: DKM_DATABASE_NAME, fullPath: dkmFolder, databaseName: DKM_DATABASE_NAME }
}

export const databaseBackupService = {
  async getSettings(): Promise<DatabaseBackupSettings> {
    try {
      const raw = await fs.readFile(SETTINGS_FILE, 'utf-8')
      const loaded = JSON.parse(raw) as Partial<DatabaseBackupSettings>
      const currentDatabaseName = getDatabaseName()
      const fallbackDatabaseNames = uniqueDatabaseNames(
        loaded.databaseNames,
        [loaded.databaseName || currentDatabaseName]
      )
      const loadedSchedules = Array.isArray(loaded.schedules) ? loaded.schedules : []
      const schedules = loadedSchedules.length > 0
        ? loadedSchedules.map((schedule, index) => normalizeSchedule(schedule, fallbackDatabaseNames, index))
        : [normalizeSchedule({
            id: 'default',
            name: 'Varsayilan Program',
            enabled: loaded.scheduleEnabled ?? false,
            databaseNames: fallbackDatabaseNames,
            scheduleType: loaded.scheduleType,
            dayOfWeek: loaded.dayOfWeek,
            timeOfDay: loaded.timeOfDay,
            lastRunAt: loaded.lastRunAt,
            lastStatus: loaded.lastStatus,
            lastMessage: loaded.lastMessage,
          }, fallbackDatabaseNames, 0)]
      return {
        ...defaultSettings,
        ...loaded,
        backupDirectory: loaded.backupDirectory || DEFAULT_BACKUP_DIR,
        postgresBinDirectory: loaded.postgresBinDirectory || '',
        databaseName: loaded.databaseName || currentDatabaseName,
        databaseNames: fallbackDatabaseNames,
        scheduleType: loaded.scheduleType === 'weekly' ? 'weekly' : 'daily',
        dayOfWeek: Number.isInteger(loaded.dayOfWeek) ? loaded.dayOfWeek ?? null : null,
        timeOfDay: normalizeTimeOfDay(loaded.timeOfDay || defaultSettings.timeOfDay),
        schedules,
      }
    } catch {
      const currentDatabaseName = getDatabaseName()
      return {
        ...defaultSettings,
        databaseName: currentDatabaseName,
        databaseNames: [currentDatabaseName],
        schedules: [normalizeSchedule({
          id: 'default',
          name: 'Varsayilan Program',
          enabled: false,
          databaseNames: [currentDatabaseName],
        }, [currentDatabaseName], 0)],
      }
    }
  },

  async saveSettings(input: Partial<DatabaseBackupSettings>): Promise<DatabaseBackupSettings> {
    const current = await this.getSettings()
    const scheduleType = input.scheduleType ?? current.scheduleType
    const databaseName = (input.databaseName ?? current.databaseName ?? getDatabaseName()).trim()
    const databaseNames = uniqueDatabaseNames(input.databaseNames, [databaseName || getDatabaseName()])
    const schedules = (Array.isArray(input.schedules) ? input.schedules : current.schedules)
      .map((schedule, index) => normalizeSchedule(schedule, databaseNames, index))
    const next: DatabaseBackupSettings = {
      ...current,
      ...input,
      backupDirectory: resolveBackupDirectory(input.backupDirectory ?? current.backupDirectory),
      postgresBinDirectory: (input.postgresBinDirectory ?? current.postgresBinDirectory).trim(),
      databaseName: databaseName || getDatabaseName(),
      databaseNames,
      scheduleType: scheduleType === 'weekly' ? 'weekly' : 'daily',
      dayOfWeek: scheduleType === 'weekly' ? input.dayOfWeek ?? current.dayOfWeek ?? 1 : null,
      timeOfDay: normalizeTimeOfDay(input.timeOfDay ?? current.timeOfDay),
      scheduleEnabled: Boolean(input.scheduleEnabled ?? current.scheduleEnabled),
      schedules,
    }

    await ensureParentDirectory(SETTINGS_FILE)
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8')
    return next
  },

  // Kullanici istegi: her veritabaninin yedegi KENDI adiyla adlandirilmis
  // alt klasorde durur - bu yuzden liste, KOK klasordeki DOSYALAR yerine
  // ALT KLASORLERI tarar. "sosyalyardimdkm" klasoru ozel/tek bir toplu
  // yedek olarak (tablo tablo + belge yil bazli), digerleri ise icindeki
  // her .sql dosyasi AYRI bir yedek olarak listelenir (her calistirmada
  // yeni bir zaman damgali dosya eklendigi icin birden fazla gecmis
  // yedek birikebilir).
  async listBackups(): Promise<DatabaseBackupFile[]> {
    const settings = await this.getSettings()
    const backupDirectory = resolveBackupDirectory(settings.backupDirectory)
    await fs.mkdir(backupDirectory, { recursive: true })
    const rootEntries = await fs.readdir(/* turbopackIgnore: true */ backupDirectory, { withFileTypes: true })

    const results: DatabaseBackupFile[] = []

    // Geriye donuk uyumluluk: eski (klasorlere ayrilmadan onceki) surumde
    // olusturulmus, KOK klasordeki duz .sql dosyalari da listeden kaybolmasin.
    for (const entry of rootEntries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sql')) continue
      const fullPath = path.join(/* turbopackIgnore: true */ backupDirectory, entry.name)
      const stats = await fs.stat(/* turbopackIgnore: true */ fullPath).catch(() => null)
      if (!stats) continue
      results.push({
        fileName: entry.name,
        fullPath,
        databaseName: inferDatabaseNameFromFileName(entry.name),
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
      })
    }

    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue
      const folderPath = path.join(/* turbopackIgnore: true */ backupDirectory, entry.name)

      if (entry.name === getSafeDatabaseName(DKM_DATABASE_NAME)) {
        const size = await getDirectorySize(folderPath)
        let createdAt = new Date().toISOString()
        try {
          createdAt = (await fs.readFile(path.join(/* turbopackIgnore: true */ folderPath, '.last-updated'), 'utf-8')).trim()
        } catch {
          const stats = await fs.stat(/* turbopackIgnore: true */ folderPath).catch(() => null)
          if (stats) createdAt = stats.mtime.toISOString()
        }
        results.push({
          fileName: DKM_DATABASE_NAME,
          fullPath: folderPath,
          databaseName: DKM_DATABASE_NAME,
          size,
          createdAt,
        })
        continue
      }

      const innerEntries = await fs.readdir(/* turbopackIgnore: true */ folderPath, { withFileTypes: true }).catch(() => [])
      for (const innerEntry of innerEntries) {
        if (!innerEntry.isFile() || !innerEntry.name.toLowerCase().endsWith('.sql')) continue
        const fullPath = path.join(/* turbopackIgnore: true */ folderPath, innerEntry.name)
        const stats = await fs.stat(/* turbopackIgnore: true */ fullPath).catch(() => null)
        if (!stats) continue
        results.push({
          fileName: innerEntry.name,
          fullPath,
          databaseName: entry.name,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
        })
      }
    }

    return results.sort((firstFile, secondFile) => (
      new Date(secondFile.createdAt).getTime() - new Date(firstFile.createdAt).getTime()
    ))
  },

  async listDatabaseOptions(): Promise<DatabaseBackupOption[]> {
    const currentDatabaseName = getDatabaseName()
    const settings = await this.getSettings()
    const selectedDatabaseName = settings.databaseName || currentDatabaseName
    const pool = new Pool({ connectionString: getDatabaseUrl(), types: createUtcTypeOverrides() } as any)

    try {
      const result = await pool.query<{ datname: string }>(`
        select datname
        from pg_database
        where datallowconn = true
          and datistemplate = false
        order by datname asc
      `)
    const names = new Set([
      currentDatabaseName,
      selectedDatabaseName,
      ...settings.databaseNames,
      ...settings.schedules.flatMap((schedule) => schedule.databaseNames),
      ...result.rows.map((row) => row.datname),
    ].filter(Boolean))

      return Array.from(names).map((name) => ({
        name,
        label: name === currentDatabaseName ? `${name} (DATABASE_URL)` : name,
        isCurrent: name === currentDatabaseName,
      }))
  } catch {
      const names = new Set([
        currentDatabaseName,
        selectedDatabaseName,
        ...settings.databaseNames,
        ...settings.schedules.flatMap((schedule) => schedule.databaseNames),
      ].filter(Boolean))
      return Array.from(names).map((name) => ({
        name,
        label: name === currentDatabaseName ? `${name} (DATABASE_URL)` : name,
        isCurrent: name === currentDatabaseName,
      }))
    } finally {
      await pool.end()
    }
  },

  async createBackup(databaseNameInput?: string) {
    const settings = await this.getSettings()
    const backupDirectory = resolveBackupDirectory(settings.backupDirectory)
    await fs.mkdir(backupDirectory, { recursive: true })

    const targetDatabaseName = databaseNameInput || settings.databaseName
    const databaseFolder = getDatabaseFolder(backupDirectory, targetDatabaseName)
    await fs.mkdir(databaseFolder, { recursive: true })

    // Kullanici istegi: sosyalyardimdkm, "belge" tablosunun devasa boyutu
    // (OOM riski) yuzunden farkli/ozel bir yontemle (tablo tablo + belge
    // yil bazli) yedeklenir - bkz. dosya basindaki aciklama.
    if (targetDatabaseName === DKM_DATABASE_NAME) {
      return createDkmBackup(databaseFolder, settings.postgresBinDirectory)
    }

    const databaseName = getSafeDatabaseName(targetDatabaseName)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `${databaseName}-${timestamp}.sql`
    const fullPath = path.join(databaseFolder, fileName)

    await runPostgresCommand('pg_dump', [
      '--dbname',
      targetDatabaseName,
      '--format=plain',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--file',
      fullPath,
    ], settings.postgresBinDirectory)

    return { fileName, fullPath, databaseName: targetDatabaseName }
  },

  async createBackups(databaseNamesInput?: string[], scheduleId?: string) {
    const settings = await this.getSettings()
    const databaseNames = uniqueDatabaseNames(databaseNamesInput, settings.databaseNames)
    if (databaseNames.length === 0) {
      throw new Error('Yedek alinacak en az bir veritabani secin.')
    }

    const backups = []
    for (const databaseName of databaseNames) {
      backups.push(await this.createBackup(databaseName))
    }

    await updateRunStatus(
      'success',
      `${databaseNames.join(', ')} veritabanlari icin ${backups.length} yedek alindi.`,
      scheduleId,
    )
    return backups
  },

  async restoreBackup(fileName: string) {
    const settings = await this.getSettings()
    const backupDirectory = resolveBackupDirectory(settings.backupDirectory)
    const safeFileName = path.basename(fileName)

    // sosyalyardimdkm: tek bir "toplu" yedek girisi olarak listelenir
    // (fileName === DKM_DATABASE_NAME) - restore'u da kendine ozel akisla
    // (once sema, sonra belge yil dosyalari, sonra diger tablolar) yapilir.
    if (safeFileName === DKM_DATABASE_NAME) {
      const dkmFolder = getDatabaseFolder(backupDirectory, DKM_DATABASE_NAME)
      return restoreDkmBackup(dkmFolder, settings.postgresBinDirectory)
    }

    // Digerleri: dosya, KOK klasorde (eski/geriye donuk uyumluluk) ya da
    // kendi veritabani alt klasorunde olabilir - ikisi de aranir.
    const rootPath = path.join(/* turbopackIgnore: true */ backupDirectory, safeFileName)
    const rootExists = await fs.access(rootPath).then(() => true).catch(() => false)

    let fullPath = rootPath
    if (!rootExists) {
      const rootEntries = await fs.readdir(/* turbopackIgnore: true */ backupDirectory, { withFileTypes: true }).catch(() => [])
      let found = ''
      for (const entry of rootEntries) {
        if (!entry.isDirectory()) continue
        const candidate = path.join(/* turbopackIgnore: true */ backupDirectory, entry.name, safeFileName)
        if (await fs.access(candidate).then(() => true).catch(() => false)) {
          found = candidate
          break
        }
      }
      if (!found) throw new Error('Belirtilen yedek dosyası bulunamadı.')
      fullPath = found
    }

    const resolvedBackupDirectory = path.resolve(/* turbopackIgnore: true */ backupDirectory)
    const resolvedFilePath = path.resolve(/* turbopackIgnore: true */ fullPath)
    if (!resolvedFilePath.startsWith(resolvedBackupDirectory)) {
      throw new Error('Gecersiz yedek dosyasi.')
    }

    await fs.access(resolvedFilePath)
    const targetDatabaseName = inferDatabaseNameFromFileName(safeFileName)
      || path.basename(path.dirname(resolvedFilePath))
      || settings.databaseName
    await runPostgresCommand('psql', [
      '--dbname',
      targetDatabaseName,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      resolvedFilePath,
    ], settings.postgresBinDirectory)

    await updateRunStatus('success', `${safeFileName} geri yuklendi.`)
    return { fileName: safeFileName, fullPath: resolvedFilePath, databaseName: targetDatabaseName }
  },

  startScheduler() {
    if (globalForDatabaseBackup.databaseBackupTimer) return

    globalForDatabaseBackup.databaseBackupTimer = setInterval(async () => {
      if (globalForDatabaseBackup.databaseBackupRunning) return
      globalForDatabaseBackup.databaseBackupRunning = true

      try {
        const settings = await this.getSettings()
        if (!settings.scheduleEnabled) return

        const now = new Date()
        const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const currentDay = now.getDay()
        const runnableSchedules = settings.schedules.filter((schedule) => {
          if (!schedule.enabled) return false
          const shouldRun = schedule.scheduleType === 'daily'
            ? schedule.timeOfDay === currentTime
            : schedule.timeOfDay === currentTime && schedule.dayOfWeek === currentDay

          if (!shouldRun) return false

          const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null
          return !(
            lastRun
            && lastRun.getFullYear() === now.getFullYear()
            && lastRun.getMonth() === now.getMonth()
            && lastRun.getDate() === now.getDate()
            && lastRun.getHours() === now.getHours()
            && lastRun.getMinutes() === now.getMinutes()
          )
        })

        for (const schedule of runnableSchedules) {
          try {
            await this.createBackups(schedule.databaseNames, schedule.id)
          } catch (error) {
            await updateRunStatus(
              'error',
              error instanceof Error ? error.message : 'Yedekleme hatasi olustu.',
              schedule.id,
            )
          }
        }
      } catch (error) {
        await updateRunStatus('error', error instanceof Error ? error.message : 'Yedekleme hatasi olustu.')
      } finally {
        globalForDatabaseBackup.databaseBackupRunning = false
      }
    }, 60000)
  },
}

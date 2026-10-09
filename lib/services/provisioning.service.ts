import 'server-only'

// Bu uygulama BAŞKA bir kuruma/bilgisayara verildiğinde, o bilgisayarda
// PostgreSQL SUNUCUSU (motor) zaten kurulu olur ama SOSYALYARDIM
// VERİTABANI ve içindeki TABLOLAR henüz yoktur. Bu servis, uygulama
// açıldığında bunu fark edip - kullanıcının AÇIKÇA ONAYLAMASI şartıyla -
// veritabanını, tüm tabloları (mevcut Prisma migration geçmişinden) ve ilk
// yönetici kullanıcısını kendi kendine oluşturur.
//
// GÜVENLİK/GERİYE UYUMLULUK: mevcut (canlı, verisi dolu) kurulumlarda bu
// kontrol HER ZAMAN "ready" (kurulu) sonucunu döner ve HİÇBİR ŞEY YAPMAZ -
// tetiklenme koşulu sadece "kullanicilar tablosu yok YA DA tablo var ama
// hiç satırı yok" durumudur (bkz. computeProvisioningState). Herhangi bir
// beklenmeyen hata durumunda da (ör. bağlantı sorunları) sistem KURULUM
// GEREKİYORMUŞ GİBİ DAVRANMAZ - "error" döner, kurulum denemez (yanlış
// şifre gibi durumlarda anlamsız CREATE DATABASE denemelerinin önüne geçer).
//
// Kurulum tetiklenmesi: app/kurulum/page.tsx (herkese açık, oturum
// gerektirmeyen sayfa) -> app/api/setup/provision/route.ts -> runProvisioning().
// İlk admin kullanıcısı VERİTABANI DIŞINDA, bu bilgisayara özel .env.local
// dosyasındaki BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD
// değerlerinden oluşturulur - kod içine GÖMÜLÜ bir varsayılan şifre YOKTUR.
import { Pool } from 'pg'
import path from 'path'
import { execFile } from 'child_process'
import { prisma } from '@/lib/db/prisma'
import { userService } from '@/lib/services/user.service'
import { withAuditedWrite } from '@/lib/db/auditContext'
import type { IUser } from '@/lib/types'

type AuditMeta = { ip?: string | null; path?: string | null }

export type ProvisioningState =
  | { status: 'ready' }
  | { status: 'needs-setup'; reason: 'no-database' | 'no-tables' | 'no-admin' }
  | { status: 'provisioning'; step: string }
  | { status: 'error'; message: string }

// Ayni anda birden fazla istek gelse bile veritabani DURUMU bir kez
// hesaplanip bellekte tutulur - "ready" oldugu ANLASILDIKTAN SONRA bir
// daha ASLA veritabanina sorgu atilmaz (canli sistemde sifir ek yuk).
let cachedState: ProvisioningState | null = null
let inFlightCheck: Promise<ProvisioningState> | null = null
// Ayni anda iki "kurulumu onayla" tiklamasi (ör. cift tiklama, iki farkli
// sekme) AYNI ANDA calismasin diye.
let provisioningInFlight: Promise<{ ok: boolean; message: string }> | null = null

// Projenin kendi 'pg' tip tanimi (bkz. types/pg.d.ts) SADECE connectionString/max
// alanlarini destekliyor - bu yuzden host/port/user/sifre yerine, hedef
// veritabani adini degistirerek AYNI DATABASE_URL'den yeni bir baglanti
// dizesi turetiyoruz (bkz. withDatabaseName). Bu, "veritabanini olusturmak
// icin ONCE var olan 'postgres' bakim veritabanina baglan" adiminda gerekir.
function getDatabaseNameFromUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function computeProvisioningState(): Promise<ProvisioningState> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    return { status: 'error', message: 'DATABASE_URL tanımlı değil (.env.local dosyasını kontrol edin).' }
  }

  try {
    getDatabaseNameFromUrl(databaseUrl)
  } catch {
    return { status: 'error', message: 'DATABASE_URL formatı geçersiz.' }
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 })

  try {
    const tableCheck = await pool.query<{ reg: string | null }>(`SELECT to_regclass('public.kullanicilar')::text AS reg`)
    if (!tableCheck.rows[0]?.reg) {
      return { status: 'needs-setup', reason: 'no-tables' }
    }

    const countCheck = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM kullanicilar`)
    const userCount = countCheck.rows[0]?.count ?? 0
    if (userCount === 0) {
      return { status: 'needs-setup', reason: 'no-admin' }
    }

    return { status: 'ready' }
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code
    // 3D000 = Postgres'in "böyle bir veritabanı yok" hata kodu - bu TEK
    // BAŞINA "kurulum gerekiyor" sayılır. Diğer TÜM bağlantı hataları
    // (yanlış şifre, sunucu kapalı, ağ sorunu vb.) "error" olarak
    // döndürülür - bunlarda kurulum denemek YANLIŞ olur.
    if (code === '3D000') {
      return { status: 'needs-setup', reason: 'no-database' }
    }
    return { status: 'error', message: error instanceof Error ? error.message : 'Veritabanına bağlanılamadı.' }
  } finally {
    await pool.end().catch(() => { /* yoksay */ })
  }
}

// Ana giris noktasi - durum bir kez hesaplanip "ready"/"needs-setup"
// olduktan sonra bellekten donulur. "error" durumu ONBELLEKLENMEZ (gecici
// bir sorun olabilir - ör. Postgres henuz tam ayaga kalkmamis), bir sonraki
// cagrida tekrar denenir.
export async function getProvisioningState(): Promise<ProvisioningState> {
  if (cachedState && cachedState.status !== 'error') return cachedState
  if (inFlightCheck) return inFlightCheck

  inFlightCheck = computeProvisioningState()
    .then((state) => {
      if (state.status !== 'error') cachedState = state
      inFlightCheck = null
      return state
    })
    .catch((error) => {
      inFlightCheck = null
      return { status: 'error', message: error instanceof Error ? error.message : 'Bilinmeyen hata.' } as ProvisioningState
    })

  return inFlightCheck
}

function setProvisioningState(state: ProvisioningState) {
  cachedState = state
}

async function createDatabaseIfMissing(databaseUrl: string): Promise<void> {
  const databaseName = getDatabaseNameFromUrl(databaseUrl)
  const maintenanceConnectionString = withDatabaseName(databaseUrl, 'postgres')
  const maintenancePool = new Pool({ connectionString: maintenanceConnectionString, max: 1 })

  try {
    const exists = await maintenancePool.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName])
    if (exists.rows.length === 0) {
      const safeName = databaseName.replace(/"/g, '""')
      await maintenancePool.query(`CREATE DATABASE "${safeName}"`)
    }
  } finally {
    await maintenancePool.end().catch(() => { /* yoksay */ })
  }
}

// "prisma migrate deploy" TAMAMEN BOS bir "public" semasi bekler - canli
// testte kesin olarak dogrulandi: bu servisin kendisi (scheduledSqlTasks.service.ts)
// uygulama her acildiginda "sistem_zamanli_gorevler" tablosunun var oldugundan
// emin olmaya calisiyor, DB az once olusturulmus olsa bile. Bu, migrate
// deploy'un "P3005: semada tanimadigi nesneler var" hatasi vermesine yol
// aciyordu. Bu asamaya SADECE "kullanicilar" tablosu (dolayisiyla HICBIR
// GERCEK VERI) yokken gelindigi ICIN, "public" semasini guvenle sifirlayip
// Prisma'ya SIFIRDAN, temiz bir zemin veriyoruz - CANLI/dolu bir veritabaninda
// bu kod yolu ASLA calismaz (bkz. computeProvisioningState).
async function resetPublicSchema(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
  } finally {
    await pool.end().catch(() => { /* yoksay */ })
  }
}

// "prisma migrate deploy" - projenin prisma/migrations klasöründeki TÜM
// geçmiş migration'ları sırayla uygulayıp TÜM tabloları/indeksleri kurar.
// Aynı komut, bu sunucuda az önce yaptığımız her tablo değişikliğinde de
// (migrate resolve --applied ile) kullanılan, Prisma'nın resmi üretim
// komutudur - burada FARKI, hiç migration geçmişi olmayan (tamamen boş)
// bir veritabanında SIFIRDAN tüm geçmişi tek seferde uygulamasıdır.
function runPrismaMigrateDeploy(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const binaryName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
    const prismaBin = path.join(process.cwd(), 'node_modules', '.bin', binaryName)

    // Windows'ta ".cmd" dosyalari gercek birer calistirilabilir degil,
    // cmd.exe tarafindan yorumlanan betiklerdir - execFile bunlari "shell:
    // true" OLMADAN dogrudan spawn edemez (aksi halde "spawn EINVAL" hatasi
    // verir, canli testte dogrulandi).
    execFile(prismaBin, ['migrate', 'deploy'], {
      cwd: process.cwd(),
      timeout: 5 * 60 * 1000,
      shell: process.platform === 'win32',
    }, (error, stdout, stderr) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim()
      resolve({ ok: !error, output })
    })
  })
}

async function seedFirstAdminUser(auditMeta?: AuditMeta): Promise<void> {
  const existingCount = await prisma.user.count()
  if (existingCount > 0) return // baska bir istek/deneme zaten olusturmus

  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD
  if (!username || !password) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD .env.local dosyasında tanımlı değil.')
  }
  if (password.length < 8) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD en az 8 karakter olmalıdır.')
  }

  await withAuditedWrite(
    (tx) => userService.create(
      {
        username,
        password,
        name: process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Sistem Yöneticisi',
        status: 1,
      } as Partial<IUser> & { password: string },
      tx,
    ),
    auditMeta,
  )
}

// Kurulum ekranindaki "Kurulumu Onayla ve Başlat" butonu bunu çağırır.
// Durum "needs-setup" DEĞİLSE (zaten kurulu ya da bir hata durumundaysa)
// hiçbir şey yapmadan döner - yanlışlıkla ikinci kez tetiklenemez.
export async function runProvisioning(auditMeta?: AuditMeta): Promise<{ ok: boolean; message: string }> {
  if (provisioningInFlight) return provisioningInFlight

  provisioningInFlight = (async () => {
    try {
      const state = await getProvisioningState()
      if (state.status === 'ready') {
        return { ok: true, message: 'Sistem zaten kurulu.' }
      }
      if (state.status !== 'needs-setup') {
        return {
          ok: false,
          message: state.status === 'error' ? state.message : 'Şu anda kurulum başlatılamıyor, lütfen birkaç saniye sonra tekrar deneyin.',
        }
      }

      const databaseUrl = process.env.DATABASE_URL
      if (!databaseUrl) return { ok: false, message: 'DATABASE_URL tanımlı değil.' }

      // Agir islemlere (veritabani/tablo olusturma) baslamadan ONCE admin
      // bilgilerinin gecerli oldugundan emin ol - yoksa yari yolda kalinip
      // "tablolar olustu ama admin olusturulamadi" gibi belirsiz bir
      // duruma dusulebilir.
      const bootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
      const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD
      if (!bootstrapUsername || !bootstrapPassword) {
        return { ok: false, message: 'BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD .env.local dosyasında tanımlı değil.' }
      }
      if (bootstrapPassword.length < 8) {
        return { ok: false, message: 'BOOTSTRAP_ADMIN_PASSWORD en az 8 karakter olmalıdır.' }
      }

      if (state.reason === 'no-database') {
        setProvisioningState({ status: 'provisioning', step: 'Veritabanı oluşturuluyor' })
        await createDatabaseIfMissing(databaseUrl)
      }

      if (state.reason === 'no-database' || state.reason === 'no-tables') {
        setProvisioningState({ status: 'provisioning', step: 'Tablolar oluşturuluyor' })
        await resetPublicSchema(databaseUrl)
        const migrateResult = await runPrismaMigrateDeploy()
        if (!migrateResult.ok) {
          const message = `Tablolar oluşturulamadı: ${migrateResult.output.slice(-800) || 'bilinmeyen hata'}`
          setProvisioningState({ status: 'error', message })
          return { ok: false, message }
        }
      }

      setProvisioningState({ status: 'provisioning', step: 'Yönetici kullanıcı oluşturuluyor' })
      await seedFirstAdminUser(auditMeta)

      setProvisioningState({ status: 'ready' })
      return { ok: true, message: 'Kurulum tamamlandı.' }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kurulum sırasında beklenmeyen bir hata oluştu.'
      setProvisioningState({ status: 'error', message })
      return { ok: false, message }
    } finally {
      provisioningInFlight = null
    }
  })()

  return provisioningInFlight
}

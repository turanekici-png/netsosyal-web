import type { Prisma } from '@prisma/client'
import type { Pool, PoolClient } from 'pg'
import { prisma } from '@/lib/db/prisma'
import { getSessionUser } from '@/lib/apiAuth'

type AuditMeta = {
  ip?: string | null
  path?: string | null
}

type AuditableClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number | bigint>
}

// Veritabanindaki sistem_audit_trigger_fn() trigger'i, dosyalar/bireyler/
// yrd_* gibi tablolarda her ekleme/guncelleme/silme isleminde "bu islemi kim
// yapti" bilgisini Postgres oturum ayarindan (app.audit_user) okur; ayar
// bos ise 'Sistem' yazar (bkz. sistem_audit_setting(name, default)).
//
// Uygulama tarafinda bu ayar hicbir yerde yapilmiyordu; bu yuzden neredeyse
// tum kayitlar - kim yaptigina bakilmaksizin - 'Sistem' olarak dusuyordu ve
// "kullanici gunluk islem performansi" gibi raporlar guvenilir degildi.
//
// Bu ayari SADECE oturum acmis GERCEK kullanicinin kendi transaction'i
// icinde (set_config(..., true) -> is_local) ayarlamak gerekir:
//   - Ayar transaction bitince otomatik sifirlanir; connection pool'a geri
//     donen bir baglanti baska bir istege "kirli" kullanici bilgisi tasimaz.
//   - Ayni transaction/baglanti uzerinde calisan TUM yazmalar (ayni `tx`
//     uzerinden) dogru kullaniciyi gorur; farkli bir client/tx uzerinden
//     yapilan yazmalar goremez.
export async function resolveAuditUserName(): Promise<string> {
  const user = await getSessionUser()
  return user?.username || user?.name || 'Sistem'
}

// Rota, kendi `prisma.$transaction(async (tx) => { ... })` bloguna SAHIP
// DEGILSE kullanilir: butun yazma islemini yeni bir transaction icinde
// calistirir ve basina denetim damgasini basar.
//
// Onemli: callback SADECE veritabani yazma islemlerini icermeli. Yavas dis
// servis cagrilarini (NVI sorgusu, geocoding, dosya/e-posta gonderimi vb.)
// bu fonksiyonun disinda, transaction acilmadan once yapin - yoksa dis
// servis yavasladiginda veritabani baglantisi/transaction gereksiz yere
// acik kalir.
export async function withAuditedWrite<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  meta?: AuditMeta,
): Promise<T> {
  const auditUser = await resolveAuditUserName()

  return prisma.$transaction(async (tx) => {
    await stampAuditUser(tx, auditUser, meta)
    return callback(tx)
  }, {
    // Varsayilan 5000ms, sistem_audit_trigger_fn() her satirda ek is yaptigi
    // icin coklu-kayit (toplu guncelle/personel ata/sil vb.) islemlerinde
    // yetersiz kaliyordu ("Transaction API error: ... expired transaction" -
    // 34 kayitlik bir personel atamasinda gercek ortamda gozlemlendi).
    // 30sn, buyuk toplu islemler icin de guvenli bir tampon birakiyor.
    timeout: 30000,
    maxWait: 10000,
  })
}

// Rota zaten kendi `prisma.$transaction(async (tx) => { ... })` blogunu
// kullaniyorsa: o transaction'in EN BASINDA, tek satirla cagirin -
// `await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))`.
// Boylece mevcut transaction yapisi degismeden denetim damgasi eklenir.
export async function stampAuditUser(
  tx: AuditableClient,
  auditUserName?: string,
  meta?: AuditMeta,
): Promise<void> {
  const auditUser = auditUserName ?? (await resolveAuditUserName())

  await tx.$executeRaw`SELECT set_config('app.audit_user', ${auditUser}, true)`

  if (meta?.ip) {
    await tx.$executeRaw`SELECT set_config('app.audit_ip', ${meta.ip}, true)`
  }
  if (meta?.path) {
    await tx.$executeRaw`SELECT set_config('app.audit_path', ${meta.path}, true)`
  }
}

// Bazi rotalar Prisma yerine dogrudan `pg.Pool` (ör. getSqlMonitorPool())
// kullanir. O rotalar icin: prisma.$transaction yerine kendi baglantisini
// alip BEGIN/COMMIT ile ayni is'i yapan karsilik. callback icinde SADECE
// bu fonksiyonun sagladigi `client` uzerinden yazma yapin (pool.query(...)
// DEGIL) - aksi halde set_config farkli bir baglantida kalir ve trigger
// gormez.
export async function withAuditedPoolWrite<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
  meta?: AuditMeta,
): Promise<T> {
  const auditUser = await resolveAuditUserName()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.audit_user', $1, true)`, [auditUser])

    if (meta?.ip) {
      await client.query(`SELECT set_config('app.audit_ip', $1, true)`, [meta.ip])
    }
    if (meta?.path) {
      await client.query(`SELECT set_config('app.audit_path', $1, true)`, [meta.path])
    }

    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

// Route handler'lar icin kisayol: request'ten IP ve path bilgisini cikarir.
export function getAuditMetaFromRequest(request: Request): AuditMeta {
  const url = new URL(request.url)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    null

  return { ip, path: url.pathname }
}

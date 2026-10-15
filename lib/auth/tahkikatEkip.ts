import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { settingService } from '@/lib/services'
import { SESSION_ABSOLUTE_SECONDS, parseSessionDetails, readSessionCookie } from '@/lib/auth'
import { isHttpsRequest } from '@/lib/auth/remoteLoginOtp'

// Kullanici istegi (2026-10-15): "tahkikat1 / tahkikat2 SABIT ekip hesabi
// olarak kalsin, ama o ekipte calisan personel degisebilsin. Tablette ekip
// hesabiyla girilince ekibin personeli listelensin, personel kendini secip
// KENDI sifresiyle girsin."
//
// Model: oturum (netsosyal_session) EKIP hesabinda kalir - yetkiler, dosya
// atamalari ve mahalle/paket rotasyonu degismeden ekip hesabina bagli.
// Uzerine imzali ikinci bir cerez "o an tableti kullanan personeli" tasir;
// form kayitlari (Hane Ziyareti / Sosyal Inceleme) ve formdaki "personel"
// alani bu personelin adiyla/id'siyle yazilir.
//
// Ekip uyeleri Ayarlar tablosunda (settings) tutulur:
//   { "<ekipKullaniciId>": ["<personelKullaniciId>", ...], ... }
// Bir ekibe hic uye tanimlanmamissa personel secimi ISTENMEZ (eski davranis).

export const TAHKIKAT_EKIP_SETTING_KEY = 'tahkikat_ekip_uyeleri'
export const EKIP_PERSONEL_COOKIE_NAME = 'netsosyal_ekip_personel'

export type EkipUyeleri = Record<string, string[]>
type CookieReader = { get: (name: string) => { value?: string } | undefined }
export type KisiOzeti = { id: string; name: string; username: string }

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET tanımlanmalıdır.')
  return secret
}

function imzala(payload: string) {
  return createHmac('sha256', getAuthSecret()).update(`ekip-personel:${payload}`).digest('hex')
}

// Ekip hesabi kullanici adi "tahkikat" ile baslayan aktif kullanicilardir
// (bkz. app/api/workflow/tahkikat/_lib/personnel.ts - ayni kural).
export function ekipHesabiMi(username: string | null | undefined) {
  return (username || '').trim().toLocaleLowerCase('tr-TR').startsWith('tahkikat')
}

export async function ekipUyeleriniGetir(): Promise<EkipUyeleri> {
  const setting = await settingService.getByKey(TAHKIKAT_EKIP_SETTING_KEY)
  const value = setting?.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const sonuc: EkipUyeleri = {}
  for (const [ekipId, uyeler] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(ekipId) || !Array.isArray(uyeler)) continue
    sonuc[ekipId] = [...new Set(uyeler.map((u) => String(u)).filter((u) => /^\d+$/.test(u)))]
  }
  return sonuc
}

export async function ekipUyeleriniKaydet(uyeler: EkipUyeleri) {
  await settingService.set(TAHKIKAT_EKIP_SETTING_KEY, uyeler, 'json')
}

function kisiyeCevir(user: { id: bigint; kullanicitamadi: string | null; username: string | null }): KisiOzeti {
  return {
    id: String(user.id),
    name: (user.kullanicitamadi || '').trim() || user.username || 'Kullanıcı',
    username: user.username || '',
  }
}

// Verilen id'lerdeki AKTIF kullanicilar (pasif yapilan personel listeden
// kendiliginden duser).
export async function aktifKisileriGetir(ids: string[]): Promise<KisiOzeti[]> {
  if (ids.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) }, status: 1 },
    select: { id: true, kullanicitamadi: true, username: true },
  })
  return users.map(kisiyeCevir).sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
}

export async function tumAktifKullanicilar(): Promise<KisiOzeti[]> {
  const users = await prisma.user.findMany({
    where: { status: 1 },
    select: { id: true, kullanicitamadi: true, username: true },
  })
  return users.map(kisiyeCevir).sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
}

// Cerez bicimi: `ekipId.oturum.personelId.sonTarih.imza` - hem ekip
// hesabina hem de O OTURUMA (giris ani) baglidir: baska kullanici girerse
// ya da ekip hesabi yeniden giris yaparsa onceki personel secimi gecersiz
// olur ve secim ekrani tekrar gelir.
export function oturumNumarasi(cookieStore: CookieReader) {
  return String(parseSessionDetails(readSessionCookie(cookieStore))?.issuedAt ?? 0)
}

export function ekipPersonelDegeriOlustur(ekipId: string, oturum: string, personelId: string) {
  const sonTarih = Math.floor(Date.now() / 1000) + SESSION_ABSOLUTE_SECONDS
  const payload = `${ekipId}.${oturum}.${personelId}.${sonTarih}`
  return `${payload}.${imzala(payload)}`
}

export function ekipPersonelDegeriniCoz(value: string | undefined | null, ekipId: string, oturum: string): string | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 5) return null
  const [cerezEkipId, cerezOturum, personelId, sonTarihText, imza] = parts
  if (cerezEkipId !== ekipId || cerezOturum !== oturum) return null
  if (!/^\d+$/.test(personelId) || !/^\d+$/.test(sonTarihText)) return null
  if (Number(sonTarihText) <= Math.floor(Date.now() / 1000)) return null
  const beklenen = Buffer.from(imzala(`${cerezEkipId}.${cerezOturum}.${personelId}.${sonTarihText}`))
  const gelen = Buffer.from(imza)
  if (beklenen.length !== gelen.length || !timingSafeEqual(beklenen, gelen)) return null
  return personelId
}

export type EkipDurumu = {
  ekip: KisiOzeti
  uyeler: KisiOzeti[]
  // Secili ve hala ekipte olan personel; yoksa null (secim ekrani gosterilir).
  aktifPersonel: KisiOzeti | null
}

// Oturumdaki kullanici, uyesi tanimli bir tahkikat ekibiyse ekip durumunu
// dondurur; degilse null (normal kullanici - hicbir sey degismez).
export async function ekipDurumunuGetir(
  sessionUser: { id: string; username?: string; name?: string } | null,
  cookieStore: CookieReader,
): Promise<EkipDurumu | null> {
  if (!sessionUser || !ekipHesabiMi(sessionUser.username)) return null
  const tumUyeler = await ekipUyeleriniGetir()
  const uyeIdleri = (tumUyeler[String(sessionUser.id)] ?? []).filter((id) => id !== String(sessionUser.id))
  if (uyeIdleri.length === 0) return null

  const uyeler = await aktifKisileriGetir(uyeIdleri)
  if (uyeler.length === 0) return null

  const personelId = ekipPersonelDegeriniCoz(
    cookieStore.get(EKIP_PERSONEL_COOKIE_NAME)?.value,
    String(sessionUser.id),
    oturumNumarasi(cookieStore),
  )
  const aktifPersonel = personelId ? uyeler.find((u) => u.id === personelId) ?? null : null

  return {
    // Ekip adi olarak kullanici adi (tahkikat1...) - gorunen ad bir kisi adi olabiliyor.
    ekip: { id: String(sessionUser.id), name: sessionUser.username || sessionUser.name || 'Ekip', username: sessionUser.username || '' },
    uyeler,
    aktifPersonel,
  }
}

// Kayitlardaki "kullaniciid" icin: ekip hesabinda personel seciliyse o
// personelin id'si, degilse oturum kullanicisinin id'si. Uyesi tanimli bir
// ekip hesabi personel SECMEDEN kayit yapamaz (personelSecimiGerekli).
export async function etkinKimlik(
  sessionUser: { id: string; username?: string; name?: string } | null,
  cookieStore: CookieReader,
): Promise<{ kullaniciId: number | null; personelSecimiGerekli: boolean; ekipKullaniciId: number | null }> {
  if (!sessionUser) return { kullaniciId: null, personelSecimiGerekli: false, ekipKullaniciId: null }
  const durum = await ekipDurumunuGetir(sessionUser, cookieStore)
  const id = Number(durum?.aktifPersonel?.id ?? sessionUser.id)
  return {
    kullaniciId: Number.isInteger(id) ? id : null,
    personelSecimiGerekli: Boolean(durum && !durum.aktifPersonel),
    // Islem bir ekip hesabi uzerinden (secili personelle) yapildiysa ekip id'si
    ekipKullaniciId: durum?.aktifPersonel ? Number(sessionUser.id) : null,
  }
}

export const PERSONEL_SECIMI_GEREKLI_MESAJI = 'Kayıt için önce ekip personelinden kendinizi seçip şifrenizle giriş yapın.'

export function ekipPersonelCereziniYaz(response: NextResponse, request: Request, value: string | null) {
  response.cookies.set({
    name: EKIP_PERSONEL_COOKIE_NAME,
    value: value ?? '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttpsRequest(request),
    path: '/',
    // Oturum cerezi gibi: tarayici kapaninca silinir (paylasilan tablet).
    ...(value ? {} : { maxAge: 0, expires: new Date(0) }),
  })
  return response
}

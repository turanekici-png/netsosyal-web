import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { requireApiAccess, getSessionUser } from '@/lib/apiAuth'
import { compressImageBuffer } from '@/lib/services/imageCompression.service'
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/security/requestBody'

const USER_PHOTO_BODY_LIMIT_BYTES = 10 * 1024 * 1024

export const dynamic = 'force-dynamic'

// Kullanici fotograflari, birey fotograflariyla (bireyresim) AYNI mantikla
// ayri "sosyalyardimdkm" veritabanindaki "kullanicifoto" tablosunda
// saklanir (bkz. app/api/documents/photo/route.ts - burasi onun kullanici
// karsiligidir).
const globalForDkmUserPhotoPrisma = globalThis as unknown as {
  dkmUserPhotoPrisma: PrismaClient | undefined
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
  if (!globalForDkmUserPhotoPrisma.dkmUserPhotoPrisma) {
    globalForDkmUserPhotoPrisma.dkmUserPhotoPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getDkmConnectionString() }),
    })
  }

  return globalForDkmUserPhotoPrisma.dkmUserPhotoPrisma
}

type Params = { id: string }

// Fotograf goruntuleme herkese (oturum acmis herhangi bir kullaniciya) acik -
// avatar bilgisi hassas degil, listede/basliktaki kucuk resimler icin gerekli.
// Fotograf EKLEME/SILME ise sadece KENDI hesabinizda (header'daki "Profilim"
// akisi) VEYA "users.manage" yetkisiyle (Ayarlar > Kullanicilar) yapilabilir.
async function requireSelfOrManage(targetId: string) {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
  }
  if (String(sessionUser.id) === String(targetId)) return null

  return requireApiAccess({ action: 'users.manage', page: '/users' })
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function imageDataToBuffer(value: unknown) {
  if (typeof value !== 'string') return null
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,(.+)$/i)
  const base64 = match?.[1] ?? value

  if (!base64 || !/^[a-z0-9+/=\s]+$/i.test(base64)) return null

  return Buffer.from(base64.replace(/\s/g, ''), 'base64')
}

// Byte-imzasindan (magic number) resim MIME turunu tahmin eder - Content-Type
// basligini dogru vermek icin (kaydederken hangi formatta geldigi
// saklanmiyor, bkz. app/api/documents/belgeler/route.ts'teki benzer yaklasim).
function sniffImageMime(buffer: Buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return 'image/jpeg'
}

// GET - fotografi dogrudan binary olarak dondurur (<img src="/api/users/{id}/photo">)
export async function GET(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const sessionUser = await getSessionUser()
    if (!sessionUser) {
      return NextResponse.json({ success: false, error: 'Oturum bulunamadı.' }, { status: 401 })
    }

    const { id } = await params
    const userId = cleanBigInt(id)
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Kullanıcı bilgisi zorunludur.' }, { status: 400 })
    }

    const rows = await getDkmPrisma().$queryRaw<{ resim: Buffer | null }[]>`
      SELECT resim
      FROM public.kullanicifoto
      WHERE kullaniciid = ${userId}
      ORDER BY id DESC
      LIMIT 1
    `

    const imageBuffer = rows[0]?.resim
    if (!imageBuffer || imageBuffer.length === 0) {
      return NextResponse.json({ success: false, error: 'Fotoğraf bulunamadı.' }, { status: 404 })
    }

    return new NextResponse(new Uint8Array(imageBuffer), {
      headers: {
        'Content-Type': sniffImageMime(imageBuffer),
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (error) {
    console.error('User photo fetch error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Fotoğraf alınamadı.' },
      { status: 500 },
    )
  }
}

// POST - fotograf ekle/degistir (var olan tum kayitlar silinip yenisi eklenir)
export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const { id } = await params
    const accessDenied = await requireSelfOrManage(id)
    if (accessDenied) return accessDenied

    const userId = cleanBigInt(id)
    const body = await readLimitedJson<{ imageData?: unknown }>(request, USER_PHOTO_BODY_LIMIT_BYTES)
    const rawImageBuffer = imageDataToBuffer(body.imageData)

    if (!userId || !rawImageBuffer || rawImageBuffer.length === 0) {
      return NextResponse.json({ success: false, error: 'Kullanıcı ve fotoğraf bilgisi zorunludur.' }, { status: 400 })
    }

    // Kullanici istegi: veritabaninin surekli buyumesini onlemek icin
    // fotograf kaydedilmeden once kucultulup JPEG olarak yeniden kodlanir.
    const imageBuffer = await compressImageBuffer(rawImageBuffer)

    const dkm = getDkmPrisma()
    await dkm.$transaction([
      dkm.$executeRaw`DELETE FROM public.kullanicifoto WHERE kullaniciid = ${userId}`,
      dkm.$executeRaw`INSERT INTO public.kullanicifoto (kullaniciid, resim) VALUES (${userId}, ${imageBuffer})`,
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    console.error('User photo save error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Fotoğraf kaydedilemedi.' },
      { status: 500 },
    )
  }
}

// DELETE - fotografi kaldir
export async function DELETE(request: Request, { params }: { params: Promise<Params> }) {
  try {
    const { id } = await params
    const accessDenied = await requireSelfOrManage(id)
    if (accessDenied) return accessDenied

    const userId = cleanBigInt(id)
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Kullanıcı bilgisi zorunludur.' }, { status: 400 })
    }

    await getDkmPrisma().$executeRaw`DELETE FROM public.kullanicifoto WHERE kullaniciid = ${userId}`

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('User photo delete error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Fotoğraf silinemedi.' },
      { status: 500 },
    )
  }
}

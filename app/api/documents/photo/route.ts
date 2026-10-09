import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { requireApiAccess } from '@/lib/apiAuth'
import { compressImageBuffer } from '@/lib/services/imageCompression.service'
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/security/requestBody'

const PHOTO_BODY_LIMIT_BYTES = 10 * 1024 * 1024

export const dynamic = 'force-dynamic'

const globalForDkmPhotoPrisma = globalThis as unknown as {
  dkmPhotoPrisma: PrismaClient | undefined
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
  if (!globalForDkmPhotoPrisma.dkmPhotoPrisma) {
    globalForDkmPhotoPrisma.dkmPhotoPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: getDkmConnectionString() }),
    })
  }

  return globalForDkmPhotoPrisma.dkmPhotoPrisma
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

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.attachments', page: '/documents' })
    if (accessDenied) return accessDenied

    const body = await readLimitedJson<{ personId?: unknown; imageData?: unknown }>(request, PHOTO_BODY_LIMIT_BYTES)
    const personId = cleanBigInt(body.personId)
    const rawImageBuffer = imageDataToBuffer(body.imageData)

    if (!personId || !rawImageBuffer || rawImageBuffer.length === 0) {
      return NextResponse.json({ success: false, error: 'Kişi ve fotoğraf bilgisi zorunludur.' }, { status: 400 })
    }

    // Kullanici istegi: veritabaninin surekli buyumesini onlemek icin
    // fotograf kaydedilmeden once kucultulup JPEG olarak yeniden kodlanir.
    const imageBuffer = await compressImageBuffer(rawImageBuffer)

    await getDkmPrisma().$executeRaw`
      INSERT INTO public.bireyresim (bireyid, resim)
      VALUES (${personId}, ${imageBuffer})
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 413 })
    }
    console.error('Document photo save error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Fotoğraf kaydedilemedi.' },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'documents.attachments', page: '/documents' })
    if (accessDenied) return accessDenied

    const { searchParams } = new URL(request.url)
    const personId = cleanBigInt(searchParams.get('personId'))

    if (!personId) {
      return NextResponse.json({ success: false, error: 'Kişi bilgisi zorunludur.' }, { status: 400 })
    }

    await getDkmPrisma().$executeRaw`
      DELETE FROM public.bireyresim
      WHERE bireyid = ${personId}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Document photo delete error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Fotoğraf silinemedi.' },
      { status: 500 },
    )
  }
}

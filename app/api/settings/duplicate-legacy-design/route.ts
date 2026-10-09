import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'

type LegacyDesignRow = {
  id: bigint
  tipi: number | null
  adi: string | null
  dizayn: Buffer | Uint8Array | string | null
  varsayilan: number | null
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

export async function POST(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const body = await request.json()
    const legacyDesignId = String(body?.legacyDesignId || '').trim()
    const name = String(body?.name || '').trim()

    if (!legacyDesignId || !name) {
      return NextResponse.json({ success: false, error: 'Legacy tasarım kimliği ve ad gerekli.' }, { status: 400 })
    }

    const match = legacyDesignId.match(/^legacy_dizayn_(\d+)$/)
    if (!match) {
      return NextResponse.json({ success: false, error: 'Geçersiz legacy tasarım kimliği.' }, { status: 400 })
    }

    const sourceId = BigInt(match[1])

    const rows = await getDkmPrisma().$queryRaw<LegacyDesignRow[]>`
      SELECT id, tipi, adi, dizayn, varsayilan
      FROM dizayn
      WHERE id = ${sourceId}
      LIMIT 1
    `

    const sourceDesign = rows[0]
    if (!sourceDesign || !sourceDesign.dizayn) {
      return NextResponse.json({ success: false, error: 'Kaynak legacy tasarım bulunamadı.' }, { status: 404 })
    }

    const insertedRows = await getDkmPrisma().$queryRaw<Pick<LegacyDesignRow, 'id'>[]>`
      INSERT INTO dizayn (tipi, adi, dizayn, varsayilan)
      VALUES (${sourceDesign.tipi}, ${name}, ${sourceDesign.dizayn}, 0)
      RETURNING id
    `

    if (!insertedRows || insertedRows.length === 0) {
      throw new Error('Legacy tasarım kopyası oluşturulamadı.')
    }

    return NextResponse.json({ success: true, data: { id: String(insertedRows[0].id) } }, { status: 201 })
  } catch (error) {
    console.error('Duplicate legacy design error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Legacy tasarım kopyalanamadı.' },
      { status: 500 },
    )
  }
}

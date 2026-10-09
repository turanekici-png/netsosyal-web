import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { parseSessionValue, readSessionCookie } from '@/lib/auth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { prisma } from '@/lib/db/prisma'

async function context() {
  const denied = await requireApiAccess({ page: '/dashboard' })
  if (denied) return { denied, userId: '' }
  const store = await cookies()
  const userId = parseSessionValue(readSessionCookie(store)) || ''
  return { denied: null, userId }
}

async function ensureTable() {
  await getSqlMonitorPool().query(`
    CREATE TABLE IF NOT EXISTS kullanici_hatirlaticilari (
      id bigserial PRIMARY KEY,
      kullanici_id bigint NOT NULL,
      baslik varchar(150) NOT NULL,
      not_metni text NOT NULL DEFAULT '',
      hatirlatma_tarihi timestamptz NOT NULL,
      tamamlandi boolean NOT NULL DEFAULT false,
      olusturma_tarihi timestamptz NOT NULL DEFAULT now(),
      guncelleme_tarihi timestamptz NOT NULL DEFAULT now()
    );
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'kullanici_hatirlaticilari'
          AND column_name = 'olusturan_kullanici_id'
      ) THEN
        ALTER TABLE kullanici_hatirlaticilari ADD COLUMN olusturan_kullanici_id bigint;
      END IF;
    END $$;
  `)
}

export async function GET() {
  const { denied, userId } = await context()
  if (denied) return denied
  await ensureTable()
  const result = await getSqlMonitorPool().query(
    `SELECT h.id::text, h.baslik, h.not_metni, h.hatirlatma_tarihi, h.tamamlandi,
            COALESCE(k.kullanicitamadi, k.kullaniciadi, '') AS olusturan_kullanici
     FROM kullanici_hatirlaticilari h
     LEFT JOIN kullanicilar k ON k.id = h.olusturan_kullanici_id
     WHERE h.kullanici_id = $1
     ORDER BY h.tamamlandi, h.hatirlatma_tarihi ASC, h.id DESC`, [userId],
  )
  return NextResponse.json({ success: true, data: result.rows })
}

export async function POST(request: Request) {
  const { denied, userId } = await context()
  if (denied) return denied
  await ensureTable()
  const body = await request.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  const note = String(body.note || '').trim()
  const reminderAt = new Date(String(body.reminderAt || ''))
  if (!title || title.length > 150) return NextResponse.json({ success: false, error: 'Başlık zorunludur.' }, { status: 400 })
  if (note.length > 2000 || Number.isNaN(reminderAt.getTime())) return NextResponse.json({ success: false, error: 'Hatırlatıcı bilgileri geçersizdir.' }, { status: 400 })
  const requestedUserIds = (Array.isArray(body.recipientUserIds) ? body.recipientUserIds : [])
    .map((value: unknown) => String(value))
    .filter((value: string) => /^\d+$/.test(value))
  const uniqueUserIds = [...new Set([userId, ...requestedUserIds])]
  const validUsers = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds.map((id) => BigInt(id)) }, status: 1 },
    select: { id: true },
  })
  const recipientIds = validUsers.map((user) => user.id.toString())
  if (!recipientIds.includes(userId)) recipientIds.unshift(userId)

  const result = await getSqlMonitorPool().query(
    `INSERT INTO kullanici_hatirlaticilari (kullanici_id, baslik, not_metni, hatirlatma_tarihi, olusturan_kullanici_id)
     SELECT hedef_kullanici_id, $2, $3, $4, $5
     FROM unnest($1::bigint[]) AS hedef(hedef_kullanici_id)
     RETURNING id::text, kullanici_id::text`,
    [recipientIds, title, note, reminderAt, userId],
  )
  return NextResponse.json({ success: true, data: { records: result.rows } }, { status: 201 })
}

export async function PATCH(request: Request) {
  const { denied, userId } = await context()
  if (denied) return denied
  await ensureTable()
  const body = await request.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, error: 'Geçersiz kayıt.' }, { status: 400 })
  const reminderAt = body.reminderAt ? new Date(String(body.reminderAt)) : null
  if (reminderAt && Number.isNaN(reminderAt.getTime())) return NextResponse.json({ success: false, error: 'Hatırlatma tarihi geçersizdir.' }, { status: 400 })
  const result = await getSqlMonitorPool().query(
    `UPDATE kullanici_hatirlaticilari
     SET tamamlandi = $1,
         hatirlatma_tarihi = COALESCE($2, hatirlatma_tarihi),
         guncelleme_tarihi = now()
     WHERE id = $3 AND kullanici_id = $4`,
    [Boolean(body.completed), reminderAt, id, userId],
  )
  return NextResponse.json({ success: true, data: { updated: result.rowCount || 0 } })
}

export async function DELETE(request: Request) {
  const { denied, userId } = await context()
  if (denied) return denied
  await ensureTable()
  const body = await request.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, error: 'Geçersiz kayıt.' }, { status: 400 })
  const result = await getSqlMonitorPool().query(
    'DELETE FROM kullanici_hatirlaticilari WHERE id = $1 AND kullanici_id = $2', [id, userId],
  )
  return NextResponse.json({ success: true, data: { deleted: result.rowCount || 0 } })
}

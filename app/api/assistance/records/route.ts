import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { getAuditMetaFromRequest, resolveAuditUserName, withAuditedPoolWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

type DeletePayload = {
  ids?: Array<string | number>
}

const ALLOWED_TABLES = new Set([
  'yrd_aceze',
  'yrd_ayninakti',
  'yrd_ddgidadosyali',
  'yrd_destekpaketi',
  'yrd_ekmek',
  'yrd_gidabankasi',
  'yrd_giyim',
  'yrd_haziryemek',
])

// Kullanici istegi (28 Agustos 2026): "eger bir veri siliniyor ise o veriyi
// TAMAMEN veritabanindan kaldirsin" - eskiden bu uc nokta "silme"yi bir
// UPDATE (durumu=0/1) olarak yapiyordu, kayit tabloda kaliyor ve
// Muracaatlar ekraninda gorunuyordu. Artik GERCEK bir DELETE yapilir.
// Silinen satirin tam hali, silme ONCESINDE 'sil' etiketiyle
// sistem_hareket_log'a yazilir - boylece islem Log Kayitlari > Cop
// Kutusu'nda gorunur ve (satiri snapshot'tan yeniden olusturarak) geri
// alinabilir (bkz. app/api/logs/restore/route.ts - bu tablolar artik
// SOFT_DELETE_TABLES'ta DEGIL, genel "INSERT ile geri yukle" yolunu kullanir).

// Ana kayit silinince, o kaydin id'sini tasiyan hareket/donem alt kayitlari
// da birlikte silinir (bu tablolarda FK YOK - elle temizlenir).
const CHILD_TABLES: Record<string, Array<{ table: string; fk: string }>> = {
  yrd_ekmek: [{ table: 'yrd_ekmekhrk', fk: 'yardimid' }],
  yrd_gidabankasi: [
    { table: 'yrd_gidabankasihrk', fk: 'yardimid' },
    { table: 'yrd_gidabankasidnm', fk: 'yrd_gbid' },
  ],
  yrd_destekpaketi: [{ table: 'yrd_destekpaketihrk', fk: 'yardimid' }],
  yrd_haziryemek: [{ table: 'yrd_haziryemekhrk', fk: 'yardimid' }],
}

// yrd_ekmek/yrd_gidabankasi/yrd_haziryemek uzerindeki "dosya durumu
// guncelle" tetikleyicisi, AFTER DELETE'te "record NEW is not assigned yet"
// hatasiyla cokuyor (DB'de onceden var olan bir hata - bkz.
// app/api/documents/route.ts'teki ayni not). Silme sirasinda SADECE bu
// transaction icinde gecici olarak devre disi birakilir; ALTER TABLE ...
// TRIGGER tam transaksiyonel oldugu icin ROLLBACK'te otomatik geri gelir.
const DOSYA_DURUM_TRIGGERS: Record<string, string> = {
  yrd_ekmek: 'trg_dosya_durum_ekmek',
  yrd_gidabankasi: 'trg_dosya_durum_gidabankasi',
  yrd_haziryemek: 'trg_dosya_durum_haziryemek',
}

function normalizeIds(ids: DeletePayload['ids']) {
  if (!Array.isArray(ids)) return []

  return Array.from(
    new Set(
      ids
        .map((id) => String(id).trim())
        .filter((id) => /^\d+$/.test(id)),
    ),
  )
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export async function DELETE(request: NextRequest) {
  const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/assistance' })
  if (accessDenied) return accessDenied

  const tableName = request.nextUrl.searchParams.get('table') || ''
  const mode = request.nextUrl.searchParams.get('mode') || 'aid'
  const payload = await request.json().catch(() => ({})) as DeletePayload
  const ids = normalizeIds(payload.ids)

  if (!ALLOWED_TABLES.has(tableName)) {
    return NextResponse.json({ success: false, error: 'Bu tablo için silme işlemi desteklenmiyor.' }, { status: 400 })
  }

  if (ids.length === 0) {
    return NextResponse.json({ success: false, error: 'Silinecek kayıt seçilmedi.' }, { status: 400 })
  }

  const pool = getSqlMonitorPool()

  try {
    const columnResult = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
      `,
      [tableName],
    )
    const columns = new Set(
      (columnResult.rows as Array<{ column_name?: unknown }>).map((row) => String(row.column_name || '')),
    )

    if (!columns.has('id')) {
      return NextResponse.json(
        { success: false, error: 'Bu tabloda silme için gerekli "id" alanı bulunamadı.' },
        { status: 400 },
      )
    }

    const aciklamaText = mode === 'request' ? 'Müracaat ekranından tamamen silindi' : 'Yardım ekranından tamamen silindi'
    const auditMeta = getAuditMetaFromRequest(request)
    const actorName = await resolveAuditUserName()
    const durumTrigger = DOSYA_DURUM_TRIGGERS[tableName]
    const childTables = CHILD_TABLES[tableName] ?? []

    const result = await withAuditedPoolWrite(pool, async (client) => {
      // Silme ONCESINDE her satirin tam halini 'sil' etiketiyle
      // sistem_hareket_log'a yaz (Cop Kutusu'nda gorunsun / geri alinabilsin).
      // NOT: current_setting(name, missing_ok) iki parametreli form PostgreSQL
      // 9.6+ - bu sunucu 9.4, degerleri dogrudan parametre geciyoruz.
      await client.query(
        `
          INSERT INTO sistem_hareket_log
            (kullanici_adi, islem_tipi, tablo_adi, kayit_id, eski_deger, yeni_deger, aciklama, ip_adresi, tarih, revision_no)
          SELECT
            $3,
            'sil',
            '${tableName}',
            o.id::text,
            row_to_json(o)::jsonb,
            NULL,
            $2,
            $4,
            NOW(),
            COALESCE((SELECT MAX(h.revision_no) FROM sistem_hareket_log h WHERE h.tablo_adi = '${tableName}' AND h.kayit_id = o.id::text), 0) + 1
          FROM (SELECT * FROM public.${quoteIdentifier(tableName)} WHERE id = ANY($1::bigint[])) o
        `,
        [ids, aciklamaText, actorName, auditMeta.ip || ''],
      )

      // Iliskili hareket/donem alt kayitlarini temizle.
      for (const child of childTables) {
        await client.query(
          `DELETE FROM public.${quoteIdentifier(child.table)} WHERE ${quoteIdentifier(child.fk)} = ANY($1::bigint[])`,
          [ids],
        )
      }

      if (durumTrigger) {
        await client.query(`ALTER TABLE public.${quoteIdentifier(tableName)} DISABLE TRIGGER ${durumTrigger}`)
      }

      let deleteResult
      try {
        deleteResult = await client.query(
          `DELETE FROM public.${quoteIdentifier(tableName)} WHERE id = ANY($1::bigint[])`,
          [ids],
        )
      } finally {
        if (durumTrigger) {
          await client.query(`ALTER TABLE public.${quoteIdentifier(tableName)} ENABLE TRIGGER ${durumTrigger}`)
        }
      }

      return deleteResult
    }, getAuditMetaFromRequest(request))

    return NextResponse.json({
      success: true,
      data: {
        requested: ids.length,
        deleted: result.rowCount || 0,
        mode: 'hard-delete',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıtlar silinemedi.' },
      { status: 500 },
    )
  }
}

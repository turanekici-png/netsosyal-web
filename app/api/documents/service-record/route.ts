import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireApiAccess, requireAuthorizedPersonnelOrAdmin } from '@/lib/apiAuth'
import { resolveCashPredefinedLabels } from '@/lib/services/cashPredefinedLabels.service'
import { requireDestructiveAuthorization } from '@/lib/security/destructiveAuthorization'
import { getAuditMetaFromRequest, stampAuditUser, withAuditedWrite } from '@/lib/db/auditContext'

export const dynamic = 'force-dynamic'

const SERVICE_TABLES = new Set([
  'yrd_ekmek',
  'yrd_gidabankasi',
  'yrd_destekpaketi',
  'yrd_ddgidadosyali',
  'yrd_giyim',
  'yrd_ayninakti',
  'yrd_haziryemek',
])

const SERVICE_RECORD_CHILD_TABLES: Record<string, string[]> = {
  yrd_ekmek: ['yrd_ekmekhrk'],
  yrd_gidabankasi: ['yrd_gidabankasihrk'],
  yrd_destekpaketi: ['yrd_destekpaketihrk'],
  yrd_haziryemek: ['yrd_haziryemekhrk'],
}

const END_DATE_STATUSES = new Set([3, 4, 5])

type ServiceRecordStatusRow = {
  durumu: number | null
}

type ServiceRecordColumnRow = {
  column_name: string
}

type ReferencingTableRow = {
  child_table: string
  child_column: string
}

const serviceRecordColumnCache = new Map<string, Set<string>>()
const referencingTableCache = new Map<string, ReferencingTableRow[]>()

function quoteIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function getDatabaseErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return ''
  const directCode = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const metaCode =
    'meta' in error &&
    typeof error.meta === 'object' &&
    error.meta !== null &&
    'code' in error.meta &&
    typeof error.meta.code === 'string'
      ? error.meta.code
      : ''
  return directCode || metaCode
}

function isMissingRelationOrColumnError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  const message = error instanceof Error ? error.message.toLocaleLowerCase('tr-TR') : ''
  return (
    code === '42P01' ||
    code === '42703' ||
    message.includes('does not exist') ||
    message.includes('mevcut değil')
  )
}

function isForeignKeyError(error: unknown) {
  const code = getDatabaseErrorCode(error)
  const message = error instanceof Error ? error.message.toLocaleLowerCase('tr-TR') : ''
  return code === '23503' || message.includes('foreign key') || message.includes('violates foreign key')
}

function cleanBigInt(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return null
  const text = String(value).trim()
  return /^\d+$/.test(text) ? BigInt(text) : null
}

function cleanStatus(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const status = Number(value)
  return Number.isInteger(status) ? status : null
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanDateText(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function cleanInt(value: unknown) {
  const text = cleanText(value)
  if (!text) return null
  const normalized = Number(text.replace(',', '.'))
  return Number.isFinite(normalized) ? Math.trunc(normalized) : null
}

function readServiceRecordPayload(body: Record<string, unknown>) {
  return {
    sourceTable: typeof body.sourceTable === 'string' ? body.sourceTable.trim() : '',
    recordId: cleanBigInt(body.recordId),
    fileId: cleanBigInt(body.fileId),
  }
}

async function getServiceRecordColumns(sourceTable: string) {
  const cachedColumns = serviceRecordColumnCache.get(sourceTable)
  if (cachedColumns) return cachedColumns

  const rows = await prisma.$queryRawUnsafe<ServiceRecordColumnRow[]>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    sourceTable,
  )

  const columns = new Set(rows.map((row) => row.column_name))
  serviceRecordColumnCache.set(sourceTable, columns)
  return columns
}

async function getReferencingTables(tx: Pick<typeof prisma, '$queryRawUnsafe'>, sourceTable: string) {
  const cachedTables = referencingTableCache.get(sourceTable)
  if (cachedTables) return cachedTables

  const rows = await tx.$queryRawUnsafe<ReferencingTableRow[]>(
    `
      SELECT child.relname AS child_table,
             child_att.attname AS child_column
      FROM pg_constraint constraint_info
      JOIN pg_class parent
        ON parent.oid = constraint_info.confrelid
      JOIN pg_namespace parent_namespace
        ON parent_namespace.oid = parent.relnamespace
      JOIN pg_class child
        ON child.oid = constraint_info.conrelid
      JOIN pg_namespace child_namespace
        ON child_namespace.oid = child.relnamespace
      JOIN unnest(constraint_info.conkey) WITH ORDINALITY AS child_key(attnum, ord)
        ON TRUE
      JOIN unnest(constraint_info.confkey) WITH ORDINALITY AS parent_key(attnum, ord)
        ON child_key.ord = parent_key.ord
      JOIN pg_attribute child_att
        ON child_att.attrelid = child.oid
       AND child_att.attnum = child_key.attnum
      JOIN pg_attribute parent_att
        ON parent_att.attrelid = parent.oid
       AND parent_att.attnum = parent_key.attnum
      WHERE constraint_info.contype = 'f'
        AND parent_namespace.nspname = 'public'
        AND child_namespace.nspname = 'public'
        AND parent.relname = $1
        AND parent_att.attname = 'id';
    `,
    sourceTable,
  )

  referencingTableCache.set(sourceTable, rows)
  return rows
}

export async function DELETE(request: Request) {
  try {
    const accessDenied = await requireApiAccess({ action: 'assistance.delete', page: '/documents' })
    if (accessDenied) return accessDenied

    const destructiveDenied = await requireDestructiveAuthorization(request)
    if (destructiveDenied) return destructiveDenied

    const body = await request.json()
    const { sourceTable, recordId, fileId } = readServiceRecordPayload(body)

    if (!SERVICE_TABLES.has(sourceTable)) {
      return NextResponse.json({ success: false, error: 'Geçersiz yardım tablosu.' }, { status: 400 })
    }

    if (!recordId || !fileId) {
      return NextResponse.json({ success: false, error: 'Kayıt ve dosya bilgisi zorunludur.' }, { status: 400 })
    }

    const existingRows = await prisma.$queryRawUnsafe<ServiceRecordStatusRow[]>(
      `SELECT durumu::int AS durumu FROM ${sourceTable} WHERE id = $1::bigint AND dosyaid = $2::bigint LIMIT 1`,
      recordId.toString(),
      fileId.toString(),
    )
    const existingRecord = existingRows[0]

    if (!existingRecord) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt bulunamadı.' }, { status: 404 })
    }

    const deletedCount = await prisma.$transaction(async (tx) => {
      await stampAuditUser(tx, undefined, getAuditMetaFromRequest(request))

      const knownChildTables = (SERVICE_RECORD_CHILD_TABLES[sourceTable] ?? []).map((childTable) => ({
        child_table: childTable,
        child_column: 'yardimid',
      }))
      const databaseChildTables = await getReferencingTables(tx, sourceTable)
      const childTables = [...databaseChildTables, ...knownChildTables]
      const seenChildTables = new Set<string>()

      for (const childReference of childTables) {
        const childKey = `${childReference.child_table}.${childReference.child_column}`
        if (seenChildTables.has(childKey) || childReference.child_table === sourceTable) continue
        seenChildTables.add(childKey)

        try {
          if (childReference.child_column === 'yardimid') {
            await tx.$executeRawUnsafe(
              `UPDATE ${quoteIdentifier(childReference.child_table)}
               SET ${quoteIdentifier(childReference.child_column)} = NULL
               WHERE ${quoteIdentifier(childReference.child_column)} = $1::bigint`,
              recordId.toString(),
            )
          } else {
            await tx.$executeRawUnsafe(
              `DELETE FROM ${quoteIdentifier(childReference.child_table)} WHERE ${quoteIdentifier(childReference.child_column)} = $1::bigint`,
              recordId.toString(),
            )
          }
        } catch (error) {
          if (!isMissingRelationOrColumnError(error)) {
            throw error
          }
        }
      }

      await tx.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(sourceTable)} DISABLE TRIGGER USER`)

      try {
        return await tx.$executeRawUnsafe(
          `DELETE FROM ${quoteIdentifier(sourceTable)} WHERE id = $1::bigint AND dosyaid = $2::bigint`,
          recordId.toString(),
          fileId.toString(),
        )
      } finally {
        await tx.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(sourceTable)} ENABLE TRIGGER USER`)
      }
    })

    if (deletedCount === 0) {
      return NextResponse.json({ success: false, error: 'Silinecek kayıt bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, deletedCount })
  } catch (error) {
    console.error('Service record delete error:', error)
    if (isForeignKeyError(error)) {
      return NextResponse.json(
        { success: false, error: 'Bu yardıma bağlı hareket kayıtları olduğu için silinemedi.' },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıt silinemedi.' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    // Normalde "Yardım güncelleme" (assistance.update) yetkisi gerekir -
    // ANCAK "Onay Bekleyenler" sayfasindan bir "Uygun Görüş İste" talebindeki
    // istenen yardimlari reddeden Yetkili Personel (veya admin), bu yetkiye
    // sahip olmayabilir (bkz. convert-application/route.ts - AYNI gerekce).
    // Bu yuzden IKI yoldan biri yeterli.
    const actionAccessDenied = await requireApiAccess({ action: 'assistance.update', page: '/documents' })
    if (actionAccessDenied) {
      const authorizedCheck = await requireAuthorizedPersonnelOrAdmin()
      if (authorizedCheck.response) return authorizedCheck.response
    }

    const body = await request.json()
    const { sourceTable, recordId, fileId } = readServiceRecordPayload(body)
    const status = cleanStatus(body.status)
    const updateMode = typeof body.mode === 'string' ? body.mode : 'status'
    const hasField = (fieldName: string) => Object.prototype.hasOwnProperty.call(body, fieldName)

    if (!SERVICE_TABLES.has(sourceTable)) {
      return NextResponse.json({ success: false, error: 'Geçersiz yardım tablosu.' }, { status: 400 })
    }

    if (updateMode === 'cancel') {
      if (!recordId || !fileId) {
        return NextResponse.json({ success: false, error: 'Kayıt ve dosya bilgisi zorunludur.' }, { status: 400 })
      }

      const cancelDate = cleanDateText(body.cancelDate)
      const cancelReason = cleanText(body.cancelReason)

      if (!cancelDate || !cancelReason) {
        return NextResponse.json({ success: false, error: 'İptal tarihi ve nedeni zorunludur.' }, { status: 400 })
      }

      const columns = await getServiceRecordColumns(sourceTable)
      const updates: Array<{ column: string; value: string | number | null }> = []
      const pushUpdate = (column: string, value: string | number | null) => {
        if (columns.has(column)) updates.push({ column, value })
      }

      pushUpdate('durumu', 1)
      pushUpdate('durumutarih', cancelDate)
      if (columns.has('durumuaciklama')) {
        pushUpdate('durumuaciklama', cancelReason)
      } else if (columns.has('aciklama')) {
        pushUpdate('aciklama', cancelReason)
      } else if (columns.has('muracaataciklama')) {
        pushUpdate('muracaataciklama', cancelReason)
      }
      pushUpdate('islemtarihi', new Date().toISOString())

      if (updates.length === 0) {
        return NextResponse.json({ success: false, error: 'Güncellenecek alan bulunamadı.' }, { status: 400 })
      }

      const setClause = updates
        .map((update, index) => `${quoteIdentifier(update.column)} = $${index + 1}`)
        .join(', ')
      const params = updates.map((update) => update.value)
      params.push(recordId.toString(), fileId.toString())

      const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(sourceTable)}
         SET ${setClause}
         WHERE id = $${params.length - 1}::bigint AND dosyaid = $${params.length}::bigint`,
        ...params,
      ), getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json({ success: false, error: 'Güncellenecek kayıt bulunamadı.' }, { status: 404 })
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    if (updateMode === 'application-payment') {
      if (!['yrd_ddgidadosyali', 'yrd_giyim'].includes(sourceTable)) {
        return NextResponse.json(
          { success: false, error: 'Odeme islemi sadece Donem Disi Gida ve Giyim muracaatlari icin kullanilabilir.' },
          { status: 400 },
        )
      }

      if (!recordId || !fileId) {
        return NextResponse.json({ success: false, error: 'Kayit ve dosya bilgisi zorunludur.' }, { status: 400 })
      }

      const paymentDate = cleanDateText(body.paymentDate)
      const description = cleanText(body.description)

      if (!paymentDate || !description) {
        return NextResponse.json({ success: false, error: 'Odeme tarihi ve aciklama zorunludur.' }, { status: 400 })
      }

      const columns = await getServiceRecordColumns(sourceTable)
      const updates: Array<{ column: string; value: string | number | null }> = []
      const pushUpdate = (column: string, value: string | number | null) => {
        if (columns.has(column)) updates.push({ column, value })
      }

      pushUpdate('durumu', 6)
      pushUpdate('durumutarih', paymentDate)
      pushUpdate('durumuaciklama', description)
      pushUpdate('aciklama', description)
      pushUpdate('islemtarihi', new Date().toISOString())

      if (updates.length === 0) {
        return NextResponse.json({ success: false, error: 'Guncellenecek alan bulunamadi.' }, { status: 400 })
      }

      const setClause = updates
        .map((update, index) => `${quoteIdentifier(update.column)} = $${index + 1}`)
        .join(', ')
      const params = updates.map((update) => update.value)
      params.push(recordId.toString(), fileId.toString())

      const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(sourceTable)}
         SET ${setClause}
         WHERE id = $${params.length - 1}::bigint AND dosyaid = $${params.length}::bigint`,
        ...params,
      ), getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json({ success: false, error: 'Guncellenecek kayit bulunamadi.' }, { status: 404 })
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    if (updateMode === 'details') {
      if (!recordId || !fileId) {
        return NextResponse.json({ success: false, error: 'Kayıt ve dosya bilgisi zorunludur.' }, { status: 400 })
      }

      const columns = await getServiceRecordColumns(sourceTable)
      const updates: Array<{ column: string; value: string | number | null }> = []
      const pushUpdate = (column: string, value: string | number | null) => {
        if (columns.has(column)) updates.push({ column, value })
      }

      const applicationDate = hasField('date') ? cleanDateText(body.date) : null
      const startDate = hasField('startDate') ? cleanDateText(body.startDate) : null
      const endDate = hasField('endDate') ? cleanDateText(body.endDate) : null
      const amount = hasField('amount') ? cleanInt(body.amount) : null
      const breakfastAmount = hasField('breakfastAmount') ? cleanInt(body.breakfastAmount) : null
      const period = hasField('period') ? cleanText(body.period) : null
      const label = hasField('label') ? cleanText(body.label) : null
      const description = hasField('description') ? cleanText(body.description) : null

      if (sourceTable === 'yrd_ayninakti') {
        const cashLabels = await resolveCashPredefinedLabels(period, label)

        if (hasField('period')) pushUpdate('donem', cashLabels.period)
        if (hasField('label')) pushUpdate('etiket', cashLabels.label)

        if (updates.length === 0) {
          return NextResponse.json({ success: false, error: 'Güncellenecek alan bulunamadı.' }, { status: 400 })
        }

        const setClause = updates
          .map((update, index) => `${quoteIdentifier(update.column)} = $${index + 1}`)
          .join(', ')
        const params = updates.map((update) => update.value)
        params.push(recordId.toString(), fileId.toString())

        const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
          `UPDATE ${quoteIdentifier(sourceTable)}
           SET ${setClause}
           WHERE id = $${params.length - 1}::bigint AND dosyaid = $${params.length}::bigint`,
          ...params,
        ), getAuditMetaFromRequest(request))

        if (updatedCount === 0) {
          return NextResponse.json({ success: false, error: 'Güncellenecek kayıt bulunamadı.' }, { status: 404 })
        }

        return NextResponse.json({ success: true, updatedCount })
      }

      if (hasField('date')) pushUpdate('muracaattarihi', applicationDate)
      if (hasField('startDate')) pushUpdate('bastarih', startDate)
      if (hasField('endDate')) pushUpdate('bittarih', endDate)
      if (hasField('amount')) {
        pushUpdate('miktar', amount)
        pushUpdate('kisisayisi', amount)
      }
      if (hasField('breakfastAmount')) pushUpdate('kahvaltimiktari', breakfastAmount)
      if (hasField('period')) {
        pushUpdate('donem', period)
        pushUpdate('nedeni', period)
      }
      if (hasField('label')) pushUpdate('etiket', label)
      if (hasField('description')) {
        // Ekranda gosterilen "Açıklama" sutunu aslinda ucu bir COALESCE'dir
        // (bkz. app/api/documents/fetch/route.ts: COALESCE(muracaataciklama,
        // aciklama, durumuaciklama)) - kullanici bu alani duzenleme
        // formundan BOSALTTIGINDA sadece aciklama/muracaataciklama NULL
        // oluyordu, durumuaciklama (ör. daha once "Yardım Süresi Bitmiştir."
        // gibi bir durum notu) dokunulmadan kaliyordu ve COALESCE oraya
        // dusup ESKI METNI GERI GETIRIYORDU - kullanici alani silip
        // kaydettiginde "silinmiyor" gibi gorunuyordu. Ucunu de ayni degere
        // esitleyerek bu geri-donme durumunu ortadan kaldiriyoruz.
        pushUpdate('aciklama', description)
        pushUpdate('muracaataciklama', description)
        pushUpdate('durumuaciklama', description)
      }
      if (status !== null) {
        pushUpdate('durumu', status)
        pushUpdate('durumutarih', new Date().toISOString().slice(0, 10))
      }
      pushUpdate('islemtarihi', new Date().toISOString())

      if (updates.length === 0) {
        return NextResponse.json({ success: false, error: 'Güncellenecek alan bulunamadı.' }, { status: 400 })
      }

      const setClause = updates
        .map((update, index) => `${quoteIdentifier(update.column)} = $${index + 1}`)
        .join(', ')
      const params = updates.map((update) => update.value)
      params.push(recordId.toString(), fileId.toString())

      const updatedCount = await withAuditedWrite((tx) => tx.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(sourceTable)}
         SET ${setClause}
         WHERE id = $${params.length - 1}::bigint AND dosyaid = $${params.length}::bigint`,
        ...params,
      ), getAuditMetaFromRequest(request))

      if (updatedCount === 0) {
        return NextResponse.json({ success: false, error: 'Güncellenecek kayıt bulunamadı.' }, { status: 404 })
      }

      return NextResponse.json({ success: true, updatedCount })
    }

    if (!recordId || !fileId || status === null) {
      return NextResponse.json({ success: false, error: 'Kayıt, dosya ve durum bilgisi zorunludur.' }, { status: 400 })
    }

    const updatedCount = await withAuditedWrite(async (tx) => {
      if (END_DATE_STATUSES.has(status)) {
        try {
          return await tx.$executeRawUnsafe(
            `UPDATE ${sourceTable}
             SET durumu = $1::int,
                 durumutarih = CURRENT_DATE,
                 bittarih = CURRENT_DATE
             WHERE id = $2::bigint AND dosyaid = $3::bigint`,
            status,
            recordId.toString(),
            fileId.toString(),
          )
        } catch (error) {
          if (!isMissingRelationOrColumnError(error)) {
            throw error
          }

          return tx.$executeRawUnsafe(
            `UPDATE ${sourceTable}
             SET durumu = $1::int,
                 durumutarih = CURRENT_DATE
             WHERE id = $2::bigint AND dosyaid = $3::bigint`,
            status,
            recordId.toString(),
            fileId.toString(),
          )
        }
      }

      if (status === 2) {
        // NOT: "Yardımı Yeniden Başlat" durumu=2'ye donerken bastarih'i
        // bugune cekiyor ama durumuaciklama'ya HIC dokunmuyordu. Daha once
        // (bittarih gecince) "Yardım Süresi Bitmiştir." gibi bir metinle
        // durumu=4 yapilmissa, o eski metin burada TEMIZLENMEDEN kaliyor -
        // yardim aslinda tekrar aktif oldugu halde acikklama sutunu hala
        // "suresi bitti" diyordu. Reaktivasyonda bu eski metni siliyoruz
        // (bos birakiyoruz) - yerine yeni bir metin YAZMIYORUZ, kullanici
        // Açıklama alaninin bos kalmasini istiyor.
        try {
          return await tx.$executeRawUnsafe(
            `UPDATE ${quoteIdentifier(sourceTable)}
             SET durumu = $1::int,
                 durumutarih = CURRENT_DATE,
                 bastarih = CURRENT_DATE,
                 durumuaciklama = NULL
             WHERE id = $2::bigint AND dosyaid = $3::bigint`,
            status,
            recordId.toString(),
            fileId.toString(),
          )
        } catch (error) {
          if (!isMissingRelationOrColumnError(error)) throw error
          return tx.$executeRawUnsafe(
            `UPDATE ${quoteIdentifier(sourceTable)}
             SET durumu = $1::int,
                 durumutarih = CURRENT_DATE
             WHERE id = $2::bigint AND dosyaid = $3::bigint`,
            status,
            recordId.toString(),
            fileId.toString(),
          )
        }
      }

      return tx.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(sourceTable)} SET durumu = $1::int WHERE id = $2::bigint AND dosyaid = $3::bigint`,
        status,
        recordId.toString(),
        fileId.toString(),
      )
    }, getAuditMetaFromRequest(request))

    if (updatedCount === 0) {
      return NextResponse.json({ success: false, error: 'Güncellenecek kayıt bulunamadı.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, updatedCount })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Kayıt güncellenemedi.' },
      { status: 500 },
    )
  }
}

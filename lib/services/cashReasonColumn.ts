import { getSqlMonitorPool } from '@/lib/services/sqlMonitor.service'
import { CASH_REASON_MAX_LENGTH } from '@/lib/nakitAutoRejectText'

// Kullanici karari (2026-10-14): yrd_ayninakti.durumuaciklama (iptal nedeni /
// otomatik red açıklaması) varchar(100) idi; otomatik red açıklaması +
// "-------" + kullanıcının yazdığı neden sığmıyordu. Alan 500 karaktere
// genişletilir. Kendi kendini onaran desen (bkz. transfer-to-cash
// ensureYrdAyninaktiAdresColumn): ilk ihtiyaç anında BİR KEZ çalışır; alan
// zaten genişse hiçbir şey yapmaz. varchar uzunluğunu ARTIRMAK PostgreSQL'de
// tabloyu yeniden yazmaz (yalnızca katalog değişikliği).
//
// Dönüş: alanın GERÇEK uzunluğu - genişletme bir sebeple başarısız olursa
// yazan taraflar metni buna göre keser (aksi halde "value too long" hatasıyla
// iptal/otomatik red işleminin TAMAMI başarısız olurdu).
let cachedLength: number | null = null

export async function ensureCashReasonColumnWidth(): Promise<number> {
  if (cachedLength !== null) return cachedLength
  const pool = getSqlMonitorPool()
  const readLength = async () => {
    const result = await pool.query<{ len: number | null; data_type: string }>(`
      SELECT character_maximum_length AS len, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'yrd_ayninakti' AND column_name = 'durumuaciklama'
    `)
    const row = result.rows[0]
    if (!row || row.data_type !== 'character varying' || row.len === null) return CASH_REASON_MAX_LENGTH // text vb.
    return row.len
  }

  try {
    let length = await readLength()
    if (length < CASH_REASON_MAX_LENGTH) {
      try {
        await pool.query(`ALTER TABLE public.yrd_ayninakti ALTER COLUMN durumuaciklama TYPE varchar(${CASH_REASON_MAX_LENGTH})`)
        length = await readLength()
      } catch (error) {
        console.error('yrd_ayninakti.durumuaciklama genisletilemedi:', error)
      }
    }
    cachedLength = length
    return length
  } catch (error) {
    console.error('yrd_ayninakti.durumuaciklama uzunlugu okunamadi:', error)
    return 100
  }
}

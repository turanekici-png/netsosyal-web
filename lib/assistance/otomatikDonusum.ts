// 2026-10-15 kullanici istegi: Dosya Yönetimi "Yeni Müracaat Ekle" ve Sonuç
// Bekleyen "+ Yardım Ekle" ile acilan Gıda Bankası / Destek Paketi / Ekmek /
// Hazır Yemek muracaatlari, eklendikten HEMEN sonra ayni bilgilerle yardima
// donusturulur ve donemleri olusturulur. Donusum mevcut, test edilmis
// /api/documents/convert-application ucuyla yapilir (Gida/Destek icin donem +
// hareket kaydini da o acar); Sonuç Bekleyen "Kaydet" akisindaki ile ayni
// sekilde /api/documents/manual-period ile donem garantilenir (409 = zaten var).
//
// Kış Dönemi muracaatlarina DOKUNULMAZ - mevcut kurala gore baslangic
// tarihinde (1 Kasim) winterSeasonalAid isi tarafindan acilirlar.

export const OTOMATIK_DONUSEN_TABLOLAR = new Set(['yrd_gidabankasi', 'yrd_destekpaketi', 'yrd_ekmek', 'yrd_haziryemek'])

export type OtomatikDonusumSonucu =
  | { durum: 'donusturuldu' }
  | { durum: 'atlandi'; neden: 'tur' | 'kis-donemi' }
  | { durum: 'hata'; mesaj: string }

export async function muracaatiYardimaDonustur(girdi: {
  fileId: string
  recordId: string
  sourceTable: string
  period?: string | null
  donemTarihi?: string // YYYY-MM-DD; verilmezse bugun
}): Promise<OtomatikDonusumSonucu> {
  if (!OTOMATIK_DONUSEN_TABLOLAR.has(girdi.sourceTable)) return { durum: 'atlandi', neden: 'tur' }
  if ((girdi.period || '').trim().toLocaleLowerCase('tr-TR') === 'kış dönemi') return { durum: 'atlandi', neden: 'kis-donemi' }

  try {
    const response = await fetch('/api/documents/convert-application', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: girdi.fileId, recordId: girdi.recordId, sourceTable: girdi.sourceTable }),
    })
    const payload = await response.json().catch(() => null) as { success?: boolean; error?: string } | null
    if (!response.ok || !payload?.success) {
      return { durum: 'hata', mesaj: payload?.error || 'Müracaat yardıma dönüştürülemedi.' }
    }

    if (girdi.sourceTable === 'yrd_gidabankasi' || girdi.sourceTable === 'yrd_destekpaketi') {
      const bugun = new Date()
      const donemTarihi = girdi.donemTarihi
        || `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, '0')}-${String(bugun.getDate()).padStart(2, '0')}`
      const periodResponse = await fetch('/api/documents/manual-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: girdi.fileId, recordId: girdi.recordId, sourceTable: girdi.sourceTable, periodDate: donemTarihi }),
      })
      if (!periodResponse.ok && periodResponse.status !== 409) {
        const periodPayload = await periodResponse.json().catch(() => null) as { error?: string } | null
        return { durum: 'hata', mesaj: periodPayload?.error || 'Yardım dönüştürüldü ancak dönemi oluşturulamadı.' }
      }
    }

    return { durum: 'donusturuldu' }
  } catch (error) {
    return { durum: 'hata', mesaj: error instanceof Error ? error.message : 'Müracaat yardıma dönüştürülemedi.' }
  }
}

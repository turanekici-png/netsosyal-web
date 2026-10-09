export const CUSTOM_REPORT_PRESETS_SETTING_KEY = 'custom_report_presets'

// Kullanıcının "Özel Rapor Oluştur" ekranında kurup kaydettiği bir rapor
// tasarımının anlık görüntüsü - kaynak tablo, aktif ek tablo (join'ler),
// koşullar, gösterilecek sütunlar. Kaydedilince tekrar aynı raporu kurmadan,
// tek tıkla geri yüklenebilir (bkz. app/(modules)/reports/ozel).
export interface CustomReportPreset {
  id: string
  name: string
  createdAt: string
  createdByUserId?: string | null
  createdByUserName?: string | null
  // URLSearchParams.toString() çıktısı - "source=...&cols=...&c0_field=..." vb.
  queryString: string
}

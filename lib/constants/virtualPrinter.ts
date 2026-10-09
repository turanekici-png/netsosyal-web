// Kullanici istegi (2026-09-28): "bir yardım türü için bu sanal yazıcı
// seçilir ise ... yardım_sayaç tablosuna göndermek istiyorum" - bu, gercek
// bir Windows yazicisi DEGIL, yazici secim listelerine eklenen ozel bir
// secenek. Secildiginde HICBIR fiziksel/agent yazdirma yapilmaz, sadece
// yardim_sayac tablosuna kayit atilir (bkz. app/(modules)/documents/page.tsx
// - printRenderedDesign). Bu sabit hem yazdirma penceresinde (documents/
// page.tsx) hem de kalici printer atamasinin yapildigi Formlar ve Tasarim
// ayarlarinda (settings/form-designer/page.tsx) AYNEN kullanilmali - aksi
// halde iki taraf birbirini taniyamaz ("Sanal Yazıcı" secilse bile normal
// bir yazici sanilip fiziksel yazdirma denenir).
export const VIRTUAL_PRINTER_NAME = 'Sanal Yazıcı (Yazdırmadan Kaydet)'
